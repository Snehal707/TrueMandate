# Stage C Live Trust-Path Report

**Date:** 2026-08-14  
**Status:** Reviewed Runtime plan re-gated and applied. Nine Cloud Run services Ready with reviewed digests and Direct VPC. **Blocked (injection) intent path proven durable.** Benign compile path reached Model Armor CLEAN and invoked Gemini under workload identity, but **did not** produce IntentState because Vertex structured output fails `CompilerModelOutputSchema`. Gateway durability/security wiring verified without payment lifecycle. **SAFE/demo not started. Live payments not integrated. Foundation not applied.**

**Hard stops honored:** no Foundation apply; no SAFE/demo; Gateway remains `MockPaymentAdapter`; no operator TokenCreator / impersonation; no invented Authority→Gateway prepare/authorize/commit trigger; no unreviewed plan apply after the gated binary.

## Project

| Field | Value |
|-------|-------|
| Project | `elite-crossbar-505104-t9` |
| Region | `us-central1` |
| Prefix | `tm-dev` |
| Applied Runtime plan | `infrastructure/terraform/stages/runtime/tfplan.runtime.gateway-final-closure` |
| Apply result | `0 added, 5 changed, 0 destroyed` |
| Evidence stamp | `20260814T164740Z` |
| This report | `docs/architecture/stage-c-live-trust-path-report.md` |

---

## 1. Re-gate and apply

### Gate

Saved binary `tfplan.runtime.gateway-final-closure` was re-inspected with `terraform show` / JSON (UTF-16-safe). Gate result: **GATE OK**.

| Metric | Required | Observed |
|--------|----------|----------|
| create | 0 | 0 |
| update | 5 | 5 |
| destroy | 0 | 0 |
| replace | 0 | 0 |

Updates limited to Gateway, agent-runtime, Authority, intent-provenance, and outcome-resolution with reviewed digests/env deltas from `docs/architecture/stage-c-gateway-final-closure-report.md`.

### Apply

```text
Apply complete! Resources: 0 added, 5 changed, 0 destroyed.
```

Foundation was not planned or applied in this phase.

---

## 2. Deployment, revisions, VPC, PSC boot

All **nine** Cloud Run services Ready after apply (see `_live-verify-services.json`).

| Service | Ready revision | Digest |
|---------|----------------|--------|
| gateway | `tm-dev-gateway-00004-rbc` | `sha256:11c9fe994e57c05a928de450bd88c66387a15f48b660fc26c9ca8fb408ae66bc` |
| agent-runtime | `tm-dev-agent-runtime-00003-wtf` | `sha256:fcc1e2769d4274935b75e59ec3b9908140d79eaf57f602855e47542ee0784dd2` |
| authority | `tm-dev-authority-00004-v7x` | `sha256:d53bb996f61a21158cdad2bb3bd22244a7756c366cf47f0d113eac6fc2ab6d7b` |
| intent-provenance | `tm-dev-intent-provenance-00003-hw7` | `sha256:04599ba2ca400b0f14e18ea87a55cf0a3d3d1b43755d73f2c0d5ebf8e5a255a6` |
| outcome-resolution | `tm-dev-outcome-resolution-00003-9zb` | (unchanged reviewed image) |
| public-bff / web / observability-api / benchmark-runner | Ready | prior digests |

### Direct VPC

Gateway and agent-runtime serving revisions use Direct VPC egress `all-traffic` through `tm-dev-s2s` / `tm-dev-s2s-usc1` (network-interfaces annotation present).

### Model Armor PSC

| Check | Result |
|-------|--------|
| Application hostname | `modelarmor.us-central1.rep.googleapis.com` (unchanged) |
| PSC endpoint IP | `10.64.0.5` |
| Private DNS A | apex → `10.64.0.5` |
| Boot probe | Gateway + agent-runtime logged listen then `/readyz` succeeded; fail-closed probe runs before listen in `services/*/src/bin/start.ts` |
| Strongest available PSC data-plane evidence | Successful fail-closed boot + VPC/DNS/control-plane binding. Packet-level PSC path is not independently traced in available logs. |

No “Model Armor probe failed” in the post-apply boot window.

---

## 3. Intent paths (benign + blocked)

### Correlation method

Unique Intent IDs + Pub/Sub `messageIds` + HTTP path/status + deterministic provenance IDs + Firestore reconstruction.  
`correlationId` is **not** reliably present in Cloud Logging/Trace (as previously mapped).

