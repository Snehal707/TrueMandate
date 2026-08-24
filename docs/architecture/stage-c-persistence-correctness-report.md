# Stage C Persistence Correctness Report

**Date:** 2026-08-14  
**Status:** Read-only readiness and injective document keys are implemented. Runtime Terraform was **planned only**. **STOP.** Do not apply.

**Hard stop honored:** no Runtime `terraform apply`, no Foundation apply, no `roles/datastore.user` for health, no product features, no live payments.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Artifact Registry | `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate` |
| Foundation state | real (`use_foundation_fixture = false`) |
| Build identifier | `c20260814T073045Z-becfe944` |
| Deploy identity | digest URIs (`@sha256:…`). No `:latest`. |

---

## 1. Readiness implementation

Boot no longer writes `_health/{service}`.

`DocumentStore.probeReachability()` performs a real `get()` of `_health/readyz` (`READY_PROBE_PATH`) through the same path encoding as every other document.

| Result of Get | Meaning |
|---------------|---------|
| RPC succeeds, document missing (`undefined` / `exists === false`) | **ready** |
| RPC succeeds, document present | **ready** |
| RPC throws (permission, transport, missing database) | **not ready** |
| Client object constructed, no Get | **not sufficient** |

`initRuntimePersistence` and `GET /readyz` share this probe. Fail closed if the first probe throws.

- `/healthz`: process is up (unchanged).
- `/readyz`: dependency readiness (unchanged contract; implementation is now read-only).

Memory mode: in-process `get` of a missing key succeeds. No sentinel write.

A Foundation **viewer** can become ready. `roles/datastore.user` is not required for health.

---

## 2. Firestore IAM matrix

IAM is Foundation-owned ([`infrastructure/terraform/modules/foundation/iam.tf`](../infrastructure/terraform/modules/foundation/iam.tf)). This pass **did not change and did not apply** Foundation or Runtime IAM.

Audit is from Cloud Run `start.ts` + persistence bundle vs current Foundation roles.

| service | collections read | collections written | transaction types | current IAM | required IAM |
|---------|------------------|---------------------|-------------------|-------------|--------------|
| intent-provenance | intents, intentStates, intentTips, provenanceNodes, provenanceEdges (+ `_meta`) | same | setTip TX; provenance append-if-absent TX | `roles/datastore.user` | `roles/datastore.user` |
| authority | intents, grants, exposure (+ index/meta) | intents (event create), grants, exposure | grant consume/revoke TX; exposure reserve TX | `roles/datastore.user` | `roles/datastore.user` |
| gateway | grants, commitTokens, nonces, idempotency, exposure, economicReservations, sideEffects, intents, provenance, outcome contracts/events | same | consume grant/token; nonce register; idempotency begin/complete/UNKNOWN; exposure reserve; reservation lock; side-effect append; setTip; provenance append; outcome putIfAbsent | `roles/datastore.user` | `roles/datastore.user` |
| outcome-resolution | outcomeContracts, outcomeEvents, resolutionCases, resolutionTriggers | same | putIfAbsent / trigger-dedupe TX | `roles/datastore.user` | `roles/datastore.user` |
| public-bff | `_health/readyz` probe; local `IntentService` also reads intents | **local `createIntent` writes intents/states/tips** | setTip TX if create runs locally | `roles/datastore.viewer` | **`roles/datastore.viewer`** |
| agent-runtime | `_health/readyz` probe; local `compileAndVerify` reads intents + provenance | **local compiler writes intents + provenance** | setTip + provenance append TX if compile runs locally | `roles/datastore.viewer` | **`roles/datastore.viewer`** |
| observability-api | `_health/readyz` probe only (DemoRuntime is in-process) | none | none | `roles/datastore.viewer` | `roles/datastore.viewer` |
| benchmark-runner | none (Terraform `TM_PERSISTENCE=memory`) | none | none | `roles/datastore.viewer` (unused) | `roles/datastore.viewer` (unused) |
| web | none | none | none | none | none |

### Least-privilege decision

`public-bff` and `agent-runtime` business writes belong on **intent-provenance** (S2S already exists: `public-bff->intent-provenance`, `agent-runtime->intent-provenance`). Outcome mutations belong on **outcome-resolution**.

This pass does **not** grant `roles/datastore.user` to viewers and does **not** implement S2S write proxies. Local writes on viewer services remain fail-closed under IAM until an owner-service routing pass.

## IAM changes

**None.** No Foundation terraform edits. No Runtime IAM resources added. No extra human IAM.

---

## 3. Document key encoding

**Decision:** `__` join is **not** collision-free. `intents/a/b` and `intents/a__b` both became `{ collection: "intents", id: "a__b" }`. Empty segments were silently dropped (`filter(Boolean)`).

