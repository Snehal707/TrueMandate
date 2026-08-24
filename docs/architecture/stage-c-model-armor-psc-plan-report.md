# Stage C Model Armor PSC Plan Report

**Date:** 2026-08-14  
**Status:** Foundation and Runtime plans generated and JSON-gated. **Neither plan was applied.** Per-event Model Armor, Authority→Gateway S2S wiring, and rebuilt images are in git/registry only. **STOP before Terraform apply and before SAFE/demo acceptance.**

**Hard stops honored:** no operator `roles/iam.serviceAccountTokenCreator`, no weakening of `INTERNAL_ONLY`, no live payments, no extra invoker IAM, no Secret Manager population, no Cloud NAT / Cloud Router / subnet IAM / firewall, no Model Armor template or region change, Gateway remains `MockPaymentAdapter`, no deployed prepare/commit invocation, identity/access tokens were not printed.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Image tag | `c20260814T151500Z-armorpsc` |
| Foundation saved plan | `infrastructure/terraform/stages/foundation/tfplan.foundation.model-armor-psc` |
| Runtime saved plan | `infrastructure/terraform/stages/runtime/tfplan.runtime.model-armor-psc` |

---

## 1. PSC target, IP, DNS, and APIs

Private Google Access does not cover `*.rep.googleapis.com`. Model Armor continues to use hostname `modelarmor.us-central1.rep.googleapis.com` (adapter `regionalHost(location)` with default `us-central1`). Runtime does **not** consume PSC outputs; DNS in the VPC is what makes that hostname resolve to the reserved IP.

| Item | Planned value |
|------|----------------|
| Target Google API | `modelarmor.us-central1.rep.googleapis.com` |
| Access type | `REGIONAL` |
| Reserved internal IP | `10.64.0.5` (`GCE_ENDPOINT`, existing subnet `tm-dev-s2s-usc1`) |
| Why `10.64.0.5` | Outside the observed Serverless allocation beginning at `10.64.0.16`; no second subnet |
| Regional endpoint name | `tm-dev-modelarmor-rep` |
| Private DNS zone | `tm-dev-modelarmor-usc1-rep` |
| DNS name | `modelarmor.us-central1.rep.googleapis.com.` |
| Apex A record | `10.64.0.5` |
| Visibility | Private to `tm-dev-s2s` only |
| APIs to enable | `networkconnectivity.googleapis.com`, `dns.googleapis.com` |

No global access, NAT, router, firewall, or shell provisioners are in the Foundation plan. Address is the IP literal (`google_compute_address....address`), not a self-link, to avoid provider permadiff.

---

## 2. Foundation plan gate

Inspected `tfplan.foundation.model-armor-psc` JSON: **6 create / 0 update / 0 delete / 0 replace**.

Allowlist (exact):

| Address | Type |
|---------|------|
| `module.foundation.google_project_service.required_apis["dns.googleapis.com"]` | API |
| `module.foundation.google_project_service.required_apis["networkconnectivity.googleapis.com"]` | API |
| `module.foundation.google_compute_address.modelarmor_psc` | Internal address `10.64.0.5` |
| `module.foundation.google_network_connectivity_regional_endpoint.modelarmor` | Regional endpoint |
| `module.foundation.google_dns_managed_zone.modelarmor_rep` | Private zone |
| `module.foundation.google_dns_record_set.modelarmor_rep` | Apex A |

Outputs added for audit only: `model_armor_psc_ip`, `model_armor_psc_endpoint`, `model_armor_psc_forwarding_rule`, `model_armor_psc_dns_zone`, `model_armor_psc_dns_name`.

**Not applied.**

---

## 3. Per-event Model Armor gate and provenance

Boot probe is unchanged: fail-closed startup, template `tm-dev-prompt-response`, region `us-central1`, `TM_MODEL_ARMOR_TEMPLATE`. No model-output inspection path was added (none exists).

Event path (`handleIntentCompileEvent` → `compileAndVerify`):

1. Create immutable Intent + INTENT provenance (`ensureIntentRoot`). Default human taint is `NONE`. Supplied external taint is schema-validated and passed through.
2. Inspect raw prompt via `ModelSecurityPort` **before** `compileIntent` / Gemini.
3. `CLEAN` proceeds to compiler and verifier. Taint is **not** cleared. Candidate and verification provenance copy input taint.
4. `BLOCKED` writes a durable `DECISION` node (`MODEL_ARMOR_BLOCKED`) and `DOES_NOT_SUPPORT` edge, returns discriminated `{ status: "REJECTED", reason: "MODEL_ARMOR_BLOCKED" }`, ACKs 2xx, creates **no IntentState**, makes **zero** Gemini calls.
5. `UNAVAILABLE` / `ERROR` / adapter throw / failed rejection provenance → `MODEL_UNAVAILABLE` with `retryable: true` (HTTP 5xx).

