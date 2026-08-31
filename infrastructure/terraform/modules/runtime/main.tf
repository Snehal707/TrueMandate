data "google_project" "current" {
  project_id = var.project_id
}

locals {
  pubsub_agent = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Metadata-only check: fails apply if a required secret has no ENABLED version.
# Does not read or store secret payloads.
resource "terraform_data" "secret_preflight" {
  count = var.enable_secret_preflight ? 1 : 0

  triggers_replace = {
    prefix  = var.name_prefix
    secrets = join(",", var.required_secret_ids)
  }

  # working_dir + unquoted relative path: Windows cmd /C concatenates quoted
  # absolute paths with the Terraform chdir and Node then fails MODULE_NOT_FOUND.
  provisioner "local-exec" {
    working_dir = "${path.module}/../../../../scripts/cloud"
    command     = length(var.required_secret_ids) == 0 ? "node secret-preflight.mjs --project ${var.project_id} --prefix ${var.name_prefix}" : "node secret-preflight.mjs --project ${var.project_id} --prefix ${var.name_prefix} --secrets ${join(",", var.required_secret_ids)}"
  }
}

resource "google_cloud_run_v2_service" "runtime" {
  for_each = local.owner_runtime_services

  name     = "${var.name_prefix}-${each.key}"
  location = var.region
  project  = var.project_id
  ingress  = each.value.ingress

  template {
    # User-managed revision nonce: forces an intentional same-config rollout
    # when changed (template labels persist to revisions and are supported on
    # google_cloud_run_v2_service).
    labels = each.key == "agent-runtime" && var.agent_runtime_revision_nonce != "" ? { "truemandate.dev/revision-nonce" = var.agent_runtime_revision_nonce } : null

    service_account = local.service_account_emails[each.value.sa]

    containers {
      image = "${local.image_root}/${each.value.image}@${local.digest_of[each.value.image]}"

      env {
        name  = "TM_PERSISTENCE"
        value = contains(["benchmark-runner", "analytics-query"], each.key) ? "memory" : "firestore"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "TM_SERVICE_NAME"
        value = each.key
      }
      env {
        name  = "TM_REQUIRE_CONFIG"
        value = "true"
      }

      dynamic "env" {
        for_each = contains(local.armor_env_services, each.key) ? [1] : []
        content {
          name  = "TM_MODEL_ARMOR_TEMPLATE"
          value = var.model_armor_template_name
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "VERTEX_PROJECT"
          value = var.project_id
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "VERTEX_LOCATION"
          value = "global"
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "GEMINI_MODEL"
          value = "gemini-3.7-flash"
        }
      }

      dynamic "env" {
        for_each = contains(["intent-provenance", "gateway"], each.key) ? [1] : []
        content {
          name  = "TM_REQUIRE_INTERNAL_AUTH"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = lookup(local.service_env, each.key, {})
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = contains(["intent-provenance", "gateway", "evidence-service"], each.key) ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_AUDIENCE"
          value = each.key == "intent-provenance" ? local.intent_provenance_audience : var.service_urls[each.key]
        }
      }

      dynamic "env" {
        for_each = contains(["intent-provenance", "gateway"], each.key) ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_VERIFY"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "gateway" ? [1] : []
        content {
          name = "TM_INTERNAL_ALLOWED_CALLERS"
          value = join(",", [
            local.service_account_emails["authority"],
            local.service_account_emails["agent-runtime"],
            # Public BFF has GET-only access to reconstruct the redacted
            # execution/provenance projection. It is not a commit caller.
            local.service_account_emails["public-bff"],
            # Wave 1 remedy lifecycle: outcome-resolution drives the production
            # PrivilegedRemedyPort (prepare/authorize) against the Gateway.
            local.service_account_emails["outcome-resolution"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "gateway" ? [1] : []
        content {
          name = "TM_COMMIT_CALLER_EMAIL"
          value = join(",", [
            local.service_account_emails["agent-runtime"],
            # Wave 1 remedy lifecycle: the remedy execution COMMIT is issued
            # by the outcome-resolution service identity.
            local.service_account_emails["outcome-resolution"],
          ])
        }
      }


      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_PHASE_B_FIXTURE_CALLER_EMAIL"
          value = local.service_account_emails["phase-b-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_PHASE_C_FIXTURE_CALLER_EMAIL"
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name = "TM_WAVE1_FIXTURE_CALLER_EMAIL"
          # Wave 1 acceptance: the existing trusted phase-c verifier identity
          # additionally owns the server-side wave1- fixture namespace (no new
          # identity, no allUsers, no caller-auth weakening).
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name = "TM_EVIDENCE_READER_CALLER_EMAILS"
          # Outcome-resolution reads for evaluation; Wave 1 operator
          # (phase-c) must also read envelopes it wrote via fixtures so
          # durable write→read acceptance can cross a revision boundary.
          value = join(",", [
            local.service_account_emails["outcome-resolution"],
            local.service_account_emails["phase-c-verifier"],
            local.service_account_emails["public-bff"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name = "TM_INTERNAL_ALLOWED_CALLERS"
          value = join(",", [
            local.service_account_emails["authority"],
            local.service_account_emails["agent-runtime"],
            local.service_account_emails["public-bff"],
            local.service_account_emails["intent-provenance"],
            local.service_account_emails["evidence-service"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name  = "TM_ACCEPTANCE_FIXTURE_CALLER_EMAIL"
          value = local.service_account_emails["phase-a-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name  = "TM_AUTHORITY_CALLER_EMAIL"
          value = local.service_account_emails["authority"]
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name  = "TM_OUTCOME_RESOLUTION_CALLER_EMAIL"
          value = local.service_account_emails["outcome-resolution"]
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name  = "TM_GATEWAY_CALLER_EMAIL"
          value = local.service_account_emails["gateway"]
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name = "TM_INTENT_STATE_CALLER_EMAILS"
          # Wave 1 capability-policy ingress: the trusted acceptance operator
          # identity may create policy IntentStates (capabilities) and read
          # the finalized tip — never the model pipeline, no allUsers.
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "intent-provenance" ? [1] : []
        content {
          name  = "TM_SEMANTIC_SUPERSESSION_CALLER_EMAILS"
          value = local.service_account_emails["agent-runtime"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_REQUIRE_INTERNAL_AUTH"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_VERIFY"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name = "TM_INTERNAL_ALLOWED_CALLERS"
          value = join(",", [
            local.service_account_emails["agent-runtime"],
            local.service_account_emails["phase-a-verifier"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_ACCEPTANCE_FIXTURE_CALLER_EMAIL"
          value = local.service_account_emails["phase-a-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "INTENT_PROVENANCE_URL"
          value = var.service_urls["intent-provenance"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "OUTCOME_RESOLUTION_URL"
          value = var.service_urls["outcome-resolution"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_REQUIRE_INTERNAL_AUTH"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_PHASE_C_VERIFIER_CALLER_EMAIL"
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "EVIDENCE_URL"
          value = var.service_urls["evidence-service"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_VERIFY"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_AUDIENCE"
          value = var.service_urls["outcome-resolution"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name = "TM_INTERNAL_ALLOWED_CALLERS"
          value = join(",", [
            local.service_account_emails["gateway"],
            local.service_account_emails["agent-runtime"],
            local.service_account_emails["evidence-service"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_OUTCOME_READER_CALLER_EMAILS"
          value = local.service_account_emails["public-bff"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_GATEWAY_CALLER_EMAIL"
          value = local.service_account_emails["gateway"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_EVIDENCE_SUBMIT_CALLER_EMAILS"
          value = local.service_account_emails["public-bff"]
        }
      }

      dynamic "env" {
        for_each = each.key == "evidence-service" ? [1] : []
        content {
          name  = "TM_EVIDENCE_VERIFY_CALLER_EMAILS"
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      dynamic "env" {
        for_each = each.key == "outcome-resolution" ? [1] : []
        content {
          name  = "TM_AUTHORITY_CALLER_EMAIL"
          value = local.service_account_emails["authority"]
        }
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/readyz"
          port = 8080
        }
        initial_delay_seconds = contains(local.vpc_callers, each.key) ? 10 : 0
        timeout_seconds       = contains(local.vpc_callers, each.key) ? 3 : 1
        period_seconds        = 10
        failure_threshold     = contains(local.vpc_callers, each.key) ? 12 : 3
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    dynamic "vpc_access" {
      for_each = contains(local.vpc_callers, each.key) ? [1] : []
      content {
        egress = var.vpc_egress
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnet
        }
      }
    }
  }

  # Match API-reported service-level autoscale floor without switching to
  # manual scaling (do not set manual_instance_count). Gateway keeps one
  # warm instance so the Phase B economic execution path never waits on a
  # scale-from-zero Model Armor startup probe; other services scale to zero.
  scaling {
    min_instance_count = each.key == "gateway" ? 1 : 0
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [terraform_data.secret_preflight]
}

# public-bff and agent-runtime call intent-provenance over S2S. Authority calls
# gateway over S2S. Split from the owner for_each so those URLs can reference
# already-created runtime services without a cycle.
resource "google_cloud_run_v2_service" "s2s" {
  for_each = local.s2s_runtime_services

  name     = "${var.name_prefix}-${each.key}"
  location = var.region
  project  = var.project_id
  ingress  = each.value.ingress

  template {
    # User-managed revision nonce: forces an intentional same-config rollout
    # when changed (template labels persist to revisions and are supported on
    # google_cloud_run_v2_service).
    labels = each.key == "agent-runtime" && var.agent_runtime_revision_nonce != "" ? { "truemandate.dev/revision-nonce" = var.agent_runtime_revision_nonce } : null

    service_account = local.service_account_emails[each.value.sa]

    containers {
      image = "${local.image_root}/${each.value.image}@${local.digest_of[each.value.image]}"

      env {
        name  = "TM_PERSISTENCE"
        value = "firestore"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "TM_SERVICE_NAME"
        value = each.key
      }
      env {
        name  = "TM_REQUIRE_CONFIG"
        value = "true"
      }

      dynamic "env" {
        for_each = lookup(local.service_env, each.key, {})
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = contains(local.armor_env_services, each.key) ? [1] : []
        content {
          name  = "TM_MODEL_ARMOR_TEMPLATE"
          value = var.model_armor_template_name
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "VERTEX_PROJECT"
          value = var.project_id
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "VERTEX_LOCATION"
          value = "global"
        }
      }

      dynamic "env" {
        for_each = contains(local.vertex_env_services, each.key) ? [1] : []
        content {
          name  = "GEMINI_MODEL"
          value = "gemini-3.7-flash"
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_VERTEX_MODEL_CONCURRENCY"
          value = "12"
        }
      }

      # Route-specific caller isolation: both verifiers may drive a fresh
      # authorized workflow chain; only the Phase B verifier may trigger
      # explicit economic execution.
      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_REQUIRE_INTERNAL_AUTH"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_VERIFY"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_AUDIENCE"
          value = var.service_urls["agent-runtime"]
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name = "TM_WORKFLOW_CALLER_EMAIL"
          value = join(",", [
            local.service_account_emails["public-bff"],
            local.service_account_emails["phase-a-verifier"],
            local.service_account_emails["phase-b-verifier"],
            local.service_account_emails["phase-c-verifier"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_WORKFLOW_COMMIT_CALLER_EMAILS"
          value = local.service_account_emails["public-bff"]
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name = "TM_EXECUTION_CALLER_EMAIL"
          value = join(",", [
            local.service_account_emails["phase-b-verifier"],
            local.service_account_emails["phase-c-verifier"],
          ])
        }
      }

      dynamic "env" {
        for_each = each.key == "agent-runtime" ? [1] : []
        content {
          name  = "TM_PRE_EXECUTION_READINESS_CALLER_EMAILS"
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      # Trusted demo-evidence orchestration. Runs as the existing
      # phase-c-verifier identity (see runtime_services above); this only
      # adds the narrow route-level allowlist for its own new internal
      # route, plus the peer URLs it needs. Never touches
      # TM_EVIDENCE_VERIFY_CALLER_EMAILS or /internal/evidence/verifications'
      # allowlist.
      dynamic "env" {
        for_each = each.key == "demo-evidence-orchestrator" ? [1] : []
        content {
          name  = "TM_DEMO_PROVISION_CALLER_EMAILS"
          value = local.service_account_emails["public-bff"]
        }
      }
      dynamic "env" {
        for_each = each.key == "demo-evidence-orchestrator" ? [1] : []
        content {
          # Named for what it is (the public workflow-submission API), not
          # "web" (which is the separate apps/web frontend service) — this
          # orchestrator calls POST /v1/workflows on public-bff exactly as a
          # browser would, never the frontend.
          name  = "WORKFLOWS_API_URL"
          value = var.service_urls["public-bff"]
        }
      }
      dynamic "env" {
        for_each = each.key == "demo-evidence-orchestrator" ? [1] : []
        content {
          name  = "EVIDENCE_URL"
          value = var.service_urls["evidence-service"]
        }
      }
      dynamic "env" {
        for_each = each.key == "demo-evidence-orchestrator" ? [1] : []
        content {
          name  = "INTENT_PROVENANCE_URL"
          value = var.service_urls["intent-provenance"]
        }
      }

      # public-bff needs the new service's URL to reach its one narrowly
      # allowlisted route. Guarded on the key's PRESENCE, not just on
      # each.key — service_urls is a plain input variable, not something
      # Terraform computes from google_cloud_run_v2_service.s2s's own .uri
      # within this module, so demo-evidence-orchestrator's URL genuinely
      # does not exist until AFTER it has been created and its real .uri has
      # been read back (via `terraform output cloud_run_services`) and added
      # to service_urls for a second apply. A bare `var.service_urls["demo-
      # evidence-orchestrator"]` index would make apply 1 (before that key
      # exists) fail outright with "Invalid index" for the ENTIRE plan, not
      # just this resource. lookup() makes the first apply create the new
      # service cleanly, with this one optional env var simply absent —
      # packages/public-api/src/bin/start.ts already treats
      # DEMO_ORCHESTRATOR_URL as optional (`ports.demoOrchestration`
      # stays undefined, and router.ts never registers the route), so an
      # absent value here is a safe, inert intermediate state, not a
      # partially-broken one.
      dynamic "env" {
        for_each = each.key == "public-bff" && lookup(var.service_urls, "demo-evidence-orchestrator", null) != null ? [1] : []
        content {
          name  = "DEMO_ORCHESTRATOR_URL"
          value = var.service_urls["demo-evidence-orchestrator"]
        }
      }

      # A-Prime: public-bff's narrow /internal/demo/evidence-provisioning
      # route restricts itself to exactly the phase-c-verifier identity, at
      # the APPLICATION layer, independent of and in addition to Cloud Run
      # IAM (the existing phase-c-verifier->public-bff invoker edge). Every
      # other public-bff route (including ordinary POST /v1/evidence) is
      # untouched by this — it has no application-level caller check and
      # never reads this allowlist.
      dynamic "env" {
        for_each = each.key == "public-bff" ? [1] : []
        content {
          name  = "TM_DEMO_EVIDENCE_PROVISION_CALLER_EMAILS"
          value = local.service_account_emails["phase-c-verifier"]
        }
      }

      # Required only to VERIFY the allowlist above: the OIDC audience the
      # provisioning route's identityVerifier checks incoming tokens
      # against. Same name/pattern already used for intent-provenance,
      # gateway, evidence-service, agent-runtime, and authority — always the
      # service's own known URL.
      dynamic "env" {
        for_each = each.key == "public-bff" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_AUDIENCE"
          value = var.service_urls["public-bff"]
        }
      }

      dynamic "env" {
        for_each = each.key == "public-bff" ? [1] : []
        content {
          name  = "GATEWAY_URL"
          value = var.service_urls["gateway"]
        }
      }

      # Wave 1 approval lifecycle: the durable human/operator decision route
      # derives decidedBy from the VERIFIED caller identity — authority must
      # verify internal auth. The allowlist carries exactly the existing
      # authority callers plus the trusted acceptance operator identity.
      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_REQUIRE_INTERNAL_AUTH"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_VERIFY"
          value = "true"
        }
      }

      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_INTERNAL_AUTH_AUDIENCE"
          value = var.service_urls["authority"]
        }
      }

      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name = "TM_INTERNAL_ALLOWED_CALLERS"
          value = join(",", [
            local.service_account_emails["agent-runtime"],
            local.service_account_emails["gateway"],
            local.service_account_emails["outcome-resolution"],
            local.service_account_emails["phase-c-verifier"],
          ])
        }
      }

      # The BFF can project only durable Authority/Approval read state. Route
      # allowlists keep evaluate, mint, and approval decisions unavailable.
      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_PUBLIC_BFF_CALLER_EMAIL"
          value = local.service_account_emails["public-bff"]
        }
      }

      # Outcome Contract creation verifies the durable Authority evaluation.
      # This is GET-only: it does not permit evaluation, minting, approval
      # decisions, preparation, commit, or execution.
      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_OUTCOME_RESOLUTION_CALLER_EMAIL"
          value = local.service_account_emails["outcome-resolution"]
        }
      }

      dynamic "env" {
        for_each = each.key == "authority" ? [1] : []
        content {
          name  = "TM_GATEWAY_CALLER_EMAIL"
          value = local.service_account_emails["gateway"]
        }
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/readyz"
          port = 8080
        }
        initial_delay_seconds = contains(local.vpc_callers, each.key) ? 10 : 0
        timeout_seconds       = contains(local.vpc_callers, each.key) ? 3 : 1
        period_seconds        = 10
        failure_threshold     = contains(local.vpc_callers, each.key) ? 12 : 3
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    dynamic "vpc_access" {
      for_each = contains(local.vpc_callers, each.key) ? [1] : []
      content {
        egress = var.vpc_egress
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnet
        }
      }
    }
  }

  # Agent Runtime keeps one warm instance so the Phase B proof path — the
  # intent.events consumer, workflow route, and execution route — never pays
  # a scale-from-zero cold start (Model Armor startup probe included).
  # Availability optimization only; readiness still requires a real probe.
  scaling {
    min_instance_count = each.key == "agent-runtime" ? 1 : 0
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    terraform_data.secret_preflight,
    google_cloud_run_v2_service.runtime["intent-provenance"],
    google_cloud_run_v2_service.runtime["gateway"],
  ]
}

moved {
  from = google_cloud_run_v2_service.runtime["authority"]
  to   = google_cloud_run_v2_service.s2s["authority"]
}

locals {
  run_services = merge(
    google_cloud_run_v2_service.runtime,
    google_cloud_run_v2_service.s2s,
  )
}

resource "google_cloud_run_v2_job" "phase_a_verifier" {
  name                = "${var.name_prefix}-phase-a-verifier"
  location            = var.region
  project             = var.project_id
  deletion_protection = true

  template {
    task_count = 1

    template {
      service_account = local.service_account_emails["phase-a-verifier"]
      max_retries     = 0
      timeout         = "300s"

      containers {
        image = "${local.image_root}/phase-a-verifier@${local.digest_of["phase-a-verifier"]}"

        env {
          name  = "AGENT_RUNTIME_URL"
          value = var.service_urls["agent-runtime"]
        }
        env {
          name  = "EVIDENCE_URL"
          value = var.service_urls["evidence-service"]
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "INTENT_PROVENANCE_URL"
          value = var.service_urls["intent-provenance"]
        }
        env {
          name  = "INTENT_TOPIC"
          value = "${var.name_prefix}-intent.events"
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }

      vpc_access {
        egress = var.vpc_egress
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnet
        }
      }
    }
  }
}

resource "google_cloud_run_v2_job" "phase_b_verifier" {
  name                = "${var.name_prefix}-phase-b-verifier"
  location            = var.region
  project             = var.project_id
  deletion_protection = true

  template {
    task_count = 1

    template {
      service_account = local.service_account_emails["phase-b-verifier"]
      max_retries     = 0
      # 600s bounds the full proof: event-driven compile/verify (measured
      # ~2m30s worst case) + authorization chain + PREPARE/AUTHORIZE +
      # explicit COMMIT + durable execution verification. Still one explicit
      # proof attempt (max_retries = 0), still bounded.
      timeout = "600s"

      containers {
        image = "${local.image_root}/phase-b-verifier@${local.digest_of["phase-b-verifier"]}"

        env {
          name  = "AGENT_RUNTIME_URL"
          value = var.service_urls["agent-runtime"]
        }
        env {
          name  = "EVIDENCE_URL"
          value = var.service_urls["evidence-service"]
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "INTENT_PROVENANCE_URL"
          value = var.service_urls["intent-provenance"]
        }
        env {
          name  = "INTENT_TOPIC"
          value = "${var.name_prefix}-intent.events"
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }

      vpc_access {
        egress = var.vpc_egress
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnet
        }
      }
    }
  }
}


resource "google_cloud_run_v2_job" "phase_c_verifier" {
  name                = "${var.name_prefix}-phase-c-verifier"
  location            = var.region
  project             = var.project_id
  deletion_protection = true

  template {
    task_count = 1

    template {
      service_account = local.service_account_emails["phase-c-verifier"]
      max_retries     = 0
      # 600s bounds the full proof: event-driven compile/verify (measured
      # ~2m30s worst case) + authorization chain + PREPARE/AUTHORIZE +
      # explicit COMMIT + durable execution verification. Still one explicit
      # proof attempt (max_retries = 0), still bounded.
      timeout = "600s"

      containers {
        image = "${local.image_root}/phase-c-verifier@${local.digest_of["phase-c-verifier"]}"

        env {
          name  = "AGENT_RUNTIME_URL"
          value = var.service_urls["agent-runtime"]
        }
        env {
          name  = "EVIDENCE_URL"
          value = var.service_urls["evidence-service"]
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "INTENT_PROVENANCE_URL"
          value = var.service_urls["intent-provenance"]
        }
        env {
          name  = "INTENT_TOPIC"
          value = "${var.name_prefix}-intent.events"
        }
        env {
          name  = "OUTCOME_RESOLUTION_URL"
          value = var.service_urls["outcome-resolution"]
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }

      vpc_access {
        egress = var.vpc_egress
        network_interfaces {
          network    = var.vpc_network
          subnetwork = var.vpc_subnet
        }
      }
    }
  }
}

# BENCHMARK_V2 runs only through the public web API. The benchmark identity
# intentionally receives no internal Cloud Run invoker or economic authority.
resource "google_cloud_run_v2_job" "benchmark_v2" {
  name                = "${var.name_prefix}-benchmark-v2"
  location            = var.region
  project             = var.project_id
  deletion_protection = true

  template {
    task_count = 1

    template {
      service_account = local.service_account_emails["benchmark-runner"]
      max_retries     = 0
      timeout         = "86400s"

      containers {
        image   = "${local.image_root}/benchmark-runner@${local.benchmark_v2_digest}"
        command = ["node"]
        args    = ["services/benchmark-runner/dist/bin/v2-load-job.js"]

        env {
          name  = "TM_BENCHMARK_PUBLIC_URL"
          value = google_cloud_run_v2_service.web.uri
        }
        env {
          name  = "TM_BENCHMARK_ENVIRONMENT"
          value = var.environment
        }
        env {
          name  = "TM_BENCHMARK_CONCURRENCY_LEVELS"
          value = "1,2,4,8,16,32"
        }
        env {
          name  = "TM_BENCHMARK_WORKFLOWS_PER_LEVEL"
          value = "50"
        }
        env {
          name  = "TM_BENCHMARK_READ_CONCURRENCY_LEVELS"
          value = "1,10,25,50"
        }
        env {
          name  = "TM_BENCHMARK_READS_PER_LEVEL"
          value = "200"
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service" "web" {
  name     = "${var.name_prefix}-web"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.service_account_emails["web"]

    containers {
      image = "${local.image_root}/web@${local.digest_of["web"]}"

      env {
        name  = "TM_PERSISTENCE"
        value = "none"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "TM_SERVICE_NAME"
        value = "web"
      }
      env {
        name  = "TM_REQUIRE_CONFIG"
        value = "false"
      }
      env {
        name  = "PUBLIC_BFF_URL"
        value = local.run_services["public-bff"].uri
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  scaling {
    min_instance_count = 0
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    terraform_data.secret_preflight,
    google_cloud_run_v2_service.runtime,
    google_cloud_run_v2_service.s2s,
  ]
}

# Exact S2S invoker grants — Gateway only receivable from authority
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = local.invoker_edges

  project  = var.project_id
  location = var.region
  name     = local.run_services[each.value.to].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.service_account_emails[each.value.from]}"
}

# web: public unauthenticated invoke (static SPA + server-side BFF proxy).
# public-bff: INGRESS_ALL but NO allUsers — Cloud Run identity required.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Allow consumer SA (OIDC push identity) to invoke its own Cloud Run service
resource "google_cloud_run_v2_service_iam_member" "oidc_self_invoker" {
  for_each = local.push_consumers

  project  = var.project_id
  location = var.region
  name     = local.run_services[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.service_account_emails[each.key]}"
}

# Pub/Sub must mint OIDC tokens as the consumer SA
resource "google_service_account_iam_member" "pubsub_token_creator" {
  for_each = local.push_consumers

  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.service_account_emails[each.key]}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.pubsub_agent
}

# OIDC push subscriptions — default production delivery. Application MUST still
# dedupe by idempotencyKey and reject stale aggregate versions.
resource "google_pubsub_subscription" "push" {
  for_each = {
    for p in local.push_pairs : p.key => p
  }

  name    = "${var.name_prefix}-${each.value.consumer}--${each.value.topic}-push"
  project = var.project_id
  topic   = "projects/${var.project_id}/topics/${var.name_prefix}-${each.value.topic}"

  ack_deadline_seconds = each.value.consumer == "agent-runtime" && each.value.topic == "intent.events" ? 180 : 60

  push_config {
    push_endpoint = "${local.run_services[each.value.consumer].uri}/internal/events"

    oidc_token {
      service_account_email = local.service_account_emails[each.value.consumer]
      audience              = local.run_services[each.value.consumer].uri
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = "projects/${var.project_id}/topics/${var.name_prefix}-${each.value.topic}-dlq"
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = ""
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.oidc_self_invoker,
    google_service_account_iam_member.pubsub_token_creator,
  ]
}

# Pub/Sub service agent must subscribe to the push subscription to drain DLQ
resource "google_pubsub_subscription_iam_member" "push_dlq_agent" {
  for_each = google_pubsub_subscription.push

  project      = var.project_id
  subscription = each.value.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}
