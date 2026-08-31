import {
  InMemoryPubSubBus,
  PubSubTopics,
  type CloudEventEnvelope,
  createPubSubPublisherPort,
  governanceEventPublishModeFromEnv,
} from "@truemandate/cloud-pubsub";
import {
  IntentProvenanceS2SClient,
  adcIdentityTokenProvider,
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  LearningS2SClient,
  requireIntentProvenanceUrl,
  requireGatewayUrl,
  requireLearningUrl,
  requireOutcomeResolutionUrl,
  GatewayS2SClient,
  OutcomeS2SClient,
  ResolutionS2SClient,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { ok, type Result } from "@truemandate/protocol";
import { IntentService } from "@truemandate/intent-service";
import { initTracing } from "@truemandate/observability";
import { AuthorityService } from "../service.js";
import { createAuthorityInternalRoutes } from "../internal-routes.js";
import { createApprovalRoutes } from "../approval-routes.js";
import {
  applyOutcomeEventToMonitoring,
  createMonitoringRoutes,
} from "../monitoring-routes.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const publicLifecycleReadCallers = (process.env.TM_PUBLIC_BFF_CALLER_EMAIL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const evaluationReadCallers = [
    ...publicLifecycleReadCallers,
    ...(process.env.TM_OUTCOME_RESOLUTION_CALLER_EMAIL ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...(process.env.TM_GATEWAY_CALLER_EMAIL ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  initTracing({ serviceName: config.serviceName });
  requireIntentProvenanceUrl(config);
  requireGatewayUrl(config); requireLearningUrl(config); requireOutcomeResolutionUrl(config);
  const persist = await initRuntimePersistence();
  const intents = new IntentService(persist.bundle.intents);
  const governancePublisher = await createPubSubPublisherPort(
    governanceEventPublishModeFromEnv(),
  );
  const monitoringStore = persist.bundle.monitoringContracts;
  const authority = new AuthorityService(
    intents,
    persist.bundle.grants,
    persist.bundle.exposure,
    governancePublisher,
    {
      assertPrivilegedActionAllowed: (workflowId) =>
        monitoringStore.assertPrivilegedActionAllowed(workflowId),
    },
  );

  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();
  const artifacts = new IntentProvenanceS2SClient(config.intentProvenanceUrl!, tokenProvider);
  const gatewayOwner = new GatewayS2SClient(config.gatewayUrl!, tokenProvider);
  const learningOwner = new LearningS2SClient(config.learningUrl!, tokenProvider);
  const outcomeOwner = new OutcomeS2SClient(config.outcomeResolutionUrl!, tokenProvider);
  const resolutionOwner = new ResolutionS2SClient(config.outcomeResolutionUrl!, tokenProvider);

  const bus = new InMemoryPubSubBus();
  const onEvent = async (envelope: CloudEventEnvelope): Promise<Result<unknown>> => {
    const payload = envelope.payload as Record<string, unknown>;
    if (typeof payload.rawText === "string" && typeof payload.principalId === "string") {
      const created = await intents.createIntent(payload);
      if (!created.ok) return created;
    }
    return ok();
  };
  bus.subscribe(PubSubTopics.INTENT, onEvent);
  bus.subscribe(PubSubTopics.GUARDIAN, onEvent);
  bus.subscribe(PubSubTopics.PLAN, onEvent);
  // Wave 4.3: fail-open MonitoringContract escalation from outcome events.
  bus.subscribe(PubSubTopics.OUTCOME, async (envelope) => {
    await applyOutcomeEventToMonitoring(monitoringStore, {
      type: envelope.type,
      payload: envelope.payload as Record<string, unknown>,
    });
    return ok();
  });

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [
      PubSubTopics.INTENT,
      PubSubTopics.GUARDIAN,
      PubSubTopics.PLAN,
      PubSubTopics.OUTCOME,
    ],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
      intentProvenanceConfigured: Boolean(config.intentProvenanceUrl),
    },
    enableEvents: true,
    internalRoutes: [
      ...createAuthorityInternalRoutes({ authority, artifacts, evaluations: persist.bundle.authorityEvaluations as never, preparedActions: { get: (id) => gatewayOwner.getPreparedAction(id) }, outcomeContracts: { get: (id) => outcomeOwner.getContract(id) }, provenance: artifacts, approvals: { get: (id) => persist.bundle.approvals.get(id) }, learning: learningOwner, resolution: { getMandate: (id) => resolutionOwner.getMandate(id), getCase: (id) => resolutionOwner.getCase(id), getRemedy: (caseId, remedyId) => resolutionOwner.getRemedy(caseId, remedyId) }, evaluationReadCallers }),
      ...createApprovalRoutes({
        approvals: {
          get: (id) =>
            persist.bundle.approvals.get(id) as Promise<
              import("@truemandate/protocol").ApprovalRequest | undefined
            >,
          putIfAbsent: (id, value) => persist.bundle.approvals.putIfAbsent(id, value),
          put: (id, value) => persist.bundle.approvals.put(id, value),
        },
        approvalEvents: { putIfAbsent: (id, value) => persist.bundle.approvalEvents.putIfAbsent(id, value) },
        evaluations: persist.bundle.authorityEvaluations as never,
        tip: {
          getCurrentIntentState: async (intentId) => {
            const tip = await intents.getCurrentIntentState(intentId);
            if (!tip.ok) return tip;
            return { ok: true, value: { id: tip.value.id, stateHash: tip.value.stateHash } };
          },
        },
        stageRecorder: persist.bundle.workflowStages,
        publicLifecycleReadCallers,
      }),
      ...createMonitoringRoutes({
        monitoring: monitoringStore,
        evaluations: persist.bundle.authorityEvaluations as never,
      }),
    ],
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "authority listening",
      service: config.serviceName,
      port: config.port,
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
