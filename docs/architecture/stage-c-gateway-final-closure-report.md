# Stage C Gateway Final Closure Report

**Date:** 2026-08-14  
**Status:** Foundation Model Armor PSC applied and control-plane verified. Five Gateway correctness gaps closed in code with tests green. Affected images rebuilt. Fresh Runtime plan generated and JSON-gated. **Runtime was not applied. SAFE/demo was not started. Deployed prepare/authorize/commit were not invoked.**

**Hard stops honored:** no Runtime `terraform apply`, no SAFE/demo, no live payments, Gateway remains `MockPaymentAdapter`, no extra invoker IAM, no Gateway→Authority invoker edge, no attachment of Gateway/agent-runtime for PSC data-plane testing, identity/access tokens were not printed.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Image tag | `c20260814T163000Z-gwclose` |
| Foundation bindaddr plan | `infrastructure/terraform/stages/foundation/tfplan.foundation.model-armor-psc.bindaddr` |
| Runtime plan (not applied) | `infrastructure/terraform/stages/runtime/tfplan.runtime.gateway-final-closure` |

---

## 1. Foundation PSC apply result

Initial saved plan `tfplan.foundation.model-armor-psc` was **6 create / 0/0/0** on the exact allowlist. Partial apply created APIs, reserved address `10.64.0.5`, private DNS zone, and apex A. Regional endpoint creation failed because binding `address` to the IP literal caused the API to allocate a second address at `10.64.0.5`.

Module fix: `google_network_connectivity_regional_endpoint.modelarmor.address = google_compute_address.modelarmor_psc.id` in `infrastructure/terraform/modules/foundation/network.tf`.

Follow-up saved plan `tfplan.foundation.model-armor-psc.bindaddr`: **1 create / 0 change / 0 destroy** — only `module.foundation.google_network_connectivity_regional_endpoint.modelarmor`. **Applied successfully.**

### Control-plane evidence

| Check | Result |
|-------|--------|
| Reserved IP | `tm-dev-modelarmor-psc` = `10.64.0.5`, status `IN_USE` by `rep-autogen-fr-tm-dev-modelarmor-rep` |
| Regional endpoint | `tm-dev-modelarmor-rep` in `us-central1`, access `REGIONAL`, target `modelarmor.us-central1.rep.googleapis.com`, address `10.64.0.5` |
| Private DNS zone | `tm-dev-modelarmor-usc1-rep`, visibility private to `tm-dev-s2s` only, dnsName `modelarmor.us-central1.rep.googleapis.com.` |
| Apex A | `modelarmor.us-central1.rep.googleapis.com.` → `10.64.0.5` |
| APIs | `dns.googleapis.com`, `networkconnectivity.googleapis.com` enabled |

**Not done (by design):** no Gateway or agent-runtime attachment to exercise PSC data plane.

---

## 2. Five Gateway gaps closed

### Durable prepare → authorize → commit

- Protocol `PreparedActionRecord` + lifecycle enum (`PREPARED | AUTHORIZED | COMMITTING | SUCCEEDED | FAILED | UNKNOWN`).
- `PreparedActionStore` port and `FirestorePreparedActionStore` / in-memory impl with CAS transitions.
- Process-local `Map` session cache removed as source of truth. Prepare persists before return; authorize/commit load from storage and fail closed on missing records.

### Full PreparedAction hash (INV_017 / INV_018)

- Keep `parameterHash` for parameter immutability.
- Versioned `PreparedActionHashPayload` / `computeFullPreparedActionHash` covers authorization-relevant fields.
- Grants, CommitTokens, and ApprovalArtifacts bind the **full** hash.
- Commit rejects OutcomeContract overrides that diverge from the persisted binding.
- Commit rejects caller PreparedAction bodies whose hash does not match the durable record (adversarial substitution).

### Trusted TOCTOU (INV_020)

- `CriticalExternalStateProvider` refreshes state at commit. HTTP/caller `externalState` is ignored.
- Material keys required as own properties; incomplete/stale/unavailable refresh → `PREPARED_ACTION_STALE`.
- Mock `SnapshotExternalStateProvider` only (no live merchant HTTP).

### Atomic exposure reservation (INV_014)

- `reserveIfUnderThreshold` with `IN_FLIGHT` before adapter invoke.
- UNKNOWN keeps `IN_FLIGHT`; success → `COMMITTED`; definitive failure → `RELEASED`.
- Grant/token `put` is create-once (`putIfAbsent` semantics); hash-divergent duplicates fail closed.

### Grant minting ownership + caller identity

- `TwoPhaseGateway.authorize` verifies an Authority-owned `grantId`; it does not mint.
- Authority remains the only grant writer (`createGrant` / internal mint route).
- Gateway privileged routes verify OIDC caller identity against `TM_INTERNAL_ALLOWED_CALLERS` (Authority SA).
- IAM docs: `gateway.commit` forbids **in-process** payment execution on Authority; Authority **may** S2S-invoke Gateway HTTP commit. Gateway must not `authority.grantMint`.

---

## 3. IAM reconciliation

