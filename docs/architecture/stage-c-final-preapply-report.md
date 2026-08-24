# Stage C Final Pre-Apply Report

**Date:** 2026-08-14  
**Status:** Code, images, live smokes, and Runtime Terraform **plan** are complete. **STOP.** Do not apply.

**Hard stop honored:** no Runtime `terraform apply`, no Foundation apply, no live payment processor, no Model Armor template edits, no extra IAM, no product features.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Foundation state | `infrastructure/terraform/stages/foundation/terraform.tfstate` (`use_foundation_fixture = false`) |
| Build identifier | `c20260814T065928Z-32a938a5` (timestamp + random) |
| Deploy identity | digest URIs (`@sha256:…`). No `:latest`. |

## What this pass closed

The previous Stage C readiness report advertised `TM_PERSISTENCE=firestore` while discarding the Google client and using `MemoryTransactionalStore`. `/readyz` was hardcoded ready. `GEMINI_MODEL` was `gemini-2.0-flash-001`. Model Armor never called the API; production availability was a `setAvailable` hook.

This pass:

1. Retains the Firestore client and **awaits** Google transactions before privileged mutations return.
2. Makes `/readyz` a non-destructive sentinel read.
3. Defaults Vertex to **`gemini-3.7-flash`** at the **global** endpoint.
4. Probes Model Armor on the working **regional REP** at boot; availability comes from that probe.

`TwoPhaseGateway` still binds `private readonly adapter = new MockPaymentAdapter()`. Gemini still does not authorize or execute privileged economic actions.

---

## 1. Firestore adapter architecture

`DocumentStore` / `TxContext` are async (`Promise`). Two implementations:

| Store | When used | Durability |
|-------|-----------|------------|
| `GoogleFirestoreDocumentStore` | `TM_PERSISTENCE=firestore` | Real `@google-cloud/firestore` client retained. `runTransaction` uses `db.runTransaction` with `maxAttempts: 8`. Commit is **awaited** before return. Remaining `ABORTED` maps to `TRANSACTION_CONFLICT:max_retries`. |
| `MemoryTransactionalStore` | `TM_PERSISTENCE=memory`, unit tests | In-process queued TX. Not production. |

`initRuntimePersistence`:

- `memory` → memory store + health sentinel write/read.
- `firestore` → construct client, wrap `GoogleFirestoreDocumentStore`, pass **that** into `createFirestorePersistence(store)`.
- Fail closed if client construction or the first sentinel write/read fails.
- `TM_FIRESTORE_SKIP_CLIENT` is **ignored**. It cannot advertise firestore while using memory.

Logical `collection/id` paths (ids may contain slashes) flatten to Firestore collection + document id joined with `__` (`firestoreRefParts`). Health lives in `_health/{service}`.

All reads inside a Google transaction happen before writes (Firestore TX rule).

### Stores that are actually durable in firestore mode

Every port in `createFirestorePersistence` uses the injected `DocumentStore`. When Cloud Run sets `TM_PERSISTENCE=firestore`, that store is `GoogleFirestoreDocumentStore`, so these collections are durable:

| Bundle port | Collection |
|-------------|------------|
| grants | `authorityGrants` |
| commitTokens | `commitTokens` |
| nonces | `nonces` |
| idempotency | `idempotencyRecords` |
| exposure | `exposureReservations` |
| economicReservations | `economicReservations` |
| sideEffects | `sideEffects` |
| intents (incl. states/tips) | `intents`, `intentStates`, `intentTips` |
| provenance | `provenanceNodes`, `provenanceEdges` |
| outcomeContracts / outcomeEvents | `outcomeContracts`, `outcomeEvents` |
| resolutionCases / resolutionTriggers | `resolutionCases`, `resolutionTriggers` |
| remediationMandates, approvals, evidence | `remediationMandates`, `approvals`, `evidenceArtifacts`, `evidenceClaims` |
| health sentinel | `_health` |

