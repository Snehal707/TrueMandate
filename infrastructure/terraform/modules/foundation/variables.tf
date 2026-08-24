variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "firestore_database_id" {
  type    = string
  default = "(default)"
}

variable "artifact_registry_repo_id" {
  type    = string
  default = "truemandate"
}

variable "enable_pull_subscriptions" {
  type        = bool
  default     = false
  description = "When true, create pull subscriptions for local/debug/benchmark workers. Cloud Run production delivery is authenticated push (runtime stage). Never enable both for the same consumer without a documented reason."
}

locals {
  name_prefix = "tm-${var.environment}"

  domain_topics = [
    "intent.events",
    "semantic.events",
    "plan.events",
    "guardian.events",
    "authority.events",
    "execution.events",
    "evidence.events",
    "outcome.events",
    "resolution.events",
    "security.events",
    "observability.events",
  ]

  # Runtime SAs: nine core services plus evidence-service, phase verifiers,
  # and Wave 3 analytics/learning identities.
  service_account_ids = toset([
    "intent-provenance",
    "authority",
    "gateway",
    "outcome-resolution",
    "agent-runtime",
    "observability-api",
    "public-bff",
    "benchmark-runner",
    "web",
    "evidence-service",
    "phase-a-verifier",
    "phase-b-verifier",
    "phase-c-verifier",
    "analytics-export",
    "analytics-query",
    "learning-service",
  ])

  firestore_rw = toset([
    "agent-runtime",
    "intent-provenance",
    "authority",
    "gateway",
    "outcome-resolution",
    "evidence-service",
    "analytics-export",
    "learning-service",
  ])

  firestore_ro = toset([
    "observability-api",
    "public-bff",
    "benchmark-runner",
  ])

  # topic → publishers (service keys)
  topic_publishers = {
    "intent.events"         = ["intent-provenance", "phase-a-verifier", "phase-b-verifier", "phase-c-verifier"]
    "semantic.events"       = ["intent-provenance", "agent-runtime"]
    "plan.events"           = ["agent-runtime", "intent-provenance"]
    "guardian.events"       = ["agent-runtime"]
    "authority.events"      = ["authority"]
    "execution.events"      = ["gateway"]
    "evidence.events"       = ["outcome-resolution", "intent-provenance"]
    "outcome.events"        = ["outcome-resolution"]
    "resolution.events"     = ["outcome-resolution"]
    "security.events"       = ["authority", "gateway", "agent-runtime", "benchmark-runner"]
    "observability.events"  = ["observability-api", "intent-provenance", "authority", "gateway", "outcome-resolution", "agent-runtime", "benchmark-runner"]
  }

  # consumer → topics (pull subscriptions / runtime push)
  consumer_topics = {
    "intent-provenance" = ["authority.events", "execution.events"]
    "authority"           = ["intent.events", "guardian.events", "plan.events"]
    "gateway"             = ["authority.events", "outcome.events"]
    "outcome-resolution"  = ["execution.events", "evidence.events"]
    "agent-runtime"       = ["intent.events"]
    "observability-api" = [
      "intent.events",
      "semantic.events",
      "plan.events",
      "guardian.events",
      "authority.events",
      "execution.events",
      "evidence.events",
      "outcome.events",
      "resolution.events",
      "security.events",
    ]
    # Wave 3: analytics-export mirrors governance topics (GOVERNANCE_EXPORT_TOPICS).
    "analytics-export" = [
      "intent.events",
      "semantic.events",
      "plan.events",
      "guardian.events",
      "authority.events",
      "execution.events",
      "evidence.events",
      "outcome.events",
      "resolution.events",
      "security.events",
    ]
  }

  subscription_pairs = flatten([
    for consumer, topics in local.consumer_topics : [
      for topic in topics : {
        key      = "${consumer}--${topic}"
        consumer = consumer
        topic    = topic
      }
    ]
  ])

  secret_ids = toset([
    "vertex-model-config",
    "adk-runtime-config",
    "gateway-hmac-key",
    "observability-api-key",
  ])

  # secret → accessors
  secret_accessors = {
    "adk-runtime-config"    = ["intent-provenance", "agent-runtime"]
    "gateway-hmac-key"      = ["authority", "gateway"]
    "vertex-model-config"   = ["agent-runtime", "benchmark-runner"]
    "observability-api-key" = ["observability-api", "public-bff"]
  }

  secret_accessor_pairs = flatten([
    for secret, accessors in local.secret_accessors : [
      for sa in accessors : {
        key    = "${secret}--${sa}"
        secret = secret
        sa     = sa
      }
    ]
  ])

  topic_publisher_pairs = flatten([
    for topic, pubs in local.topic_publishers : [
      for sa in pubs : {
        key   = "${topic}--${sa}"
        topic = topic
        sa    = sa
      }
    ]
  ])

  armor_sAs = toset(["agent-runtime", "gateway", "benchmark-runner"])
  vertex_sAs = toset(["agent-runtime", "benchmark-runner"])

  # Cloud Trace — only SAs whose bin/start.ts calls initTracing().
  # Excludes public-bff, web, and phase-*-verifier (no Wave 2 tracing).
  cloudtrace_sAs = toset([
    "agent-runtime",
    "authority",
    "gateway",
    "outcome-resolution",
    "intent-provenance",
    "evidence-service",
    "observability-api",
    "benchmark-runner",
    "analytics-export",
    "analytics-query",
    "learning-service",
  ])
}
