# Terraform Preapply Closure Report (no apply)

**Date:** 2026-08-14  
**Project:** `elite-crossbar-505104-t9`

## Plan counts

| Stage | Create | Change | Destroy | Replace |
|-------|-------:|-------:|--------:|--------:|
| **Foundation (A)** | **112** | 0 | 0 | 0 |
| **Runtime (C)** | **75** | 0 | 0 | 0 |

## Subscriptions

| Mode | Count |
|------|------:|
| Pull (default) | **0** (`enable_pull_subscriptions = false`) |
| Push (OIDC, production) | **20** |

A production Cloud Run consumer is not subscribed twice. Pull remains opt-in for local/debug/benchmark workers. Application `idempotencyKey` + aggregate-version checks remain mandatory.

## Pub/Sub service agent Token Creator

`service-547914435840@gcp-sa-pubsub.iam.gserviceaccount.com` → `roles/iam.serviceAccountTokenCreator` on:

- tm-dev-intent-provenance
- tm-dev-authority
- tm-dev-gateway
- tm-dev-outcome-resolution
- tm-dev-agent-runtime
- tm-dev-observability-api

Not granted on web, public-bff, or benchmark-runner.

Each push subscription also grants that agent `roles/pubsub.subscriber` (DLQ drain). Foundation still grants the agent `roles/pubsub.publisher` on DLQ topics.

## Push identity → target

OIDC SA = consumer runtime SA; audience = Cloud Run URI; endpoint = `{uri}/internal/events`; Invoker = same SA on that service.

| Push subscription | Identity | Target |
|-------------------|----------|--------|
| tm-dev-intent-provenance--authority.events-push | tm-dev-intent-provenance@… | tm-dev-intent-provenance |
| tm-dev-intent-provenance--execution.events-push | tm-dev-intent-provenance@… | tm-dev-intent-provenance |
| tm-dev-authority--intent.events-push | tm-dev-authority@… | tm-dev-authority |
| tm-dev-authority--guardian.events-push | tm-dev-authority@… | tm-dev-authority |
| tm-dev-authority--plan.events-push | tm-dev-authority@… | tm-dev-authority |
| tm-dev-gateway--authority.events-push | tm-dev-gateway@… | tm-dev-gateway |
| tm-dev-gateway--outcome.events-push | tm-dev-gateway@… | tm-dev-gateway |
| tm-dev-outcome-resolution--execution.events-push | tm-dev-outcome-resolution@… | tm-dev-outcome-resolution |
| tm-dev-outcome-resolution--evidence.events-push | tm-dev-outcome-resolution@… | tm-dev-outcome-resolution |
| tm-dev-agent-runtime--intent.events-push | tm-dev-agent-runtime@… | tm-dev-agent-runtime |
| tm-dev-observability-api--{10 topics}-push | tm-dev-observability-api@… | tm-dev-observability-api |

## Web → BFF authentication

Browser → `tm-dev-web` (`allUsers`) → [`web-proxy.mjs`](../../infrastructure/docker/web-proxy.mjs) fetches a metadata identity token (audience = BFF URI) → `tm-dev-public-bff`. Tokens never returned to the browser. BFF has **no** `allUsers` invoker.

## Web SA permissions

- Artifact Registry reader
- Cloud Run Invoker **only** on public-bff
- No Firestore, Secrets, Pub/Sub, Vertex, Model Armor, Gateway, or Authority

## BFF permissions

- Firestore viewer
- Secret accessor: observability-api-key (after a version exists)
- Invoke: intent-provenance, outcome-resolution
- Invoked by: web SA only (plus no public invoker)
- No Gateway / grant mint / CommitToken

## Secret readiness

[`scripts/cloud/secret-preflight.mjs`](../../scripts/cloud/secret-preflight.mjs) lists ENABLED versions (metadata only). Runtime `terraform_data.secret_preflight` runs that check **at apply** and fails closed. No `secret_data` in Terraform.

**Current blocker:** no ENABLED versions for `tm-dev-vertex-model-config`, `tm-dev-adk-runtime-config`, `tm-dev-gateway-hmac-key`, `tm-dev-observability-api-key` (shells themselves are not applied yet).

## API dependency ordering

Foundation: `google_project_service` → `time_sleep.wait_apis` (60s) → per-API `depends_on` for Firestore, Pub/Sub, Artifact Registry, Secret Manager, Model Armor, IAM SAs.

## Model Armor

- API `modelarmor.googleapis.com`
- Template `tm-dev-prompt-response` (RAI + PI/jailbreak + malicious URI)
- `roles/modelarmor.user`: agent-runtime, gateway, benchmark-runner
- Env `TM_MODEL_ARMOR_TEMPLATE` on those three Cloud Run services
- App invariant unchanged: CLEAN ≠ clear taint; UNAVAILABLE fail-closed

## Cloud Run Invoker relationships

- public-bff → intent-provenance, outcome-resolution
- agent-runtime → intent-provenance, observability-api
- intent-provenance → agent-runtime, observability-api
- **authority → gateway**, observability-api
- gateway → outcome-resolution, observability-api
- outcome-resolution → observability-api
- **web → public-bff**
- OIDC self-invoker on each push consumer
- web `allUsers` (public static + proxy)
- **not** public-bff `allUsers`

Gateway ingress: `INGRESS_TRAFFIC_INTERNAL_ONLY`.

## Public access bindings

| Binding | Principal |
|---------|-----------|
| tm-dev-web invoker | `allUsers` |
| tm-dev-public-bff invoker | web SA only |
| tm-dev-gateway invoker | authority SA (+ gateway SA for push) |

## Destroy / replace

None in either plan (greenfield).

## Remaining deployment blockers (do not apply yet)

1. Stage A not applied — APIs, topics, SAs, secret shells, Model Armor do not exist yet
2. Container images not in Artifact Registry (Stage B)
3. Mandatory secret **versions** missing — Stage C apply will fail closed until operators add them out of band
4. Runtime plan uses foundation fixture until A has state (`use_foundation_fixture=true`)
5. Stage C push subscriptions require Stage A topics

**Did not run `terraform apply`.**
