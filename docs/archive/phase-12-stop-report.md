# Phase 12 Stop Report — Google Cloud Production Infrastructure

**Date:** 2026-08-14  
**Baseline:** 287 green tests (Phase 11 complete)  
**Result:** Cloud adapters (Firestore TX semantics, Pub/Sub envelope), Vertex ADC, Model Armor port, sdk-adk governed tools, public-bff, Terraform/IAM/Docker, SAFE cloud subset, architecture docs.  
**STOP.** No further product features until review.

---

## Principle

Cloud implements infrastructure underneath existing ports. ADK orchestrates; TrueMandate governs. INV_001–INV_025 and Phase 11 SAFE holdout boundaries are unchanged.

---

## Packages added

| Package | Role |
|---------|------|
| `@truemandate/cloud-firestore` | DocumentStore + Grant/CommitToken/Nonce/Idempotency/Exposure/Reservation/SideEffect/Intent/Provenance/repos |
| `@truemandate/cloud-pubsub` | Envelope, topics, InMemoryPubSubBus (dedupe/OOO/DLQ), Outcome + Observability adapters |
| `@truemandate/cloud-security` | ModelSecurityPort, Model Armor fail-closed, identity verifier, security events |
| `@truemandate/sdk-adk` | ADK wrappers; privileged tools → ActionProposal → Gateway only |
| `@truemandate/public-api` | Limited BFF (Intent create, workspace read, ApprovalArtifact, evidence) |

## Infra

- `infrastructure/terraform` — APIs, SAs, IAM, Firestore, Pub/Sub+DLQ, Cloud Run stubs, Artifact Registry, secret refs
- `infrastructure/docker/Dockerfile.*` — one per Cloud Run/static service
- `scripts/cloud/*` — bootstrap, deploy, smoke, SAFE subset, teardown-dev
- `docs/architecture/iam-matrix.json` + markdown companions

## Cloud Run co-location

intent-provenance · authority · gateway (private) · outcome-resolution · agent-runtime · observability-api · public-bff · web · attack-lab · optional benchmark-runner (**no prod economic authority**)

## Testing

| Layer | Status |
|-------|--------|
| Unit InMemory + FakeModel | Preserved |
| Firestore TX races (emulator-equivalent) | `packages/cloud-firestore` |
| Pub/Sub dedupe / OOO / DLQ | `packages/cloud-pubsub` |
| Armor unavailable≠safe; CLEAN≠clear taint | `packages/cloud-security` |
| ADK no direct payment | `packages/sdk-adk` |
| BFF architecture ban | `packages/public-api` |
| SAFE cloud golden subset | `services/benchmark-runner/src/safe-cloud-subset.test.ts` |
| Live GCP smoke | Optional `pnpm cloud:smoke` — not required for default `pnpm test` |

## Service names / URLs

Terraform resource names (environment-specific URLs after apply):

- `tm-intent-provenance`
- `tm-authority`
- `tm-gateway` (**ingress: internal / authenticated only**)
- `tm-outcome-resolution`
- `tm-agent-runtime`
- `tm-observability-api`
- `tm-public-bff`
- `tm-web` / `tm-attack-lab`
- `tm-benchmark-runner` (optional)

Record live URLs here after first environment apply:

| Service | URL |
|---------|-----|
| public-bff | _(pending apply)_ |
| web | _(pending apply)_ |
| attack-lab | _(pending apply)_ |

## Manual GCP steps

1. Confirm org policies / Model Armor enablement where Terraform cannot fully automate.
2. Verify Gateway is not publicly invokable.
3. Populate Secret Manager values (sandbox/webhook/HMAC) — never commit.
4. Bind human operators without Gateway commit rights.
5. Optional: wire live Vertex ADC on Cloud Run SA and capture SAFE live artifacts separately from holdout.

## Architectural notes / assumptions

- CI proves Firestore TX races via `MemoryTransactionalStore` (optimistic concurrency + serialized TX). Live emulator optional.
- Sync store ports retained; durable adapters implement the same interfaces.
- `fixtures` exported from `@truemandate/authority` for cloud adapter tests.
- Vertex token order: env → injected TokenProvider → ADC (`google-auth-library` optional dynamic import).

## Explicit non-goals deferred

- Full live multi-region HA runbooks
- Replacing DemoRuntime with Firestore in default local dashboard demos (still InMemory unless `TM_PERSISTENCE=firestore`)
- Product feature work beyond infrastructure

---

## STOP

Phase 12 is complete for review. Do not start Phase 13+ or further product features until the user continues the build.
