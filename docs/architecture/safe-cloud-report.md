# SAFE Cloud Report Notes (Phase 12)

- Cloud golden subset uses the **same** `toSutPublicInput()` as local SAFE (no ground-truth leakage).
- Holdout remains sealed.
- Default CI: FakeModel + deterministic adapters + emulator-equivalent Firestore/Pub/Sub.
- Live Gemini / Vertex runs are **optional separate artifacts** (`pnpm cloud:smoke` when credentials present).
- Attack Lab continues to read observability + SAFE artifacts only — no privileged production actions on cloud topology.
- Script: `./scripts/cloud/safe-cloud-subset.sh` (+ vitest `services/benchmark-runner/src/safe-cloud-subset.test.ts`).
