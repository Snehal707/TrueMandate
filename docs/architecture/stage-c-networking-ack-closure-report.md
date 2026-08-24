# Stage C Networking and ACK Closure Report

**Date:** 2026-08-14  
**Status:** Plan only. Foundation and Runtime plans were regenerated and **not applied**. Live Cloud Run S2S still cannot reach `INTERNAL_ONLY` destinations. **STOP.** Do not start SAFE/demo acceptance.

**Hard stops honored:** no Foundation apply, no Runtime apply, no SAFE/demo, no operator `roles/iam.serviceAccountTokenCreator`, no weakening of `INTERNAL_ONLY`, no live payments, no `allUsers` on trust services, no extra invoker IAM, no Secret Manager population, identity/access tokens were not printed.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Image tag (prior ACK rebuilds) | `c20260814T093500Z-acknet` |
| Image tag (outcome-resolution only) | `c20260814T110000Z-outack` |
| Foundation plan | `infrastructure/terraform/stages/foundation/tfplan.foundation.networking` |
| Runtime plan | `infrastructure/terraform/stages/runtime/tfplan.runtime.networking` |

---

## 1. S2S root cause

Applied Runtime state has empty `vpc_access` on every Cloud Run service (confirmed with `gcloud run services describe` for all nine; applied `infrastructure/terraform/stages/runtime/terraform.tfstate` has `"vpc_access": []`).

Google requires callers of Internal Cloud Run to send `*.run.app` requests **through a VPC** with `egress = ALL_TRAFFIC`. Same-project identity tokens are not enough.

Pub/Sub OIDC push already reaches `INTERNAL_ONLY` (Google frontend). That path is unchanged and must stay.

Live Compute Engine API was **disabled** (`SERVICE_DISABLED`). No VPC/subnet existed to reuse. Dedicated TrueMandate network `tm-dev-s2s` / `10.64.0.0/24` has no CIDR conflict.

---

## 2. Destination audit (six Direct VPC callers)

Audited from production entrypoints and adapters. Destinations are Google APIs, Internal Cloud Run `*.run.app`, or the metadata server. **No non-Google public internet endpoint is required.** Gateway remains `MockPaymentAdapter` only.

Implemented Cloud Run S2S today is narrower than the invoker graph: only **public-bff** and **agent-runtime** construct `IntentProvenanceS2SClient` to `https://tm-dev-intent-provenance-o2sz2wgoma-uc.a.run.app`. The other IAM edges (`public-bff → outcome-resolution`, `agent-runtime → observability-api`, `intent-provenance → agent-runtime/observability-api`, `authority → gateway/observability-api`, `gateway → outcome-resolution/observability-api`, `outcome-resolution → observability-api`) are permissions, not implemented HTTP clients. Direct VPC stays on all six callers because `egress = ALL_TRAFFIC` also carries their Google API traffic (Firestore, Vertex, Model Armor) once attached, and the invoker graph is the intended S2S surface.

| Caller | Implemented outbound | IAM-only / not implemented |
|--------|----------------------|----------------------------|
| **public-bff** | S2S to intent-provenance (`/internal/intents`); Firestore readiness GET `firestore.googleapis.com`; metadata ID token | `public-bff → outcome-resolution` (no outcome URL/client) |
| **agent-runtime** | S2S to intent-provenance (intent/state/provenance routes); Vertex `https://aiplatform.googleapis.com/v1/projects/elite-crossbar-505104-t9/locations/global/publishers/google/models/gemini-3.7-flash:generateContent`; Model Armor `https://modelarmor.us-central1.rep.googleapis.com/v1/.../templates/tm-dev-prompt-response:sanitizeUserPrompt`; Firestore readiness GET; metadata ADC | `agent-runtime → observability-api` |
| **intent-provenance** | Firestore RW `firestore.googleapis.com`; inbound Pub/Sub `/internal/events` | no outbound Cloud Run client |
| **authority** | Firestore RW (intents, grants, exposure) | no gateway or observability HTTP client |
| **gateway** | Firestore RW; Model Armor probe (same REP URL); **MockPaymentAdapter — no network I/O, no live processor** | no outcome-resolution or observability HTTP client |
| **outcome-resolution** | Firestore RW (contracts, events, cases, triggers); validated execution/evidence handlers (not a no-op ACK) | no observability HTTP client |

