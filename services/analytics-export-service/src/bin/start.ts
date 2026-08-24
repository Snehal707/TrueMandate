import {
  type AnalyticsLedgerEntry,
  analyticsExportModeFromEnv,
} from "@truemandate/analytics-bigquery";
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
import { initTracing, logStructured } from "@truemandate/observability";
import { AnalyticsExportService } from "../service.js";

/** Governance topics mirrored from observability-api consumer_topics. */
export const GOVERNANCE_EXPORT_TOPICS: readonly PubSubTopic[] = [
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

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  const persist = await initRuntimePersistence();
  const mode = analyticsExportModeFromEnv();

  const ledgerStore = {
    get: async (id: string) =>
      (await persist.bundle.analyticsExportLedger.get(id)) as
        | AnalyticsLedgerEntry
        | undefined,
    put: async (id: string, value: AnalyticsLedgerEntry) =>
      persist.bundle.analyticsExportLedger.put(id, value),
  };

  const analytics = await AnalyticsExportService.create({
    ledgerStore,
    projectId: persist.firestoreClient?.projectId,
  });

  const bus = new InMemoryPubSubBus();

  for (const topic of GOVERNANCE_EXPORT_TOPICS) {
    bus.subscribe(
      topic,
      async (envelope: CloudEventEnvelope) => {
        const result = await analytics.onGovernanceEvent(topic, envelope);
        if (!result.ok) {
          logStructured("warn", {
            event: "tm.analytics.export_nack",
            service: config.serviceName,
            topic,
            eventId: envelope.eventId,
            message: result.message,
          });
        }
        return result;
      },
      // Defense in depth: a failed export must never fail sibling handlers
      // if any are co-located on this bus in the future.
      { securityCritical: true },
    );
  }

  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: GOVERNANCE_EXPORT_TOPICS,
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      persistence: persist.mode,
      analyticsExportMode: mode,
      storeKind: persist.store.kind,
    },
    enableEvents: true,
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "analytics-export-service listening",
      service: config.serviceName,
      port: config.port,
      analyticsExportMode: mode,
      topics: GOVERNANCE_EXPORT_TOPICS,
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
