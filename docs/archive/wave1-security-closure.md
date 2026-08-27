# Wave 1 — Final Security Closure Audit (2026-08-19)

**LOCAL ONLY. NOT DEPLOYED.** Suite: **1024 passed / 32 skipped / 0 failed**. Full workspace build: clean.

---

## 1. IntentState.capabilities — security finding

### Origin trace

| Stage | Answer |
|---|---|
| **source** | Owner policy only. The ONLY production write paths are `IntentService.createIntentState` and `IntentService.finalizeVerifiedCompilation` (both accept an OPTIONAL `capabilities` input). |
| **producer** | The intent owner (human/enterprise policy pipeline). **The model pipeline cannot set it**: the `/internal/compilations/finalize` route calls `finalizeVerifiedCompilation` WITHOUT capabilities, and `CandidateInterpretation` has no capabilities field (strict schema). |
| **schema** | `IntentStateSchema.capabilities: z.record(AuthorityDecisionSchema).optional()`; `CandidateInterpretationSchema` is strict and has NO capability field; the workflow request schema is strict with NO capability field. |
| **validator** | zod strict schemas at every boundary; `hashCanonical` covers `capabilities` in `stateHash` (undefined keys dropped → historical states hash-identically). |
| **persistence owner** | intent-service (intentStates collection; `finalizeState`/`putState`). |
| **consumers** | `ProcurementWorkflowCoordinator` only — derives `execute_payment` permission = `state.capabilities?.execute_payment ?? ALLOW` into the ACTION's authorityRequest scope. |
| **authority consumers** | `AuthorityService.evaluateAuthorityRequest` (deterministic scope checks incl. amount/merchant/exposure) → EvaluationRecord → `mintGrantFromEvaluation` (PreparedAction/scope hash equality against the evaluated scope + fresh-tip revalidation). |

### Can any untrusted actor expand privilege? **No.**

| Attacker | Mechanism attempted | Result (tested) |
|---|---|---|
| Gemini / compiler | injects `capabilities` into the candidate output | **strict schema rejects the candidate** → compilation fails closed, no IntentState, no authority (`capability-injection.test.ts`) |
| Planner | injects permission-like fields into plan steps | **strict plan shape fails** → run errors, zero evaluations, zero side effects |
| External caller | injects `capability`/`capabilities` into the workflow request | **strict schema rejects** → `SCHEMA_PARSE_FAILED` |
| Merchant content | capability-suggesting strings in merchant/product/delivery-terms content | content binds only as SCOPE VALUES (allowedMerchants, terms) — permission stays REQUIRE_APPROVAL → `AWAITING_APPROVAL`, zero side effects |
| Stale IntentState | pins a superseded state whose permission was broader (ALLOW) while the tip is REQUIRE_APPROVAL | **tip revalidation** fails → `GRANT_INTENT_STATE_MISMATCH`, zero evaluations |
| Evidence content | evidence values feed obligations/claims only | no capability surface |
| Another agent | agentId is server-fixed ("agent-runtime"/"resolution-service") | no self-elevation path |

### Invariant

**model-requested capability ≠ authoritative capability grant** holds STRUCTURALLY: the model/planner/caller surfaces carry no capability field at all; the permission is owner-policy-derived; the Authority grant's scope is hash-bound to the evaluated scope which is hash-bound to the ACTION artifact which binds the state-derived permission. Privilege is ultimately bounded by deterministic trusted policy (state → scope → evaluation → grant). The `?? ALLOW` default preserves the pre-existing bounded-ALLOW coordinator framing for historical fixtures (Phase A/B/C untouched) — scope still bounded by amount/merchant checks downstream. Negative tests: 6/6 passing.

---

## 2. Remedy mandate concurrency — result

### Mandate state machine implemented

```
ACTIVE ──claim(mandateId, idempotencyKey K)──▶ CLAIMED ──SUCCESS──▶ CONSUMED (terminal)
   ▲                                              │
   │                                              ▼ (FAILED / UNKNOWN)
   └──────────── release(K only) ◀────────── RELEASED (tombstone)
```

- **Claim slot**: durable single-slot per mandate (`mandateClaims` collection, `putIfAbsent(mandateId, claim)`), plus a process-local registry. Atomic arbiter = the durable `putIfAbsent`.
- **Same attempt (same deterministic key `remedy:<caseId>:<remedyId>`)**: CONTINUATION — converges on identical grant/token identities.
- **Different attempt while CLAIMED**: `REMEDIATION_MANDATE_INVALID` before any economic state exists.
- **FAILED/UNKNOWN**: `releaseMandateClaim(mandateId, K)` — released back to its OWN attempt only; a different key stays rejected (tombstone), so no unsafe blind retry.
- **CONSUMED**: terminal — the pipeline's mandate validation rejects any further execution.

### Parallel test result (genuinely parallel `Promise.all`, not sequential replay)

