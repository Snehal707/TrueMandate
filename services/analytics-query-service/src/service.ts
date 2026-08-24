import {
  CrossWorkflowAnalyticsService,
  GoogleBigQueryQueryPort,
  MemoryBigQueryQueryPort,
  analyticsQueryModeFromEnv,
  emptySeed,
  type AnalyticsQuerySeed,
  type BigQueryQueryPort,
} from "@truemandate/analytics-query";

export interface AnalyticsQueryServicePorts {
  readonly port?: BigQueryQueryPort;
  readonly seed?: AnalyticsQuerySeed;
  readonly datasetId?: string;
  readonly projectId?: string;
}

/**
 * Thin wrapper around CrossWorkflowAnalyticsService.
 * Analytics-only — never participates in Authority/Gateway decisions.
 */
export class AnalyticsQueryService {
  readonly analytics: CrossWorkflowAnalyticsService;
  readonly port: BigQueryQueryPort;

  private constructor(
    analytics: CrossWorkflowAnalyticsService,
    port: BigQueryQueryPort,
  ) {
    this.analytics = analytics;
    this.port = port;
  }

  static async create(
    ports: AnalyticsQueryServicePorts = {},
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<AnalyticsQueryService> {
    const mode = analyticsQueryModeFromEnv(env);
    let port: BigQueryQueryPort;
    if (ports.port) {
      port = ports.port;
    } else if (mode === "bigquery") {
      const projectId =
        ports.projectId ??
        env.GOOGLE_CLOUD_PROJECT ??
        env.GCP_PROJECT ??
        "";
      if (!projectId.trim()) {
        throw new Error(
          "TM_ANALYTICS_QUERY=bigquery requires GOOGLE_CLOUD_PROJECT",
        );
      }
      port = await GoogleBigQueryQueryPort.create({
        projectId,
        datasetId: ports.datasetId ?? env.TM_BQ_DATASET ?? "tm_analytics",
      });
    } else {
      port = new MemoryBigQueryQueryPort(ports.seed ?? emptySeed());
    }

    return new AnalyticsQueryService(
      new CrossWorkflowAnalyticsService(
        port,
        ports.datasetId ?? env.TM_BQ_DATASET ?? "tm_analytics",
      ),
      port,
    );
  }
}