`ProvenanceService.recordNode` / `recordEdge` now append durable storage **before** mutating the in-process graph, so a blocked prompt cannot ACK with only a local node.

**Zero-Gemini blocked test:** `services/agent-runtime/src/intent-event-handler.test.ts` — `blocked injection writes rejection provenance and makes zero Gemini calls`. `FakeModel.generationCount === 0` for compiler and verifier; INTENT + DECISION nodes exist; tip IntentState is absent.

---

## 4. Authority → Gateway S2S design

IAM edge `authority → gateway` was already present. This pass adds application routes and a typed client. **Deployed prepare/commit were not invoked.**

Gateway internal routes (only these three):

- `POST /internal/gateway/prepare`
- `POST /internal/gateway/authorize`
- `POST /internal/gateway/commit`

Strict Zod DTOs wrap `TwoPhaseGateway.prepare` / `.authorize` / `.commit`. Callers cannot send `adapterMode`, `now`, `exposureThreshold`, or `claimedPrivilegeClass`. PreparedAction and CommitToken are loaded server-side. `TwoPhaseGateway` remains the sole enforcement point. Gateway boot requires `TM_REQUIRE_INTERNAL_AUTH=true`. Missing `Authorization` is 401 (Cloud Run IAM remains the identity layer).

`GatewayS2SClient` in `packages/cloud-runtime` reuses ADC audience tokens and retryable HTTP mapping. Authority boot requires `GATEWAY_URL` and constructs the client; it does not call prepare/commit.

Authority was moved in Terraform state (`runtime["authority"]` → `s2s["authority"]`) so `GATEWAY_URL` can reference gateway URI without a cycle.

Documented, not fixed in this pass: optional CriticalExternalState TOCTOU completeness, PreparedAction hash coverage, non-atomic exposure vs `reserveIfUnderThreshold`, gateway minting grants vs IAM matrix, and `iam-matrix.json` marking authority forbidden from `gateway.commit` vs the Terraform invoker edge.

---

## 5. Test totals

Focused suites (no SAFE):

| Suite | Result |
|-------|--------|
| Intent compiler Phase 4 + owner-routing | passed |
| Agent-runtime event handler (CLEAN / BLOCKED / unavailable / taint / owner S2S 503) | passed |
| Model Security port | passed |
| cloud-runtime S2S / internal routes / ACK mapping | passed |
| Gateway internal routes + client bypass gates | passed |
| Gateway Phase 7, Phase 7 hardening, Phase 8 binding, mock-adapter binding | passed |
| Combined focused vitest | **84 passed** (10 emulator tests skipped in that combined process without `FIRESTORE_EMULATOR_HOST`) |
| `scripts/cloud/run-firestore-emulator-races.mjs` | **10/10 passed** |

Typecheck/build: `cloud-runtime`, `intent-compiler`, `intent-verifier`, `agent-runtime`, `gateway-service`, `authority-service`, `provenance-service`.

---

## 6. Rebuilt image digests

Only `agent-runtime`, `gateway`, and `authority` were rebuilt and pushed (`linux/amd64`, tag `c20260814T151500Z-armorpsc`). Unrelated service digests are unchanged.

| Image | Digest |
|-------|--------|
| agent-runtime | `sha256:3a58912e200b57042aecf89c83f02d42711c44ad686d600e616ef0b5e8eb9ad0` |
| gateway | `sha256:c29ec2fc15d2408005f18822f5f947dcafb31e1505791a3bd0d754f498507348` |
| authority | `sha256:590f4b7d17a7e056db09a61e925b82a4bba26c7ab3935c081aa92e147c7d5388` |
| intent-provenance (unchanged) | `sha256:04599ba2ca400b0f14e18ea87a55cf0a3d3d1b43755d73f2c0d5ebf8e5a255a6` |
| public-bff (unchanged) | `sha256:bef33a2c995e6bfde9c1335ed019d0159387188778bd20ba2def991d284f420a` |
| outcome-resolution (unchanged) | `sha256:15aad3908a1731ae79e586f66a93880f259b1477c46628cb6ec7e81c69483a7c` |
| observability-api (unchanged) | `sha256:a0b73dc348e1d65482f76ca13a9cdb02e3709fc947ebcf68eda31559772a7ba5` |
| benchmark-runner (unchanged) | `sha256:3c67f4c4f89d88e7c6ed22314d114db9094e8b4444b838a71128984ef694525a` |
| web (unchanged) | `sha256:729db96fed08646f4bc7224bf0eae83ae1f1e72693513f275bae23ebd152e137` |

