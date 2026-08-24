# Stage C Runtime Readiness Report

**Date:** 2026-08-14  
**Status:** Stage C readiness complete. **STOP.** Runtime Terraform was **planned only**. Do not apply until this report is reviewed.

**Hard stop honored:** no Runtime `terraform apply`, no Foundation apply, no live economic commit/payment.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Foundation state | `infrastructure/terraform/stages/foundation/terraform.tfstate` (`use_foundation_fixture = false`) |
| Build identifier | `c20260813T233056Z-12a54be8` (timestamp + random; not Stage B `b20260814T041238Z-bc1a09b2`) |
| Deploy identity | digest URIs (`@sha256:…`). No `:latest`. |

## What changed from Stage B stubs

Seven Cloud Run images previously ran `infrastructure/docker/health-stub.mjs`. They now compile TypeScript and start real HTTP processes.

| Service | Previous CMD | Real entrypoint | `/internal/events` |
|---------|--------------|-----------------|--------------------|
| gateway | `node health-stub.mjs` | `TwoPhaseGateway` + `MockPaymentAdapter` (`services/gateway-service/src/bin/start.ts`) | yes — `authority.events`, `outcome.events` |
| intent-provenance | stub | `IntentService` + `ProvenanceService` | yes — `authority.events`, `execution.events` |
| authority | stub | `AuthorityService` | yes — `intent.events`, `guardian.events`, `plan.events` |
| outcome-resolution | stub | `OutcomeService` + `ResolutionService` (`services/resolution-service/src/bin/start.ts`) | yes — `execution.events`, `evidence.events` |
| agent-runtime | stub | `compileAndVerify` + `VertexGeminiModel.fromEnv` + `ModelArmorAdapter.fromEnv` (no grant mint) | yes — `intent.events` |
| observability-api | stub | `DemoRuntime` projectors (10 Foundation topics) | yes |
| benchmark-runner | stub | `ScenarioRunner` loaded; **does not** auto-run golden vs live payments | **no** (404) |
| public-bff | already HTTP, stub ports | live adapters: `IntentService`, `DemoRuntime`, `EvidenceService` | no |
| web | `web-proxy.mjs` | unchanged | no |

Shared HTTP shell: `@truemandate/cloud-runtime` (`GET /healthz`, `GET /readyz`, `POST /internal/events`). Pub/Sub push decode: `packages/cloud-pubsub/src/push-decode.ts` (`message.data` base64 → `CloudEventEnvelope`). Duplicate `idempotencyKey` → 200 without re-handling. Stale `aggregateVersion` → 400. Optional `TM_REQUIRE_PUSH_AUTH=true` requires `Authorization` (Cloud Run IAM is the real gate; no HMAC invented).

Dockerfile `CMD` restored to compiled `dist/bin/start.js`. Service `tsc` builds are re-enabled. `.dockerignore` now excludes `**/dist` and `**/*.tsbuildinfo` so host emit does not poison image compiles.

## `/internal/events` status

Implemented in-process for every Terraform push consumer. Push endpoint in the plan is `{Cloud Run URI}/internal/events` with OIDC as the consumer SA. Application still must (and does) dedupe by `idempotencyKey` and reject stale versions.

Not push consumers: `public-bff`, `web`, `benchmark-runner`.

## Local tests

Vitest (31 tests, all pass):

- Fail-closed `loadRuntimeConfig` without `GOOGLE_CLOUD_PROJECT` when `TM_REQUIRE_CONFIG=true`
- `/healthz` 200 after init
- `/internal/events` happy path, malformed JSON, missing envelope fields, duplicate `idempotencyKey` (200, handler once), stale `aggregateVersion` (400)
- Push without `Authorization` when `TM_REQUIRE_PUSH_AUTH=true` → 401
- Non-consumer `/internal/events` → 404
- Firestore: `persistenceModeFromEnv`; firestore without project fail-closed; `TM_FIRESTORE_SKIP_CLIENT=true` still reports `firestore` (does not silently advertise memory)
- `VertexGeminiModel.fromEnv()` with `VERTEX_PROJECT` set; tokens not printed
- Model Armor: `fromEnv` reads `TM_MODEL_ARMOR_TEMPLATE`; unavailable ≠ safe; CLEAN does not clear taint
- Gateway source binds `MockPaymentAdapter` only (no Stripe/Adyen/PayPal)
- Public-bff live adapters create intents; unknown workspace fails closed (no grant mint)

