# Stage C Owner Service Routing Report

**Date:** 2026-08-14  
**Status:** Viewer services persist intents and provenance through intent-provenance S2S. Runtime Terraform was **planned only**. **STOP.** Do not apply.

**Hard stop honored:** no Runtime `terraform apply`, no Foundation apply, no `roles/datastore.user` for public-bff or agent-runtime, no product features, no live settlement.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Foundation state | real (`use_foundation_fixture = false`) |
| Build identifier | `c20260814T081002Z-02c630f8` |
| Deploy identity | digest URIs (`@sha256:…`). No `:latest`. |

---

## 1. Internal APIs (intent-provenance owner)

Ingress remains `INGRESS_TRAFFIC_INTERNAL_ONLY`. These paths are not on public-bff.

| Method | Path | Owner logic |
|--------|------|-------------|
| POST | `/internal/intents` | `IntentService.createIntent` |
| GET | `/internal/intents/:id` | `getIntent` |
| GET | `/internal/intents/:id/tip` | `getCurrentIntentState` |
| POST | `/internal/intent-states` | `createIntentState` |
| POST | `/internal/provenance/nodes` | `ProvenanceService.recordNode` |
| POST | `/internal/provenance/edges` | `ProvenanceService.recordEdge` |
| GET | `/internal/provenance/nodes/:id` | in-process graph, then durable `getNode` |
| GET | `/internal/provenance/edges/:id` | durable `getEdge` |

Fail closed: Zod/`parseWithSchema` → 400; unknown id → 404/400 with stable codes. Duplicate `createIntent` with the same id and same `contentHash`/`rawText` returns the existing intent; a different hash remains a conflict. There is no generic Firestore mutation proxy.

**Auth:** Cloud Run IAM is the boundary. App-level `TM_REQUIRE_INTERNAL_AUTH=true` (intent-provenance Terraform env) rejects missing/empty `Authorization` with 401 — presence check only, no HMAC, no in-app JWT verification. Production callers mint an identity token with audience = intent-provenance URL via `google-auth-library` (`getIdTokenClient`). Tests inject `Bearer test` / `staticTokenProvider`.

---

## 2. public-bff routing

`createLivePublicBffPorts` takes an `IntentCreatePort`. Production start constructs `IntentProvenanceS2SClient` (`INTENT_PROVENANCE_URL` required when `TM_REQUIRE_CONFIG=true`) and does **not** import `IntentService` or `persist.bundle.intents`.

`initRuntimePersistence` remains **only** for `/readyz` Get. Workspace/approval/evidence stay DemoRuntime/EvidenceService (unchanged; not owner routing).

Fail closed if the URL is missing or S2S is non-2xx.

---

## 3. agent-runtime routing

Vertex + Model Armor + `compileAndVerify` remain. `persist.bundle.intents` / `persist.bundle.provenance` are **not** passed into those services.

- `IntentProvenanceS2SClient` implements `createIntent` / `getIntent` / `createIntentState` over HTTP (business rules stay on the owner).
- `ProvenanceService` keeps the in-process graph for the compile session; `durable.appendNode/appendEdge` is the S2S client.
- If `compileAndVerify` receives `intentId` and GET finds it, create is skipped (BFF already persisted). Otherwise create via S2S.
- Gemini still does not mint grants.

`persist` remains for `/readyz` only.

---

## 4. Viewer write audit (architecture, not IAM)

No Foundation IAM edits. public-bff and agent-runtime stay `roles/datastore.viewer`.

| Service | Firestore use after this pass |
|---------|-------------------------------|
| public-bff | `/readyz` Get only |
| agent-runtime | `/readyz` Get only |
| observability-api | `/readyz` Get only; DemoRuntime in-process |
| benchmark-runner | Terraform `TM_PERSISTENCE=memory`; start does not call `initRuntimePersistence` |

Source tests:

- `packages/public-api/src/architecture-ban.test.ts` — start.ts must not contain `IntentService` / `persist.bundle.intents`
- `services/agent-runtime/src/viewer-write-ban.test.ts` — no local `IntentService` / bundle injection / grant mint
- `services/observability-service/src/viewer-write-ban.test.ts`
- `services/benchmark-runner/src/viewer-write-ban.test.ts`

---

## 5. S2S auth

| Layer | Behavior |
|-------|----------|
| Cloud Run IAM | existing `public-bff->intent-provenance` and `agent-runtime->intent-provenance` invoker edges |
| App | `TM_REQUIRE_INTERNAL_AUTH=true` → 401 if `Authorization` missing/empty |
| Production token | ADC identity token, audience = intent-provenance URI |
| Tests | `Authorization: Bearer test` + `staticTokenProvider` |

---

## 6. Tests