ADC / ID-token acquisition uses `google-auth-library` against the metadata server (`http://169.254.169.254/computeMetadata/v1` and `http://metadata.google.internal./computeMetadata/v1`), including `/instance/service-accounts/default/token` and `/instance/service-accounts/default/identity`. Workload code does not call `oauth2.googleapis.com`, `sts.googleapis.com`, or `iamcredentials.googleapis.com`. Pub/Sub Token Creator on consumer SAs is inbound OIDC push, not outbound application traffic.

Not attached to Direct VPC (unchanged): **web** (calls INGRESS_ALL public-bff), **observability-api** (sink), **benchmark-runner** (does not call INTERNAL_ONLY).

---

## 3. NAT / router / networkUser removal

Private Google Access on `tm-dev-s2s-usc1` plus Direct VPC `egress = ALL_TRAFFIC` is sufficient for Google APIs (`*.googleapis.com`, `*.rep.googleapis.com`) and Internal Cloud Run `*.run.app` URLs. Cloud NAT is required only for arbitrary public internet. None of the six callers has such a destination.

**Removed from** `infrastructure/terraform/modules/foundation/network.tf`:

- `google_compute_router.s2s`
- `google_compute_router_nat.s2s`
- `google_compute_subnetwork_iam_member.cloudrun_network_user`

**Kept:** custom VPC `tm-dev-s2s`, subnet `tm-dev-s2s-usc1` `10.64.0.0/24` with `private_ip_google_access = true`. Runtime Direct VPC `ALL_TRAFFIC` and normal `*.run.app` URLs are unchanged.

### Service-agent permission evidence

Live project IAM grants the Cloud Run service agent:

`service-547914435840@serverless-robot-prod.iam.gserviceaccount.com` → **`roles/run.serviceAgent`**

`gcloud iam roles describe roles/run.serviceAgent` includes:

- `compute.networks.access`
- `compute.networks.get`
- `compute.subnetworks.get`
- `compute.subnetworks.use`

Those permissions are enough for Direct VPC attachment. The extra subnet `roles/compute.networkUser` binding was therefore redundant and was not planned.

Predicted self-links used for the Runtime plan overlay (Foundation not applied, so remote state cannot export them yet):

- `projects/elite-crossbar-505104-t9/global/networks/tm-dev-s2s`
- `projects/elite-crossbar-505104-t9/regions/us-central1/subnetworks/tm-dev-s2s-usc1`

Not a Serverless VPC connector. Not human Token Creator. Not invoker-graph IAM.

---

## 4. Callers requiring egress

Ingress is **unchanged**:

- `INTERNAL_ONLY`: intent-provenance, authority, gateway, outcome-resolution, agent-runtime, observability-api, benchmark-runner
- `INGRESS_ALL`: public-bff, web

Existing invoker edges are unchanged. `INTENT_PROVENANCE_URL` remains the `*.run.app` URI.

| Service | Direct VPC `ALL_TRAFFIC` | Why |
|---------|--------------------------|-----|
| public-bff | yes | → intent-provenance, outcome-resolution |
| agent-runtime | yes | → intent-provenance, observability-api |
| intent-provenance | yes | → agent-runtime, observability-api |
| authority | yes | → gateway, observability-api |
| gateway | yes | → outcome-resolution, observability-api |
| outcome-resolution | yes | → observability-api |
| web | **no** | calls INGRESS_ALL public-bff |
| observability-api | **no** | sink |
| benchmark-runner | **no** | does not call INTERNAL_ONLY |

---

## 5. Foundation plan counts

`terraform -chdir=infrastructure/terraform/stages/foundation plan -out=tfplan.foundation.networking`

**3 add, 0 change, 0 destroy.** No unrelated replace. No Cloud Router, Cloud NAT, or `networkUser` binding.

Adds:

1. `google_project_service.required_apis["compute.googleapis.com"]`
2. `google_compute_network.s2s` (`tm-dev-s2s`)
3. `google_compute_subnetwork.s2s` (`tm-dev-s2s-usc1`, `10.64.0.0/24`, `private_ip_google_access = true`)

New outputs: `vpc_network`, `vpc_subnet`, `vpc_egress=ALL_TRAFFIC`.

Model Armor `template_metadata` API drift was **not** included. The template resource still `ignore_changes = [template_metadata]` so this pass does not mutate Model Armor, Firestore, Pub/Sub, or service accounts.

**Not applied.**

---

## 6. Runtime plan counts

