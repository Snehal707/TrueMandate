# Persistence Abstractions (Phase 2 hardening / Phase 3)

## Ports

| Port | Package | Memory implementation |
|------|---------|------------------------|
| `NonceStore` | `@truemandate/crypto` | `InMemoryNonceStore` |
| `IdempotencyStorePort` | `@truemandate/crypto` | `InMemoryIdempotencyStore` |
| `GrantStore` | `@truemandate/authority` | `InMemoryGrantStore` |
| `ExposureLedger` | `@truemandate/authority` | `InMemoryExposureLedger` |
| `CommitTokenStore` | `@truemandate/authority` | `InMemoryCommitTokenStore` |
| `SideEffectLedger` | `@truemandate/side-effect-ledger` | `InMemorySideEffectLedger` |

Phase 3 services **must depend on these ports**, not on process-local Maps directly (except when constructing memory adapters for tests).

## What is NOT production-safe today

The in-memory implementations are **single-process, non-durable, and not multi-instance safe**:

- `InMemoryNonceStore` — nonce reuse can succeed on another replica
- `InMemoryIdempotencyStore` — duplicate economic writes possible across instances
- `InMemoryGrantStore` — revocation on one instance is invisible to others
- `InMemoryExposureLedger` — cumulative exposure can be undercounted across instances
- `InMemoryCommitTokenStore` — single-use consume is not cross-instance atomic (needs persistent TX)
- `InMemorySideEffectLedger` — not durable across restarts
- Intent / provenance service memory repositories (Phase 3) — same limits

Do **not** treat these as production persistence. Phase 12 provides `@truemandate/cloud-firestore` adapters implementing the same ports (`TM_PERSISTENCE=firestore`). CI uses `MemoryTransactionalStore` with Firestore-compatible transactional semantics; live Firestore emulator/GCP is optional.

## Fail-closed expectations for durable adapters

Durable adapters must preserve:

- nonce single-use
- UNKNOWN execution cannot blind-retry
- grant revocation / consumption visible at execution/commit time
- cumulative exposure aggregation for related groups
