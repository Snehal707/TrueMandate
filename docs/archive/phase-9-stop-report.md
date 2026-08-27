# Phase 9 Stop Report — Phase 8 Hardening + Resolution Engine

**Date:** 2026-08-14  
**Baseline:** Phase 8 stop report (~210 green tests)  
**Result:** Phase 8 hardening completed; Phase 9 Resolution Engine delivered. **Phase 10 not started.**

---

## Part A — Phase 8 hardening

### A1. Outcome binding fail-closed by default
- `TwoPhaseGateway` uses `TwoPhaseGatewayOptions` with **required** `outcomeBinding: OutcomeContractBindingPort`.
- Binding enforced from **tool privilege class** (T2/T3), not optional DI.
- Missing/failed binding → `OUTCOME_CONTRACT_REQUIRED` / `OUTCOME_CONTRACT_STALE`.
- Test-only escape: `TwoPhaseGateway.createForUnboundLegacyTests(...)` (Phase 3/7 harness only).
- T0 tools unaffected; T1 policy: no outcome binding unless later marked economic.

### A2. Non-circular staged cryptographic binding
- `OutcomeContractDefinition` → `definitionHash`; PA `parameterHash` hashes parameters only.
- `preparedActionHash` excluded from binding digest.
- Documented in `docs/architecture/protocol-deltas.md`.
- Tests: determinism, mutation sensitivity, no mutual inclusion cycle.

### A3. Resolution trigger identity / dedupe
- `triggerIdentity = H(canonical({ contractId, triggerKind, conditionKey }))`.
- Emitted on PARTIAL / AT_RISK / BREACHED / EVIDENCE_CONFLICT.
- Outcome event dedupe key `trigger:${triggerIdentity}`; ResolutionCase open is idempotent per unresolved identity.

---

## Part B — Phase 9 Resolution Engine

### Packages / services

| Path | Role |
|------|------|
| `packages/resolution-core` | Transitions, bounds, case builder, evidence/remedy planners, INV_010 re-export |
| `services/resolution-service` | Case store, events, evidence/remedy lifecycle, child cases, `executeRemedyPipeline` |
| `agents/resolution-agent` | Findings-only ModelPort; cannot mutate contracts/grants/gateway |

### Protocol / schema
- Full `ResolutionCaseState` machine with fail-closed transitions.
- `CausalTimelineEvent`, `ResponsibilityHypothesis`, `EvidenceRequest`, extended `RemedyProposal`, `ResolutionEvent`.
- `ResponsibilityState.POSSIBLE`; `RootCauseCode` taxonomy.
- Error codes: `RESOLUTION_*`.

### Case builder + causal timeline
- Reconstructs from IntentState, OutcomeContract, outcome events — no invented narrative.
- First divergence (e.g. quantity 450 vs 500) stored distinct from root-cause hypothesis.
- Merchant/warehouse quantities remain claims until elevated.

### Hypotheses / false-blame / evidence
- Single-party accusation cannot reach ESTABLISHED.
- EvidenceRequestPlanner prefers discriminating, independent, timely reads.
- ResolutionAgent rejects invented event IDs; model unavailable fails closed.

### Remedy path (no fast lane)
```
RemedyProposal → independent authority (INV_010) → remedy OutcomeContract
  → PrivilegedRemedyPort / TwoPhaseGateway prepare→authorize→commit
  → tool SUCCESS → VERIFYING_REMEDY (≠ RESOLVED)
  → remedy OC SATISFIED or human variance → RESOLVED
```
- Original purchase grant cannot fund remedy.
- Cumulative remediative exposure bounded; excess → ESCALATED.
- Child case on failed remedy; parent stays unresolved; original OC immutable.
- Human accepted variance records event; does not rewrite original requirements.

### Bounds
- max remedy attempts, economic exposure, recursion depth, evidence requests → ESCALATED.

### Fixtures
- `scenarios/procurement/phase9/` A–D
- `evals/resolution/phase9-scenarios.json`

### Tests
- Phase 8 binding + staged hash + trigger identity (kept green)
- Phase 9 resolution-service scenarios A–D+, AT_RISK, refund verify, false blame, exposure, recursion
- Gateway `phase9-remedy.test.ts` (real TwoPhaseGateway path)
- resolution-core property tests: transitions, authority isolation, recursion/exposure bounds

---

## Assumptions
- In-process OutcomeEventBus remains the Pub/Sub port until infrastructure phase.
- `PrivilegedRemedyPort` is the resolution→gateway seam; production wires `TwoPhaseGateway`.
- **RemediationMandate** is a scope prerequisite (case/remedy/amount/merchant/capability bounds). It is **not** an execution `AuthorityGrant` and has no `preparedActionHash`.
- Gateway AUTHORIZE mints the only executable grant, bound to exact `PreparedAction.parameterHash` (INV_018). Mandate id must never equal execution grant id.
- Child trigger identities append `:d{depth}` to avoid colliding with parent unresolved identity.

## Deferred (Phase 10+)
- Dashboard and live Intent Provenance Graph (Phase 10)
- Golden benchmark suite expansion (Phase 11)
- Cloud Run / Pub/Sub / Firestore / Vertex / ADK deployment (Phase 12)

**Stop. Do not start Phase 10 until the user continues the build.**