- Two parallel `executeRemedyPipeline` runs against the same mandate → **exactly one SUCCESS economic execution**; the other does not pass.
- Side-effect ledger: original purchase + **exactly one remedy side effect** (remedy-counterparty entries = 1).
- **Exactly one consumed CommitToken**; a third execution after consumption fails 400.
- Claim-slot semantics verified separately: foreign key rejected while CLAIMED; identical key continues; release → foreign key still rejected.

### Protection chain (complete)

1. Single-slot atomic mandate claim (ACTIVE → CLAIMED) — fail-fast before economic state.
2. Deterministic evaluation/grant/token identities (same case+remedy → same ids) — attempts converge, never diverge into separate economic lanes.
3. Grant store put-if-absent (idempotent same-hash; divergent hash rejected).
4. CommitToken single-use consume.
5. Gateway idempotency record (TX-serialized begin) → second commit = IDEMPOTENT_REPLAY.
6. Side-effect ledger dedupe (one entry per execution id).

---

## 3. Remedy + cumulative exposure — result

### Fix

`TwoPhaseGateway.commit` now accepts `rootExposure: {relatedGroupId, threshold}`. The gateway COMMIT route, for remedy-flagged PreparedActions, reads the **root budget from the authoritative IntentState budget/FINANCIAL constraint** (never caller-supplied) and reserves BOTH:
- the remediation-specific group `remedy:<mandateId>:<currency>` (threshold = mandate maxAmount), and
- the **root related group `<intentId>:<currency>`** (threshold = root policy budget).

All release/commit paths mirror both entries; if the root reservation fails, the mandate-scoped reservation is released and nothing else is touched. **Fail closed**: a remedy without an authoritative root budget constraint is rejected at the route.

### Adversarial test

Original purchase committed 742000 against the root group; prior remedies driven root cumulative exposure to 796000 (each individually valid at 6000). One more 6000 remedy → 802000 > 800000 → **CUMULATIVE_EXPOSURE_EXCEEDED**, zero remedy side effects, zero token consumption, mandate stays ACTIVE (reconciliation possible, blind re-execution not). Legitimate replacement semantics preserved (acceptance C still RESOLVED, combined 500).

---

## 4. Unsafe-supplier acceptance path — explanation

**"0 evaluations" means**: the Authority owner was never consulted — no `AuthorityRequest` reached it, no `EvaluationRecord` was created, no grant, no CommitToken, no side effect. The workflow's deterministic obligation proofs mark the supplier-approval obligation **UNSATISFIED** (Guardian proof trail durable in the PROOF artifacts), which makes the action **ineligible** (`eligible=false`) and terminates at `BLOCKED` **before** `authority.evaluateProcurement`.

**Is this the correct architecture? Yes.** The Semantic Guardian is the fail-closed gate: an action with unsatisfied HARD obligations must never be shaped into an AuthorityRequest — evaluating it would fabricate an authority record for an ineligible action. The spec's "Authority Denied" is therefore represented as **"no authority request created because Guardian made the action ineligible"** — the durable Guardian + PROOF records ARE the authority-denied evidence. No meaningless BLOCK-evaluation artifacts were created to satisfy wording.

**Acceptance A evidence** (asserted): state `BLOCKED`; 0 side effects; **0 evaluations**; ≥1 UNSATISFIED proof; Guardian verdict recorded; zero mints/tokens (implied by 0 evaluations + 0 side effects — mints/tokens cannot exist without an evaluation).

---

## 5. All 32 skipped tests — classification

All 32 skips are `describe.skipIf(!FIRESTORE_EMULATOR_HOST)` in `packages/cloud-firestore/src/*-emulator-races.test.ts`. They RUN when the emulator is up (dedicated runner `scripts/cloud/run-firestore-emulator-races.mjs`). None is a legacy fixture skip; none is silently disabled.

| Suite (count) | Subjects | Classification |
|---|---|---|
| evaluation-record-emulator-races (8) | evaluation create-once, divergent create fail-closed, tamper rejection | environment-conditional; **security-relevant logic now also covered by deterministic tests** |
| execution-provenance-emulator-races (4) | provenance replay/divergence/tamper | environment-conditional; deterministic equivalents in gateway/provenance suites |
| firestore-emulator-races (11) | CommitToken consume race, idempotency UNKNOWN lock, exposure bound, grant revoke race, nonce replay, putIfAbsent | environment-conditional; **deterministic equivalents added** (`parallel-single-use.test.ts`) |
| outcome-contract-emulator-races (4) | contract create-once, binding divergence | environment-conditional; deterministic equivalents in outcome suites |
| preexecution-emulator-races (6) | PreparedAction/grant/token persistence races | environment-conditional; **deterministic equivalents added** |

**Wave 1 production-critical subjects with RUNNING deterministic equivalents (new `services/gateway-service/src/parallel-single-use.test.ts`, all emulator-free, 4/4 passing):**
- two parallel COMMIT on one CommitToken → exactly one SUCCESS, one side effect, token consumed
- parallel identical grant persistence → one grant; divergent → `PREPARED_ACTION_HASH_MISMATCH`
- parallel exposure reservations beyond a bound → at most the bound, one `CUMULATIVE_EXPOSURE_EXCEEDED`
- PreparedAction canonical record

