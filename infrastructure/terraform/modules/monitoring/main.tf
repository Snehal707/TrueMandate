/**
 * Wave 2 Cloud Monitoring — non-authoritative observability only.
 *
 * These log-based metrics, dashboards, and alert policies NEVER gate
 * authorization, execution, or privilege. They are read-only signals derived
 * from structured JSON logs (`event` field) emitted by trusted-core services.
 */

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

locals {
  prefix = var.name_prefix != "" ? var.name_prefix : "tm-${var.environment}"

  # Structured-log event names emitted by application code (logStructured).
  decision_metrics = {
    guardian_decision = {
      filter      = "jsonPayload.event=\"tm.guardian.decision\""
      description = "Guardian verdict decisions (allow/block/uncertain)"
    }
    authority_decision = {
      filter      = "jsonPayload.event=\"tm.authority.decision\""
      description = "Authority ALLOW/BLOCK/REQUIRE_APPROVAL decisions"
    }
    approval_decision = {
      filter      = "jsonPayload.event=\"tm.approval.decision\""
      description = "Human approval APPROVE/DENY decisions"
    }
    commit_token_issued = {
      filter      = "jsonPayload.event=\"tm.commit_token.issued\""
      description = "CommitToken issuances from AUTHORIZE"
    }
    execution_success = {
      filter      = "jsonPayload.event=\"tm.execution.result\" AND jsonPayload.status=\"SUCCESS\""
      description = "Successful privileged executions"
    }
    execution_unknown = {
      filter      = "jsonPayload.event=\"tm.execution.result\" AND jsonPayload.status=\"UNKNOWN\""
      description = "UNKNOWN execution results (must never be blindly retried)"
    }
    outcome_breach = {
      filter      = "jsonPayload.event=\"tm.outcome.breach\""
      description = "OutcomeContract BREACHED triggers"
    }
    resolution_case_opened = {
      filter      = "jsonPayload.event=\"tm.resolution.case_opened\""
      description = "ResolutionCase openings"
    }
    remedy_mandate_issued = {
      filter      = "jsonPayload.event=\"tm.remedy.mandate_issued\""
      description = "RemediationMandate issuances"
    }
  }

  model_concurrency_gauges = {
    active = {
      field       = "active"
      description = "Active outbound Vertex model attempts"
    }
    queued = {
      field       = "queued"
      description = "Queued outbound Vertex model attempts"
    }
    max_queue_depth = {
      field       = "maxQueueDepth"
      description = "Maximum Agent Runtime model queue depth"
    }
    stage_active = {
      field       = "stageActive"
      description = "Active outbound Vertex attempts by model stage"
    }
    stage_queued = {
      field       = "stageQueued"
      description = "Queued outbound Vertex attempts by model stage"
    }
  }
}

resource "google_logging_metric" "decision" {
  for_each = local.decision_metrics

  name    = "${local.prefix}-${replace(each.key, "_", "-")}"
  project = var.project_id
  filter  = each.value.filter

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = each.value.description
  }

  description = each.value.description
}

resource "google_logging_metric" "model_concurrency" {
  for_each = local.model_concurrency_gauges

  name            = "${local.prefix}-model-${replace(each.key, "_", "-")}"
  project         = var.project_id
  filter          = "jsonPayload.event=\"tm.model.concurrency.state\" OR jsonPayload.event=\"tm.model.queue.wait\" OR jsonPayload.event=\"tm.model.permit.release\""
  value_extractor = "EXTRACT(jsonPayload.${each.value.field})"

  metric_descriptor {
    metric_kind  = "GAUGE"
    value_type   = "INT64"
    unit         = "1"
    display_name = each.value.description
    labels {
      key         = "stage"
      value_type  = "STRING"
      description = "Model schema/stage"
    }
  }
  label_extractors = {
    stage = "EXTRACT(jsonPayload.schemaId)"
  }
  description = each.value.description
}

resource "google_logging_metric" "model_queue_wait" {
  name            = "${local.prefix}-model-queue-wait-ms"
  project         = var.project_id
  filter          = "jsonPayload.event=\"tm.model.queue.wait\" AND jsonPayload.outcome=\"ACQUIRED\""
  value_extractor = "EXTRACT(jsonPayload.queueWaitMs)"

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "ms"
    display_name = "Vertex model queue wait"
    labels {
      key         = "stage"
      value_type  = "STRING"
      description = "Model schema/stage"
    }
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 1
    }
  }
  label_extractors = {
    stage = "EXTRACT(jsonPayload.schemaId)"
  }
}