Local process smoke (compiled gateway): missing project exits **1**; with memory persistence `/healthz` 200 and malformed events 400.

Container smoke (`linux/amd64`, `TM_PERSISTENCE=memory`, no live GCP writes):

| Image | CMD | `/healthz` | `/internal/events` malformed |
|-------|-----|------------|------------------------------|
| gateway | `node services/gateway-service/dist/bin/start.js` | 200 | 400 |
| intent-provenance | `node services/intent-service/dist/bin/start.js` | 200 | 400 |
| public-bff | `node packages/public-api/dist/bin/start.js` | 200 | n/a |
| benchmark-runner | `node services/benchmark-runner/dist/bin/start.js` | 200 (`autoRunGolden: false`) | n/a |

Gateway container without `GOOGLE_CLOUD_PROJECT` exits **1**. Gateway commit path was **not** invoked against real processors.

## Secret contract

Runtime `required_secret_ids = []`. Preflight:

```
node scripts/cloud/secret-preflight.mjs --project elite-crossbar-505104-t9 --prefix tm-dev
```

**Exit 0:** `secret-preflight: ok (0 secrets have ENABLED versions)`.

No Secret Manager payloads were invented. No Cloud Run secret env/volume mounts (plan has no `secret_key_ref` / `value_source`). HMAC and observability keys are **not** mounted-and-ignored.

Foundation secret **shells remain** (no Foundation apply). Unused by application:

| Secret | ENABLED version | App consumer | Stage C decision |
|--------|-----------------|--------------|------------------|
| `tm-dev-vertex-model-config` | none | none | unused shell; Vertex uses `VERTEX_PROJECT` / `VERTEX_LOCATION` / `GEMINI_MODEL` |
| `tm-dev-adk-runtime-config` | none | none | unused shell; no ADK secret schema |
| `tm-dev-gateway-hmac-key` | `1` | none | unused shell; no HMAC verify in gateway/authority |
| `tm-dev-observability-api-key` | `1` | none | unused shell; no API-key auth in observability/public-bff |

## Runtime env (Terraform + app)

| Var | Who | Source |
|-----|-----|--------|
| `GOOGLE_CLOUD_PROJECT` | all requiring config | `elite-crossbar-505104-t9` |
| `TM_SERVICE_NAME` | all | service key |
| `TM_REQUIRE_CONFIG` | all except web | `true` (web `false`) |
| `TM_PERSISTENCE` | privileged + BFF | `firestore` (web `none`; benchmark-runner `memory`) |
| `VERTEX_PROJECT` | agent-runtime, benchmark-runner | project id (not a secret) |
| `VERTEX_LOCATION` | same | `us-central1` |
| `GEMINI_MODEL` | same | `gemini-2.0-flash-001` |
| `TM_MODEL_ARMOR_TEMPLATE` | agent-runtime, gateway, benchmark-runner | Foundation output `projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response` |
| `PUBLIC_BFF_URL` | web | Cloud Run URI (known after apply) |
| `PORT` | Cloud Run | 8080 |

`ModelArmorAdapter.fromEnv()` now reads `TM_MODEL_ARMOR_TEMPLATE`. Inspect remains fail-closed until availability is proven (`setAvailable` / live probe). CLEAN still preserves taint.

### Firestore honesty

`DocumentStore` is synchronous. Converting stores to the async Google client would be a large interface break. Boot initializes `@google-cloud/firestore` when `TM_PERSISTENCE=firestore` (fail-closed if the client cannot be constructed), then uses the existing transactional bundle (`MemoryTransactionalStore` behind `createFirestorePersistence`). Health reports both `persistence` mode and `firestoreClient` initialized/none. This is **not** live Firestore TX. Local tests use `TM_PERSISTENCE=memory`.

## Images (digest-pinned)

Repository `truemandate` only. No second Artifact Registry repo. Platform `linux/amd64`. Tag `c20260813T233056Z-12a54be8`.

