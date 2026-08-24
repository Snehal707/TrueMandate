# Deploy Guide (Phase 12 hardened — staged)

## Stages

| Stage | What | Where |
|-------|------|-------|
| **A** | APIs, Artifact Registry, SAs, IAM, Firestore, Pub/Sub **topics + DLQ**, optional pull subs (default **off**), Secret shells, Model Armor | `infrastructure/terraform/stages/foundation` |
| **B** | Build & push images | `./scripts/cloud/deploy.sh` |
| **C** | Cloud Run, invoker IAM, **OIDC push** subscriptions, secret-version preflight | `infrastructure/terraform/stages/runtime` |

## Commands (no apply until explicitly approved)

```bash
# Stage A — plan (push-only; pull stays off)
cd infrastructure/terraform/stages/foundation
terraform init
terraform plan -out=tfplan.foundation
# terraform apply tfplan.foundation   # ONLY when approved

# After A: add secret versions out of band (never Terraform secret_data)
# gcloud secrets versions add tm-dev-gateway-hmac-key --data-file=...

# Stage B — after A applied
./scripts/cloud/deploy.sh --project-id elite-crossbar-505104-t9 --tag dev

# Secret readiness (metadata only)
node scripts/cloud/secret-preflight.mjs --project elite-crossbar-505104-t9 --prefix tm-dev

# Stage C — plan (use fixture until A has state; then set use_foundation_fixture=false)
cd infrastructure/terraform/stages/runtime
terraform init
terraform plan -out=tfplan.runtime
# terraform apply tfplan.runtime   # ONLY when approved; apply runs secret-preflight and fails closed if versions missing
```

Pull subscriptions for debug/benchmark:

```hcl
enable_pull_subscriptions = true  # foundation tfvars only; do not also consume push for the same worker
```

## Prerequisites

- Terraform ≥ 1.5, Google provider ~> 6.0, hashicorp/time for API settle wait
- Billing enabled
- Secret **versions** populated after shells exist (never in TF state as plaintext)
- Firestore preflight completed (see `docs/architecture/firestore-preflight.md`)

## Manual GCP steps

- Confirm Gateway remains INTERNAL_ONLY after apply
- Browser reaches BFF only via the web proxy (web SA identity token)
- Do not grant dashboard/Attack Lab Gateway invoker
