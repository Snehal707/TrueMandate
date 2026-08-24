import type { CloudEventEnvelope } from "@truemandate/cloud-pubsub";
import { logStructured } from "@truemandate/observability";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import type { BigQueryExportPort } from "./bigquery-port.js";
import type { AnalyticsLedgerPort } from "./ledger-port.js";
import {
  envelopeToGovernanceEventRow,
  provenanceEdgeToRow,
  provenanceNodeToRow,
  type ProvenanceEdgeExportInput,
  type ProvenanceNodeExportInput,
} from "./rows.js";
import { AnalyticsTable } from "./schemas.js";

export interface AnalyticsExporterOptions {
  readonly port: BigQueryExportPort;
  readonly ledger: AnalyticsLedgerPort;
}

/**
 * Append-only analytics exporter.
 *
 * Fail-open: BigQuery loss/unavailability never throws into callers.
 * Idempotent: ledger checked before insert; marked only after successful insert.
 * On insert failure returns err so a lone analytics-export subscriber can NACK
 * for retry — callers co-located with critical handlers must subscribe with
 * `securityCritical: true` so a failed export cannot fail `bus.publish()`.
 */
export class AnalyticsExporter {
  constructor(private readonly options: AnalyticsExporterOptions) {}

  async exportGovernanceEvent(
    topic: string,
    envelope: CloudEventEnvelope,
  ): Promise<Result<{ readonly status: "exported" | "skipped" }>> {
    try {
      const row = envelopeToGovernanceEventRow(topic, envelope);
      if (await this.options.ledger.hasExported(row.export_id)) {
        return ok({ status: "skipped" });
      }
      const inserted = await this.safeInsert(AnalyticsTable.GOVERNANCE_EVENTS, [
        row,
      ]);
      if (!inserted.ok) return inserted;
      await this.options.ledger.markExported({
        exportId: row.export_id,
        table: AnalyticsTable.GOVERNANCE_EVENTS,
        exportedAt: row.exported_at,
      });
      return ok({ status: "exported" });
    } catch (e) {
      return this.failOpen("exportGovernanceEvent", e);
    }
  }

  async exportProvenanceNode(
    node: ProvenanceNodeExportInput,
  ): Promise<Result<{ readonly status: "exported" | "skipped" }>> {
    try {
      const row = provenanceNodeToRow(node);
      if (await this.options.ledger.hasExported(row.export_id)) {
        return ok({ status: "skipped" });
      }
      const inserted = await this.safeInsert(AnalyticsTable.PROVENANCE_NODES, [
        row,
      ]);
      if (!inserted.ok) return inserted;
      await this.options.ledger.markExported({
        exportId: row.export_id,
        table: AnalyticsTable.PROVENANCE_NODES,
        exportedAt: row.exported_at,
      });
      return ok({ status: "exported" });
    } catch (e) {
      return this.failOpen("exportProvenanceNode", e);
    }
  }

  async exportProvenanceEdge(
    edge: ProvenanceEdgeExportInput,
  ): Promise<Result<{ readonly status: "exported" | "skipped" }>> {
    try {
      const row = provenanceEdgeToRow(edge);
      if (await this.options.ledger.hasExported(row.export_id)) {
        return ok({ status: "skipped" });
      }
      const inserted = await this.safeInsert(AnalyticsTable.PROVENANCE_EDGES, [
        row,
      ]);
      if (!inserted.ok) return inserted;
      await this.options.ledger.markExported({
        exportId: row.export_id,
        table: AnalyticsTable.PROVENANCE_EDGES,
        exportedAt: row.exported_at,
      });
      return ok({ status: "exported" });
    } catch (e) {
      return this.failOpen("exportProvenanceEdge", e);
    }
  }

  private async safeInsert(
    table: (typeof AnalyticsTable)[keyof typeof AnalyticsTable],
    rows: Parameters<BigQueryExportPort["insertRows"]>[1],
  ): Promise<Result<void>> {
    try {
      return await this.options.port.insertRows(table, rows);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logStructured("error", {
        event: "tm.analytics.export_failed",
        service: "analytics-bigquery",
        table,
        message,
      });
      return err(ErrorCode.VALIDATION_FAILED, `BigQuery unavailable: ${message}`, {
        table,
      });
    }
  }

  private failOpen(
    op: string,
    e: unknown,
  ): Result<{ readonly status: "exported" | "skipped" }> {
    const message = e instanceof Error ? e.message : String(e);
    logStructured("error", {
      event: "tm.analytics.export_unexpected",
      service: "analytics-bigquery",
      op,
      message,
    });
    // Unexpected errors still must not throw into callers.
    return err(ErrorCode.VALIDATION_FAILED, `Analytics export failed: ${message}`, {
      op,
    });
  }
}
