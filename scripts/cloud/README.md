# Cloud deployment scripts (Phase 12)

Bash helpers for bootstrapping, deploying, smoke testing, and tearing down TrueMandate on Google Cloud.

## Windows note

These scripts are written for Bash. On Windows use one of:

- **Git Bash** (included with Git for Windows)
- **WSL** (Windows Subsystem for Linux)

PowerShell equivalents are not provided in Phase 12; run from WSL/Git Bash at the repository root:

```bash
./scripts/cloud/bootstrap.sh --project-id YOUR_PROJECT
```

## Scripts

| Script | Purpose |
|--------|---------|
| `bootstrap.sh` | Enable GCP APIs, `terraform init` |
| `deploy.sh` | Build and push Docker images to Artifact Registry |
| `smoke.sh` | Hit Cloud Run `/healthz` + run local public-api tests |
| `teardown-dev.sh` | `terraform destroy` for non-prod environments |
| `safe-cloud-subset.sh` | Validate `iam-matrix.json` + architecture ban tests |
| `secret-preflight.sh` / `secret-preflight.mjs` | Confirm each required Secret Manager secret has an ENABLED version (metadata only) |

## Safety

- Default monorepo tests do **not** call live GCP APIs.
- `smoke.sh` only performs HTTP health checks against deployed Cloud Run URLs when they exist.
- No service account JSON keys are baked into Docker images.
- Missing `GOOGLE_CLOUD_PROJECT` with `TM_REQUIRE_CONFIG=true` causes containers to exit non-zero.

## Related docs

- `infrastructure/terraform/README.md` — apply order and variables
- `docs/architecture/iam-matrix.json` — service account capability matrix
