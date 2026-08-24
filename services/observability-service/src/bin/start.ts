import {
  InMemoryPubSubBus,
  PubSubTopics,
  type CloudEventEnvelope,
  type PubSubTopic,
} from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
} from "@truemandate/cloud-runtime";
import type { ObservabilityTopic } from "@truemandate/read-model";
import { initTracing } from "@truemandate/observability";
import { DemoRuntime } from "../demo-runtime.js";

const TOPICS: readonly PubSubTopic[] = [
  PubSubTopics.INTENT,
  PubSubTopics.SEMANTIC,
  PubSubTopics.PLAN,
  PubSubTopics.GUARDIAN,
  PubSubTopics.AUTHORITY,
  PubSubTopics.EXECUTION,
  PubSubTopics.EVIDENCE,
  PubSubTopics.OUTCOME,
  PubSubTopics.RESOLUTION,
  PubSubTopics.SECURITY,
];

function toObservabilityTopic(topic: string): ObservabilityTopic {
  if (topic.startsWith("intent.")) return "intent";
  if (topic.startsWith("authority.")) return "authority";
  if (topic.startsWith("execution.")) return "execution";
  if (topic.startsWith("outcome.")) return "outcome";
  if (topic.startsWith("resolution.")) return "resolution";
  return "*";
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  const persist = await initRuntimePersistence();
  const runtime = new DemoRuntime();
  const events = runtime.getEventPort();

  const bus = new InMemoryPubSubBus();
  for (const topic of TOPICS) {
    bus.subscribe(topic, (envelope: CloudEventEnvelope) => {
      // Projector throw must not ACK (bus maps unexpected throw → 5xx).
      events.publish({
        id: envelope.eventId,
        topic: toObservabilityTopic(topic),
        type: envelope.type,
        at: envelope.occurredAt,
        payload: envelope.payload,
        dedupeKey: envelope.idempotencyKey,
      });
    });
  }

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [...TOPICS],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      persistence: persist.mode,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
      projectors: "demo-runtime",
    },
    enableEvents: true,
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "observability-api listening",
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