Rebuilt and pushed **only** `outcome-resolution` (`c20260814T110000Z-outack`). All other approved ACK digests are unchanged.

| Image | Digest |
|-------|--------|
| intent-provenance | unchanged `sha256:04599ba2ca400b0f14e18ea87a55cf0a3d3d1b43755d73f2c0d5ebf8e5a255a6` |
| public-bff | unchanged `sha256:bef33a2c995e6bfde9c1335ed019d0159387188778bd20ba2def991d284f420a` |
| agent-runtime | unchanged `sha256:854f4fe0ce55c83daac43aa02199ecc9b320153d716fc349f421ea6600d8fb08` |
| authority | unchanged `sha256:f61e2659172127edb2a621f2966dfed6b27facc5a00dedc89013e2df9e201703` |
| gateway | unchanged `sha256:e76a2ff22526cfbb80534e2be02d8467ed1632e3a08af285d04ea5d6c0505212` |
| **outcome-resolution** | **new** `sha256:15aad3908a1731ae79e586f66a93880f259b1477c46628cb6ec7e81c69483a7c` |
| observability-api | unchanged `sha256:a0b73dc348e1d65482f76ca13a9cdb02e3709fc947ebcf68eda31559772a7ba5` |
| benchmark-runner | unchanged `sha256:3c67f4c4…` |
| web | unchanged `sha256:729db96f…` |

`terraform -chdir=infrastructure/terraform/stages/runtime plan -out=tfplan.runtime.networking`

Uses predicted Foundation self-links (Foundation not applied).

**0 add, 7 change, 0 destroy.** No Firestore / Pub/Sub / SA destroy. No invoker IAM change. Ingress unchanged.

The seven in-place Cloud Run updates:

- **vpc_access `ALL_TRAFFIC` + image:** public-bff, agent-runtime, intent-provenance, authority, gateway, outcome-resolution (new digest)
- **image only:** observability-api (ACK mapping lives in `cloud-runtime`; no Direct VPC)

web and benchmark-runner are absent from the plan.

Apply of this Runtime plan **requires Foundation networking to exist first**. The Cloud Run API will reject Direct VPC attachment to a network that has not been created. Sequence for a later reviewed apply: Foundation networking, then Runtime.

**Not applied.**

---

## 7. IAM

- Invoker graph: unchanged.
- Pub/Sub `roles/iam.serviceAccountTokenCreator` on consumer SAs: unchanged (Pub/Sub agent only).
- No operator Token Creator.
- Direct VPC: rely on Cloud Run **service agent** `roles/run.serviceAgent` (`compute.networks.access/get`, `compute.subnetworks.get/use`). No extra subnet IAM.

---

## 8. ACK mapping

Idempotency keys are recorded **only after** all handlers succeed. Duplicate of a completed key → 2xx, handler not re-run. Transient failure leaves the key unused so Pub/Sub can retry.

HTTP mapping from structured `Result` (not everything 400):

| Status | When |
|--------|------|
| 2xx | Valid terminal domain outcome, including deterministic BLOCK/REJECTED after durable provenance; duplicate already processed |
| 4xx | Malformed JSON/envelope; permanently invalid; out-of-order aggregate version; schema/validation failure |
| 5xx | Owner S2S transient (`retryable` / 5xx / 429 / GFE HTML 404); `MODEL_UNAVAILABLE`; unexpected throw (500), including Firestore persistence failure |

`agent-runtime` inspects `compileAndVerify` `Result` and does not ACK on `err`.

Deterministic BLOCK: `criticalFailure` follows the existing `SemanticLifecycle.REJECTED` path — `ok` without privileged `IntentState` after required provenance is written. Provenance/S2S write failure still fails closed (5xx).

S2S classification (`s2sResultFromHttp` / `fetchS2SJson`): network errors → 503 retryable; 5xx/429 retryable; application JSON 4xx permanent; GFE HTML 404/403 retryable vs app JSON 404 permanent.

Other `/internal/events` consumers:

- intent-provenance / authority / gateway: inspect `createIntent` / `recordNode` Results
- observability-api: projector throw → 5xx
- **outcome-resolution: no longer a no-op ACK.** Validated execution/evidence handlers drive durable `OutcomeService` / `ResolutionService`. Receipt of an event is not itself 2xx.

No `TM_S2S_BEARER` / operator impersonation is used as production proof.

---

## 9. Outcome-resolution event handlers

`services/resolution-service/src/event-handler.ts` is wired from `services/resolution-service/src/bin/start.ts`.

