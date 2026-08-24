# Threat Model Update — Cloud Topology (Phase 12)

## New / elevated threats

| Threat | Mitigation |
|--------|------------|
| Cross-replica race on CommitToken/Grant | Firestore TX + concurrency tests |
| Pub/Sub duplicate / reorder | App dedupe + version checks + DLQ |
| Dashboard/BFF privilege escalation | IAM forbid + architecture ban tests + limited routes |
| Agent-runtime direct payment tool | sdk-adk GovernedToolCaller only |
| Model Armor outage treated as safe | UNAVAILABLE fail-closed + security events |
| CLEAN clearing taint | Explicit preserve-taint invariant |
| Secret leakage in images | No keys in Docker; Secret Manager refs |
| Benchmark as prod authority | Separate SA; forbiddenCapabilities |
| ADC misuse | Cloud Run SA scoped; Vertex model ID recorded |

## Unchanged core threats

Prompt injection, sticky constraint loss, payment≠outcome, UNKNOWN blind retry, cumulative exposure salami — still enforced by INV_001–INV_025 on durable stores.
