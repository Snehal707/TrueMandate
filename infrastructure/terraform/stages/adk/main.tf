terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "image" {
  type        = string
  description = "Container image reference (tag or pinned digest) for the ADK/A2A service."
}

variable "tm_public_base_url" {
  type        = string
  description = "Public base URL the SDK tools reach (the existing web proxy — read-only canonical route)."
}

variable "a2a_base_url" {
  type        = string
  description = "Advertised A2A base URL (the deployed service's own HTTPS URL)."
}

variable "invoker_principals" {
  type        = list(string)
  default     = []
  description = "Named authenticated principals granted run.invoker (never allUsers)."
}

/**
 * ADK/A2A stage — deliberately SEPARATE from the trusted runtime stage.
 * This stage creates exactly three things and grants nothing else:
 *   1. a dedicated least-privilege service account,
 *   2. that SA's two roles (Vertex AI user + logging),
 *   3. the A2A Cloud Run service (authenticated ingress, NO allUsers).
 * Zero modification to the trusted service IAM graph: no authority writer,
 * no gateway invoker, no CommitToken privileges, no grant minting, no broad
 * Firestore writer, no economic execution privilege.
 */

resource "google_service_account" "adk_a2a" {
  account_id   = "tm-dev-adk-a2a"
  display_name = "TrueMandate ADK A2A reference agent"
  project      = var.project_id
}

# Vertex AI Gemini invocation (prediction) — required capability only.
resource "google_project_iam_member" "adk_a2a_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.adk_a2a.email}"
}

# Logging.
resource "google_project_iam_member" "adk_a2a_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.adk_a2a.email}"
}

resource "google_cloud_run_v2_service" "adk_a2a" {
  name     = "tm-dev-adk-a2a"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"
  # NOTE: ingress ALL but NO allUsers binding anywhere in this stage —
  # invocations require Cloud Run identity (run.invoker), i.e. authenticated
  # principals only. The A2A RPC stays authenticated.

  template {
    service_account = google_service_account.adk_a2a.email

    containers {
      image = var.image

      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "true"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-3.7-flash"
      }
      env {
        name  = "TM_PUBLIC_BASE_URL"
        value = var.tm_public_base_url
      }
      env {
        name  = "A2A_BASE_URL"
        value = var.a2a_base_url
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    timeout = "300s"
  }

  # Declared to match the materialized service-level scaling block so plans
  # stay strictly image-only (no repeated cosmetic normalizations).
  scaling {
    manual_instance_count = 0
    min_instance_count    = 0
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }
}

# Named authenticated principals only — the RPC service stays authenticated.
# NO allUsers is ever added to this service.
resource "google_cloud_run_v2_service_iam_member" "adk_a2a_invokers" {
  for_each = toset(var.invoker_principals)

  name     = google_cloud_run_v2_service.adk_a2a.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = each.value
}

output "adk_a2a_url" {
  value = google_cloud_run_v2_service.adk_a2a.uri
}

output "adk_a2a_service_account" {
  value = google_service_account.adk_a2a.email
}