### Cloud Run injection

| Service | Durable bundle actually injected |
|---------|----------------------------------|
| gateway | grants, exposure, commitTokens, nonces, idempotency, economicReservations, sideEffects, intents, provenance, outcome contracts/events |
| authority | grants, exposure, intents |
| intent-provenance | intents, provenance |
| outcome-resolution | outcome contracts/events, resolution cases/triggers |
| agent-runtime | intents, provenance |
| public-bff | intents (boot fails closed if init/probe fails) |
| observability-api | Firestore store for `/readyz` only; **DemoRuntime projectors remain in-process** |
| benchmark-runner | `TM_PERSISTENCE=memory`; no Firestore bundle; does not auto-run golden vs live payments |

Privileged call paths (`TwoPhaseGateway`, `AuthorityService`, `IntentService`, provenance/outcome/resolution mutating methods) `await` these ports. INV_001–INV_025 were not weakened.

---

## 2. Emulator concurrency (production-semantics proof)

Runner: `scripts/cloud/run-firestore-emulator-races.mjs` (fails if `FIRESTORE_EMULATOR_HOST` is not listening). Tests use a **real** `@google-cloud/firestore` client, not `MemoryTransactionalStore`.

Emulator: Firebase emulator at `127.0.0.1:8081`, project `truemandate-emulator`.

**Result: 9 passed.**

| Case | Result |
|------|--------|
| two concurrent `CommitToken.consume` — exactly one succeeds | pass |
| duplicate idempotency keys; `UNKNOWN` cannot begin retry | pass |
| concurrent exposure reservations exceeding a bound (1 of 3) | pass |
| revoke grant between prepare and commit → `GRANT_REVOKED` | pass |
| stale consume after consume → `GRANT_CONSUMED` | pass |
| replayed nonce → `NONCE_REPLAY` | pass |
| **restart:** second client reconstructs consumed grant + token | pass |
| out-of-order `putIfAbsent` rejected | pass |
| `UNKNOWN` execution locked against `attemptRetry` / `begin` | pass |

Fast CI still uses `packages/cloud-firestore/src/firestore-concurrency.test.ts` against memory (8 tests, queued TX).

---

## 3. Truthful `/readyz`

| Path | Meaning |
|------|---------|
| `GET /healthz` | Process is up (200 after listen). Does **not** prove persistence. |
| `GET /readyz` | 200 only after `readinessProbe()` reads `_health/{service}`. Constructing a client object is not enough. 503 otherwise. |

Firestore services: not ready if the Google store was not selected or the probe failed. Memory/dev: ready after in-memory sentinel init.

Public BFF `createHealthHandlers` accepts `state.probe` and uses it for `/readyz`.

Cloud Run `startup_probe` in `modules/runtime/main.tf`:

- Runtime services → `/readyz`
- Web (static SPA, `TM_PERSISTENCE=none`) → `/healthz`

Readiness probes are **read-only** after boot (boot writes the sentinel once; `/readyz` only reads it).

`benchmark-runner` has no Firestore bundle; `/readyz` falls back to in-process `health.ready` (Terraform sets that service to memory).

---

## 4. Gemini 3.7 Flash — live ADC smoke

Defaults replaced from `gemini-2.0-flash-001` to **`gemini-3.7-flash`** in:

- `packages/model/src/vertex-gemini.ts` `fromEnv` (default location **`global`**)
- `packages/cloud-runtime/src/config.ts`
- Terraform `GEMINI_MODEL` and `VERTEX_LOCATION = "global"` (not `var.region`)
- tests and `scripts/cloud/container-http-smoke.mjs`

`us-central1` is not a documented serving location for this model. The client uses:

```
https://aiplatform.googleapis.com/v1/projects/elite-crossbar-505104-t9/locations/global/publishers/google/models/gemini-3.7-flash:generateContent
```