**Replacement:** split on the **first** `/` only. Collection = first segment. Logical id = remainder (may contain `/`). Firestore document id = `encodeURIComponent(logicalId)`.

- `a/b` → `a%2Fb`
- `a__b` → `a__b`
- `a%2Fb` → `a%252Fb`

Reject empty collection/id, empty segments (`//`), and `.` / `..`.

No production runtime data exists. The unsafe mapping was not retained for compatibility. Memory store keeps logical `collection/id` Map keys (encoding is Google Firestore only).

### Collision tests ([`packages/cloud-firestore/src/firestore-ref-parts.test.ts`](../../packages/cloud-firestore/src/firestore-ref-parts.test.ts))

| Case | Result |
|------|--------|
| `a/b` vs `a__b` distinct | pass |
| `a/b` vs literal `a%2Fb` distinct | pass |
| repeated separators / empty segments throw | pass |
| `.` / `..` throw | pass |
| Unicode `café` vs `cafe` distinct | pass |
| nested `_meta` / `_index` / `_byHash` vs joined-form ids distinct | pass |

---

## 4. Tests

| Suite | Result |
|-------|--------|
| Unit / integration (`pnpm test`, emulator host unset) | **351 passed**, 10 skipped (emulator-gated file) |
| Encoding tests | **6 passed** (included in 351) |
| Reachability tests (memory + mocked Get) | **3 passed** (included in 351) |
| Firestore emulator races (real client TX) | **10 passed** (includes missing-doc Get) |
| Credential/secret scan (source trees) | **0** hits |
| Gateway image filesystem scan | **0** hits |

Combined unique Vitest cases executed: **361** (351 always-on + 10 emulator).

---

## 5. Images (digest-pinned)

Repository `truemandate` only. Platform `linux/amd64`. Tag `c20260814T073045Z-becfe944`.

| Image | SHA256 digest | Cloud Run? |
|-------|---------------|------------|
| public-bff | `sha256:89bab62a01e620a6c8e216ad2c718d92dee264c3d16f6934618905a68219d586` | yes |
| gateway | `sha256:4c2348e035d5e31f22775798e7d13195a0c850cc8414cf5fc8b92d92dbad2900` | yes |
| intent-provenance | `sha256:1899ac84911530f7350d5246e1a934901cccf0743dcf19fc38a5a1b4e440b8f3` | yes |
| authority | `sha256:70d334cf456fef083ab17f2008c7602acc17345a0e07a7e5bda0ece20b0cb6ec` | yes |
| outcome-resolution | `sha256:dafb322a0d869ac42a9cde0939786b50935b202f38db83288499355c6a46f12f` | yes |
| agent-runtime | `sha256:f2f38bf03137b3346aac1722a811c2186dd1485656a802ce87d7245036126c9b` | yes |
| observability-api | `sha256:c3935a186cc527d93de0eff34ef589995b0bb43b26347ecc9948e7768c0de96e` | yes |
| web | `sha256:729db96fed08646f4bc7224bf0eae83ae1f1e72693513f275bae23ebd152e137` | yes |
| benchmark-runner | `sha256:3c67f4c4f89d88e7c6ed22314d114db9094e8b4444b838a71128984ef694525a` | yes |
| attack-lab | `sha256:7103e8b431a78cb22fd6354a961c8038eb42e485acde56b566efced8f0bd6080` | **no** |

---

## 6. Terraform plan (not applied)

```
terraform -chdir=infrastructure/terraform/stages/runtime plan -input=false -no-color -out=tfplan.runtime
```

Real Foundation remote state. Digest-pinned images from this build.

| Metric | Count |
|--------|-------|
| Add | **75** |
| Change | **0** |
| Destroy | **0** |
| Replace | **0** |

Saved to `infrastructure/terraform/stages/runtime/tfplan.runtime`. **Do not apply.**

Plan still uses `/readyz` startup probes for runtime services, `GEMINI_MODEL=gemini-3.7-flash`, `VERTEX_LOCATION=global`. No Firestore IAM resources in the Runtime plan.

---

## Remaining blockers

1. **Runtime apply is unapproved.** Plan is ready (`75` add / `0` change / `0` destroy / `0` replace).
2. **Viewer local writes.** `public-bff` `createIntent` and `agent-runtime` `compileAndVerify` still construct write-capable local adapters. They stay `datastore.viewer`; those writes fail closed until routed to intent-provenance over existing S2S.
3. Observability-api projectors remain `DemoRuntime` in-process.
4. No live payment processor. `TwoPhaseGateway` keeps `MockPaymentAdapter`.
5. Four Foundation secret shells remain unused (correct).
6. `attack-lab` is not a Runtime Cloud Run service.

**Did not apply runtime infrastructure. Did not apply Foundation. Did not grant `roles/datastore.user` for health. Did not call real payment processors.**
