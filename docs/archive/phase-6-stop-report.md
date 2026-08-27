# Phase 6 Stop Report — Coverage Hardening + Semantic Guardian Committee

**Status:** Complete. Phase 7 not started.

## Repository changes

### Part A — Constraint coverage

- `ConstraintCoverageStatus.DEFERRED` in protocol + Zod schemas
- Research plan fixtures use `DEFERRED` (not `IRRELEVANT`) for food/budget/qty still relevant later
- Plan verifier: economic plans fail on sticky/financial left `DEFERRED` or `IRRELEVANT`
- Delegation firewall: sticky may be absent on `READ_ONLY`; marking sticky `IRRELEVANT` on economic steps fails closed

### Part B — Guardian committee

| Package | Role |
|---------|------|
| `packages/guardian-core` | Binding hashes, `invokeJudge`, deterministic `aggregateGuardianVerdict` |
| `agents/fidelity-judge` | Constraint fidelity vs intent (`judge.fidelity.v1`) |
| `agents/contradiction-judge` | Direct conflicts only (`judge.contradiction.v1`) |
| `agents/devils-advocate` | Strongest refuse reason; no fidelity verdict input |
| `agents/provenance-judge` | Interprets ProvenanceService graph/taint; does not invent edges |
| `agents/evidence-judge` | Evidence sufficiency; cannot upgrade `TrustClass` |
| `agents/guardian` | `evaluateActionProposal` orchestrator + provenance |

Vitest aliases and root `tsconfig` project references updated. CI remains FakeModel-only.

## Protocol deltas

Documented in `docs/architecture/protocol-deltas.md`:

- `PARTIALLY_SUPPORTED`, `GuardianSemanticStatus`, `JudgeId`, `JudgeInvocationStatus`, `ConstraintApplicability`
- Extended `ConstraintClaim`, `JudgeResult`, `GuardianVerdict` (binding hashes, `semanticStatus`, `judgeResults`, `verdictHash`, stale/version maps)
- Optional `ActionProposal.planId` / `planStepId`
- `ProvenanceNodeKind.FINDING`
- Error codes: `GUARDIAN_*`, `UNTRUSTED_INFLUENCE`, `UNSUPPORTED_ASSUMPTION`, `EVIDENCE_INSUFFICIENT`, `ACTION_PROPOSAL_MISMATCH`

## Orchestrator

`evaluateActionProposal`:

1. Validate tip IntentState binding
2. Run five judges in parallel with independent payloads
3. Deterministic aggregate (recommendation only)
4. Record Action → FINDING → DECISION provenance
5. **No** AuthorityService / MockGateway / grants

## Aggregation logic (precedence, not majority)

1. Tip / action hash / IntentState binding mismatches → fail closed
2. Sticky/HARD/FINANCIAL `CONTRADICTED`, or judge-marked `NOT_EVALUABLE` on high-consequence → `CRITICAL_FAILURE` + `BLOCK`
3. `UNTRUSTED_INFLUENCE` → critical BLOCK
4. Required judges (Fidelity, Contradiction, Evidence) unavailable on high-consequence → `GUARDIAN_JUDGE_UNAVAILABLE`
5. Devil’s Advocate HIGH/CRITICAL → at least `REQUIRE_APPROVAL` / `CONFLICTED`
6. Soft preference miss ≠ hard breach; `overallFidelity` diagnostic only; critical dominates
7. Unevaluated sticky on high-consequence cannot emit `CLEAR` (`REQUIRE_APPROVAL`)

## Evidence sufficiency

Evidence judge schema `judge.evidence.v1` assesses relevance/sufficiency; envelopes expose read-only `trustClass`. Unsupported equivalences use `UNSUPPORTED_ASSUMPTION`; gaps use `EVIDENCE_INSUFFICIENT`.

## Taint / provenance

- Untrusted merchant **data** as evidence allowed; data-only taint does not auto-BLOCK
- Instructional influence → Provenance Judge + aggregator → `UNTRUSTED_INFLUENCE` → BLOCK
- External content still cannot create authority (existing INV_003 path)

## Verdict binding

- `actionContentHash`, `evidenceSnapshotHash`, `intentStateId`, optional plan binding
- Tip drift → `GUARDIAN_VERDICT_STALE`
- Proposal content change vs bound hash → `ACTION_PROPOSAL_MISMATCH` / `isVerdictStale`

## SAFE fixtures

- `scenarios/procurement/phase6/` — industrial block, food-grade cert pass
- `scenarios/travel/phase6/` — quiet/party, arrive vs ship, hidden bag fee, near→beachfront
- `evals/guardian-drift/` — injection influence, unsupported rating⇒quiet, judge disagreement

## Tests

- `pnpm test`: **168** passed (was ~149; +Phase 6)
- Coverage includes industrial block, cert pass (no grants), quiet/party, arrive/ship, bag fee, strengthening, injection vs data taint, required-judge fail-closed, stale tip/action, soft≠hard, dependency ban (no gateway/authority-service), DEFERRED≠IRRELEVANT

## Model-failure behavior

Unavailable / schema-invalid judge → `JudgeInvocationStatus` (`UNAVAILABLE` | `SCHEMA_PARSE_FAILED` | …), never positive evidence. High-consequence required-judge failure fail-closed.

## Assumptions

- Judges share `JudgeModelOutputSchema`; orchestrator stamps `judgeId` after model parse
- Single FakeModel with per-`schemaId` handlers is sufficient for CI; optional per-judge ModelPorts supported
- Guardian recommendation is not an AuthorityGrant; Phase 7 gateway will consume verdicts separately

## Semantic conflicts found

- Prior research fixtures used `IRRELEVANT` for deferred economic constraints; corrected to `DEFERRED`
- Untouched default `NOT_EVALUABLE` must not equal judge-asserted insufficiency (aggregator distinguishes via evaluated set)

## Deferred (out of scope)

- Phase 7 Tool Gateway, UPI/AP2, Pub/Sub, Firestore, Cloud Run, frontend, real merchants
- Live Vertex judges (env-gated via `packages/model`; CI FakeModel only)
- Adaptive Authority / learning privilege (must not grant from Guardian scores)