`extractStructuredTextFromParts` concatenates **all** `candidates[0].content.parts` text and skips `thought` parts. `generateContent` + `responseMimeType: application/json` confirmed by the live smoke.

**Live smoke** (`scripts/cloud/gemini-37-smoke.mjs`; tokens not printed):

```
model: gemini-3.7-flash
modelVersion: gemini-3.7-flash
location: global
endpoint: https://aiplatform.googleapis.com/v1/projects/elite-crossbar-505104-t9/locations/global/publishers/google/models/gemini-3.7-flash:generateContent
httpSuccess: true
schemaOk: true
```

Not a benchmark. Gemini does not mint grants or call payment tools.

---

## 5. Model Armor — live regional probe

Adapter: `packages/cloud-security/src/model-armor-adapter.ts`

- Regional REP: `https://modelarmor.us-central1.rep.googleapis.com/v1/{template}:sanitizeUserPrompt`
- Template (unchanged): `projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response`
- Boot: `fromEnv` + ADC `probe()`. **Availability is set only after a successful probe**, not by production `setAvailable(true)`.
- Probe failure or missing template → UNAVAILABLE, fail closed. Armor-required services (gateway, agent-runtime, benchmark-runner) **exit non-zero**.
- `inspect()`: `NO_MATCH_FOUND` → CLEAN, `MATCH_FOUND` → BLOCKED.
- CLEAN does not clear taint. UNAVAILABLE is not safe. Armor does not replace Semantic Guardian.
- `setAvailable` remains a **test-only** hook (does not enable the live API).

**Live probe** (`scripts/cloud/model-armor-probe.mjs`; no template mutation):

| Sample | HTTP | `filterMatchState` |
|--------|------|--------------------|
| health probe | 200 | `NO_MATCH_FOUND` |
| benign procurement text | 200 | `NO_MATCH_FOUND` |
| obvious injection / privilege elevation | 200 | `MATCH_FOUND` |

---

## 6. Images (digest-pinned)

Repository `truemandate` only. Platform `linux/amd64`. Tag `c20260814T065928Z-32a938a5`.

| Image | SHA256 digest | Cloud Run? |
|-------|---------------|------------|
| public-bff | `sha256:e283eb30627cf520bc8cbca819ad9ae9a57a09e2e2c307d6468a56014c5cd33f` | yes |
| gateway | `sha256:93fa61710ceb4973f7b6e13893d78e30557e642dfc4a76f4b0e061532157807a` | yes |
| intent-provenance | `sha256:a51e57b19e57fa7a1355e52d1a3193389a364fdcc0cb51f543405db45116e762` | yes |
| authority | `sha256:3d0e8c5f31a0aebe70378bf9c157b5fc12f162f1af5efa29d8277a4fa98a1f66` | yes |
| outcome-resolution | `sha256:96e285b457f6d26bdf60632018c5d0bec325b9a118ce1d5861548cc8a236a8ce` | yes |
| agent-runtime | `sha256:4f3e700dd0c69ab55b35e7ab04363df1a7193e790d913d82369e05b4827e99e1` | yes |
| observability-api | `sha256:6f7e73569201bdafbc606938193b1cdbe32fe57abd979073e49b26b11568de7d` | yes |
| web | `sha256:835a48ac65e88e76df4ee9c58e72ed84b56c4c8b9d2454ec8dab458ebef72524` | yes |
| benchmark-runner | `sha256:d96ff5c05ae69706e7370c145949a8faeb751f391aa795476e4117675172731d` | yes |
| attack-lab | `sha256:80428eef8296cce06731e2593d808fb7289d47b7694c8a0ddfcbe5b4d2afeab0` | **no** (deploy.sh only) |

Runtime `terraform.tfvars` (gitignored): `use_foundation_fixture=false`, `image_tag` and `image_digests` updated to this build. `GEMINI_MODEL=gemini-3.7-flash` is set in the module, not tfvars.

---

