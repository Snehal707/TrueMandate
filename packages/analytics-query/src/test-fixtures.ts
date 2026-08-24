import {
  deriveExportId,
  type GovernanceEventRow,
  type ProvenanceEdgeRow,
  type ProvenanceNodeRow,
} from "@truemandate/analytics-bigquery";

export function govEvent(input: {
  readonly eventId: string;
  readonly topic: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly actorService?: string;
  readonly occurredAt?: string;
}): GovernanceEventRow {
  const occurredAt = input.occurredAt ?? "2026-08-01T12:00:00.000Z";
  return {
    export_id: deriveExportId("event", input.eventId),
    topic: input.topic,
    event_id: input.eventId,
    event_type: input.eventType,
    aggregate_id: input.aggregateId,
    aggregate_version: 1,
    causation_id: "c",
    correlation_id: "corr",
    actor_service: input.actorService ?? "test-service",
    protocol_version: "0.1.0",
    schema_version: "1",
    payload_hash: "h",
    idempotency_key: `idem-${input.eventId}`,
    provenance_refs: [],
    payload: JSON.stringify(input.payload),
    occurred_at: occurredAt,
    exported_at: occurredAt,
  };
}

export function provNode(input: {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly subjectRef?: string | null;
}): ProvenanceNodeRow {
  const createdAt = "2026-08-01T12:00:00.000Z";
  return {
    export_id: deriveExportId("node", input.id),
    node_id: input.id,
    kind: input.kind,
    label: input.label,
    trust_class: "TRUSTED_SYSTEM",
    taint: null,
    subject_ref: input.subjectRef === undefined ? null : input.subjectRef,
    created_at: createdAt,
    exported_at: createdAt,
    schema_version: "1",
  };
}

export function provEdge(input: {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}): ProvenanceEdgeRow {
  const createdAt = "2026-08-01T12:00:00.000Z";
  return {
    export_id: deriveExportId("edge", input.id),
    edge_id: input.id,
    from_node_id: input.from,
    to_node_id: input.to,
    relation: input.relation,
    created_at: createdAt,
    exported_at: createdAt,
    schema_version: "1",
  };
}