| Image | SHA256 digest | Cloud Run? |
|-------|---------------|------------|
| public-bff | `sha256:b89c464ad299f0daa0644cf9e309e5e2ba0a71aab5752d9413037565e18462bf` | yes |
| gateway | `sha256:c2cc02a9ca83ce3af6c864283c6d8049f0bc2e1519cc7e13de44b04134d4b331` | yes |
| intent-provenance | `sha256:5cc8d02e90b17b361cc55bfe7cfff3af665652a94a047b87286c1249235a9529` | yes |
| authority | `sha256:19dbe075fc617fe3558f0db51f8a752da75b1004167073e3afc1d44fdf762c36` | yes |
| outcome-resolution | `sha256:898187642430240e31d58499bd30760a3f67ef892d044799b81526666b433b95` | yes |
| agent-runtime | `sha256:f1752ad597a002060b51f1c94395bfe29659fb31a111b08a3f2aed37b79b358d` | yes |
| observability-api | `sha256:c1e8e7b3dfe72a77676eb3976ce18821062bb18d5f0afa3b80f771537bdb83d7` | yes |
| web | `sha256:1ab3c3974665ca4308157428d0c4c6db887b29341639599f8d0047d0a021e94a` | yes |
| benchmark-runner | `sha256:d42ebd0325faa4b61e08935aed10329a063e2e7d02c110e15ee74e2bbc2e446e` | yes |
| attack-lab | `sha256:1fe656a42c0c68232e2c964e81c4e55e0e31cb20df83744f50503413283a60c0` | **no** (deploy.sh only) |

Runtime module `image_digests` map; `lifecycle.ignore_changes` on container image **removed**. Plan images are `@sha256:…` URIs.

## Terraform plan (not applied)

```
cd infrastructure/terraform/stages/runtime
terraform plan -input=false -no-color -out=tfplan.runtime
```

| Metric | Count |
|--------|-------|
| Add | **75** |
| Change | **0** |
| Destroy | **0** |
| Replace | **0** |

Saved to `infrastructure/terraform/stages/runtime/tfplan.runtime` (dockerignored / gitignored pattern). **Do not apply.**

### Cloud Run in the plan (9)

`tm-dev-intent-provenance`, `tm-dev-authority`, `tm-dev-gateway`, `tm-dev-outcome-resolution`, `tm-dev-agent-runtime`, `tm-dev-observability-api`, `tm-dev-public-bff`, `tm-dev-benchmark-runner`, `tm-dev-web`.

Ingress: privileged services `INGRESS_TRAFFIC_INTERNAL_ONLY`; `public-bff` `INGRESS_TRAFFIC_ALL` (no `allUsers`); `web` `INGRESS_TRAFFIC_ALL` + `allUsers` invoker.

### Pub/Sub push in the plan (20)

OIDC push subscriptions to `{uri}/internal/events` for Foundation `consumer_topics`. DLQ subscriber grants for the Pub/Sub service agent. Token creator on each consumer SA.

### IAM in the plan

- 12 exact S2S `roles/run.invoker` edges (Gateway receivable from authority only)
- 6 OIDC self-invokers (push consumers)
- 6 `roles/iam.serviceAccountTokenCreator` for Pub/Sub agent → consumer SAs
- web public invoker `allUsers`

No extra human IAM. No secret accessor grants added in Runtime.

## Credential / secret scan

Workspace source trees (`packages`, `services`, `agents`, `apps`, `infrastructure`, `scripts`, `docs`): no `.env`, `*credentials*.json`, `*.pem`, `id_rsa`, or `*service-account*.json`.

Gateway image filesystem scan (`find` excluding `node_modules`): **0** matches.

`.dockerignore` excludes `.env`, tfstate, tfvars, credential globs, `dist`, and `tsbuildinfo`. Terraform never received secret values.

## Remaining blockers

1. **Runtime apply is unapproved.** Plan is ready (`75` add / `0` change / `0` destroy / `0` replace).
2. Firestore mode initializes the Google client then uses the in-process TX bundle. Live Firestore document TX is not wired.
3. Model Armor inspect is still fail-closed until a live probe sets availability; CLEAN does not clear taint.
4. Four Foundation secret shells remain unused (correct; do not populate vertex/adk without a schema).
5. Stage B Model Armor gcloud 403 (CLI `us` REP vs `us-central1` template) is unchanged; do not grant extra IAM.
6. No live payment processor. `TwoPhaseGateway` keeps `MockPaymentAdapter`.
7. `attack-lab` is not a Runtime Cloud Run service.

**Did not apply runtime infrastructure. Did not deploy Cloud Run. Did not populate vertex/adk secrets. Did not call real payment processors.**
