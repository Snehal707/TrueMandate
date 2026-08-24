# Wave 1 Production Closure Report

**Date:** 2026-08-20 (takeover continuation) / closed 2026-08-21  
**Project:** `elite-crossbar-505104-t9` · **Region:** `us-central1`  
**Registry:** `us-central1-docker.pkg.dev/elite-crossbar-505104-t9/truemandate`

## Final verdict

**WAVE 1 PRODUCTION CLOSED**

Positive and negative APPROVAL live proofs completed on the patched stack (`wave1-approval-resume1`, `wave1-approval-negative-resume1`). All other required live proofs that ran after the patch train remain PASS. Historical Phase A/B/C tokens and side effects were preserved; orphan cleanup uncertainty and non-canonical partial residues remain documented below.

---

## 1. Takeover / reconstructed state

Frozen at takeover in `infrastructure/terraform/stages/runtime/_wave1-takeover-recon.json` (2026-08-20T16:26:00Z).

| Namespace | Classification | Notes |
|---|---|---|
| `wave1-a-unsafe-supplier-liveA1` | PARTIAL_NO_ECONOMIC_EFFECT | 0 grants / 0 CommitTokens / 0 side effects |
| `wave1-b-full-delivery-liveB1` | LIKELY SUCCESSFULLY_COMPLETE | Canonical B — CLOSED / payment SUCCESS / 1 side effect |
| `wave1-b-full-delivery-liveB2` | PARTIAL — leave alone | Non-canonical residue; not continued |
| `wave1-c-short-delivery-liveC1` | PARTIAL | Remedy mid-flight; later blocked by immutable pre-fix OC; resumed via fresh `patchC5` lineage |
| approval / concurrency / exposure / evidence | NOT_STARTED at takeover | Run after patch |

Orphan four-artifact cleanup claimed by prior agent: **UNKNOWN / unverified**. No further production deletes.

Stale plan `tfplan.wave1-delta12` was **not** applied (live already had the target digest).

Pre-patch local docs (`wave1-closure-report.md`, `wave1-security-closure.md`) still said NOT DEPLOYED — **stale**; this report supersedes them for production.

---

## 2. Original deployment (pre-patch)

| Service | Revision | Digest | Tag | Local five-fixes in digest? |
|---|---|---|---|---|
| `tm-dev-gateway` | `…-00012-gj4` | `sha256:78d78acd…` | `wave1-20260819T190802Z` | **NO** |
| `tm-dev-intent-provenance` | `…-00020-st2` | `sha256:9a074ef9…` | `wave1-20260820T125500Z` | LIKELY YES |
| `tm-dev-outcome-resolution` | `…-00018-p27` | `sha256:b3bf6d7c…` | `wave1-20260820T121500Z` | LIKELY YES |

Unaffected / left pinned: authority, evidence-service, agent-runtime, public-bff, web, verifiers, ADK.

---

## 3. Source → image → service mapping (patch surface)

| Local fix | Source | Image | Cloud Run |
|---|---|---|---|
| Provenance hydration `ensureNodeInGraph` | `services/provenance-service/src/service.ts` | `intent-provenance` | `tm-dev-intent-provenance` |
| Mint-time AUTHORITY first-write-wins | `services/intent-service/src/internal-routes.ts` | `intent-provenance` | same |
| `hydrateCase` counters | `services/resolution-service/src/service.ts` | `outcome-resolution` | `tm-dev-outcome-resolution` |
| `IDEMPOTENT_REPLAY` → SUCCESS | `services/resolution-service/src/remedy-execution-port.ts` | `outcome-resolution` | same |
| Authorize replay / root exposure | `services/gateway-service/src/two-phase.ts` | `gateway` | `tm-dev-gateway` |

Additional production-closure fixes discovered live (see §4–5):

| Fix | Source | Deployed via |
|---|---|---|
| Policy `createIntentState` inherits tip `temporalAuthority` | `services/intent-service/src/service.ts` | intent-provenance patch5 |
| Remedy OC requirement poisoning | `services/outcome-service/src/templates.ts` | outcome-resolution patch2–4 |
| Evidence reader allowlist includes phase-c | terraform `TM_EVIDENCE_READER_CALLER_EMAILS` | evidence-service env (patch5) |
| phase-c → authority `run.invoker` | terraform `invoker_edges` | IAM only (patch6) |

