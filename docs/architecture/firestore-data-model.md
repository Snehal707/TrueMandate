# Firestore Data Model (Phase 12)

Logical collections (immutable history separate from current-state projections):

| Collection | Role |
|------------|------|
| `intents` / `intentStates` / `intentTips` | Intent lineage + tip pointer |
| `authorityGrants` | Grants (consume/revoke TX) |
| `commitTokens` | Single-use CommitTokens |
| `nonces` | Replay protection |
| `idempotencyRecords` | Economic write idempotency (UNKNOWN fail-closed) |
| `exposureReservations` | Cumulative exposure entries + indexes |
| `economicReservations` | UNKNOWN reconciliation locks |
| `sideEffects` | Append-only privileged ledger |
| `provenanceNodes` / `provenanceEdges` | Append-only provenance |
| `outcomeContracts` / `outcomeEvents` | Outcome state + events |
| `resolutionCases` / `resolutionTriggers` | Cases + trigger dedupe |
| `remediationMandates` / `approvals` | Mandates + ApprovalArtifacts |
| `evidenceArtifacts` / `evidenceClaims` | Evidence metadata |

## Transactional operations

Atomic TX required for: CommitToken consume, Grant consume, nonce register, exposure reserve/reconcile, idempotency begin/complete, mandate consume, resolution trigger dedupe, OutcomeEvent dedupe.

Package: `@truemandate/cloud-firestore` (`MemoryTransactionalStore` for CI; production DocumentStore over `@google-cloud/firestore`).
