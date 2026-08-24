/**
 * BigQuery analytics table schemas (Wave 3.3).
 *
 * These are analytics/history only. They must never be read by Authority,
 * PreparedAction, CommitToken, Gateway commit, approval, or IntentState paths.
 */

export const ANALYTICS_DATASET_ID = "tm_analytics";

export const AnalyticsTable = {
  GOVERNANCE_EVENTS: "governance_events",
  PROVENANCE_NODES: "provenance_nodes",
  PROVENANCE_EDGES: "provenance_edges",
} as const;

export type AnalyticsTableName =
  (typeof AnalyticsTable)[keyof typeof AnalyticsTable];

/** Field descriptors shared with Terraform schema JSON. */
export interface BigQueryFieldDescriptor {
  readonly name: string;
  readonly type: "STRING" | "INT64" | "TIMESTAMP" | "JSON" | "BOOL";
  readonly mode: "REQUIRED" | "NULLABLE" | "REPEATED";
  readonly description?: string;
}

export const GOVERNANCE_EVENTS_SCHEMA: readonly BigQueryFieldDescriptor[] = [
  {
    name: "export_id",
    type: "STRING",
    mode: "REQUIRED",
    description: "Deterministic row key (sha256 of event_id)",
  },
  { name: "topic", type: "STRING", mode: "REQUIRED" },
  { name: "event_id", type: "STRING", mode: "REQUIRED" },
  { name: "event_type", type: "STRING", mode: "REQUIRED" },
  {
    name: "aggregate_id",
    type: "STRING",
    mode: "REQUIRED",
    description: "Workflow / aggregate identifier for cross-workflow queries",
  },
  { name: "aggregate_version", type: "INT64", mode: "REQUIRED" },
  { name: "causation_id", type: "STRING", mode: "REQUIRED" },
  { name: "correlation_id", type: "STRING", mode: "REQUIRED" },
  { name: "actor_service", type: "STRING", mode: "REQUIRED" },
  { name: "protocol_version", type: "STRING", mode: "REQUIRED" },
  { name: "schema_version", type: "STRING", mode: "REQUIRED" },
  { name: "payload_hash", type: "STRING", mode: "REQUIRED" },
  { name: "idempotency_key", type: "STRING", mode: "REQUIRED" },
  { name: "provenance_refs", type: "STRING", mode: "REPEATED" },
  { name: "payload", type: "JSON", mode: "REQUIRED" },
  {
    name: "occurred_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "Partition column",
  },
  { name: "exported_at", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

export const PROVENANCE_NODES_SCHEMA: readonly BigQueryFieldDescriptor[] = [
  {
    name: "export_id",
    type: "STRING",
    mode: "REQUIRED",
    description: "Deterministic row key (sha256 of node_id)",
  },
  { name: "node_id", type: "STRING", mode: "REQUIRED" },
  { name: "kind", type: "STRING", mode: "REQUIRED" },
  { name: "label", type: "STRING", mode: "REQUIRED" },
  { name: "trust_class", type: "STRING", mode: "REQUIRED" },
  { name: "taint", type: "JSON", mode: "NULLABLE" },
  { name: "subject_ref", type: "STRING", mode: "NULLABLE" },
  {
    name: "created_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "Partition column",
  },
  { name: "exported_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "schema_version", type: "STRING", mode: "REQUIRED" },
] as const;

export const PROVENANCE_EDGES_SCHEMA: readonly BigQueryFieldDescriptor[] = [
  {
    name: "export_id",
    type: "STRING",
    mode: "REQUIRED",
    description: "Deterministic row key (sha256 of edge_id)",
  },
  { name: "edge_id", type: "STRING", mode: "REQUIRED" },
  { name: "from_node_id", type: "STRING", mode: "REQUIRED" },
  { name: "to_node_id", type: "STRING", mode: "REQUIRED" },
  { name: "relation", type: "STRING", mode: "REQUIRED" },
  {
    name: "created_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "Partition column",
  },
  { name: "exported_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "schema_version", type: "STRING", mode: "REQUIRED" },
] as const;

export const ANALYTICS_TABLE_SCHEMAS = {
  [AnalyticsTable.GOVERNANCE_EVENTS]: GOVERNANCE_EVENTS_SCHEMA,
  [AnalyticsTable.PROVENANCE_NODES]: PROVENANCE_NODES_SCHEMA,
  [AnalyticsTable.PROVENANCE_EDGES]: PROVENANCE_EDGES_SCHEMA,
} as const;
