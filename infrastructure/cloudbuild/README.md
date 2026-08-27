# Cloud Build configurations

Historical per-deployment Cloud Build configs used to build and push service
images to Artifact Registry during development.

These are **operator artifacts, not part of the build system**. Nothing in the
repository references them programmatically — each was invoked ad hoc:

```bash
gcloud builds submit --config=infrastructure/cloudbuild/<group>/<file>.yaml .
```

They are retained because each one reproduces a specific image digest that was
deployed at some point, and several of those digests are still referenced by
Terraform inputs and by the benchmark evidence under `evals/benchmark/v2/runs/`.

| Directory | Configs | What it covers |
|---|---:|---|
| `phase-a/` | 24 | Phase A — intent provenance, obligations, readiness, replay protection |
| `phase-b/` | 20 | Phase B — gateway commit provenance, principal binding, trigger paths |
| `phase-c/` | 11 | Phase C — outcome resolution and evidence service closure |
| `wave1/` | 32 | Wave 1 — trusted runtime, authority, outcome contracts |
| `wave2/` | 8 | Wave 2 — observability and benchmark runner |
| `wave3/` | 9 | Wave 3 — analytics export/query and governed learning |
| `wave4/` | 8 | Wave 4 — adaptive runtime and general workflow stabilization |
| `demo/` | 3 | Judge-facing demo web and public BFF |
| `p0closure/` | 2 | P0 submission closure builds |
| `benchmark/` | 1 | Benchmark runner readiness-race fix |

The current deployed image digests are pinned in
`infrastructure/terraform/stages/runtime/terraform.tfvars` (gitignored — it
binds to a specific GCP project).
