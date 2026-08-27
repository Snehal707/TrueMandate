# Phase 10 Stop Report — Phase 9 Authority Hardening + Dashboard

**Date:** 2026-08-14  
**Baseline:** 245 green tests (Phase 9 complete)  
**Result:** Phase 9 remediation-mandate hardening + Phase 10 observability dashboard delivered. **265 tests green. Phase 11 not started.**

---

## Phase 9 hardening result

### Semantic boundary
- Added protocol object `RemediationMandate` (ACTIVE | CONSUMED | EXPIRED | REVOKED).
- `RemedyProposal.requiredRemediationMandateId` replaces fake `requiredAuthorityGrantId`.
- Mandate = **scope prerequisite** (case, remedy, amount, merchants, capabilities, expiry). **No `preparedActionHash`.**
- Execution `AuthorityGrant` remains minted only by Gateway AUTHORIZE and must bind exact `PreparedAction.parameterHash` (INV_018).
- Pipeline rejects execution grant id equal to mandate id (`REMEDIATION_MANDATE_NOT_EXECUTABLE`).

### Tests added
- Broad mandate cannot execute arbitrary PreparedAction / out-of-scope merchant
- Execution grant hash binding; mutated parameters fail closed
- Stale/EXPIRED mandate cannot authorize newer remedy
- Mandate cannot be reused across unrelated ResolutionCases

Docs updated: `protocol-deltas.md`, `phase-9-stop-report.md` assumptions.

---

## Repository changes

| Path | Role |
|------|------|
| `packages/read-model` | Pure projectors, redaction, ObservabilityEventPort |
| `packages/dashboard-ui` | Presentational React panels (no trust logic) |
| `services/observability-service` | `DemoRuntime` composing canonical services |
| `apps/web` | Vite + React Intent workspace |
| `apps/attack-lab` | Vite + React Attack Lab + Phase 11 placeholder |

Workspace: `apps/*` added to `pnpm-workspace.yaml`.

---

## Read model architecture
- Projectors map canonical objects → view DTOs; **never mutate** stores.
- Status labels (AUTHORIZED, PARTIAL, AT_RISK, …) come from canonical fields only.
- Payment status and outcome state projected separately.
- Redaction strips credentials/tokens/secrets before UI.

## Dashboard pages
- `apps/web`: Intent workspace (mandate, constraints + grounding, plan, guardian, authority, execution, outcome, resolution, graph, timeline).
- Approval panel: APPROVE/REJECT only via `DemoRuntime.submitApproval` → `ApprovalArtifact`.

## Intent Provenance Graph
- Nodes/edges from `ProvenanceService.getGraph()` only.
- Filters: semantic, authority, external, tainted, execution, outcome, resolution, critical.
- **Trace to Human** walks inbound provenance relations to PRINCIPAL.
- Bounded default node count.

## Guardian / Authority / Execution / Outcome / Resolution
- Judges listed independently; aggregator shown separately (not majority vote).
- Authority panel states Guardian recommends / Authority decides / Gateway enforces.
- Execution: two-phase phases; UNKNOWN ≠ FAILED (pending reconciliation, blocked retry).
- Outcome: payment SUCCESS + PARTIAL/AT_RISK requirements.
- Resolution: divergence ≠ hypothesis ≠ responsibility; UNKNOWN blame honesty; remedy comparison by restoration.

## Attack Lab
- Scenario picker over SAFE attack classes (semantic drop, injection, TOCTOU, UNKNOWN, partial, false blame, AT_RISK, stale state, exposure, authority expansion).
- Fixture-backed demo seeding via `DemoRuntime`.
- Phase 11 Gemini vs TrueMandate placeholder only.

## Live events
- `ObservabilityEventPort` + `InProcessObservabilityBus` with dedupe keys (Pub/Sub-ready interface).

## Demo scenarios
1. Procurement 450/500: payment SUCCESS, outcome PARTIAL, ResolutionCase OPEN, responsibility UNKNOWN.
2. AT_RISK delivery: ETA after deadline before breach.

## Tests
- Keep prior suite green; add read-model, remediation-mandate, DemoRuntime, dashboard-ui tests.
- Frontend cannot mint grants or resolve cases (`forbidDirect*` guards).

## Assumptions
- Phase 10 uses in-process DemoRuntime (no HTTP BFF yet); same ports later bind HTTP/Pub/Sub.
- Vite + React chosen for `apps/web` and `apps/attack-lab`.
- Graph visualization is list/structured (not a full canvas force-layout).

## Deferred (Phase 11+)
- SAFE benchmark runner and leaderboard claims
- Live external payments
- Firestore / Pub/Sub / Cloud Run (Phase 12)
- Rich canvas graph rendering polish

**Stop. Do not begin Phase 11 until explicitly approved.**
