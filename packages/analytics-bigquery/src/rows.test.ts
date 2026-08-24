import { createEnvelope } from "@truemandate/cloud-pubsub";
import { describe, expect, it } from "vitest";
import {
  deriveExportId,
  envelopeToGovernanceEventRow,
  provenanceEdgeToRow,
  provenanceNodeToRow,
} from "./rows.js";
import {
  ANALYTICS_TABLE_SCHEMAS,
  AnalyticsTable,
  GOVERNANCE_EVENTS_SCHEMA,
} from "./schemas.js";

describe("analytics row mappers", () => {
  it("maps CloudEventEnvelope to governance_events with workflow identifiers", () => {
    const envelope = createEnvelope({
      eventId: "evt-1",
      type: "AUTHORITY_DECISION",
      aggregateId: "intent-42",
      aggregateVersion: 3,
      causationId: "cause-1",
      correlationId: "corr-1",
      actorService: "authority",
      payloadHash: "phash",
      idempotencyKey: "idem-1",
      provenanceRefs: ["node-a", "node-b"],
      payload: { decision: "ALLOW" },
      occurredAt: "2026-08-21T10:00:00.000Z",
    });
    const row = envelopeToGovernanceEventRow("authority.events", envelope, "2026-08-21T10:01:00.000Z");
    expect(row.export_id).toBe(deriveExportId("event", "evt-1"));
    expect(row.topic).toBe("authority.events");
    expect(row.aggregate_id).toBe("intent-42");
    expect(row.aggregate_version).toBe(3);
    expect(row.causation_id).toBe("cause-1");
    expect(row.correlation_id).toBe("corr-1");
    expect(row.schema_version).toBe("1");
    expect(row.protocol_version).toBeTruthy();
    expect(row.provenance_refs).toEqual(["node-a", "node-b"]);
    expect(row.occurred_at).toBe("2026-08-21T10:00:00.000Z");
    expect(row.exported_at).toBe("2026-08-21T10:01:00.000Z");
    expect(JSON.parse(row.payload)).toEqual({ decision: "ALLOW" });
  });

  it("maps provenance node/edge with retention/versioning fields", () => {
    const node = provenanceNodeToRow({
      id: "n1",
      kind: "INTENT",
      label: "buy",
      trustClass: "TRUSTED_HUMAN",
      taint: { tainted: false },
      subjectRef: "intent-1",
      createdAt: "2026-08-21T09:00:00.000Z",
      schemaVersion: "1",
    });
    expect(node.export_id).toBe(deriveExportId("node", "n1"));
    expect(node.schema_version).toBe("1");
    expect(node.created_at).toBe("2026-08-21T09:00:00.000Z");

    const edge = provenanceEdgeToRow({
      id: "e1",
      from: "n1",
      to: "n2",
      relation: "AUTHORIZES",
      createdAt: "2026-08-21T09:01:00.000Z",
    });
    expect(edge.export_id).toBe(deriveExportId("edge", "e1"));
    expect(edge.from_node_id).toBe("n1");
    expect(edge.to_node_id).toBe("n2");
  });

  it("exposes schemas for all three analytics tables", () => {
    expect(Object.keys(ANALYTICS_TABLE_SCHEMAS).sort()).toEqual(
      [
        AnalyticsTable.GOVERNANCE_EVENTS,
        AnalyticsTable.PROVENANCE_EDGES,
        AnalyticsTable.PROVENANCE_NODES,
      ].sort(),
    );
    expect(GOVERNANCE_EVENTS_SCHEMA.some((f) => f.name === "export_id")).toBe(
      true,
    );
  });
});