## 7. Tests

| Suite | Result |
|-------|--------|
| Unit / integration (`pnpm test`, emulator host unset) | **342 passed**, 9 skipped (emulator-gated file) |
| Firestore emulator races (real client TX) | **9 passed** |
| Gemini 3.7 live ADC smoke | **pass** (`httpSuccess`, `schemaOk`) |
| Model Armor live regional probe | **pass** (benign `NO_MATCH_FOUND`, injection `MATCH_FOUND`) |

Combined unique Vitest cases executed this pass: **351** (342 always-on + 9 emulator).

---

## 8. Terraform plan (not applied)

```
terraform -chdir=infrastructure/terraform/stages/runtime plan -input=false -no-color -out=tfplan.runtime
```

| Metric | Count |
|--------|-------|
| Add | **75** |
| Change | **0** |
| Destroy | **0** |
| Replace | **0** |

Saved to `infrastructure/terraform/stages/runtime/tfplan.runtime`. **Do not apply.**

Plan confirms:

- Images pinned `@sha256:…` for this build
- `GEMINI_MODEL=gemini-3.7-flash`
- `VERTEX_LOCATION=global`
- Runtime `startup_probe` path `/readyz`
- Web `startup_probe` path `/healthz`

### Cloud Run in the plan (9)

`tm-dev-intent-provenance`, `tm-dev-authority`, `tm-dev-gateway`, `tm-dev-outcome-resolution`, `tm-dev-agent-runtime`, `tm-dev-observability-api`, `tm-dev-public-bff`, `tm-dev-benchmark-runner`, `tm-dev-web`.

Ingress: privileged services `INGRESS_TRAFFIC_INTERNAL_ONLY`; `public-bff` `INGRESS_TRAFFIC_ALL` (no `allUsers`); `web` `INGRESS_TRAFFIC_ALL` + `allUsers` invoker.

### Pub/Sub push in the plan (20)

OIDC push subscriptions to `{uri}/internal/events` for Foundation `consumer_topics`.

### IAM in the plan

- 12 exact S2S `roles/run.invoker` edges (Gateway receivable from authority only)
- 6 OIDC self-invokers (push consumers)
- 6 `roles/iam.serviceAccountTokenCreator` for Pub/Sub agent → consumer SAs
- web public invoker `allUsers`

No extra human IAM. No secret accessor grants added in Runtime.

---

## 9. Credential / secret scan

Workspace source trees (`packages`, `services`, `agents`, `apps`, `infrastructure`, `scripts`, `docs`): **0** matches for `.env` (excluding `.env.example`), `*credentials*.json`, `*.pem`, `id_rsa`, `id_ed25519`, or `*service-account*.json`.

Gateway image filesystem scan (`find /app`, excluding `node_modules`): **0** matches.

`.dockerignore` excludes `.env`, tfstate, tfvars, credential globs, `dist`, and `tsbuildinfo`. Terraform never received secret values. Runtime `required_secret_ids = []`.

---

## Remaining blockers

1. **Runtime apply is unapproved.** Plan is ready (`75` add / `0` change / `0` destroy / `0` replace).
2. Observability-api projectors are still `DemoRuntime` in-process; Firestore is used for readiness, not for the read-model.
3. Four Foundation secret shells remain unused (correct; do not populate vertex/adk without a schema).
4. No live payment processor. `TwoPhaseGateway` keeps `MockPaymentAdapter`.
5. `attack-lab` is not a Runtime Cloud Run service.
6. Armor-required local Docker processes fail closed without ADC (intentional). Cloud Run will use the service account.
7. First Cloud Run boot writes `_health/{service}` then `/readyz` only reads it. Firestore security rules / IAM for the runtime SA must already allow that sentinel (Foundation); this pass did not grant extra IAM.

**Did not apply runtime infrastructure. Did not deploy Cloud Run. Did not mutate the Model Armor template. Did not call real payment processors.**
