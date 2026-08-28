terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "agent_runtime_revision_nonce" {
  type        = string
  default     = ""
  description = "When non-empty, stamps client.knative.dev/nonce on the agent-runtime revision template to force an intentional same-config rollout. Empty by default (no effect)."
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "artifact_registry_repo_id" {
  type = string
}

variable "enable_public_bff_ingress" {
  type    = bool
  default = true
}

variable "service_account_emails" {
  type = map(string)
}

variable "service_urls" {
  type        = map(string)
  description = "Canonical Cloud Run service URLs used by runtime S2S configuration."
}

variable "model_armor_template_name" {
  type = string
}

variable "consumer_topics" {
  type        = map(list(string))
  description = "Consumer service key → domain topic names. Drives authenticated push subscriptions."
}

variable "name_prefix" {
  type = string
}

variable "enable_secret_preflight" {
  type        = bool
  default     = true
  description = "Run secret-version preflight at apply (metadata only; never writes secret values into state)."
}

variable "required_secret_ids" {
  type        = list(string)
  default     = []
  description = "Secret Manager IDs (unprefixed) that must have an ENABLED version. Empty: no application consumer in Stage C."
}

variable "image_digests" {
  type        = map(string)
  description = "Image name → sha256 digest (with or without sha256: prefix). Required for every Cloud Run image. No :latest."

  validation {
    condition = alltrue([
      for name in [
        "intent-provenance",
        "authority",
        "gateway",
        "outcome-resolution",
        "agent-runtime",
        "observability-api",
        "public-bff",
        "benchmark-runner",
        "evidence-service",
        "phase-a-verifier",
        "phase-b-verifier",
        "phase-c-verifier",
        "web",
        "analytics-export",
        "analytics-query",
        "learning-service",
        "demo-evidence-orchestrator",
      ] : contains(keys(var.image_digests), name)
    ])
    error_message = "image_digests must include every Cloud Run image name."
  }
}

variable "benchmark_v2_image_digest" {
  type        = string
  description = "Dedicated sha256 digest for the isolated BENCHMARK_V2 Cloud Run Job."

  validation {
    condition     = can(regex("^(sha256:)?[0-9a-f]{64}$", var.benchmark_v2_image_digest))
    error_message = "benchmark_v2_image_digest must be a sha256 digest."
  }
}

variable "vpc_network" {
  type        = string
  description = "Self-link of the dedicated TrueMandate S2S VPC (Direct VPC)."
}

variable "vpc_subnet" {
  type        = string
  description = "Self-link of the Direct VPC subnet."
}

variable "vpc_egress" {
  type        = string
  description = "Cloud Run Direct VPC egress. ALL_TRAFFIC is required to reach Internal Cloud Run *.run.app URLs."
  default     = "ALL_TRAFFIC"
}

locals {
  image_root = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_registry_repo_id}"
  service_account_emails = merge(var.service_account_emails, {
    "evidence-service" = "${var.name_prefix}-evidence-service@${var.project_id}.iam.gserviceaccount.com"
    "phase-a-verifier" = "${var.name_prefix}-phase-a-verifier@${var.project_id}.iam.gserviceaccount.com"
  })
  intent_provenance_audience = var.service_urls["intent-provenance"]

  runtime_services = {
    intent-provenance = {
      image   = "intent-provenance"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "intent-provenance"
    }
    authority = {
      image   = "authority"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "authority"
    }
    gateway = {
      image   = "gateway"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "gateway"
    }
    outcome-resolution = {
      image   = "outcome-resolution"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "outcome-resolution"
    }
    agent-runtime = {
      image   = "agent-runtime"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "agent-runtime"
    }
    observability-api = {
      image   = "observability-api"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "observability-api"
    }
    public-bff = {
      image   = "public-bff"
      ingress = var.enable_public_bff_ingress ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "public-bff"
    }
    benchmark-runner = {
      image   = "benchmark-runner"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "benchmark-runner"
    }
    evidence-service = {
      image   = "evidence-service"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "evidence-service"
    }
    analytics-export = {
      image   = "analytics-export"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "analytics-export"
    }
    analytics-query = {
      image   = "analytics-query"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "analytics-query"
    }
    learning-service = {
      image   = "learning-service"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "learning-service"
    }
    # Trusted demo-evidence orchestration for the judge-facing Live Proof /
    # Attack Lab surfaces. Runs under the EXISTING phase-c-verifier identity
    # (sa = "phase-c-verifier", not a new service account) — the only
    # identity TM_EVIDENCE_VERIFY_CALLER_EMAILS allowlists for
    # /internal/evidence/verifications. That allowlist is unchanged by this
    # service's addition. Internal-only: reached solely via public-bff.
    demo-evidence-orchestrator = {
      image   = "demo-evidence-orchestrator"
      ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
      sa      = "phase-c-verifier"
    }
  }

  # Split so public-bff/agent-runtime can reference intent-provenance.uri and
  # authority can reference gateway.uri without a cycle.
  owner_runtime_services = {
    for k, v in local.runtime_services : k => v
    if !contains(["public-bff", "agent-runtime", "authority", "demo-evidence-orchestrator"], k)
  }
  s2s_runtime_services = {
    for k, v in local.runtime_services : k => v
    if contains(["public-bff", "agent-runtime", "authority", "demo-evidence-orchestrator"], k)
  }

  # Exact invoker edges (source SA → target service key)
  invoker_edges = {
    "agent-runtime->authority"              = { from = "agent-runtime", to = "authority" }
    "agent-runtime->evidence-service"       = { from = "agent-runtime", to = "evidence-service" }
    "agent-runtime->gateway"                = { from = "agent-runtime", to = "gateway" }
    "public-bff->agent-runtime"             = { from = "public-bff", to = "agent-runtime" }
    "public-bff->authority"                 = { from = "public-bff", to = "authority" }
    "public-bff->evidence-service"          = { from = "public-bff", to = "evidence-service" }
    "public-bff->intent-provenance"         = { from = "public-bff", to = "intent-provenance" }
    "public-bff->outcome-resolution"        = { from = "public-bff", to = "outcome-resolution" }
    "agent-runtime->intent-provenance"      = { from = "agent-runtime", to = "intent-provenance" }
    "agent-runtime->observability-api"      = { from = "agent-runtime", to = "observability-api" }
    "agent-runtime->outcome-resolution"     = { from = "agent-runtime", to = "outcome-resolution" }
    "intent-provenance->agent-runtime"      = { from = "intent-provenance", to = "agent-runtime" }
    "intent-provenance->observability-api"  = { from = "intent-provenance", to = "observability-api" }
    "authority->gateway"                    = { from = "authority", to = "gateway" }
    "authority->learning-service"           = { from = "authority", to = "learning-service" }
    "authority->outcome-resolution"         = { from = "authority", to = "outcome-resolution" }
    "authority->intent-provenance"          = { from = "authority", to = "intent-provenance" }
    "authority->observability-api"          = { from = "authority", to = "observability-api" }
    "gateway->outcome-resolution"           = { from = "gateway", to = "outcome-resolution" }
    "gateway->observability-api"            = { from = "gateway", to = "observability-api" }
    "gateway->authority"                    = { from = "gateway", to = "authority" }
    "gateway->intent-provenance"            = { from = "gateway", to = "intent-provenance" }
    "outcome-resolution->authority"         = { from = "outcome-resolution", to = "authority" }
    "outcome-resolution->evidence-service"  = { from = "outcome-resolution", to = "evidence-service" }
    "outcome-resolution->intent-provenance" = { from = "outcome-resolution", to = "intent-provenance" }
    # Wave 1 remedy lifecycle: the production PrivilegedRemedyPort performs
    # Gateway PREPARE/AUTHORIZE/COMMIT from the outcome-resolution identity
    # (route allowlists above additionally bind this identity server-side).
    "outcome-resolution->gateway"           = { from = "outcome-resolution", to = "gateway" }
    "outcome-resolution->observability-api" = { from = "outcome-resolution", to = "observability-api" }
    "phase-a-verifier->agent-runtime"       = { from = "phase-a-verifier", to = "agent-runtime" }
    "phase-b-verifier->agent-runtime"       = { from = "phase-b-verifier", to = "agent-runtime" }
    "phase-b-verifier->evidence-service"    = { from = "phase-b-verifier", to = "evidence-service" }
    "phase-c-verifier->agent-runtime"       = { from = "phase-c-verifier", to = "agent-runtime" }
    "phase-c-verifier->evidence-service"    = { from = "phase-c-verifier", to = "evidence-service" }
    "phase-c-verifier->outcome-resolution"  = { from = "phase-c-verifier", to = "outcome-resolution" }
    # Wave 1 capability-policy ingress: the acceptance operator reads the
    # finalized tip and creates policy IntentStates via intent-provenance.
    "phase-c-verifier->intent-provenance" = { from = "phase-c-verifier", to = "intent-provenance" }
    # Wave 1 approval decide: decidedBy is the verified phase-c operator
    # identity; allowlist already includes phase-c on authority — invoker
    # must match so Cloud Run does not 403 before the decide route.
    "phase-c-verifier->authority"          = { from = "phase-c-verifier", to = "authority" }
    "phase-a-verifier->evidence-service"   = { from = "phase-a-verifier", to = "evidence-service" }
    "phase-a-verifier->intent-provenance"  = { from = "phase-a-verifier", to = "intent-provenance" }
    "evidence-service->intent-provenance"  = { from = "evidence-service", to = "intent-provenance" }
    "evidence-service->outcome-resolution" = { from = "evidence-service", to = "outcome-resolution" }
    "web->public-bff"                      = { from = "web", to = "public-bff" }
    # Trusted demo-evidence orchestration: public-bff is the ONLY caller
    # allowed to reach the new internal route (narrow, additive — does not
    # touch TM_EVIDENCE_VERIFY_CALLER_EMAILS or any other existing
    # allowlist). The orchestrator's own outbound edges mirror the
    # phase-c-verifier identity's EXISTING edges above exactly, since it
    # runs as that same identity. It does not call gateway/authority
    # directly — commit/authorize happen inside agent-runtime's own
    # workflow pipeline, reached only via public-bff's public route.
    "public-bff->demo-evidence-orchestrator"          = { from = "public-bff", to = "demo-evidence-orchestrator" }
    "demo-evidence-orchestrator->evidence-service"    = { from = "demo-evidence-orchestrator", to = "evidence-service" }
    "demo-evidence-orchestrator->intent-provenance"   = { from = "demo-evidence-orchestrator", to = "intent-provenance" }
  }

  armor_env_services  = toset(["agent-runtime", "gateway", "benchmark-runner"])
  vertex_env_services = toset(["agent-runtime", "benchmark-runner"])

  digest_of = {
    for name, digest in var.image_digests :
    name => startswith(digest, "sha256:") ? digest : "sha256:${digest}"
  }
  benchmark_v2_digest = startswith(var.benchmark_v2_image_digest, "sha256:") ? var.benchmark_v2_image_digest : "sha256:${var.benchmark_v2_image_digest}"

  push_consumers = toset([
    "intent-provenance",
    "authority",
    "gateway",
    "outcome-resolution",
    "agent-runtime",
    "observability-api",
    "analytics-export",
  ])

  push_pairs = flatten([
    for consumer, topics in var.consumer_topics : [
      for topic in topics : {
        key      = "${consumer}--${topic}"
        consumer = consumer
        topic    = topic
      }
    ]
  ])

  # Callers of INTERNAL_ONLY destinations. web, observability-api, and
  # benchmark-runner do not send S2S to Internal Cloud Run.
  vpc_callers = toset([
    "public-bff",
    "agent-runtime",
    "intent-provenance",
    "authority",
    "gateway",
    "outcome-resolution",
    "evidence-service",
  ])

  service_env = {
    agent-runtime = {
      AUTHORITY_URL             = var.service_urls["authority"]
      EVIDENCE_URL              = var.service_urls["evidence-service"]
      GATEWAY_URL               = var.service_urls["gateway"]
      INTENT_PROVENANCE_URL     = var.service_urls["intent-provenance"]
      OUTCOME_RESOLUTION_URL    = var.service_urls["outcome-resolution"]
      TM_GOVERNANCE_EVENTS_MODE = "pubsub"
      TM_PUBSUB_TOPIC_PREFIX    = "${var.name_prefix}-"
    }
    authority = {
      GATEWAY_URL               = var.service_urls["gateway"]
      INTENT_PROVENANCE_URL     = var.service_urls["intent-provenance"]
      LEARNING_URL              = var.service_urls["learning-service"]
      OUTCOME_RESOLUTION_URL    = var.service_urls["outcome-resolution"]
      TM_GOVERNANCE_EVENTS_MODE = "pubsub"
      TM_PUBSUB_TOPIC_PREFIX    = "${var.name_prefix}-"
    }
    gateway = {
      AUTHORITY_URL             = var.service_urls["authority"]
      INTENT_PROVENANCE_URL     = var.service_urls["intent-provenance"]
      OUTCOME_RESOLUTION_URL    = var.service_urls["outcome-resolution"]
      TM_GOVERNANCE_EVENTS_MODE = "pubsub"
      TM_PUBSUB_TOPIC_PREFIX    = "${var.name_prefix}-"
    }
    outcome-resolution = {
      AUTHORITY_URL         = var.service_urls["authority"]
      INTENT_PROVENANCE_URL = var.service_urls["intent-provenance"]
      # Wave 1 remedy lifecycle: the production PrivilegedRemedyPort drives
      # Gateway PREPARE/AUTHORIZE/COMMIT over S2S.
      GATEWAY_URL               = var.service_urls["gateway"]
      TM_GOVERNANCE_EVENTS_MODE = "pubsub"
      TM_PUBSUB_TOPIC_PREFIX    = "${var.name_prefix}-"
    }
    intent-provenance = {
      TM_GOVERNANCE_EVENTS_MODE = "pubsub"
      TM_PUBSUB_TOPIC_PREFIX    = "${var.name_prefix}-"
    }
    public-bff = {
      AGENT_RUNTIME_URL      = var.service_urls["agent-runtime"]
      AUTHORITY_URL          = var.service_urls["authority"]
      EVIDENCE_URL           = var.service_urls["evidence-service"]
      INTENT_PROVENANCE_URL  = var.service_urls["intent-provenance"]
      OUTCOME_RESOLUTION_URL = var.service_urls["outcome-resolution"]
    }
    analytics-export = {
      TM_ANALYTICS_EXPORT = "bigquery"
      TM_BQ_DATASET       = "tm_dev_analytics"
    }
    analytics-query = {
      TM_ANALYTICS_QUERY          = "bigquery"
      TM_BQ_DATASET               = "tm_dev_analytics"
      TM_REQUIRE_INTERNAL_AUTH    = "true"
      TM_INTERNAL_AUTH_VERIFY     = "true"
      TM_INTERNAL_AUTH_AUDIENCE   = var.service_urls["analytics-query"]
      TM_INTERNAL_ALLOWED_CALLERS = local.service_account_emails["phase-c-verifier"]
    }
    learning-service = {
      TM_REQUIRE_INTERNAL_AUTH  = "true"
      TM_INTERNAL_AUTH_VERIFY   = "true"
      TM_INTERNAL_AUTH_AUDIENCE = var.service_urls["learning-service"]
      TM_INTERNAL_ALLOWED_CALLERS = join(",", [
        local.service_account_emails["phase-c-verifier"],
        local.service_account_emails["authority"],
      ])
    }
  }
}
