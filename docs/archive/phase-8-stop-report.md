# Phase 8 Stop Report — Outcome Contract Engine (+ Phase 7 Hardening)

**Date:** 2026-08-14  
**Baseline:** Phase 7 stop report (185 green tests)  
**Result:** Phase 7 hardening + Phase 8 Outcome Contract Engine delivered. Phase 9 (Resolution Engine) not started.

## Phase 7 hardening results

### A1. Single canonical privileged path
- `MockGateway.executeMockPayment` is fail-closed (`TOOL_PRIVILEGE_DENIED`).
- Phase 3 integration tests use `TwoPhaseGateway` via `prepareAuthorize` / `executePrivilegedPayment`.
- Invariant: successful T2 side effect records a `SideEffectRecord` with consumed `CommitToken`.

### A2. UNKNOWN locks authority and reserves exposure
- `GrantConsumptionState.PENDING_RECONCILIATION` locks grants on UNKNOWN.
- Exposure reserved as `IN_FLIGHT`; blocks salami and re-issue of CommitTokens for the same prepared hash (`RECONCILIATION_REQUIRED`).
- `TwoPhaseGateway.reconcileUnknownExecution({ sideEffectOccurred })` releases or commits reservation deterministically.
- Prepared hashes become non-reusable after reconciliation.

### A3. Execution vs outcome provenance
- `ProvenanceNodeKind.EXECUTION` and `SIDE_EFFECT` added.
- `OUTCOME` reserved for OutcomeContract/outcome verification provenance.

## Phase 8 Outcome model

| Component | Role |
|-----------|------|
| `packages/outcome-core` | Predicates, aggregation, transition validator, criticality lock, payment integration (INV_009) |
| `services/evidence-service` | Append-only envelopes/claims, freshness, independence, conflict detection, `OutcomeEventBus` |
| `services/outcome-service` | Contract lifecycle, payment/UNKNOWN integration, observations, transitions, Phase 9 trigger events (no remedies) |
| `agents/outcome-verifier` | ModelPort semantic findings only; never mutates criticality or contract state |

### Binding (INV-style)
- T2/T3 prepare/commit require `outcomeContractId` + `outcomeContractHash` when `OutcomeService` is injected / `enforceOutcomeBinding` is true.
- Payment SUCCESS → at most `AWAITING_OUTCOME`, never `SATISFIED`.
- UNKNOWN execution → stay `AWAITING_EXECUTION`; never treat as purchase success.

### Aggregation policy
- SAFETY_CRITICAL / HARD BREACHED → contract cannot be SATISFIED (`criticalFailure`).
- Independent HARD disagreement → `CONFLICTED`.
- Insufficient independence/freshness → `AWAITING_EVIDENCE` / `EVIDENCE_STALE` / `EVIDENCE_NOT_INDEPENDENT`.
- Soft misses ≠ critical breach.
- Model unavailable → fail closed for semantic HARD requirements.

### AT_RISK / partial / breach
- Partial quantity → requirement + contract `PARTIAL` while recoverable; payment remains SUCCESS.
- Deadline ETA after deadline before deadline date → `AT_RISK` + `OUTCOME_AT_RISK` signal.
- Emits `OUTCOME_PARTIAL`, `OUTCOME_BREACHED`, `EVIDENCE_CONFLICT` for Phase 9 (no autonomous remedies).

## Fixtures
- `scenarios/procurement/phase8/` A–D
- `scenarios/travel/phase8/E_delivery_at_risk.json`
- `evals/outcome/phase8-scenarios.json`

## Tests
- Gateway Phase 3/7/7-hardening + Phase 8 binding
- Outcome-service scenarios A–E, UNKNOWN, quiet-hotel semantic, transition/dedupe/evidence
- outcome-core aggregation / criticality / transition properties
- Full suite green after schema registry update

## Assumptions
- Outcome binding is enforced when `OutcomeService` is wired into `TwoPhaseGateway`; Phase 7 tests remain unbound for backward compatibility.
- In-process `OutcomeEventBus` is the Pub/Sub port until infrastructure phase.
- Semantic verifier returns findings only; outcome-service applies deterministic aggregation.

## Deferred (Phase 9+)
- Resolution Engine, causal responsibility, autonomous remedies/refunds
- Frontend, Pub/Sub/Firestore/Cloud Run deployment
- Persistent multi-instance grant/exposure/reservation stores

**Do not start Phase 9 until the user continues the build.**
