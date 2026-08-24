# Public access semantics (Phase 12 hardened)

**Ingress ≠ authentication.** `INGRESS_TRAFFIC_ALL` only means the load balancer accepts internet traffic. Cloud Run IAM still decides who may invoke.

| Service | Ingress | Cloud Run IAM | Application auth |
|---------|---------|---------------|------------------|
| `web` | ALL | `allUsers` invoker | Static SPA + **server-side** BFF proxy; browser has no Google tokens |
| `public-bff` | ALL | **No** `allUsers` — **web SA only** (`web→public-bff`) | Identity token from web proxy; route bans forbid grant/commit/resolution mutate |
| All trust services | INTERNAL_ONLY | S2S invoker edges only | N/A |
| `gateway` | INTERNAL_ONLY | **Only** `authority` SA (plus OIDC self for Pub/Sub push) | Privileged commit path |

## Browser path

Browser → public web Cloud Run → server-side authenticated BFF proxy (web SA identity token) → public-bff.

Browser code must not receive Google service account credentials or workload tokens.

## Rules

1. Gateway is never publicly invokable.
2. Dashboard/Attack Lab must not receive Gateway invoker.
3. Benchmark-runner must not receive production economic authority or Gateway/authority mutate rights.
4. Web SA is isolated from Firestore writes, secrets, Pub/Sub, Vertex, and Model Armor. It may invoke **public-bff only**.
