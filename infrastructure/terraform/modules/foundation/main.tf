resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "iam.googleapis.com",
    "modelarmor.googleapis.com",
    "cloudtrace.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "bigquery.googleapis.com",
    "iamcredentials.googleapis.com",
    "compute.googleapis.com",
    "networkconnectivity.googleapis.com",
    "dns.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "time_sleep" "wait_apis" {
  create_duration = "60s"
  depends_on      = [google_project_service.required_apis]
}

resource "google_service_account" "runtime" {
  for_each = local.service_account_ids

  account_id   = "${local.name_prefix}-${each.value}"
  display_name = "TrueMandate ${each.value} (${var.environment})"
  project      = var.project_id

  depends_on = [
    google_project_service.required_apis["iam.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_firestore_database" "primary" {
  project     = var.project_id
  name        = var.firestore_database_id
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [
    google_project_service.required_apis["firestore.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_pubsub_topic" "domain" {
  for_each = toset(local.domain_topics)

  name    = "${local.name_prefix}-${each.value}"
  project = var.project_id

  depends_on = [
    google_project_service.required_apis["pubsub.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_pubsub_topic" "dlq" {
  for_each = toset(local.domain_topics)

  name    = "${local.name_prefix}-${each.value}-dlq"
  project = var.project_id

  depends_on = [
    google_project_service.required_apis["pubsub.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

# Pull subscriptions are OPTIONAL (default off). Cloud Run production delivery is OIDC push.
resource "google_pubsub_subscription" "consumer" {
  for_each = var.enable_pull_subscriptions ? {
    for p in local.subscription_pairs : p.key => p
  } : {}

  name    = "${local.name_prefix}-${each.value.consumer}--${each.value.topic}"
  project = var.project_id
  topic   = google_pubsub_topic.domain[each.value.topic].id

  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq[each.value.topic].id
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = ""
  }

  depends_on = [
    google_project_service.required_apis["pubsub.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_artifact_registry_repository" "truemandate" {
  location      = var.region
  repository_id = var.artifact_registry_repo_id
  description   = "TrueMandate container images"
  format        = "DOCKER"
  project       = var.project_id

  depends_on = [
    google_project_service.required_apis["artifactregistry.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_secret_manager_secret" "placeholders" {
  for_each = local.secret_ids

  secret_id = "${local.name_prefix}-${each.value}"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [
    google_project_service.required_apis["secretmanager.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

# Model Armor template used by ModelSecurityPort (CLEAN must never clear taint in app code)
resource "google_model_armor_template" "tm_prompt_response" {
  location    = var.region
  template_id = "${local.name_prefix}-prompt-response"
  project     = var.project_id

  filter_config {
    rai_settings {
      rai_filters {
        filter_type      = "HATE_SPEECH"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "DANGEROUS"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "SEXUALLY_EXPLICIT"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
      rai_filters {
        filter_type      = "HARASSMENT"
        confidence_level = "MEDIUM_AND_ABOVE"
      }
    }

    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "MEDIUM_AND_ABOVE"
    }

    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }
  }

  depends_on = [
    google_project_service.required_apis["modelarmor.googleapis.com"],
    time_sleep.wait_apis,
  ]

  lifecycle {
    ignore_changes = [template_metadata]
  }
}
