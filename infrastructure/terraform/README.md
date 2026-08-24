# Legacy monolithic root (pre-hardening)

Phase 12 hardening moved Terraform into staged roots:

- [`stages/foundation`](stages/foundation) — Stage A (APIs, AR, SAs, IAM, Firestore, Pub/Sub topics+pull subs, secrets, Model Armor)
- [`scripts/cloud/deploy.sh`](../../scripts/cloud/deploy.sh) — Stage B (build/push images)
- [`stages/runtime`](stages/runtime) — Stage C (Cloud Run, invokers, OIDC push subscriptions)

Do **not** apply from this directory. Use the stage directories.

See [`docs/architecture/deploy-guide.md`](../../docs/architecture/deploy-guide.md).
