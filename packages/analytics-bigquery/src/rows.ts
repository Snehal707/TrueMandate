import { createHash } from "node:crypto";
import type { CloudEventEnvelope } from "@truemandate/cloud-pubsub";
import { AnalyticsTable } from "./schemas.js";

export function deriveExportId(kind: string, naturalKey: string): string {
  return createHash("sha256")
    .update(`${kind}:${naturalKey}`, "utf8")
    .digest("hex");
}

export interface GovernanceEventRow {
  readonly export_id: string;
  readonly topic: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly causation_id: string;
  readonly correlation_id: string;
  readonly actor_service: string;
  readonly protocol_version: string;
  readonly schema_version: string;
  readonly payload_hash: string;
  readonly idempotency_key: string;
  readonly provenance_refs: readonly string[];
  readonly payload: string;
  readonly occurred_at: string;
  readonly exported_at: string;
}

export interface ProvenanceNodeRow {
  readonly export_id: string;
  readonly node_id: string;
  readonly kind: string;
  readonly label: string;
  readonly trust_class: string;
  readonly taint: string | null;
  readonly subject_ref: string | null;
  readonly created_at: string;
  readonly exported_at: string;
  readonly schema_version: string;
}

export interface ProvenanceEdgeRow {
  readonly export_id: string;
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly relation: string;
  readonly created_at: string;
  readonly exported_at: string;
  readonly schema_version: string;
}

export type AnalyticsRow =
  | GovernanceEventRow
  | ProvenanceNodeRow
  | ProvenanceEdgeRow;

export function envelopeToGovernanceEventRow(
  topic: string,
  envelope: CloudEventEnvelope,
  exportedAt: string = new Date().toISOString(),
): GovernanceEventRow {
  return {
    export_id: deriveExportId("event", envelope.eventId),
    topic,
    event_id: envelope.eventId,
    event_type: envelope.type,
    aggregate_id: envelope.aggregateId,
    aggregate_version: envelope.aggregateVersion,
    causation_id: envelope.causationId,
    correlation_id: envelope.correlationId,
    actor_service: envelope.actorService,
    protocol_version: envelope.protocolVersion,
    schema_version: envelope.schemaVersion,
    payload_hash: envelope.payloadHash,
    idempotency_key: envelope.idempotencyKey,
    provenance_refs: [...envelope.provenanceRefs],
    payload: JSON.stringify(envelope.payload),
    occurred_at: envelope.occurredAt,
    exported_at: exportedAt,
  };
}

export interface ProvenanceNodeExportInput {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly trustClass: string;
  readonly taint?: unknown;
  readonly subjectRef?: string;
  readonly createdAt: string;
  readonly schemaVersion?: string;
}

export interface ProvenanceEdgeExportInput {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: string;
  readonly createdAt: string;
  readonly schemaVersion?: string;
}

export function provenanceNodeToRow(
  node: ProvenanceNodeExportInput,
  exportedAt: string = new Date().toISOString(),
): ProvenanceNodeRow {
  return {
    export_id: deriveExportId("node", node.id),
    node_id: node.id,
    kind: node.kind,
    label: node.label,
    trust_class: node.trustClass,
    taint: node.taint === undefined ? null : JSON.stringify(node.taint),
    subject_ref: node.subjectRef ?? null,
    created_at: node.createdAt,
    exported_at: exportedAt,
    schema_version: node.schemaVersion ?? "1",
  };
}

export function provenanceEdgeToRow(
  edge: ProvenanceEdgeExportInput,
  exportedAt: string = new Date().toISOString(),
): ProvenanceEdgeRow {
  return {
    export_id: deriveExportId("edge", edge.id),
    edge_id: edge.id,
    from_node_id: edge.from,
    to_node_id: edge.to,
    relation: edge.relation,
    created_at: edge.createdAt,
    exported_at: exportedAt,
    schema_version: edge.schemaVersion ?? "1",
  };
}

export function tableForRow(row: AnalyticsRow): typeof AnalyticsTable[keyof typeof AnalyticsTable] {
  if ("event_id" in row) return AnalyticsTable.GOVERNANCE_EVENTS;
  if ("node_id" in row) return AnalyticsTable.PROVENANCE_NODES;
  return AnalyticsTable.PROVENANCE_EDGES;
}
