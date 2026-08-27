import {
  InMemoryPubSubBus,
  PubSubTopics,
  type CloudEventEnvelope,
  createPubSubPublisherPort,
  governanceEventPublishModeFromEnv,
} from "@truemandate/cloud-pubsub";
import {
  IntentProvenanceS2SClient,
  EvidenceS2SClient,
  AuthorityS2SClient,
  OutcomeS2SClient,
  GatewayS2SClient,
  adcIdentityTokenProvider,
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  requireIntentProvenanceUrl,
  requireEvidenceUrl,
  requireAuthorityUrl,
  requireOutcomeResolutionUrl,
  requireGatewayUrl,
  requireModelArmorConfig,
  requireVertexConfig,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { ModelArmorAdapter } from "@truemandate/cloud-security";
import {
  VertexGeminiModel,
  modelConcurrencyLimitFromEnv,
  type ModelConcurrencyObserver,
} from "@truemandate/model";
import { initTracing } from "@truemandate/observability";
import { ProvenanceService } from "@truemandate/provenance-service";
import { handleIntentCompileEvent } from "../intent-event-handler.js";
import { GenericWorkflowEngine } from "../generic-workflow-engine.js";
import { InvoiceVendorPaymentDomainPack } from "../invoice-vendor-payment-domain-pack.js";
import { LogisticsFulfillmentDomainPack } from "../logistics-fulfillment-domain-pack.js";
import { ProcurementDomainPack } from "../procurement-domain-pack.js";
import { SaasItSpendDomainPack } from "../saas-it-spend-domain-pack.js";
import { TravelDomainPack } from "../travel-domain-pack.js";
import { AuthoritativeIntentService } from "../authoritative-intent-service.js";
import { createAgentRuntimeInternalRoutes } from "../internal-routes.js";
import { PreExecutionReadinessService } from "../pre-execution-readiness.js";
import { GenericWorkflowDispatcher } from "../workflow-dispatcher.js";
import type { WorkflowRequestBase } from "../domain-pack.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  requireVertexConfig(config);
  requireModelArmorConfig(config);
  requireIntentProvenanceUrl(config);
  requireEvidenceUrl(config);
  requireAuthorityUrl(config);
  requireOutcomeResolutionUrl(config);
  requireGatewayUrl(config);
  const persist = await initRuntimePersistence();
  const concurrencyLimit = modelConcurrencyLimitFromEnv();
  const concurrencyObserver: ModelConcurrencyObserver = {
    record: (event) => console.info(JSON.stringify({
      ...event,
      service: config.serviceName,
      revision: process.env.K_REVISION,
      instanceId: process.env.HOSTNAME,
    })),
  };
  const modelConcurrency = persist.bundle.createModelConcurrencyLimiter({
    limit: concurrencyLimit,
    ownerId: `${process.env.K_REVISION ?? "local"}:${process.env.HOSTNAME ?? process.pid}`,
    observer: concurrencyObserver,
  });
  // Wave 2: durable production model-call telemetry (success and every
  // documented failure branch). Fail-open — a Firestore write failure inside
  // the store never throws into generateStructured().
  const vertex = VertexGeminiModel.fromEnv(
    undefined,
    persist.bundle.modelTelemetry,
    modelConcurrency,
  );
  if (!vertex.ok) {
    throw new Error(vertex.message);
  }
  const armor = ModelArmorAdapter.fromEnv();
  if (!(await armor.probe())) {
    throw new Error("Model Armor probe failed — fail closed");
  }

  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();
  const owner = new IntentProvenanceS2SClient(
    config.intentProvenanceUrl!,
    tokenProvider,
  );
  // Adapt S2S Result-shaped reads to the durable port used by ProvenanceService
  // cross-instance hydration (Wave 1). Appends still go through owner routes.
  const provenance = new ProvenanceService({
    appendNode: (node) => owner.appendNode(node),
    appendEdge: (edge) => owner.appendEdge(edge),
    getNode: async (id) => {
      const result = await owner.getNode(id);
      if (!result.ok) return undefined;
      return { payload: result.value, createdAt: result.value.createdAt };
    },
    getEdge: async (id) => {
      const result = await owner.getEdge(id);
      if (!result.ok) return undefined;
      return { payload: result.value, createdAt: result.value.createdAt };
    },
  });
  const intents = new AuthoritativeIntentService(owner);
  const evidence = new EvidenceS2SClient(config.evidenceUrl!, tokenProvider);
  const authority = new AuthorityS2SClient(config.authorityUrl!, tokenProvider);
  const outcomes = new OutcomeS2SClient(config.outcomeResolutionUrl!, tokenProvider);
  const gateway = new GatewayS2SClient(config.gatewayUrl!, tokenProvider);
  const governancePublisher = await createPubSubPublisherPort(
    governanceEventPublishModeFromEnv(),
  );
  // Wave 2: durable workflow-stage timing (COMPILATION/VERIFICATION/GUARDIAN).
  // Fail-open — a Firestore write failure inside the store never throws into
  // the compile/verify/guardian pipeline it observes.
  // Constructed before the engines: the same operation the internal route exposes
  // is now also the lifecycle's own evidence-backed readiness handoff, called
  // in-process so no service has to hold the verifier caller identity to reach it.
  const preExecutionReadiness = new PreExecutionReadinessService({
    intents,
    owner: owner as ConstructorParameters<typeof PreExecutionReadinessService>[0]["owner"],
    evidence,
  });
  const sharedDeps = {
    intents,
    owner,
    evidence,
    preExecutionReadiness,
    authority,
    outcomes,
    gateway,
    model: vertex.value,
    provenance,
    stageRecorder: persist.bundle.workflowStages,
    publisher: governancePublisher,
  } as const;
  const procurementCoordinator = new GenericWorkflowEngine({
    pack: ProcurementDomainPack,
    ...sharedDeps,
  });
  const travelCoordinator = new GenericWorkflowEngine({
    pack: TravelDomainPack,
    ...sharedDeps,
  });
  const saasCoordinator = new GenericWorkflowEngine({
    pack: SaasItSpendDomainPack,
    ...sharedDeps,
  });
  const invoiceCoordinator = new GenericWorkflowEngine({
    pack: InvoiceVendorPaymentDomainPack,
    ...sharedDeps,
  });
  const logisticsCoordinator = new GenericWorkflowEngine({
    pack: LogisticsFulfillmentDomainPack,
    ...sharedDeps,
  });
  const dispatcher = new GenericWorkflowDispatcher(owner, {
    procurement: procurementCoordinator as GenericWorkflowEngine<WorkflowRequestBase>,
    travel: travelCoordinator as GenericWorkflowEngine<WorkflowRequestBase>,
    saas_it_spend: saasCoordinator as GenericWorkflowEngine<WorkflowRequestBase>,
    invoice_vendor_payment:
      invoiceCoordinator as GenericWorkflowEngine<WorkflowRequestBase>,
    logistics_fulfillment:
      logisticsCoordinator as GenericWorkflowEngine<WorkflowRequestBase>,
  });
  const internalCoordinator = {
    run: (raw: unknown) => dispatcher.run(raw),
    submitWorkflow: (raw: unknown) => dispatcher.submitWorkflow(raw),
    readWorkflow: (workflowId: string) => dispatcher.readWorkflow(workflowId),
    resumeWithApproval: (raw: unknown) => dispatcher.resumeWithApproval(raw),
    resumeWorkflow: (raw: unknown) => dispatcher.resumeWorkflow(raw),
    commitAuthorizedExecution: (raw: unknown) =>
      dispatcher.commitAuthorizedExecution(raw),
    commitWorkflow: (workflowId: string) => dispatcher.commitWorkflow(workflowId),
    evaluatePreExecutionReadiness: (raw: unknown) =>
      preExecutionReadiness.evaluate(raw),
  };

  const bus = new InMemoryPubSubBus();
  const onEvent = (envelope: CloudEventEnvelope) =>
    handleIntentCompileEvent(envelope, {
      intents: owner,
      provenance,
      compilerModel: vertex.value,
      verifierModel: vertex.value,
      modelSecurity: armor,
      stageRecorder: persist.bundle.workflowStages,
    });
  bus.subscribe(PubSubTopics.INTENT, onEvent);

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [PubSubTopics.INTENT],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      vertex: "initialized",
      geminiModel: config.geminiModel,
      vertexLocation: config.vertexLocation,
      vertexModelConcurrency: concurrencyLimit,
      armorConfigured: armor.configured,
      armorLive: armor.liveEnabled,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
      intentOwner: "intent-provenance-s2s",
    },
    enableEvents: true,
    internalRoutes: createAgentRuntimeInternalRoutes(internalCoordinator, {
      workflowCallerEmails: config.workflowCallerEmails,
      workflowCommitCallerEmails: config.workflowCommitCallerEmails,
      executionCallerEmails: config.executionCallerEmails,
      preExecutionReadinessCallerEmails: (process.env.TM_PRE_EXECUTION_READINESS_CALLER_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "agent-runtime listening",
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
