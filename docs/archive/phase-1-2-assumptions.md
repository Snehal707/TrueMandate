# Phase 1–2 Assumptions

These assumptions fill specification gaps for the deterministic trusted core. They do not weaken security invariants.

## Tooling

- Monorepo tool: **pnpm workspaces** with TypeScript project references and **Vitest**.
- Package scope: **`@truemandate/*`** (repository name TrueMandate).
- Node.js ≥ 20.

## Canonical serialization

- The specification requires “canonical JSON serialization” and SHA-256 without naming an RFC.
- Implementation uses **RFC 8785-style JSON Canonicalization** (lexicographically sorted object keys, no insignificant whitespace, UTF-8 string form) in `@truemandate/crypto`.
- Unicode is preserved as code units (**no silent NFC rewrite**), matching JCS.
- Non-finite numbers, `bigint`, `Date`/`Map`/`Set`, and non-plain objects are rejected fail-closed.
- Integrity hashes for IntentState, PreparedAction parameters, and similar bindings use `hashCanonical`.

## Capability subset (fail-closed)

- Missing child restrictions are treated as **broader** authority when the parent is restricted (`maxAmount`, `expiresAt`, `currency`, allow-lists, `maxDelegationDepth`).
- Empty child allow-list `[]` means allow-nothing (narrower), not unrestricted.

## Persistence

- `NonceStore`, `IdempotencyStorePort`, `GrantStore`, and `ExposureLedger` are persistence **ports**.
- In-memory adapters exist for local tests only and are **not multi-instance safe**.
- See [`persistence.md`](../architecture/persistence.md).

## Invariant enforcement surface

- INV_001–INV_025 are implemented as pure deterministic functions / graph operations with automated tests.
- Grant validation and commit reload grants from `GrantStore` and require the live IntentState tip.

## Protocol extras

See [`protocol-deltas.md`](../architecture/protocol-deltas.md).