Web entry: `https://tm-dev-web-o2sz2wgoma-uc.a.run.app` → public-bff → intent-provenance.  
Events: Pub/Sub REST publish to `tm-dev-intent.events` (no direct agent-runtime call, no debug route).

Artifacts: `_live-intent-proof.json`, `_live-intent-recheck.json`, `_diag-ar-all.json`, `_diag-ip-all.json`.

### Blocked / injection — **PROVEN**

| Step | Evidence |
|------|----------|
| Create via Web `POST /v1/intents` | 200 for `intent-compile-injection-20260814T164740Z` |
| Pub/Sub publish | messageId `21012034506811711` |
| agent-runtime `/internal/events` | **200** (~0.88s) |
| Durable intent | Firestore `intents/...` 200 |
| Intent root node | `provenanceNodes/intent-node-...` 200 |
| Armor rejection | `provenanceNodes/armor-block-...` label `MODEL_ARMOR_BLOCKED`, `inspectionStatus=BLOCKED` |
| Edge | `e-armor-block-intent-node-...-armor-block-...` present |
| No IntentState / tip | 404 for `intentStates` / `intentTips` |
| No candidate/verdict nodes | recheck node list: intent-node + armor-block only |

**Gemini zero-call proof:** Cloud Audit / Vertex telemetry for `aiplatform.googleapis.com` returned empty for the window. Independent zero-call telemetry is **unavailable**. Rely on code ordering (Armor BLOCKED returns before `compileIntent`) plus absence of candidate/verifier provenance nodes.

### Benign compile — **PARTIAL / NOT fully proven**

| Step | Evidence |
|------|----------|
| Create via Web | 200 for `intent-compile-benign-20260814T164740Z` |
| Pub/Sub publish | messageId `21012034506811707` |
| Durable intent + intent-node | Firestore 200 |
| Armor block node | **absent** (CLEAN path) |
| intent-provenance S2S | GET intent + POST provenance/nodes during processing |
| agent-runtime terminal | **400** (~9–10s, responseSize 259), Pub/Sub retries |
| IntentState / tip | **404** — not created |
| Candidate/verifier nodes | **absent** |

Interpretation (fail-closed mapping in `packages/cloud-runtime/src/event-status.ts`):

- HTTP **400** maps to `SCHEMA_PARSE_FAILED` / `VALIDATION_FAILED` (not `MODEL_UNAVAILABLE`, which would be **503**).
- ~10s latency + Armor CLEAN + intent-node without armor-block ⇒ Model Armor passed and Vertex was reached under agent-runtime workload identity.
- Compiler never persisted a candidate ⇒ failure is inside `generateStructured` schema validation (or equivalent pre-provenance failure).

### Root cause of benign failure (local Vertex probe)

Operator ADC call to `gemini-3.7-flash` (`locations/global`) with the same compiler system instruction returned HTTP 200 JSON whose top-level keys were:

`schemaVersion`, `intentId`, `principalId`, `candidateId`, `interpretation`

Required `CompilerModelOutputSchema` keys (`goal`, `constraints`, `preferences`, `assumptions`, `ambiguities`, `readiness`) were **all missing**.

Cause: `VertexGeminiModel` prompts only with `Respond with JSON only matching schema ${schemaId}` and does **not** embed the Zod/JSON Schema shape or Vertex `responseSchema`. Gemini invents a plausible alternate structure → deterministic schema reject → 400 ACK (non-retryable permanent for that payload shape; Pub/Sub still retried).

**This is a remaining product blocker for full benign trust-path success.** Fixing it requires a code change + image rebuild + **new reviewed Runtime plan** (not applied here).

### Intent-path status summary

| Requirement | Blocked path | Benign path |
|-------------|--------------|-------------|
| Pub/Sub messageIds | yes | yes |
| Terminal 2xx after durable outcome | yes (rejection) | **no** (400 after schema fail) |
| Model Armor CLEAN / BLOCKED | BLOCKED proven | CLEAN inferred |
| Gemini success + IntentState | n/a | **no** |
| Owner S2S + Firestore reconstruction | yes | partial (intent + intent-node only) |

---

## 4. Gateway durability and route security

Evidence: `_gateway-security-proof.json`, `services/gateway-service/src/bin/start.ts`, `services/gateway-service/src/two-phase.ts`, `services/authority-service/src/bin/start.ts`.