Image content checks:

- agent-runtime: `modelarmor.${location}.rep.googleapis.com` with default location `us-central1`; template `tm-dev-prompt-response`
- gateway: `MockPaymentAdapter` in `two-phase.js`; `createGatewayInternalRoutes`; `TM_REQUIRE_INTERNAL_AUTH=true`
- authority: `GatewayS2SClient` + `requireGatewayUrl`; no `.prepare(` invocation in `start.js`

Gitignored Runtime tfvars pin the three new digests.

---

## 7. Runtime plan delta

Inspected `tfplan.runtime.model-armor-psc` JSON: **0 add / 5 change / 0 destroy / 0 replace**. `moved` converted authority out of the owner `for_each` without destroy/create.

| Resource | Delta | Ingress | VPC after |
|----------|-------|---------|-----------|
| `runtime["gateway"]` | New digest; `TM_REQUIRE_INTERNAL_AUTH=true`; longer `/readyz`; **add Direct VPC `ALL_TRAFFIC`** | `INTERNAL_ONLY` | added |
| `s2s["agent-runtime"]` | New digest; longer `/readyz`; **add Direct VPC `ALL_TRAFFIC`** | `INTERNAL_ONLY` | added |
| `s2s["authority"]` (moved) | New digest; `GATEWAY_URL=https://tm-dev-gateway-o2sz2wgoma-uc.a.run.app` | `INTERNAL_ONLY` | remains |
| `runtime["intent-provenance"]` | Startup-probe normalization only (`failure_threshold` 3→12, delay 0→10, timeout 1→3) | `INTERNAL_ONLY` | remains |
| `runtime["outcome-resolution"]` | Same probe normalization | `INTERNAL_ONLY` | remains |

Existing VPC attachments remain on authority, public-bff, intent-provenance, and outcome-resolution. `lifecycle.ignore_changes = [client, client_version]` dropped gcloud client-metadata churn. No IAM, Pub/Sub, scaling, secrets, ingress, or payment-adapter changes. Vertex remains Gemini 3.7. Model Armor template/region unchanged.

**Apply order if later approved:** Foundation PSC first, then Runtime. Applying the Runtime plan before PSC would attach Direct VPC to gateway and agent-runtime and **fail Model Armor boot again**.

**Not applied.**

---

## 8. Blockers remaining after this plan

1. **PSC is plan-only.** Reachability of `modelarmor.us-central1.rep.googleapis.com` via `10.64.0.5` is unverified until Foundation apply + live DNS/PSC check from a VPC caller.
2. **Deployed trust-path closure is pending.** Per-event Armor and Authority→Gateway exist in images and Terraform, but Cloud Run still runs the previous digests. Gateway/agent-runtime still have no Direct VPC in live GCP.
3. **Runtime apply is unsafe until PSC is live.** Same Armor REP failure mode as Stage C networking.
4. **PreparedAction HTTP sessions are in-process.** Scale-to-zero will drop prepare→authorize→commit session maps; durable session store is out of this pass.
5. **Operator impersonation** remains denied. Live proofs in a later apply pass must use the public web proxy and Pub/Sub publish only.
6. **SAFE/demo acceptance has not started.**

---

## 9. What is true now vs after apply

Now (repo + registry, no apply):

- Foundation PSC graph is a clean 6-create plan.
- Compiler/event path gates Model Armor before Gemini with durable BLOCKED provenance.
- Authority has a typed Gateway client; Gateway exposes three authenticated internal operations wrapping `TwoPhaseGateway`.
- Three new image digests are pinned in gitignored tfvars.

After a later approved apply (not this pass):

- PSC + private DNS would need live verification from Direct VPC.
- Gateway and agent-runtime could attach `ALL_TRAFFIC` only if that verification succeeds.
- Authority would receive `GATEWAY_URL`; Gateway would require internal auth.

**STOP before Terraform apply and before SAFE/demo acceptance.**
