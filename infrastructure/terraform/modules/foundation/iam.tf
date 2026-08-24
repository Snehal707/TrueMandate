# Firestore — RW vs RO (viewer). web has neither.
resource "google_project_iam_member" "firestore_user" {
  for_each = local.firestore_rw

  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "firestore_viewer" {
  for_each = local.firestore_ro

  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# Topic-scoped publishers
resource "google_pubsub_topic_iam_member" "publisher" {
  for_each = {
    for p in local.topic_publisher_pairs : p.key => p
  }

  project = var.project_id
  topic   = google_pubsub_topic.domain[each.value.topic].name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.runtime[each.value.sa].email}"
}

# Subscription-scoped subscribers — only when pull is enabled
resource "google_pubsub_subscription_iam_member" "subscriber" {
  for_each = var.enable_pull_subscriptions ? {
    for p in local.subscription_pairs : p.key => p
  } : {}

  project      = var.project_id
  subscription = google_pubsub_subscription.consumer[each.key].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.runtime[each.value.consumer].email}"
}

# Pub/Sub service agent needs publisher on DLQ topics for dead lettering
data "google_project" "current" {
  project_id = var.project_id
}

resource "google_pubsub_topic_iam_member" "dlq_pubsub_agent" {
  for_each = toset(local.domain_topics)

  project = var.project_id
  topic   = google_pubsub_topic.dlq[each.key].name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"

  depends_on = [
    google_project_service.required_apis["pubsub.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

# Secret-scoped accessors
resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = {
    for p in local.secret_accessor_pairs : p.key => p
  }

  project   = var.project_id
  secret_id = google_secret_manager_secret.placeholders[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.sa].email}"
}

# Vertex AI
resource "google_project_iam_member" "vertex_user" {
  for_each = local.vertex_sAs

  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# Model Armor — only screening workloads
resource "google_project_iam_member" "model_armor_user" {
  for_each = local.armor_sAs

  project = var.project_id
  role    = "roles/modelarmor.user"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# Artifact Registry reader for all runtime SAs that pull images (Cloud Run runtime SA)
resource "google_artifact_registry_repository_iam_member" "reader" {
  for_each = local.service_account_ids

  project    = var.project_id
  location   = var.region
  repository = google_artifact_registry_repository.truemandate.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# Cloud Trace — least privilege: only SAs whose bin/start.ts calls
# initTracing() (agent-runtime, authority, gateway, outcome-resolution,
# intent-provenance, evidence-service, observability-api, benchmark-runner).
# public-bff, web, and phase-*-verifier do not emit traces and must not
# receive roles/cloudtrace.agent.
resource "google_project_iam_member" "cloudtrace_agent" {
  for_each = local.cloudtrace_sAs

  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.runtime[each.key].email}"

  depends_on = [
    google_project_service.required_apis["cloudtrace.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

# Forbidden capability anchors (enforced by packages/architecture tests + iam-matrix.json):
# - web MUST NOT receive Firestore / Secrets / Pub/Sub / Vertex / Armor / Gateway invoker
# - public-bff / observability / benchmark / agent-runtime MUST NOT invoke Gateway
# - benchmark-runner MUST NOT receive production economic authority