| Suite | Result |
|-------|--------|
| Unit / integration (`pnpm test`) | **370 passed** (includes 10 Firestore emulator races) |
| Owner API integration | Bearer accepted; missing auth 401; malformed/missing-field 400; duplicate createIntent idempotency; GET reconstruct |
| Flagship (FakeModel, no live Vertex/payment) | BFF-equivalent S2S create → compileAndVerify via S2S → provenance GET reconstructs INTENT node → in-process `AuthorityService.evaluateAuthorityRequest` (`search`, ALLOW) → gateway source still `MockPaymentAdapter` |
| Viewer write spies | throwing local `set` / `runTransaction` never called on the viewer store |

Flagship path (Vitest only):

1. Human intent via S2S create (same port public-bff uses)
2. Durable GET from intent-provenance
3. agent-runtime `compileAndVerify` with `FakeModel`, persisting through S2S
4. Provenance GET reconstructs the INTENT node
5. In-process `AuthorityService` evaluates the resulting state (no grant mint from agent-runtime)
6. Gateway path remains `private readonly adapter = new MockPaymentAdapter()`

No Stripe/Adyen/PayPal/UPI. No live Vertex in this test.

---

## 7. Images (digest-pinned)

Repository `truemandate` only. Platform `linux/amd64`. Tag `c20260814T081002Z-02c630f8`.

**Rebuilt this pass:** `intent-provenance`, `public-bff`, `agent-runtime`.  
**Not rebuilt:** other images keep digests from `c20260814T073045Z-becfe944`. `attack-lab` was skipped (health-stub; does not compile the public-api start path).

| Image | SHA256 digest | This pass |
|-------|---------------|-----------|
| intent-provenance | `sha256:9d8ea81d8cd226c313f00bc2461a2d98d80895a07455340b43ad9ff5ce28dcdb` | rebuilt |
| public-bff | `sha256:aa0ac86f98694162cbd6eeaa934aeba6762007ac0a84d923cb09370694fb265c` | rebuilt |
| agent-runtime | `sha256:c78f993bd84e135066e626194e794bb393385e1ceaa6ff15644b5dff3ffa5ffd` | rebuilt |
| authority | `sha256:70d334cf456fef083ab17f2008c7602acc17345a0e07a7e5bda0ece20b0cb6ec` | unchanged |
| gateway | `sha256:4c2348e035d5e31f22775798e7d13195a0c850cc8414cf5fc8b92d92dbad2900` | unchanged |
| outcome-resolution | `sha256:dafb322a0d869ac42a9cde0939786b50935b202f38db83288499355c6a46f12f` | unchanged |
| observability-api | `sha256:c3935a186cc527d93de0eff34ef589995b0bb43b26347ecc9948e7768c0de96e` | unchanged |
| benchmark-runner | `sha256:3c67f4c4f89d88e7c6ed22314d114db9094e8b4444b838a71128984ef694525a` | unchanged |
| web | `sha256:729db96fed08646f4bc7224bf0eae83ae1f1e72693513f275bae23ebd152e137` | unchanged |

Credential/secret scan: source trees **0** hits; rebuilt image filesystems **0** hits (no `.pem` / `*credentials*.json` / `*service-account*.json` / private key PEM).

---

## 8. Terraform plan (not applied)

Runtime module (not Foundation):

- `INTENT_PROVENANCE_URL` = intent-provenance Cloud Run URI on **public-bff** and **agent-runtime**
- `TM_REQUIRE_INTERNAL_AUTH=true` on **intent-provenance**
- public-bff and agent-runtime split into `google_cloud_run_v2_service.s2s` so they can reference `runtime["intent-provenance"].uri` without a `for_each` cycle
- URI/name maps merged for IAM, push, web `PUBLIC_BFF_URL`, and outputs

```
terraform -chdir=infrastructure/terraform/stages/runtime plan -input=false -no-color -out=tfplan.runtime
```

`use_foundation_fixture=false`. Digest-pinned images from this build.

| Metric | Count |
|--------|-------|
| Add | **75** |
| Change | **0** |
| Destroy | **0** |
| Replace | **0** |

Saved to `infrastructure/terraform/stages/runtime/tfplan.runtime`. **Do not apply.**

Runtime was never applied, so the split still appears as creates (`runtime[...]` for owners, `s2s["public-bff"]` / `s2s["agent-runtime"]`). No Firestore IAM resources in the Runtime plan. No `roles/datastore.user` for viewers.

---

## Remaining blockers

1. **Runtime apply is unapproved.** Plan is ready (`75` add / `0` change / `0` destroy / `0` replace).
2. Observability-api projectors remain `DemoRuntime` in-process.
3. No live payment processor. `TwoPhaseGateway` keeps `MockPaymentAdapter`.
4. Four Foundation secret shells remain unused (correct).
5. `attack-lab` is not a Runtime Cloud Run service.

**Did not apply runtime infrastructure. Did not apply Foundation. Did not grant `roles/datastore.user` to public-bff or agent-runtime. Did not call real payment processors.**
