# Local + Emulator Guide (Phase 12)

## Default CI (no GCP)

```bash
pnpm test
```

Uses:

- `InMemory*` stores for unit tests
- `MemoryTransactionalStore` (Firestore TX semantics) in `@truemandate/cloud-firestore`
- `InMemoryPubSubBus` for dedupe / ordering / DLQ
- `FakeModel` / Fake Model Armor
- SAFE golden via FakeModel adapters

## Optional emulators

| Emulator | Purpose |
|----------|---------|
| Firestore emulator | Live TX against `@google-cloud/firestore` |
| Pub/Sub emulator | Push/pull against real client libs |

Set `TM_PERSISTENCE=firestore` and `FIRESTORE_EMULATOR_HOST` when using the Firestore emulator.

## Live smoke (credentials required)

```bash
pnpm cloud:smoke   # optional; not part of default pnpm test
```

Requires ADC or `GOOGLE_OAUTH_ACCESS_TOKEN` + `VERTEX_PROJECT`. Live Gemini SAFE results must be written as **separate artifacts** — never mix into sealed holdout scoring.
