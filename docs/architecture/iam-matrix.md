# IAM Matrix (Phase 12)

Machine-readable source: [`iam-matrix.json`](./iam-matrix.json).

## Forbidden capabilities (non-negotiable)

| Actor | Must never |
|-------|------------|
| `public-bff` / `observability-api` / dashboard | Gateway commit, grant mint, CommitToken mint, Resolution mutation |
| `agent-runtime` | Mint grants, consume grants, Gateway commit, raw payment tools |
| `benchmark-runner` | Production economic authority |

## Capability dimensions

Per service account: `invoke`, `publish`, `subscribe`, `firestore`, `vertex`, `armor`, `secrets`, plus `forbiddenCapabilities[]`.

Terraform and Cloud Run IAM must align with this matrix. Application architecture bans (public-api tests) reinforce the same boundaries.

## Authority and Gateway commit

`authority.forbiddenCapabilities` includes `gateway.commit`. That capability means Authority must not embed `TwoPhaseGateway.commit` or a payment adapter. It does **not** forbid HTTP invocation of Gateway.

Only Authority has Cloud Run invoker on Gateway (`INGRESS_TRAFFIC_INTERNAL_ONLY`). Authority is therefore the HTTP orchestrator of `/internal/gateway/prepare`, `/internal/gateway/authorize`, and `/internal/gateway/commit`. Gateway verifies caller identity against the Authority service account.

`gateway.forbiddenCapabilities` includes `authority.grantMint`. Gateway may load, lock, and consume grants. It must not mint them.
