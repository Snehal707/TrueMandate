import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import type { AnalyticsTableName } from "./schemas.js";
import type { AnalyticsRow } from "./rows.js";

export interface BigQueryExportPort {
  insertRows(
    table: AnalyticsTableName,
    rows: readonly AnalyticsRow[],
  ): Promise<Result<void>>;
  probeReachability(): Promise<void>;
}

export interface MemoryBigQueryExportPortOptions {
  /** When true, insertRows returns a soft failure Result. */
  readonly failInserts?: boolean;
  /** When true, insertRows throws (simulates hard client crash). */
  readonly throwOnInsert?: boolean;
}

/**
 * In-memory sink for tests. Captures inserted rows; never talks to GCP.
 */
export class MemoryBigQueryExportPort implements BigQueryExportPort {
  readonly inserted: {
    readonly table: AnalyticsTableName;
    readonly rows: readonly AnalyticsRow[];
  }[] = [];
  private failInserts: boolean;
  private throwOnInsert: boolean;

  constructor(options: MemoryBigQueryExportPortOptions = {}) {
    this.failInserts = options.failInserts ?? false;
    this.throwOnInsert = options.throwOnInsert ?? false;
  }

  setFailInserts(value: boolean): void {
    this.failInserts = value;
  }

  setThrowOnInsert(value: boolean): void {
    this.throwOnInsert = value;
  }

  async insertRows(
    table: AnalyticsTableName,
    rows: readonly AnalyticsRow[],
  ): Promise<Result<void>> {
    if (this.throwOnInsert) {
      throw new Error("BIGQUERY_UNAVAILABLE");
    }
    if (this.failInserts) {
      return err(ErrorCode.VALIDATION_FAILED, "BigQuery insert failed", {
        table,
      });
    }
    this.inserted.push({ table, rows: [...rows] });
    return ok();
  }

  async probeReachability(): Promise<void> {
    if (this.failInserts || this.throwOnInsert) {
      throw new Error("BIGQUERY_UNAVAILABLE");
    }
  }
}

export interface GoogleBigQueryExportPortOptions {
  readonly projectId: string;
  readonly datasetId: string;
  readonly location?: string;
}

/**
 * Production adapter. Lazily imports `@google-cloud/bigquery` only when
 * constructed — privileged packages never need this dependency installed.
 */
export class GoogleBigQueryExportPort implements BigQueryExportPort {
  private client: {
    dataset(id: string): {
      table(id: string): {
        insert(
          rows: readonly Record<string, unknown>[],
        ): Promise<unknown>;
      };
    };
  };

  constructor(
    private readonly options: GoogleBigQueryExportPortOptions,
    client: GoogleBigQueryExportPort["client"],
  ) {
    this.client = client;
  }

  static async create(
    options: GoogleBigQueryExportPortOptions,
  ): Promise<GoogleBigQueryExportPort> {
    // Avoid a static module dependency so privileged package graphs and CI
    // builds never require @google-cloud/bigquery. Resolved only when
    // TM_ANALYTICS_EXPORT=bigquery at runtime.
    const load = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<{
      BigQuery: new (opts: {
        projectId: string;
        location?: string;
      }) => GoogleBigQueryExportPort["client"];
    }>;
    const mod = await load("@google-cloud/bigquery");
    const client = new mod.BigQuery({
      projectId: options.projectId,
      location: options.location,
    });
    return new GoogleBigQueryExportPort(options, client);
  }

  async insertRows(
    table: AnalyticsTableName,
    rows: readonly AnalyticsRow[],
  ): Promise<Result<void>> {
    try {
      const prepared = rows.map((row) => ({ ...row }) as Record<string, unknown>);
      await this.client.dataset(this.options.datasetId).table(table).insert(prepared);
      return ok();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(ErrorCode.VALIDATION_FAILED, `BigQuery insert failed: ${message}`, {
        table,
      });
    }
  }

  async probeReachability(): Promise<void> {
    // Existence check via metadata; missing table surfaces as thrown error.
    await this.client.dataset(this.options.datasetId).table("governance_events");
  }
}
