import type {
  GovernanceEventRow,
  ProvenanceEdgeRow,
  ProvenanceNodeRow,
} from "@truemandate/analytics-bigquery";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";

export interface AnalyticsQuerySeed {
  readonly governanceEvents: readonly GovernanceEventRow[];
  readonly provenanceNodes: readonly ProvenanceNodeRow[];
  readonly provenanceEdges: readonly ProvenanceEdgeRow[];
}

export interface BigQueryQueryPort {
  readonly kind: "memory" | "bigquery";
  run<T>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<Result<readonly T[]>>;
  probeReachability(): Promise<void>;
}

export function isMemoryQueryPort(
  port: BigQueryQueryPort,
): port is MemoryBigQueryQueryPort {
  return port.kind === "memory";
}

/**
 * In-memory analytics query adapter. Does not parse SQL — callers that need
 * aggregation must use the query module's pure aggregate functions against
 * `getSeed()`. `run()` is reserved for the Google adapter path and fails closed
 * on the memory port to prevent accidental SQL dependence in tests.
 */
export class MemoryBigQueryQueryPort implements BigQueryQueryPort {
  readonly kind = "memory" as const;
  private seed: AnalyticsQuerySeed;

  constructor(seed: AnalyticsQuerySeed = emptySeed()) {
    this.seed = {
      governanceEvents: [...seed.governanceEvents],
      provenanceNodes: [...seed.provenanceNodes],
      provenanceEdges: [...seed.provenanceEdges],
    };
  }

  getSeed(): AnalyticsQuerySeed {
    return this.seed;
  }

  replaceSeed(seed: AnalyticsQuerySeed): void {
    this.seed = {
      governanceEvents: [...seed.governanceEvents],
      provenanceNodes: [...seed.provenanceNodes],
      provenanceEdges: [...seed.provenanceEdges],
    };
  }

  async run<T>(
    _sql: string,
    _params?: Record<string, unknown>,
  ): Promise<Result<readonly T[]>> {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "MemoryBigQueryQueryPort does not execute SQL; use query module aggregates",
      {},
    );
  }

  async probeReachability(): Promise<void> {
    // Always reachable.
  }
}

export function emptySeed(): AnalyticsQuerySeed {
  return {
    governanceEvents: [],
    provenanceNodes: [],
    provenanceEdges: [],
  };
}

export interface GoogleBigQueryQueryPortOptions {
  readonly projectId: string;
  readonly datasetId: string;
  readonly location?: string;
}

/**
 * Production read adapter. Lazily loads `@google-cloud/bigquery` so privileged
 * packages never need the dependency.
 */
export class GoogleBigQueryQueryPort implements BigQueryQueryPort {
  readonly kind = "bigquery" as const;

  private constructor(
    private readonly options: GoogleBigQueryQueryPortOptions,
    private readonly client: {
      query(opts: {
        query: string;
        params?: Record<string, unknown>;
        types?: Record<string, string>;
        location?: string;
      }): Promise<[Array<Record<string, unknown>>, unknown]>;
    },
  ) {}

  static async create(
    options: GoogleBigQueryQueryPortOptions,
  ): Promise<GoogleBigQueryQueryPort> {
    const load = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<{
      BigQuery: new (opts: {
        projectId: string;
        location?: string;
      }) => GoogleBigQueryQueryPort["client"];
    }>;
    const mod = await load("@google-cloud/bigquery");
    const client = new mod.BigQuery({
      projectId: options.projectId,
      location: options.location,
    });
    return new GoogleBigQueryQueryPort(options, client);
  }

  async run<T>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<Result<readonly T[]>> {
    try {
      // BigQuery Node client requires explicit types when a named param is null
      // (e.g. optional since/until window filters). Infer from non-null values
      // when possible; default nulls to TIMESTAMP for analytics window fields.
      const types: Record<string, string> | undefined = params
        ? Object.fromEntries(
            Object.entries(params).map(([key, value]) => {
              if (typeof value === "number") return [key, "INT64"];
              if (typeof value === "boolean") return [key, "BOOL"];
              if (typeof value === "string") {
                // ISO timestamps used for since/until; otherwise STRING.
                if (
                  key === "since" ||
                  key === "until" ||
                  /^\d{4}-\d{2}-\d{2}T/.test(value)
                ) {
                  return [key, "TIMESTAMP"];
                }
                return [key, "STRING"];
              }
              if (value === null || value === undefined) {
                if (key === "since" || key === "until") return [key, "TIMESTAMP"];
                if (key === "limit") return [key, "INT64"];
                return [key, "STRING"];
              }
              return [key, "STRING"];
            }),
          )
        : undefined;
      const [rows] = await this.client.query({
        query: sql,
        params,
        types,
        location: this.options.location,
      });
      return ok(rows as readonly T[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(ErrorCode.VALIDATION_FAILED, `BigQuery query failed: ${message}`, {});
    }
  }

  async probeReachability(): Promise<void> {
    const result = await this.run("SELECT 1 AS ok");
    if (!result.ok) {
      throw new Error(result.message);
    }
  }
}

export type AnalyticsQueryMode = "disabled" | "memory" | "bigquery";

/** TM_ANALYTICS_QUERY=disabled|memory|bigquery (default: disabled). */
export function analyticsQueryModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsQueryMode {
  const raw = (env.TM_ANALYTICS_QUERY ?? "disabled").trim().toLowerCase();
  if (raw === "memory" || raw === "bigquery" || raw === "disabled") {
    return raw;
  }
  return "disabled";
}