| Check | Result |
|-------|--------|
| Ready | `tm-dev-gateway-00004-rbc` Ready |
| Image | reviewed gateway digest |
| Ingress | `internal` (`INTERNAL_ONLY`) |
| Direct VPC | `all-traffic` + `tm-dev-s2s` / `tm-dev-s2s-usc1` |
| `TM_PERSISTENCE` | `firestore` |
| `TM_REQUIRE_INTERNAL_AUTH` | `true` |
| `TM_INTERNAL_ALLOWED_CALLERS` | `tm-dev-authority@...` only |
| Payment adapter | `MockPaymentAdapter` hardcoded in `TwoPhaseGateway` |
| Grant minting | Gateway authorize does not mint; Authority owns grants |
| `preparedActions` store | Firestore list empty (`{}`) — expected before prepare |
| Wiring proof without synthetic prepare | env + readiness `storeKind` / Firestore client in start.ts + durable store port binding |
| IAM invokers | Authority SA + Gateway self (OIDC push/self) |

### Authority → Gateway live application flow

**Unproven / deferred to SAFE/demo.**  
Authority constructs `GatewayS2SClient` but intentionally `void gateway` — no legitimate deployed prepare→grant→authorize→commit trigger. No debug route, impersonation, TokenCreator, public ingress, Gateway self-as-Authority, or direct Firestore insert was used as workflow proof.

### Residual limits

- Unsigned JWT claim parsing for caller allowlisting depends on Cloud Run IAM fronting the request.
- Pub/Sub/self `roles/run.invoker` confers service reachability to `/internal/events`, not privileged prepare/authorize/commit authorization (those routes still require Authority caller allowlist when auth is enforced).

---

## 5. Post-apply drift (read-only)

| Stage | detailed-exitcode | Counts | Action taken |
|-------|-------------------|--------|--------------|
| Runtime | 0 | 0/0/0/0 (75 no-op) | **Clean.** Not applied (nothing to apply). |
| Foundation | 2 | **1 replace** of `module.foundation.google_network_connectivity_regional_endpoint.modelarmor` | **Not applied.** |

Foundation replace detail (dangerous — do not apply):

- Live `address` in state is IP `10.64.0.5`.
- Config wants address resource ID `projects/.../addresses/tm-dev-modelarmor-psc` and adds `subnetwork`, which Terraform treats as force-replace.
- Live PSC control plane is healthy at `10.64.0.5`. Applying this replace would destroy/recreate the working regional endpoint.

Saved read-only plans:

- `infrastructure/terraform/stages/foundation/tfplan.foundation.post-live-trust`
- `infrastructure/terraform/stages/runtime/tfplan.runtime.post-live-trust`

---

## 6. Errors / billing / quota

| Area | Observation |
|------|-------------|
| Billing / quota | No billing or quota denials observed in the bounded checks |
| Delivery | Benign Pub/Sub retries after 400 (expected for non-2xx) |
| Runtime | Benign `/internal/events` 400; injection 200 |
| Model | Live benign fails structured schema; local probe confirms invented schema |
| Vertex audit logs | Empty for window — cannot use as independent call counter |
| Armor / IAM / DNS / PSC | No induced failures; boot and blocked path healthy |

Local fail-closed / idempotency suite was not re-executed in this bounded live pass; prior Stage C unit/integration coverage remains the logical evidence for those behaviors unless a natural transient appears (none did beyond benign schema 400 retries).

---

## 7. Limitations and remaining blockers

1. **Benign IntentState success blocked** by Vertex adapter missing real schema/`responseSchema` embedding → `SCHEMA_PARSE_FAILED` after Armor CLEAN. Needs code fix, agent-runtime rebuild, and a **new reviewed Runtime plan** (out of scope for this apply-only verification).
2. **Gemini zero-call telemetry** for blocked path unavailable; rely on code ordering + missing downstream nodes.
3. **PSC packet path** not independently traced; boot + VPC/DNS/control-plane is strongest available evidence.
4. **Authority→Gateway privileged flow** unproven until SAFE/demo exposes a legitimate prepare→authorize→commit path.
5. **Foundation post-plan shows PSC endpoint replace drift** — must not be applied blindly; treat as provider representation drift pending a careful lifecycle-ignore or state reconciliation design.
6. Empty `preparedActions` proves absence of prepares, not by itself that the store is exercised end-to-end.

---

## 8. Stop line

Stage C Runtime apply + live trust-path verification is complete for the bounded scope:

- Reviewed plan applied once.
- Blocked trust path proven durable.
- Benign path partially proven through Armor CLEAN + Gemini reachability, with durable success blocked by schema adapter gap.
- Gateway security/durability wiring verified without payment lifecycle.
- Post-apply Runtime clean; Foundation replace drift recorded and **not** applied.

**STOP.** No SAFE/demo. No live payments. No Foundation modification. No fail-closed weakening.
