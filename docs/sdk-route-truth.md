# SDK Route Truth — audit matrix (2026-08-19)

Audited against the deployed public BFF (`packages/public-api/src/router.ts`),
the S2S client layer (`packages/cloud-runtime/src/s2s-client.ts`), and the
Terraform runtime module. This matrix is what `@truemandate/sdk-core` /
`@truemandate/sdk-agent` were built against.

## Public routes (the SDK's complete surface)

| Capability | Method + path | Transport (prod) | Real backing | Safe for external SDK? |
|---|---|---|---|---|
| Record intent (durable) | `POST /v1/intents` | browser → web-proxy (web SA identity) → public-bff → S2S → intent-provenance | Durable Firestore; idempotent by content hash; **nothing follows** | Yes — "record raw Intent" only |
| Read canonical proof projection | `GET /v1/demo/canonical-phase-c-v5` | same chain | Durable read of fixed allowlisted doc ids; field-picked `CanonicalProjection`; `readOnly: true` | Yes |
| Read evidence | `GET /v1/evidence/:id` | same chain | In-process `EvidenceService` — empty in the live BFF (422 expected) | Yes (degraded; no durable read today) |
| Read workspace | `GET /v1/workspace/:intentId` | same chain | `DemoRuntime` in-process synthetic — **NOT canonical** | Only labeled as demo data |

## NOT reachable publicly (verified)

Compile / finalize compilation, workflow trigger, guardian verdict, authority
evaluation, bind-and-mint, gateway prepare/authorize/commit, provenance
node/edge writes, outcome contract create/evaluate, resolution case reads —
all live behind `INGRESS_TRAFFIC_INTERNAL_ONLY` + VPC + exact service-account
invoker edges + identity-token allowlists. The public BFF route table has no
such path (404), and `architecture-ban.test.ts` forbids the BFF from
importing authority/gateway code.

## SDK negative boundaries (enforced by tests)

- `packages/sdk-core/src/authority-boundary.test.ts` — no dependency on
  cloud-runtime / gateway-service / authority-service / …; no `/internal/`
  path strings; no grant/token/prepared-action type exports; strict intent
  wire schema (a response carrying grant keys is rejected).
- `packages/sdk-core/src/route-truth.test.ts` — the SDK issues exactly the
  four real routes and no others; recordIntent issues exactly one request
  (no compile/authority/commit follow-up).
- `packages/sdk-agent/src/agent-sdk.test.ts` — no execute/pay/submit/mint
  surface; registry-owned privilege only; proposals are local objects with
  no submission route.

## External-ingress truth (the safe surface)

The public surface supports exactly this external flow:

```
external agent
  → record Intent (POST /v1/intents, durable, idempotent, nothing follows)
```

There is **no arbitrary public compile / authorize / COMMIT path** for
recorded intents. This is deliberate and is NOT being "solved" in this pass:
workflow triggering, compilation, guardian, authority, gateway commit — the
entire authorization pipeline — remain internal (INGRESS_TRAFFIC_INTERNAL_ONLY,
VPC, identity allowlists).

Two concepts must stay visibly separate:

1. **Interoperability proof** — the Google ADK integration
   (`integrations/google-adk`) proves an external framework can use the
   existing safe surface: it records intents and reads the canonical proof
   through the same four routes, nothing more.
2. **The canonical procurement proof** — a fixed-allowlist, read-only
   projection of ONE specific executed workflow (Phase C v5). A newly
   recorded arbitrary Intent does **NOT** automatically traverse this
   proof. Recording an intent is the end of the public surface; the proof
   describes a workflow that already ran inside the infrastructure.

Both the SDK README and the developer UI state this explicitly.

## Ingress gap (deployment decision, NOT changed in this build)

The public BFF is `INGRESS_TRAFFIC_ALL` but grants the invoker edge to the
web SA only; the browser reaches it exclusively through the same-origin
web-proxy, which mints the identity token. A framework-neutral SDK from a
third-party runtime therefore needs its own ingress decision:

**Recommendation:** keep the current boundary. Do NOT add `allUsers` to the
public BFF. For agent-facing access, deploy `integrations/google-adk` as its
own Cloud Run service (identity-token ingress, its own SA), configured with
`TM_PUBLIC_BASE_URL` pointing at the web proxy URL; the A2A server then
reaches the four public routes through the existing web-SA identity exactly
like the browser. Alternatively, extend the web proxy with a dedicated
agent-facing path — but never expose the BFF's internal S2S routes.
