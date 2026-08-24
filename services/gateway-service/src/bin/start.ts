import {
  InMemoryPubSubBus,
  PubSubTopics,
  type CloudEventEnvelope,
  createPubSubPublisherPort,
  governanceEventPublishModeFromEnv,
} from "@truemandate/cloud-pubsub";
import {
  AuthorityS2SClient,
  IntentProvenanceS2SClient,
  createCloudRunHttpServer,
  adcIdentityTokenProvider,
  initRuntimePersistence,
  loadRuntimeConfig,
  OutcomeS2SClient,
  requireAuthorityUrl,
  requireInternalAllowedCallers,
  requireCommitCallerEmail,
  requireIntentProvenanceUrl,
  requireModelArmorConfig,
  requireOutcomeResolutionUrl,
  RuntimeConfigError,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { ModelArmorAdapter } from "@truemandate/cloud-security";
import { AuthorityService } from "@truemandate/authority-service";
import { IntentService } from "@truemandate/intent-service";
import { initTracing } from "@truemandate/observability";
import { OutcomeService } from "@truemandate/outcome-service";
import { ProvenanceService } from "@truemandate/provenance-service";
import { ErrorCode, err, ok, type ProvenanceEdge, type ProvenanceNode, type Result } from "@truemandate/protocol";
import { TwoPhaseGateway } from "../two-phase.js";
import { createGatewayInternalRoutes } from "../internal-routes.js";
import { createGatewayOwnerReaders } from "./owner-readers.js";

/**
 * Cloud Run entry: existing TwoPhaseGateway (MockPaymentAdapter — no live money).
 */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  requireModelArmorConfig(config);
  const commitCallerEmail = requireCommitCallerEmail(config);
  requireInternalAllowedCallers(config);
  requireAuthorityUrl(config);
  requireIntentProvenanceUrl(config);
  requireOutcomeResolutionUrl(config);
  const armor = ModelArmorAdapter.fromEnv();
  if (!(await armor.probe())) {
    throw new Error("Model Armor probe failed — fail closed");
  }
  const persist = await initRuntimePersistence();
  const bundle = persist.bundle;

  if (!config.requireInternalAuth) {
    throw new RuntimeConfigError("Gateway requires TM_REQUIRE_INTERNAL_AUTH=true");
  }

  const intents = new IntentService(bundle.intents);
  const governancePublisher = await createPubSubPublisherPort(
    governanceEventPublishModeFromEnv(),
  );
  const authority = new AuthorityService(
    intents,
    bundle.grants,
    bundle.exposure,
    governancePublisher,
  );
  const provenance = new ProvenanceService(bundle.provenance);
  const outcomes = new OutcomeService(undefined, {
    contracts: bundle.outcomeContracts,
    events: bundle.outcomeEvents,
  }, undefined, governancePublisher);
  const gateway = new TwoPhaseGateway({
    intents,
    authority,
    provenance,
    // Authorize-time Authority-provenance completeness gate: reads the
    // durable provenance rows the authority-binding route wrote. Missing
    // rows fail closed before any CommitToken is minted.
    provenanceOwner: {
      getNode: async (id) => {
        const record = await bundle.provenance.getNode(id);
        return record
          ? ok(record.payload as ProvenanceNode)
          : err(ErrorCode.VALIDATION_FAILED, "Unknown provenance node", { id });
      },
      getEdge: async (id) => {
        const record = await bundle.provenance.getEdge(id);
        return record
          ? ok(record.payload as ProvenanceEdge)
          : err(ErrorCode.VALIDATION_FAILED, "Unknown provenance edge", { id });
      },
    },
    outcomeBinding: outcomes,
    tokenStore: bundle.commitTokens,
    nonceStore: bundle.nonces,
    idempotencyStore: bundle.idempotency,
    reservations: bundle.economicReservations,
    ledger: bundle.sideEffects,
    preparedActionStore: bundle.preparedActions,
    // Wave 2: durable workflow-stage timing (PREPARE/AUTHORIZE/COMMIT).
    // Fail-open — a Firestore write failure inside the store never throws
    // into two-phase execution.
    stageRecorder: bundle.workflowStages,
  });
  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();
  const authorityOwner = new AuthorityS2SClient(config.authorityUrl!, tokenProvider);
  const intentOwner = new IntentProvenanceS2SClient(config.intentProvenanceUrl!, tokenProvider);
  const outcomeOwner = new OutcomeS2SClient(config.outcomeResolutionUrl!, tokenProvider);

  const bus = new InMemoryPubSubBus();
  const onEvent = async (envelope: CloudEventEnvelope): Promise<Result<unknown>> => {
    const payload = envelope.payload as Record<string, unknown>;
    if (typeof payload.rawText === "string" && typeof payload.principalId === "string") {
      const created = await intents.createIntent(payload);
      if (!created.ok) return created;
    }
    return ok();
  };
  bus.subscribe(PubSubTopics.AUTHORITY, onEvent);
  bus.subscribe(PubSubTopics.OUTCOME, onEvent);

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [PubSubTopics.AUTHORITY, PubSubTopics.OUTCOME],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      armorConfigured: armor.configured,
      armorLive: armor.liveEnabled,
      persistence: persist.mode,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
    },
    enableEvents: true,
    internalRoutes: createGatewayInternalRoutes({
      gateway,
      owners: createGatewayOwnerReaders({
        authority: authorityOwner,
        intents: intentOwner,
        outcomes: outcomeOwner,
      }),
      // Durable ApprovalRequest reads unlock REQUIRE_APPROVAL prepare
      // (mirrors resolution-service wiring). Without this port, prepare
      // short-circuits before any Firestore get.
      approvalReadPort: {
        get: (id) => persist.bundle.approvals.get(id),
      },
      // TM_COMMIT_CALLER_EMAIL may carry a comma-joined list: the explicit
      // COMMIT caller set now includes both the agent-runtime SA (Phase B
      // controlled execution) and the outcome-resolution SA (Wave 1 remedy
      // execution through the production PrivilegedRemedyPort).
      commitCallers: commitCallerEmail
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "gateway listening",
      service: config.serviceName,
      port: config.port,
      persistence: persist.mode,
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