Plus the mandate claim state machine + parallel remedy execution (`remedy-concurrency.test.ts`, 2/2 passing) covering ApprovalRequest/remediation/CommitToken/idempotency/side-effect-ledger subjects at the Wave-1 flow level.

**Production-critical skipped-test count: 0** — every Wave-1-critical race has a deterministic test that actually runs; the emulator suites remain as transport-layer TX verification (enable `FIRESTORE_EMULATOR_HOST` to run them).

---

## 6. Acceptance B — complete evidence (all asserted, not just reported)

| Item | Value |
|---|---|
| controlled purchase side effect | **exactly 1** (SUCCESS) |
| payment | **SUCCESS** (contract paymentStatus) |
| quantity | requirement `quantity_received` SATISFIED, value **500** |
| food-grade evidence | `food_grade` requirement **SATISFIED** (certificate_valid claim) |
| supplier approved | `supplier_approved` requirement **SATISFIED** (merchant match) |
| amount | grant amount **742000 ≤ 800000** |
| Outcome | **SATISFIED → CLOSED** |
| ResolutionCase | **none** (by-contract read fails) |
| CommitToken | **consumed exactly once** |
| replay | commit replay → idempotent, **0 additional side effects** (ledger stays 1) |

---

## 7. wave1-verifier classification

**Test/acceptance-only. NOT a production runtime service.** It orchestrates owner routes in-process with FakeModels and fixtures; it owns no data, no routes, no Firestore collections of its own. Deployment plan: **do not deploy as a permanent Cloud Run service** — run locally / CI / as an operator verifier against deployed endpoints if desired. **No Terraform ownership exists or will be added.** It is already excluded from producing deployable artifacts beyond its source (build emits fixture/run modules only, no server bin).

---

## 8. Infrastructure delta recheck (verified against owners)

**Services requiring a new image when this wave is deployed:**
1. `authority-service` — approval routes, remedy-evaluations route, approval-unlock gate, resolution S2S port.
2. `resolution-service` — remedy routes, production remedy port, durable mandates/claims/events, close route, approval-read port.
3. `gateway-service` — prepare approval-unlock, remedy exposure group + root exposure reservation.
4. `evidence-service` — durable read-through, wave1- fixture namespace.
5. `agent-runtime` — REQUIRE_APPROVAL workflow branch + resumption.
6. `public-api` (BFF) — approval/resolution SDK routes.

**Env vars (new):**
- `TM_WAVE1_VERIFIER_CALLER_EMAIL` — resolution-service (remedy routes + reads), authority-service (resolution reads caller, if the verifier drives remedy evaluations live), public-api (optional).
- `TM_WAVE1_FIXTURE_CALLER_EMAIL` — evidence-service fixture writer (idPrefix `wave1-`).
- `TM_COMMIT_CALLER_EMAIL` / gateway commit allowlist must include the **resolution service identity** (it now commits remedies) — config-level, not IAM.

**Firestore collections (dynamic — no Terraform):** `approvalEvents`, `resolutionEvents`, `remediationMandates`, `mandateClaims` (new this audit). All key-by-id access; no composite indexes required.

**IAM:** no new service accounts — existing internal-caller identities are reused. **Pub/Sub:** no new topics/subscriptions. **Cloud Run:** no new services (wave1-verifier NOT deployed). **No Terraform changes expected** — env additions go through the existing Cloud Run service env blocks.

---

## Wave 1 production-safety verdict

**SAFE TO PROCEED TO DEPLOYMENT PLANNING** (deployment itself remains HARD-STOPPED): capability policy is model-injectable nowhere and bounded by deterministic trusted policy; the remedy mandate has an atomic single-slot claim state machine with genuinely parallel single-execution proof; remedies cannot evade root cumulative exposure; the unsafe-supplier path is a documented fail-closed Guardian-terminated architecture with durable proof; acceptance B carries complete evidence; no Wave 1-critical security test remains skipped without a running deterministic equivalent; the verifier is classified acceptance-only with zero production ownership; the infra delta is env/collection-only with no unmanaged infrastructure.

**Files changed in this audit:** `packages/cloud-firestore/src/{document-store,repositories,index}.ts` (mandateClaims), `services/resolution-service/src/service.ts` (claim state machine), `services/resolution-service/src/remedy-pipeline.ts` (claim/release wiring), `services/gateway-service/src/two-phase.ts` (rootExposure), `services/gateway-service/src/internal-routes.ts` (remedy root budget derivation), `services/wave1-verifier/src/{run.ts, capability-injection.test.ts, remedy-concurrency.test.ts, remedy-exposure.test.ts, wave1-acceptance.test.ts}`, `services/gateway-service/src/parallel-single-use.test.ts`, this report.

**Final counts:** tests 1024 passed / 32 skipped (all emulator-environmental, equivalents running) / 0 failed. `pnpm -r run build`: 0 errors.

**HARD STOP. DO NOT DEPLOY.** No telemetry, BigQuery, Learning, Adaptive Authority, external workflow, or UI work started.
