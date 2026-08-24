import { createEnvelope } from "@truemandate/cloud-pubsub";
import { describe, expect, it } from "vitest";
import { MemoryBigQueryExportPort } from "./bigquery-port.js";
import { AnalyticsExporter } from "./exporter.js";
import { MemoryAnalyticsLedgerPort } from "./ledger-port.js";
import { AnalyticsTable } from "./schemas.js";

function makeEnvelope(eventId = "evt-1") {
  return createEnvelope({
    eventId,
    type: "AUTHORITY_DECISION",
    aggregateId: "intent-1",
    aggregateVersion: 1,
    causationId: "c1",
    correlationId: "corr1",
    actorService: "authority",
    payloadHash: "h",
    idempotencyKey: `idem-${eventId}`,
    provenanceRefs: [],
    payload: { ok: true },
  });
}

describe("AnalyticsExporter fail-open + idempotency", () => {
  it("exports a governance event and marks the ledger", async () => {
    const port = new MemoryBigQueryExportPort();
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });
    const result = await exporter.exportGovernanceEvent(
      "authority.events",
      makeEnvelope(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("exported");
    expect(port.inserted).toHaveLength(1);
    expect(port.inserted[0]?.table).toBe(AnalyticsTable.GOVERNANCE_EVENTS);
    expect(ledger.size).toBe(1);
  });

  it("skips duplicate export_id without re-inserting", async () => {
    const port = new MemoryBigQueryExportPort();
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });
    const env = makeEnvelope("evt-dup");
    await exporter.exportGovernanceEvent("authority.events", env);
    const second = await exporter.exportGovernanceEvent("authority.events", env);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe("skipped");
    expect(port.inserted).toHaveLength(1);
    expect(ledger.size).toBe(1);
  });

  it("does not mark ledger when BigQuery insert fails (Result)", async () => {
    const port = new MemoryBigQueryExportPort({ failInserts: true });
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });
    const result = await exporter.exportGovernanceEvent(
      "authority.events",
      makeEnvelope("evt-fail"),
    );
    expect(result.ok).toBe(false);
    expect(ledger.size).toBe(0);
    expect(port.inserted).toHaveLength(0);
  });

  it("never throws when BigQuery client throws; ledger untouched", async () => {
    const port = new MemoryBigQueryExportPort({ throwOnInsert: true });
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });
    const result = await exporter.exportGovernanceEvent(
      "authority.events",
      makeEnvelope("evt-throw"),
    );
    expect(result.ok).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it("exports provenance node and edge idempotently", async () => {
    const port = new MemoryBigQueryExportPort();
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });
    const n1 = await exporter.exportProvenanceNode({
      id: "node-1",
      kind: "INTENT",
      label: "x",
      trustClass: "TRUSTED_HUMAN",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(n1.ok && n1.value.status).toBe("exported");
    const n2 = await exporter.exportProvenanceNode({
      id: "node-1",
      kind: "INTENT",
      label: "x",
      trustClass: "TRUSTED_HUMAN",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(n2.ok && n2.value.status).toBe("skipped");

    const e1 = await exporter.exportProvenanceEdge({
      id: "edge-1",
      from: "node-1",
      to: "node-2",
      relation: "AUTHORIZES",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(e1.ok && e1.value.status).toBe("exported");
    expect(port.inserted).toHaveLength(2);
  });
});
