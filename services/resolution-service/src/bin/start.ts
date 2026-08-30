import {
  InMemoryPubSubBus,
  PubSubTopics,
  createPubSubPublisherPort,
  governanceEventPublishModeFromEnv,
} from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  IntentProvenanceS2SClient,
  AuthorityS2SClient,
  EvidenceS2SClient,
  GatewayS2SClient,
  adcIdentityTokenProvider,
  requireAuthorityUrl,
  requireGatewayCallerEmail,
  requireIntentProvenanceUrl,
  requireEvidenceUrl,
  requireGatewayUrl,
} from "@truemandate/cloud-runtime";
import { OutcomeService } from "@truemandate/outcome-service";
import { initTracing } from "@truemandate/observability";
import {
  handleEvidenceEvent,
  handleExecutionEvent,
} from "../event-handler.js";
import { requireAuthorityCallerEmail } from "@truemandate/cloud-runtime";
import { ResolutionService } from "../service.js";
import { createOutcomeInternalRoutes } from "../outcome-internal-routes.js";
import { createResolutionReadRoutes } from "../resolution-read-routes.js";
import { createRemedyRoutes } from "../remedy-routes.js";
import { createRemedyExecutionPort } from "../remedy-execution-port.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  requireAuthorityUrl(config);
  requireIntentProvenanceUrl(config);
  requireEvidenceUrl(config);
  requireGatewayUrl(config);
  const evaluationCallerEmail = config.phaseCVerifierCallerEmail;
  const wave1VerifierCallerEmail = config.wave1VerifierCallerEmail;
  const authorityCallerEmail = requireAuthorityCallerEmail(config);
  const gatewayCallerEmail = requireGatewayCallerEmail(config);
  const outcomeReaderCallerEmails = (process.env.TM_OUTCOME_READER_CALLER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const persist = await initRuntimePersistence();
  const stages = persist.bundle.workflowStages;
  const governancePublisher = await createPubSubPublisherPort(
    governanceEventPublishModeFromEnv(),
  );
  const outcomes = new OutcomeService(undefined, {
    contracts: persist.bundle.outcomeContracts,
    immutableContracts: persist.bundle.outcomeContractDefinitions,
    events: persist.bundle.outcomeEvents,
  }, stages, governancePublisher);
  const resolution = new ResolutionService(outcomes, undefined, {
    cases: persist.bundle.resolutionCases,
    triggers: persist.bundle.resolutionTriggers,
    mandates: persist.bundle.remediationMandates,
    events: persist.bundle.resolutionEvents,
    mandateClaims: persist.bundle.mandateClaims,
  }, {
    getIntentState: async (id) => (await persist.bundle.intents.getState(id)) ?? undefined,
    stageRecorder: stages,
    publisher: governancePublisher,
  });
  const ports = {
    outcomes,
    resolution,
    getIntentState: (id: string) => persist.bundle.intents.getState(id),
  };
  const tokens = await adcIdentityTokenProvider();
  const authority = new AuthorityS2SClient(config.authorityUrl!, tokens);
  const owner = new IntentProvenanceS2SClient(config.intentProvenanceUrl!, tokens);
  const evidence = new EvidenceS2SClient(config.evidenceUrl!, tokens);
  const gateway = new GatewayS2SClient(config.gatewayUrl!, tokens);
  // Production remedy execution port: the full independent authority chain
  // over the deployed owner routes (INV_023 — Resolution never mints grants
  // or calls the payment adapter itself).
  const remedyPort = createRemedyExecutionPort({
    owner,
    authority,
    gateway,
    outcomes,
    resolution,
  });
  const remedyCallers = [
    ...(config.internalAllowedCallers ?? []),
    ...(wave1VerifierCallerEmail ? [wave1VerifierCallerEmail] : []),
    ...(evaluationCallerEmail ? [evaluationCallerEmail] : []),
  ].filter((value, index, all) => all.indexOf(value) === index);

  const bus = new InMemoryPubSubBus();
  bus.subscribe(PubSubTopics.EXECUTION, (envelope) =>
    handleExecutionEvent(envelope, ports),
  );
  bus.subscribe(PubSubTopics.EVIDENCE, (envelope) =>
    handleEvidenceEvent(envelope, ports),
  );

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [PubSubTopics.EXECUTION, PubSubTopics.EVIDENCE],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      persistence: persist.mode,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
    },
    enableEvents: true,
    internalRoutes: [
      ...createOutcomeInternalRoutes(outcomes, {
        getEvaluation: (id) => authority.getEvaluation(id),
        getArtifact: (id) => owner.getSemanticArtifact(id),
        getState: (id) => owner.getIntentState(id),
        getTip: (intentId) => owner.getTip(intentId),
      }, {
        globalCallers: config.internalAllowedCallers,
        readerCallerEmails: outcomeReaderCallerEmails,
        gatewayCallerEmail,
        authorityCallerEmail,
        evaluationCallerEmail,
        evidenceReadPort: {
          getClaim: (id) => evidence.getClaim(id),
          getEnvelope: (id) => evidence.getEnvelope(id),
        },
        approvalReadPort: {
          get: (id) => persist.bundle.approvals.get(id),
        },
        resolutionRead: {
          getCaseByContract: (contractId) => resolution.getCaseByContract(contractId),
        },
        // Owner-side CLOSE: the verified acceptance/operator identity may
        // close a SATISFIED contract (the no-open-case guard still applies).
        closeCallers: [
          ...(config.internalAllowedCallers ?? []),
          ...(evaluationCallerEmail ? [evaluationCallerEmail] : []),
        ].filter((value, index, all) => all.indexOf(value) === index),
      }),
      // Case/mandate/remedy reads are shared with the independent Authority
      // owner (mandate-validated remedy evaluations) and the verifiers.
      ...createResolutionReadRoutes(resolution, [
        ...(authorityCallerEmail ? [authorityCallerEmail] : []),
        ...(evaluationCallerEmail ? [evaluationCallerEmail] : []),
        ...(wave1VerifierCallerEmail ? [wave1VerifierCallerEmail] : []),
        ...(config.internalAllowedCallers ?? []),
      ].filter((value, index, all) => all.indexOf(value) === index)),
      ...createRemedyRoutes({
        resolution,
        outcomes,
        gateway: remedyPort,
        getIntentState: async (id) => (await persist.bundle.intents.getState(id)) ?? undefined,
        remedyCallers,
        stageRecorder: stages,
      }),
    ],
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "outcome-resolution listening",
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