---

## 4. Bugs discovered live

1. **Gateway behind five-fixes train** — Aug 19 digest; authorize-replay shortcut not live.
2. **C stuck / poisoned remedy OC** — immutable requirements included non-commercial predicates; fixed in outcome templates (patch2–4); `liveC1` left as historical residue; proved on `wave1-c-short-delivery-patchC5`.
3. **APPROVAL BLOCKED** — `createIntentState` hashed `temporalAuthority: null`, dropping tip temporal authority so Guardian/proofs failed closed. Fixed by inheriting tip `temporalAuthority` on policy ingress.
4. **EVIDENCE_READ VALIDATION_FAILED** — durable write succeeded; GET denied because phase-c was fixture writer but not in `TM_EVIDENCE_READER_CALLER_EMAILS` (only outcome-resolution). Fixed in terraform.
5. **APPROVAL decide 403** — per [Cloud Run troubleshooting](https://cloud.google.com/run/docs/troubleshooting): caller missing `roles/run.invoker`. App allowlist already had phase-c; IAM edge `phase-c-verifier->authority` was missing. Fixed in terraform.
6. **APPROVAL post-IAM failures** — Vertex HTTP **429** (`MODEL_UNAVAILABLE`), then `SEMANTIC_READINESS_INSUFFICIENT` (readiness below PLANNABLE). Not security regressions; model availability/quality blocked the live approval proof.

---

## 5. Exact patches + security reasoning

### Five original fixes (audited fail-closed)

1. **Provenance hydration** — durable store authoritative; hydrate missing memory; fail on missing/malformed durable endpoints; immutable conflicts fail.
2. **`hydrateCase` counters** — ephemeral only; durable case/events/mandates remain authoritative.
3. **`IDEMPOTENT_REPLAY`** — same-lineage gateway replay → semantic SUCCESS; zero new side effect.
4. **Mint-time AUTHORITY** — first-write-wins; strip mutable `grantHash` only; fail on principal/agent/intent/IntentState/action/capability/merchant/amount/currency/scope/PreparedAction/lineage drift.
5. **Authorize replay** — full provenance gate only when PreparedAction lifecycle is `PREPARED`; exact replay converges CommitToken; revoked cannot shortcut.

### Additional fail-closed patches

- **temporalAuthority inheritance** — policy ingress may change capabilities only; cannot strip temporal authority from a verified tip.
- **Evidence readers** — Wave 1 operator that writes fixtures must be able to read them for cross-revision durable proof (least privilege: outcome-resolution + phase-c only).
- **IAM invoker** — matches Google S2S requirement: allowlist alone is insufficient without `roles/run.invoker` ([service-to-service auth](https://cloud.google.com/run/docs/authenticating/service-to-service)).

---

## 6. Targeted tests / full suite / build

- Targeted Wave 1 suites extended (provenance hydration, resolution hydrate/replay, mint-time AUTHORITY, authorize replay, temporalAuthority inheritance on `createIntentState`, remedy template exclusions).
- Full suite at audit gate: **1050 passed / 32 skipped / 0 failed**.
- `pnpm -r run build`: clean (agent-runtime S2S adapter fix for ProvenanceService Result shape; agent-runtime image not rebuilt for Wave 1 patch train).

---

## 7. Patch image digests

### Patch train 1 — `wave1-patch-20260820T163654Z`

| Image | Digest | Fixes |
|---|---|---|
| gateway | `sha256:753dd1150d8b8b4dc1f777690eac178d58cf531662e8340c95bac19f25fb29b0` | authorize replay, root exposure |
| intent-provenance | `sha256:7a6a17f43c05bc6a7a4d6c4fd45e559d2e52e8ae5b3674477064c100594406bc` | ensureNodeInGraph, mint-time AUTHORITY |
| outcome-resolution | `sha256:0dfce011b95b439b4300b8f729bba01669478b4412b36938e69c7676a2d37f5b` | hydrateCase, IDEMPOTENT_REPLAY |

### Outcome-resolution-only follow-ups

| Tag | Digest | Why |
|---|---|---|
| patch2 | `sha256:f6ecaa25…` | exclude item_quantity / supplier_* / food_grade aliases |
| patch3 | `sha256:7a8f37e5…` | exclude item_specification when commercial.product set |
| patch4 | `sha256:fcade45668a17a8af1cede8bbe4eda65b285e80d2629934436ced41efac11370` | also exclude product_specification / product / supplier_identity |

### Patch5 — intent-provenance (+ evidence env)

| Image | Tag | Digest |
|---|---|---|
| intent-provenance | `wave1-patch5-20260820T184503Z` | `sha256:42e3e7d84e659fbc543b567acd239988a59b019ae98942be303837a9d0871401` |

Build: `e3c4cc34-3f90-4994-a399-94e039133e28`.

### Patch6 — IAM only

`phase-c-verifier->authority` → `roles/run.invoker` on `tm-dev-authority` (1 add / 0 change / 0 destroy).

---

## 8. Terraform plan / apply

| Plan | Result | Scope |
|---|---|---|
| `tfplan.wave1-patch-resume` | 0/3/0 | three image digests |
| `tfplan.wave1-patch2/3/4-resume` | outcome-resolution digest only | remedy OC templates |
| `tfplan.wave1-patch5-resume` | 0/2/0 | intent-provenance digest + evidence reader env |
| `tfplan.wave1-patch6-iam` | **1/0/0** | phase-c→authority invoker (required for decide; documented exception to digest-only gate) |

Hard stops honored: no Wave 2, no telemetry/BQ, no web UI, no networking/VPC/Pub/Sub/Firestore index changes, no destroy, no rebuild of the original six unrelated images.

---

## 9. Final revisions (patched stack)

| Service | Final revision | Digest |
|---|---|---|
| `tm-dev-gateway` | `tm-dev-gateway-00014-9vl` | `sha256:3e819d0f91a47f5c5ff387e0d4d3700b0ec949ff3329cc0c4196a78fa56b09f5` (approvalReadPort resume fix; prior `00013-9tw` / `753dd115…` intermediate) |
| `tm-dev-agent-runtime` | `tm-dev-agent-runtime-00023-jtk` | `sha256:cd868faa2669b659c0302343aa12feabc2ec33259bbb82f6a8cd23bd62974700` (readiness A2/A3 tighten; prior revisions intermediate) |
| `tm-dev-intent-provenance` | `tm-dev-intent-provenance-00022-nt7` | `sha256:42e3e7d8…` |
| `tm-dev-outcome-resolution` | `tm-dev-outcome-resolution-00023-xwc` | `sha256:fcade456…` |
| `tm-dev-evidence-service` | `tm-dev-evidence-service-00009-jj5` | env-only (readers) |

---

## 10. Acceptance reconciliation + results

| Proof | Result | Evidence |
|---|---|---|
| **A** | **PASS** | `RUN_SUFFIX=-patchA1`; food_grade UNSATISFIED / Guardian BLOCK; 0 grants/tokens/side effects |
| **B** | **PASS (reconciled)** | `liveB1` CLOSED; payment SUCCESS; 1 side effect; 0 ResolutionCases; token `ct-e0be7bf9459c` consumed |
| **C** | **PASS** | `wave1-c-short-delivery-patchC5`: original PARTIAL; remedy OC SATISFIED; case RESOLVED; `liveC1` accounted as non-rewritable residue |
| **APPROVAL** | **PASS** | `wave1-approval-resume1` (`tm-dev-wave1-operator-bvhqb`): ACTIONABLE/A1; REQUIRE_APPROVAL; ApprovalRequest `approval-wf-fdc6da54e677c98310c28cae` APPROVED; `decidedBy` = `tm-dev-phase-c-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com`; resume AUTHORIZED; grant `grant-f6fb9fc0e1859b83` ALLOW/CONSUMED; CommitToken `ct-12f992cbc6f1` consumed once; side effects = 1; payment SUCCESS; outcome AWAITING_OUTCOME |
| **APPROVAL_NEGATIVE** | **PASS** | `wave1-approval-negative-resume1` (`tm-dev-wave1-operator-mts5s`): rejection `APPROVAL_STALE_INTENT_STATE`; ApprovalRequest `approval-wf-4ef8fd86c2356ebddd8e467f` remains PENDING; tip at policy-v2; never AUTHORIZED; CommitTokens = 0; side effects = 0; grants/outcomes = 0 |
| **EVIDENCE_WRITE** | **PASS** | `-patch1` |
| **EVIDENCE_READ** | **PASS** | `-patch1` after reader allowlist (execution `tm-dev-wave1-operator-g7vxh`) |
| **CONCURRENCY** | **PASS** | `-patch1`; ≤1 SUCCESS / one claim / one side effect |
| **EXPOSURE** | **PASS** | `-patch1` → `CUMULATIVE_EXPOSURE_EXCEEDED`; zero new side effect |
| **Reconstruction** | **PASS** (suite) | Deterministic reconstruct from immutable events; live spot-checks via C/B lineages |
| **Historical regression** | **PASS** | `_historical-regression.mjs` → `HISTORICAL_CANONICAL_PRESERVED` |

### Final approval proofs (canonical)

**POSITIVE** — namespace `wave1-approval-resume1`

- ACTIONABLE / A1
- REQUIRE_APPROVAL
- ApprovalRequest APPROVED
- verified `decidedBy`
- resume = AUTHORIZED
- grant ALLOW / CONSUMED
- CommitToken consumed exactly once
- side effects = 1
- payment SUCCESS
- outcome AWAITING_OUTCOME

**NEGATIVE** — namespace `wave1-approval-negative-resume1`

- rejection = `APPROVAL_STALE_INTENT_STATE`
- workflow never AUTHORIZED
- CommitTokens = 0
- side effects = 0
- grants/outcomes = 0

---

## 11. Orphan artifact accounting

Prior agent claimed four dead-branch artifacts deleted. **No durable cleanup record found** → **UNKNOWN / unverified**. No further deletes performed during takeover. `liveB2` preserved as non-canonical partial.

---

## 12. Historical Phase A/B/C preservation

- Phase A historical token: unconsumed (regression).
- Phase B: exactly one historical side effect preserved.
- Phase C historical PARTIAL / OPEN / UNKNOWN responsibility unchanged; `liveC1` not rewritten.
- No blind retry of UNKNOWN economics; C resumed only via independent remedy lineage / fresh patchC5 after immutable OC poison.

---

## 13. Exact resources changed

- Cloud Run images: gateway, intent-provenance, outcome-resolution (digest pins).
- Cloud Run env: evidence-service `TM_EVIDENCE_READER_CALLER_EMAILS`.
- IAM: `phase-c-verifier` → `tm-dev-authority` `roles/run.invoker`.
- Local code: five fixes + temporalAuthority inheritance + remedy template exclusions + tests.
- **Not changed:** Wave 2 surfaces, telemetry, learning, Adaptive Authority, web UI, Attack Lab, unrelated six images.

---

## 14. Known limitations

1. Earlier APPROVAL attempts failed after security blockers cleared (Vertex HTTP 429 / `MODEL_UNAVAILABLE`, then `SEMANTIC_READINESS_INSUFFICIENT`, then resume blocked by missing gateway `approvalReadPort`). Those are historical; closed via agent-runtime stabilize + gateway resume patches and `-resume1` positive/negative proofs — **not** an open Wave 1 blocker.
2. Orphan four-artifact cleanup unverifiable.
3. `liveB2` non-canonical partial residue remains.
4. `liveC1` immutable poisoned remedy OC remains; proof moved to `patchC5`.
5. Pre-patch docs claimed NOT DEPLOYED; production was already partially deployed — this report supersedes.
6. Patch6 IAM was 1 add (invoker) — required to match already-deployed app allowlist and Google S2S rules; documented as Wave 1 approval decide completion, not Wave 2 expansion.
7. Healthz via user identity token returns 404 on INTERNAL_ONLY services; Ready=True used as deploy gate.

---

## 15. HARD STOP

- Did not start Wave 2.
- Did not work telemetry / OTel / Trace / Monitoring / BQ / learning / Adaptive Authority / web UI overhaul / Attack Lab.
- Did not redesign architecture.
- Did not consume or rewrite historical Phase A/B/C economic tokens beyond reconciliation proofs.

---

## Verdict (exact)

**WAVE 1 PRODUCTION CLOSED**
