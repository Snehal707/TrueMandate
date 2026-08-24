import {
  InMemoryPubSubBus,
  PubSubTopics,
  createPubSubPublisherPort,
  governanceEventPublishModeFromEnv,
  type CloudEventEnvelope,
} from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  requireAuthorityCallerEmail,
  requireGatewayCallerEmail,
  requireOutcomeResolutionCallerEmail,
} from "@truemandate/cloud-runtime";
import { ok, type Result } from "@truemandate/protocol";
import { initTracing } from "@truemandate/observability";
import { IntentService } from "../service.js";
import { createIntentProvenanceInternalRoutes } from "../internal-routes.js";
import { ProvenanceService } from "@truemandate/provenance-service";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  const authorityCallerEmail = requireAuthorityCallerEmail(config);
  const outcomeResolutionCallerEmail = requireOutcomeResolutionCallerEmail(config);
  const gatewayCallerEmail = requireGatewayCallerEmail(config);
  const persist = await initRuntimePersistence();
  const governancePublisher = await createPubSubPublisherPort(
    governanceEventPublishModeFromEnv(),
  );
  const intents = new IntentService(
    persist.bundle.intents,
    persist.bundle.semanticArtifacts,
    governancePublisher,
  );
  const provenance = new ProvenanceService(persist.bundle.provenance);

  const bus = new InMemoryPubSubBus();
  const onEvent = async (envelope: CloudEventEnvelope): Promise<Result<unknown>> => {
    const payload = envelope.payload as Record<string, unknown>;
    if (typeof payload.rawText === "string" && typeof payload.principalId === "string") {
      const created = await intents.createIntent(payload);
      if (!created.ok) return created;
    }
    if (payload.kind !== undefined) {
      const recorded = await provenance.recordNode(payload);
      if (!recorded.ok) return recorded;
    }
    return ok();
  };
  bus.subscribe(PubSubTopics.AUTHORITY, onEvent);
  bus.subscribe(PubSubTopics.EXECUTION, onEvent);

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [PubSubTopics.AUTHORITY, PubSubTopics.EXECUTION],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
      ownerApis: true,
    },
    enableEvents: true,
    internalRoutes: createIntentProvenanceInternalRoutes({
    globalCallers: config.internalAllowedCallers,
    outcomeResolutionCallerEmail,
    gatewayCallerEmail,
      intents,
      provenance,
      durableProvenance: persist.bundle.provenance,
      semanticArtifacts: persist.bundle.semanticArtifacts,
      authorityCallerEmail,
      // Owner-side capability-policy ingress: verified acceptance/operator
      // identities only (never the model pipeline).
      intentStateCallers: (process.env.TM_INTENT_STATE_CALLER_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      // Read-only tip visibility for the same verified operator identities
      // (acceptance drivers poll the finalized tip before policy creation).
      extraReadCallers: (process.env.TM_INTENT_STATE_CALLER_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      semanticSupersessionCallers: (process.env.TM_SEMANTIC_SUPERSESSION_CALLER_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }),
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "intent-provenance listening",
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
