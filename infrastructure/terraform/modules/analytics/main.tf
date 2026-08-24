variable "project_id" {
  type = string
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type    = string
  default = ""
}

variable "location" {
  type    = string
  default = "US"
  description = "BigQuery dataset location"
}

variable "partition_expiration_days" {
  type        = number
  default     = 365
  description = "Retention: partition expiration in days (0 = never expire)"
}

variable "analytics_export_sa_email" {
  type        = string
  description = "Service account email for analytics-export (dataEditor only)"
}

variable "analytics_query_sa_email" {
  type        = string
  description = "Service account email for analytics-query (dataViewer + jobUser only)"
}

locals {
  prefix     = var.name_prefix != "" ? var.name_prefix : "tm-${var.environment}"
  dataset_id = replace("${local.prefix}_analytics", "-", "_")

  governance_events_schema = [
    { name = "export_id", type = "STRING", mode = "REQUIRED" },
    { name = "topic", type = "STRING", mode = "REQUIRED" },
    { name = "event_id", type = "STRING", mode = "REQUIRED" },
    { name = "event_type", type = "STRING", mode = "REQUIRED" },
    { name = "aggregate_id", type = "STRING", mode = "REQUIRED" },
    { name = "aggregate_version", type = "INTEGER", mode = "REQUIRED" },
    { name = "causation_id", type = "STRING", mode = "REQUIRED" },
    { name = "correlation_id", type = "STRING", mode = "REQUIRED" },
    { name = "actor_service", type = "STRING", mode = "REQUIRED" },
    { name = "protocol_version", type = "STRING", mode = "REQUIRED" },
    { name = "schema_version", type = "STRING", mode = "REQUIRED" },
    { name = "payload_hash", type = "STRING", mode = "REQUIRED" },
    { name = "idempotency_key", type = "STRING", mode = "REQUIRED" },
    { name = "provenance_refs", type = "STRING", mode = "REPEATED" },
    { name = "payload", type = "JSON", mode = "REQUIRED" },
    { name = "occurred_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "exported_at", type = "TIMESTAMP", mode = "REQUIRED" },
  ]

  provenance_nodes_schema = [
    { name = "export_id", type = "STRING", mode = "REQUIRED" },
    { name = "node_id", type = "STRING", mode = "REQUIRED" },
    { name = "kind", type = "STRING", mode = "REQUIRED" },
    { name = "label", type = "STRING", mode = "REQUIRED" },
    { name = "trust_class", type = "STRING", mode = "REQUIRED" },
    { name = "taint", type = "JSON", mode = "NULLABLE" },
    { name = "subject_ref", type = "STRING", mode = "NULLABLE" },
    { name = "created_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "exported_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "schema_version", type = "STRING", mode = "REQUIRED" },
  ]

  provenance_edges_schema = [
    { name = "export_id", type = "STRING", mode = "REQUIRED" },
    { name = "edge_id", type = "STRING", mode = "REQUIRED" },
    { name = "from_node_id", type = "STRING", mode = "REQUIRED" },
    { name = "to_node_id", type = "STRING", mode = "REQUIRED" },
    { name = "relation", type = "STRING", mode = "REQUIRED" },
    { name = "created_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "exported_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "schema_version", type = "STRING", mode = "REQUIRED" },
  ]
}

/**
 * Wave 3.3 BigQuery analytics — history/analytics only.
 * NEVER read by Authority, PreparedAction, CommitToken, Gateway commit,
 * current approval, or current IntentState paths.
 */
resource "google_bigquery_dataset" "analytics" {
  project                     = var.project_id
  dataset_id                  = local.dataset_id
  friendly_name               = "TrueMandate analytics (${var.environment})"
  description                 = "Append-only governance/provenance analytics. Not operational truth."
  location                    = var.location
  delete_contents_on_destroy  = false
}

resource "google_bigquery_table" "governance_events" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  table_id   = "governance_events"

  description = "Append-only CloudEventEnvelope exports from governance Pub/Sub topics"

  time_partitioning {
    type                     = "DAY"
    field                    = "occurred_at"
    expiration_ms            = var.partition_expiration_days > 0 ? var.partition_expiration_days * 24 * 60 * 60 * 1000 : null
    require_partition_filter = false
  }

  schema = jsonencode(local.governance_events_schema)
}

resource "google_bigquery_table" "provenance_nodes" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  table_id   = "provenance_nodes"

  description = "Append-only provenance node exports for cross-workflow graph analytics"

  time_partitioning {
    type                     = "DAY"
    field                    = "created_at"
    expiration_ms            = var.partition_expiration_days > 0 ? var.partition_expiration_days * 24 * 60 * 60 * 1000 : null
    require_partition_filter = false
  }

  schema = jsonencode(local.provenance_nodes_schema)
}

resource "google_bigquery_table" "provenance_edges" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  table_id   = "provenance_edges"

  description = "Append-only provenance edge exports for cross-workflow graph analytics"

  time_partitioning {
    type                     = "DAY"
    field                    = "created_at"
    expiration_ms            = var.partition_expiration_days > 0 ? var.partition_expiration_days * 24 * 60 * 60 * 1000 : null
    require_partition_filter = false
  }

  schema = jsonencode(local.provenance_edges_schema)
}

resource "google_bigquery_dataset_iam_member" "analytics_export_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${var.analytics_export_sa_email}"
}

resource "google_bigquery_dataset_iam_member" "analytics_query_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${var.analytics_query_sa_email}"
}

# Query jobs require project-level jobUser; never grant dataEditor to query SA.
resource "google_project_iam_member" "analytics_query_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${var.analytics_query_sa_email}"
}

output "dataset_id" {
  value = google_bigquery_dataset.analytics.dataset_id
}

output "table_ids" {
  value = {
    governance_events = google_bigquery_table.governance_events.table_id
    provenance_nodes  = google_bigquery_table.provenance_nodes.table_id
    provenance_edges  = google_bigquery_table.provenance_edges.table_id
  }
}
