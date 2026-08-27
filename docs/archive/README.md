# Archived engineering records

Internal engineering records preserved for provenance. **Not required to
understand, run, or evaluate the system** — start at the [root README](../../README.md)
instead.

These documents were written during development as phase-gate and closure
records. They are point-in-time snapshots: where they disagree with the current
code, the code is authoritative.

| Group | Files | What it is |
|---|---:|---|
| `phase-*-stop-report.md` | 7 | Phase-gate stop reports (phases 6–12) |
| `stage-b-*`, `stage-c-*` | 13 | Cloud deployment and closure reports |
| `wave{1,2,3,4}-*` | 9 | Per-wave production closure reports and spec-to-source gap maps |
| Deployment/plan reports | 5 | Foundation deployment, orchestrator plan, Terraform pre-apply, SAFE demo acceptance, P0 submission build |
| `firestore-preflight.md` | 1 | One-off Firestore preflight check |
| `safe-cloud-report.md` | 1 | Short SAFE cloud notes stub |
| `TrueMandate_Claude_Handoff.md` | 1 | Internal AI-assistant handoff brief and product positioning notes |

For current, maintained documentation see:

- [`docs/architecture/`](../architecture/) — cloud architecture, security boundaries, IAM matrix, Pub/Sub topology, data model, deploy and emulator guides
- [`docs/BENCHMARK.md`](../BENCHMARK.md) — benchmark results and what they do and do not establish
- [`docs/REPRODUCE.md`](../REPRODUCE.md) — how to reproduce the results
