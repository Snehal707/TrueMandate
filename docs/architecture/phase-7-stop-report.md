# Phase 7 Stop Report — Two-Phase Tool Gateway

**Status:** Complete. Phase 8 not started.

## Repository changes

### Phase 6 hardening (prerequisite)

- Constraint criticality locked to IntentState (`assertCriticalityIntegrity`)
- `GuardianVerdict.intentStateHash` binding + richer `isVerdictStale`
- Tests: judge cannot soften HARD/SAFETY_CRITICAL; unavailable/schema-failed judges never improve verdicts

### Phase 7 packages / services

| Path | Role |
|------|------|
| `packages/tool-registry` | Deterministic Tool Registry (T0–T3); capability visibility |
| `packages/side-effect-ledger` | Append-only Side Effect Ledger |
| `packages/authority` | Guardian gate, ApprovalArtifact, CommitToken issue/store, extended TOCTOU |
| `services/authority-service` | `evaluatePrivilegedAuthority`, approval-gated grants, CommitToken issuance |
| `services/gateway-service` | `TwoPhaseGateway` PREPARE/AUTHORIZE/COMMIT + `MockPaymentAdapter` |
| `scenarios/procurement/phase7/` | SAFE fixtures A–G |

Legacy `MockGateway.executeMockPayment` retained for Phase 3 regression (uses `markUnknown` with `ExecutionState.PENDING`).

## Protocol changes

- `ToolPrivilegeClass`, `ApprovalDecision`, `ReconciliationState`, `ExecutionState.PENDING`
- Extended `PreparedAction` / `CommitToken` binding fields
- `ApprovalArtifact`, `ToolDescriptor`, `SideEffectRecord`, `MaterialExternalSnapshot`
- Error codes: `TOOL_*`, `APPROVAL_*`, `SEMANTIC_GATE_BLOCKED`, `GUARDIAN_VERDICT_REQUIRED`, `RECONCILIATION_REQUIRED`, …

See `docs/architecture/protocol-deltas.md`.

## Tool Registry

Trusted config only. Agent-claimed privilege cannot elevate above registry class. Search-only agents see T0 tools; `payment.execute` requires `execute_payment`. Gateway still enforces on direct invoke.

## PREPARE flow

Normalize commercial params → validate GuardianVerdict binding (tip, intentStateHash, action hash) → registry resolve tool → capture material external snapshot → immutable PreparedAction with idempotency key / expiry. **No side effect.**

## Authority evaluation

Consumes GuardianVerdict as one input; independently validates binding/freshness + semantic gate:

- CRITICAL_FAILURE / BLOCK → BLOCK
- CONFLICTED (high-consequence) → BLOCK
- UNCERTAIN → REQUIRE_APPROVAL / ALLOW_WITH_MONITORING (no silent full economic ALLOW)
- CLEAR → further scope/exposure checks

Guardian ALLOW never forces Authority ALLOW. Cumulative exposure still blocks (scenario G).

## CommitToken design

Issued only after grant mint; binds grant, PreparedAction hash, IntentState hash, agent, capability, nonce, expiry, `tokenHash`. Single-use via atomic `CommitTokenStore.consume`. Revoked grant blocks commit even with prior token.

## COMMIT flow

Revalidate: Intent tip, PreparedAction expiry + parameter integrity (INV_017), Guardian freshness, `validateCommit` (grant/token/TOCTOU/idempotency/nonce/bundle), agent/capability/currency/amount/merchant/exposure, provenance privileged path → consume token → adapter → ledger → consume grant on SUCCESS.

## TOCTOU

Material fields: merchant, product, quantity, amount, currency, refundability, deliveryTerms, certificationRef, counterparty, sku. Non-material (e.g. `pageViewCount`) ignored.

## Idempotency / UNKNOWN

States: PENDING → SUCCESS | FAILED | UNKNOWN. SUCCESS replay returns prior result. UNKNOWN → `UNKNOWN_EXECUTION_CANNOT_RETRY` + reconciliation required. FAILED before side effect may retry (begin resets FAILED→PENDING).

## Side Effect Ledger

Append-only records for privileged attempts (executionId, PreparedAction, CommitToken, grant, tool, amounts, idempotency key, result, external ref, reconciliation).

## Capability-based tool visibility

`listVisibleTools(capabilities)` filters registry. Defense in depth only — commit still enforces.

## Provenance additions

Execution + side-effect OUTCOME nodes linked from Action via RESULTED_IN. Full semantic→authority→execution chain reconstructable with prior Phase 3–6 nodes.

## Tests and results

`pnpm test`: **185 passed** (was 168; +hardening +Phase 7).

Coverage includes scenarios A–G, Guardian BLOCK, TOCTOU, non-material ignore, UNKNOWN no-retry, revoke, stale verdict, Search Agent deny, privilege elevation deny, exposure, single-use race, property mutations of prepared fields.

## Concurrency

In-memory GrantStore / CommitTokenStore use compare-and-set style consume. **Future requirement:** persistent transactional consumption across instances (document here — not implemented).

## SAFE fixtures

`scenarios/procurement/phase7/*.json` for valid execution, TOCTOU, UNKNOWN, revocation, stale guardian, capability misuse, cumulative exposure.

## Assumptions

- Phase 3 `executeMockPayment` remains a parallel path without CommitToken for backward compatibility; new code should use `TwoPhaseGateway`
- Compensation/refund requires a new privileged prepare/authorize/commit (no free authority on FAILED)
- Payment SUCCESS is not task completion (no Outcome Contract)

## Intentionally deferred (Phase 8+)

- Outcome Contract engine / Resolution
- Real UPI or payment APIs
- Cloud Run, Firestore, Pub/Sub
- Frontend approval UX
- Multi-instance persistent grant/token transactions
