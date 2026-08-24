import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  loadRuntimeConfig,
} from "@truemandate/cloud-runtime";
import { initTracing } from "@truemandate/observability";
import { analyticsQueryModeFromEnv } from "@truemandate/analytics-query";
import { createAnalyticsQueryRoutes } from "../analytics-query-routes.js";
import { AnalyticsQueryService } from "../service.js";

/**
 * Cloud Run entry — code-only for Wave 3.4 (not wired into Terraform deploy).
 * Analytics-only surface; never participates in privilege.
 */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  const mode = analyticsQueryModeFromEnv();
  const query = await AnalyticsQueryService.create();

  const bus = new InMemoryPubSubBus();
  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [],
    health: { ready: true },
    extraHealth: {
      analyticsQueryMode: mode,
    },
    enableEvents: false,
    internalRoutes: [
      ...createAnalyticsQueryRoutes({ analytics: query.analytics }),
    ],
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "analytics-query-service listening",
      service: config.serviceName,
      port: config.port,
      analyticsQueryMode: mode,
      note: "Wave 3.4 code-only — not deployed via Terraform yet",
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