resource "google_logging_metric" "model_events" {
  for_each = {
    rate_limited = "jsonPayload.event=\"vertex_model_attempt\" AND jsonPayload.httpStatus=429"
    retry        = "jsonPayload.event=\"vertex_model_attempt\" AND jsonPayload.phase=\"STARTED\" AND jsonPayload.attempt>1"
    timeout      = "jsonPayload.event=\"vertex_model_attempt\" AND jsonPayload.status=\"TIMEOUT\""
  }

  name    = "${local.prefix}-model-${replace(each.key, "_", "-")}"
  project = var.project_id
  filter  = each.value
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Vertex model ${replace(each.key, "_", " ")}"
  }
}

resource "google_monitoring_dashboard" "wave2" {
  project = var.project_id

  dashboard_json = jsonencode({
    displayName = "TrueMandate Wave 2 — ${var.environment}"
    gridLayout = {
      columns = 2
      widgets = concat(
        [
          for key, meta in local.decision_metrics : {
            title = meta.description
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${local.prefix}-${replace(key, "_", "-")}\" resource.type=\"global\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        ],
        [
          {
            title = "Cloud Trace — request latency (p50/p95)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_DELTA"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        ],
        [
          for key, meta in local.model_concurrency_gauges : {
            title = meta.description
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${local.prefix}-model-${replace(key, "_", "-")}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MAX"
                      crossSeriesReducer = key == "max_queue_depth" ? "REDUCE_MAX" : "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        ],
        [
          {
            title = "Vertex model queue wait (p95)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${local.prefix}-model-queue-wait-ms\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_PERCENTILE_95"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        ]
      )
    }
  })

  depends_on = [
    google_logging_metric.decision,
    google_logging_metric.model_concurrency,
    google_logging_metric.model_queue_wait,
    google_logging_metric.model_events,
  ]
}

# Non-authoritative alerts. These notify operators; they must never be wired
# into authorization, commit, or privilege-granting control planes.
resource "google_monitoring_alert_policy" "unknown_executions" {
  project      = var.project_id
  display_name = "${local.prefix} UNKNOWN executions > 0"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "UNKNOWN execution log metric"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${local.prefix}-execution-unknown\" resource.type=\"global\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  documentation {
    content   = "UNKNOWN executions must never be blindly retried. Investigate reconciliation. This alert is non-authoritative — monitoring never gates privilege."
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.decision]
}

resource "google_monitoring_alert_policy" "outcome_breaches" {
  project      = var.project_id
  display_name = "${local.prefix} outcome breaches"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Outcome breach log metric"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${local.prefix}-outcome-breach\" resource.type=\"global\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  documentation {
    content   = "OutcomeContract entered BREACHED. Open/inspect ResolutionCase. Non-authoritative monitoring only."
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.decision]
}

resource "google_monitoring_alert_policy" "guardian_authority_anomalies" {
  project      = var.project_id
  display_name = "${local.prefix} Guardian/Authority block spike"
  combiner     = "OR"
  enabled      = true

  conditions {
    display_name = "Authority BLOCK decisions elevated"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${local.prefix}-authority-decision\" resource.type=\"global\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 50
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  documentation {
    content   = "Elevated Authority decision rate — investigate for unauthorized-execution-style anomalies. Non-authoritative; never used to grant or deny privilege."
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.decision]
}

output "log_metric_names" {
  value = merge(
    { for k, m in google_logging_metric.decision : k => m.name },
    { for k, m in google_logging_metric.model_concurrency : "model_${k}" => m.name },
    { model_queue_wait = google_logging_metric.model_queue_wait.name },
    { for k, m in google_logging_metric.model_events : "model_${k}" => m.name },
  )
}

output "dashboard_id" {
  value = google_monitoring_dashboard.wave2.id
}

output "alert_policy_ids" {
  value = {
    unknown_executions           = google_monitoring_alert_policy.unknown_executions.id
    outcome_breaches             = google_monitoring_alert_policy.outcome_breaches.id
    guardian_authority_anomalies = google_monitoring_alert_policy.guardian_authority_anomalies.id
  }
}
