import {
  AnalyticsExporter,
  MemoryAnalyticsLedgerPort,
  MemoryBigQueryExportPort,
} from "@truemandate/analytics-bigquery";
import {
  createEnvelope,
  InMemoryPubSubBus,
  PubSubTopics,
} from "@truemandate/cloud-pubsub";
import { ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { runProvenanceExportBatch } from "./service.js";

describe("BigQuery loss cannot affect runtime authorization/execution", () => {
  it("securityCritical analytics failure does not fail publish or block sibling critical handler", async () => {
    const bus = new InMemoryPubSubBus();
    const decisions: string[] = [];

    bus.subscribe(PubSubTopics.AUTHORITY, async () => {
      decisions.push("ALLOW");
      return ok();
    });

    const port = new MemoryBigQueryExportPort({ throwOnInsert: true });
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });

    bus.subscribe(
      PubSubTopics.AUTHORITY,
      async (envelope) => {
        return exporter.exportGovernanceEvent(
          PubSubTopics.AUTHORITY,
          envelope,
        );
      },
      { securityCritical: true },
    );

    const envelope = createEnvelope({
      eventId: "evt-iso-1",
      type: "AUTHORITY_DECISION",
      aggregateId: "intent-iso",
      aggregateVersion: 1,
      causationId: "c",
      correlationId: "corr",
      actorService: "authority",
      payloadHash: "h",
      idempotencyKey: "idem-iso-1",
      provenanceRefs: [],
      payload: { decision: "ALLOW" },
    });

    const published = await bus.publish(PubSubTopics.AUTHORITY, envelope);
    expect(published.ok).toBe(true);
    expect(decisions).toEqual(["ALLOW"]);
    expect(bus.dlq.some((e) => e.eventId === "evt-iso-1")).toBe(true);
    expect(ledger.size).toBe(0);
  });

  it("runProvenanceExportBatch is idempotent and fail-open on BQ loss", async () => {
    const port = new MemoryBigQueryExportPort();
    const ledger = new MemoryAnalyticsLedgerPort();
    const exporter = new AnalyticsExporter({ port, ledger });

    const nodes = [
      {
        id: "n1",
        kind: "INTENT",
        label: "x",
        trustClass: "TRUSTED_HUMAN",
        createdAt: "2026-08-21T00:00:00.000Z",
      },
    ];
    const edges = [
      {
        id: "e1",
        from: "n1",
        to: "n2",
        relation: "AUTHORIZES",
        createdAt: "2026-08-21T00:00:00.000Z",
      },
    ];

    const first = await runProvenanceExportBatch({
      listNodes: async () => nodes,
      listEdges: async () => edges,
      exporter,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.nodesExported).toBe(1);
      expect(first.value.edgesExported).toBe(1);
    }

    const second = await runProvenanceExportBatch({
      listNodes: async () => nodes,
      listEdges: async () => edges,
      exporter,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.nodesSkipped).toBe(1);
      expect(second.value.edgesSkipped).toBe(1);
    }

    port.setThrowOnInsert(true);
    const failing = await runProvenanceExportBatch({
      listNodes: async () => [
        {
          id: "n2",
          kind: "ACTION",
          label: "y",
          trustClass: "TRUSTED_SYSTEM",
          createdAt: "2026-08-21T00:00:00.000Z",
        },
      ],
      listEdges: async () => [],
      exporter,
    });
    expect(failing.ok).toBe(false);
  });
});
