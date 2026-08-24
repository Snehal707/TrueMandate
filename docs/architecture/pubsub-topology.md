# Pub/Sub Topology (Phase 12 hardened)

## Topics

11 domain topics + matching DLQ topics (`tm-{env}-{topic}` / `tm-{env}-{topic}-dlq`).

## Delivery mode

**Authenticated OIDC push is the default production delivery for Cloud Run.**

Pull subscriptions are **opt-in** (`enable_pull_subscriptions = true`) for local testing, benchmark workers, or debugging.

A single logical production consumer must **not** receive the same event through both a pull subscription and a push subscription unless there is a documented intentional reason. The default Terraform configuration creates **push only**.

## Push subscriptions (Stage C)

| Consumer | Topics |
|----------|--------|
| intent-provenance | authority.events, execution.events |
| authority | intent.events, guardian.events, plan.events |
| gateway | authority.events, outcome.events |
| outcome-resolution | execution.events, evidence.events |
| agent-runtime | intent.events |
| observability-api | intent, semantic, plan, guardian, authority, execution, evidence, outcome, resolution, security |

No subscriptions for `public-bff`, `web`, or `benchmark-runner`.

Each push subscription:

- Endpoint: Cloud Run `{consumer}` `/internal/events`
- OIDC SA: that consumer's runtime service account
- Audience: the Cloud Run service URI
- Cloud Run Invoker: consumer SA on its own service
- Pub/Sub service agent: `roles/iam.serviceAccountTokenCreator` on the consumer SA
- Pub/Sub service agent: `roles/pubsub.subscriber` on the push subscription (DLQ drain)
- Retry + dead-letter policy

## Delivery guarantees

- Ack only after durable success
- **Always** application-level dedupe by `idempotencyKey`
- Reject stale aggregate version rewinds
- **Never** treat Pub/Sub as business-level exactly-once
