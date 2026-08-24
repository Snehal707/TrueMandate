# @truemandate/sdk-core

Framework-neutral TrueMandate client. **The SDK proposes, transports and
verifies. Infrastructure authorizes.**

## Capability classification (programmatic + honest)

`SDK_CAPABILITIES` exposes every capability with an explicit status — the
four real routes are NOT presented as equivalent:

| Capability | Status | Real route | Truth |
|---|---|---|---|
| `intents.record` | **supported** | `POST /v1/intents` | durable Intent record only — nothing follows |
| `proof.canonical` | **supported** | `GET /v1/demo/canonical-phase-c-v5` | fixed-allowlist durable read (readOnly) |
| `evidence.read` | **degraded** | `GET /v1/evidence/:id` | allowlisted read; backing store is process-local and empty in the live deploy (422 expected) |
| `workspace.read` | **demo-only** | `GET /v1/workspace/:intentId` | synthetic DemoRuntime data — NOT canonical production state |
| `intents.compile`, `workflow.trigger`, `guardian.verdict`, `authority.evaluate`, `grant.mint`, `commit.token`, `gateway.commit`, `provenance.write` | **infrastructure-owned** | — | no public route; the SDK has no method for any of these |

```ts
import { createSdkCore, SDK_CAPABILITIES } from "@truemandate/sdk-core";

const core = createSdkCore({ baseUrl: "https://<same-origin-proxy-root>" });

SDK_CAPABILITIES["intents.record"].status;  // "supported"
SDK_CAPABILITIES["evidence.read"].status;   // "degraded"
SDK_CAPABILITIES["workspace.read"].status;  // "demo-only"
SDK_CAPABILITIES["gateway.commit"].status;  // "infrastructure-owned"

const intent = await core.recordIntent({ rawText: "…", principalId: "…" });
// intent is RECORDED. It does NOT compile, authorize, or execute anything.
const proof = await core.readCanonicalProjection(); // read-only
```

## External-ingress truth

Recording an intent through `intents.record` is the end of the public
surface: there is **no public compile/authorize/COMMIT path** for arbitrary
intents. A newly recorded arbitrary Intent does **not** automatically
traverse the canonical procurement proof — the canonical proof projection is
a fixed-allowlist view of a specific executed workflow, never of new input.

## Guarantees (test-enforced)

- `route-truth.test.ts` — the SDK issues exactly the four real routes, one
  request per record, and no others.
- `authority-boundary.test.ts` — no S2S runtime dependency, no `/internal/`
  strings, no grant/token/prepared-action type exports, strict wire schemas.
- `allowlist-sync.test.ts` — the evidence view mirrors the deployed BFF
  allowlist exactly.