| Statement | Status |
|-----------|--------|
| Authority is sole HTTP orchestrator of prepare/authorize/commit | Documented + Terraform invoker edge unchanged |
| `authority.forbiddenCapabilities: ["gateway.commit"]` = no in-process adapter | Documented in `iam-matrix.md` / `.json` notes |
| `gateway.forbiddenCapabilities: ["authority.grantMint"]` | Enforced in Gateway authorize (no mint) |
| No new invoker IAM / no Gateway→Authority edge | Honored |
| `TM_INTERNAL_ALLOWED_CALLERS` on Gateway | Present in Runtime module; included in gated plan |

---

## 4. Tests

Focused suites (no SAFE):

| Suite | Result |
|-------|--------|
| `packages/authority` INV suites + remediation | passed |
| `packages/cloud-runtime` internal routes / caller identity | passed |
| Gateway Phase 7 / hardening / Phase 8 / Phase 9 / mock adapter | passed |
| Gateway internal routes + S2S client | passed |
| Gateway closure (durable, hash, TOCTOU, exposure, ownership, UNKNOWN) | passed |
| Phase 3 deterministic integration flow | passed |
| **Combined focused** | **112 passed** |

Required behaviors covered: durable reconstruct / missing record fail-closed; hash substitution; stale/unavailable TOCTOU; concurrent exposure bound; revoked grant; duplicate commit; UNKNOWN lock; unauthorized vs Authority identity; Gateway cannot mint.

---

## 5. Image digests

Rebuilt and pushed only `gateway`, `authority`, and `agent-runtime` (`linux/amd64`, tag `c20260814T163000Z-gwclose`). Other digests unchanged from prior Stage C pin.

| Image | Digest |
|-------|--------|
| gateway | `sha256:11c9fe994e57c05a928de450bd88c66387a15f48b660fc26c9ca8fb408ae66bc` |
| authority | `sha256:d53bb996f61a21158cdad2bb3bd22244a7756c366cf47f0d113eac6fc2ab6d7b` |
| agent-runtime | `sha256:fcc1e2769d4274935b75e59ec3b9908140d79eaf57f602855e47542ee0784dd2` |
| intent-provenance (unchanged) | `sha256:04599ba2ca400b0f14e18ea87a55cf0a3d3d1b43755d73f2c0d5ebf8e5a255a6` |
| outcome-resolution (unchanged) | `sha256:15aad3908a1731ae79e586f66a93880f259b1477c46628cb6ec7e81c69483a7c` |
| observability-api (unchanged) | `sha256:a0b73dc348e1d65482f76ca13a9cdb02e3709fc947ebcf68eda31559772a7ba5` |
| public-bff (unchanged) | `sha256:bef33a2c995e6bfde9c1335ed019d0159387188778bd20ba2def991d284f420a` |
| benchmark-runner (unchanged) | `sha256:3c67f4c4f89d88e7c6ed22314d114db9094e8b4444b838a71128984ef694525a` |
| web (unchanged) | `sha256:729db96fed08646f4bc7224bf0eae83ae1f1e72693513f275bae23ebd152e137` |

Gitignored Runtime `terraform.tfvars` pins the three new digests.

---

## 6. Runtime plan gate (not applied)

Fresh plan from applied Foundation PSC state: **`tfplan.runtime.gateway-final-closure`**.

JSON gate: **0 create / 5 update / 0 delete / 0 replace**. Allowlist exactly:

1. `module.runtime.google_cloud_run_v2_service.runtime["gateway"]` — new digest; `TM_REQUIRE_INTERNAL_AUTH=true`; `TM_INTERNAL_ALLOWED_CALLERS=<authority SA>`; Direct VPC `ALL_TRAFFIC`; probe normalization
2. `module.runtime.google_cloud_run_v2_service.s2s["authority"]` — new digest; `GATEWAY_URL` to Gateway
3. `module.runtime.google_cloud_run_v2_service.s2s["agent-runtime"]` — new digest; Direct VPC `ALL_TRAFFIC`; probe normalization
4. `module.runtime.google_cloud_run_v2_service.runtime["intent-provenance"]` — probe normalization only
5. `module.runtime.google_cloud_run_v2_service.runtime["outcome-resolution"]` — probe normalization only

No IAM create/destroy, no Pub/Sub graph changes, no Secret Manager population, no payment-adapter changes, no Model Armor template/region changes.

**Do not apply.**

---

## 7. Remaining risks

- PSC data plane from Cloud Run to Model Armor was not proven (control plane only).
- Precommit multi-object Firestore transaction packing (session + token + grant lock + exposure) is semantically ordered; further TX coalescing may still be desirable for multi-replica races under load.
- Authority constructs `GatewayS2SClient` but must not invoke deployed prepare/authorize/commit until Runtime apply + explicit SAFE/demo approval.
- Runtime plan still carries residual probe/VPC deltas from earlier Stage C plans that were never applied; applying later must re-gate against live state.

---

## 8. Hard stops

| Stop | Honored |
|------|---------|
| No Runtime apply | Yes |
| No SAFE/demo | Yes |
| No live payments / MockPaymentAdapter only | Yes |
| No deployed prepare/authorize/commit invoke | Yes |
| No extra invoker IAM | Yes |
| No Gateway/agent-runtime PSC attachment test | Yes |

**STOP.**