**execution.events**

- Strict Zod payload: `contractId` / `outcomeContractId` / envelope `aggregateId`, and `status` / `paymentStatus` / `executionState` ∈ `{SUCCESS, FAILED, UNKNOWN}`.
- Hydrate the durable OutcomeContract, then `onPaymentSuccess` / `onPaymentFailed` / `onPaymentUnknown`.
- Payment `SUCCESS` moves the contract at most to `AWAITING_OUTCOME`. It never `SATISFIED` the Outcome Contract (`INV_009`).

**evidence.events**

- Strict Zod observation snapshot (`facts` and/or flattened `ObservationFacts`) plus optional `conflictedConcepts`.
- Hydrate the contract, then `OutcomeService.applyObservations`.
- When the resulting state is `PARTIAL`, `AT_RISK`, `BREACHED`, or `CONFLICTED`, load the bound immutable `IntentState` from the Firestore intent repository and call `ResolutionService.openCaseFromTrigger`.
- Trigger identity remains the idempotency key. First-divergence is reported. Responsibility/root cause stay `UNKNOWN`.

**ACK classes**

- Unsupported / malformed / permanently invalid payloads → structured `SCHEMA_PARSE_FAILED` / `VALIDATION_FAILED` (4xx).
- Firestore / internal throws remain 5xx through the existing bus (`unexpected: true`) and `eventHttpStatus`.
- Duplicate completed delivery ACKs 2xx without a second transition or a second Resolution Case.
- Durable writes complete **before** in-memory dedupe/cache is consumed, so a failed persistence attempt stays retryable.

---

## 10. Tests

65 tests passed in this pass:

| File | Tests |
|------|-------|
| `services/resolution-service/src/event-handler.test.ts` | 8 |
| `services/resolution-service/src/phase9.test.ts` | 17 |
| `services/outcome-service/src/phase8.test.ts` | 13 |
| `packages/cloud-pubsub/src/pubsub-bus.test.ts` | 6 |
| `packages/cloud-runtime/src/cloud-runtime.test.ts` | 9 |
| `packages/cloud-runtime/src/s2s-client.test.ts` | 4 |
| `packages/cloud-firestore/src/firestore-concurrency.test.ts` | 8 |

Handler coverage:

- execution success updates the bound OutcomeContract and does **not** make outcome success automatic
- evidence updates requirement verification; PARTIAL / CONFLICTED / BREACHED open a Resolution Case
- duplicate completed delivery creates no duplicate transition or Resolution Case
- payment `SUCCESS` remains distinct from a `PARTIAL` outcome
- malformed/strict extra fields → 4xx
- retryable persistence failure → HTTP 500; bus idempotency is not consumed; retry succeeds
- `/internal/events` 5xx then 2xx then duplicate 2xx

Existing ACK/S2S/compiler coverage kept: owner S2S 503, `MODEL_UNAVAILABLE` 503, duplicate key 2xx, malformed/out-of-order 400, BLOCK after durable provenance, GFE HTML vs app JSON 4xx.

---

## 11. Scaling decision

Post-apply Runtime drift wanted to drop service-level `scaling { min_instance_count = 0, manual_instance_count = 0 }` on all nine services. Intended autoscale remains `template.scaling { min_instance_count = 0, max_instance_count = 3 }`.

Google provider 6: setting **only** top-level `scaling { min_instance_count = 0 }` (not `manual_instance_count`) does **not** switch the service to manual scaling. That block is set explicitly on all nine Cloud Run resources.

The Runtime plan shows **no scaling attribute changes**. `min_instance_count` remains 0. No scale-up.

---

## 12. Remaining blockers

1. **Plans are not applied.** Live services still have empty `vpc_access`. Compile `intent.events` can still 200 without owner `/internal/*` traffic until a reviewed apply.
2. Runtime Direct VPC apply must follow Foundation networking apply (Compute API + VPC + PGA-enabled subnet only; no NAT).
3. Live workload S2S proofs wait until after that apply, using **workload ADC identity tokens**, not operator impersonation:
   - web → public-bff
   - public-bff → intent-provenance
   - Pub/Sub → agent-runtime → intent-provenance
   - authority → gateway `/healthz` only (no prepare/commit)
4. Operator Owner still cannot impersonate runtime SAs. Do not grant human Token Creator to prove S2S.

**STOP.** Do not apply in this pass. Do not start SAFE/demo.
