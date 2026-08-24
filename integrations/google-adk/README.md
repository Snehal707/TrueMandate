# TrueMandate x Google ADK - reference integration (A2A 1.0)

Reference integration of a TrueMandate governed agent on the official Google
ADK TypeScript package (`@google/adk`), exposed over A2A 1.0
(`@a2a-js/sdk`).

## What is real here

| Surface | Backing |
|---|---|
| `true_mandate_record_intent` tool | Real `POST /v1/intents` via `@truemandate/sdk-core` (durable Intent record; nothing follows) |
| `true_mandate_canonical_proof` tool | Real `GET /v1/demo/canonical-phase-c-v5` (fixed-allowlist read-only projection) |
| `true_mandate_submit_workflow` tool | Real `POST /v1/workflows` via `@truemandate/sdk-adk` -> `@truemandate/sdk-core` (generic governed workflow submit across registered packs) |
| `true_mandate_read_workflow` tool | Real `GET /v1/workflows/:workflowId` (sanitized workflow lifecycle status read) |
| `true_mandate_resume_workflow` tool | Real `POST /v1/workflows/:workflowId/resume-approval` (governed workflow resume after durable approval) |
| `true_mandate_read_approval` tool | Real `GET /v1/approvals/:id` (allowlisted approval read) |
| `true_mandate_decide_approval` tool | Real `POST /v1/approvals/:id/decide` (durable approval decision only) |
| `true_mandate_submit_evidence` tool | Real `POST /v1/evidence` (governed evidence submission) |
| `true_mandate_read_evidence` tool | Real `GET /v1/evidence/:id` (allowlisted evidence read) |
| `true_mandate_read_outcome` tool | Real `GET /v1/outcomes/contracts/:id` (allowlisted outcome status read) |
| `true_mandate_read_resolution_case` tool | Real `GET /v1/resolutions/cases/:id` (allowlisted resolution read) |
| `true_mandate_read_resolution_by_outcome` tool | Real `GET /v1/resolutions/cases/by-outcome/:outcomeContractId` (allowlisted resolution lookup by outcome id) |
| A2A 1.0 Agent Card | `/.well-known/agent-card.json` - `supportedInterfaces` with `protocolBinding: "JSONRPC"`, `protocolVersion: "1.0"` |
| A2A 1.0 JSON-RPC endpoint | `/a2a` - `DefaultRequestHandler` + native 1.0 `AgentExecutor` driving the ADK `Runner` |

There is no economic execution surface: no payment tool, no gateway client,
no `execute()` / `pay()` convenience method, no `AuthorityGrant`, no
`PreparedAction`, no `CommitToken`, and no raw Gateway commit. The agent
operates only on the governed public lifecycle; TrueMandate infrastructure
authorizes.

## Package facts (verified against installed artifacts, Friday, August 21, 2026)

- `@google/adk` 1.6.0 (official Google ADK JS; `LlmAgent`, `FunctionTool`,
  `Runner`, `runEphemeral`)
- `@a2a-js/sdk` 1.0.1 (official A2A 1.0 SDK for TS)
- Caveat: `@google/adk@1.6.0` internally depends on `@a2a-js/sdk ^0.3.10`,
  so its bundled A2A bridge (`toA2a`, `A2AAgentExecutor`) still advertises
  A2A 0.3. This integration therefore implements the A2A 1.0
  `AgentExecutor` interface directly against the ADK Runner
  (`src/a2a-executor.ts`) and serves the card + JSON-RPC handler from
  `@a2a-js/sdk@1.0.1`. No 0.3 surface is exposed.

## Model backend - Vertex AI + ADC (verified)

Verified against the installed packages (`@google/adk@1.6.0`
`models/google_llm.js`; `@google/genai@2.17.1` `dist/node/index.mjs`):
`GOOGLE_GENAI_USE_VERTEXAI=true` selects Vertex mode (no API key required -
the ADK only throws when NEITHER Vertex NOR an API key is configured),
`GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` select project/region, and
authentication is Application Default Credentials locally (or the Cloud Run
service identity after deployment). Model: `gemini-3.7-flash`
(`GEMINI_MODEL` override). No Gemini AI Studio API key is used or required.
The Vertex/ADC smoke (`src/vertex-smoke.ts`) ran successfully with tool
`true_mandate_canonical_proof` on a read-only path.

## Local run

```bash
# from the repo root
GOOGLE_GENAI_USE_VERTEXAI=true \
GOOGLE_CLOUD_PROJECT=elite-crossbar-505104-t9 \
GOOGLE_CLOUD_LOCATION=global \
TM_PUBLIC_BASE_URL=<public base URL> \
pnpm --filter @truemandate/integration-google-adk start
# default: http://localhost:8000
curl -s http://localhost:8000/healthz
curl -s http://localhost:8000/.well-known/agent-card.json
```

`TM_PUBLIC_BASE_URL` points the tools at the deployed public base URL (the
production web proxy authenticates the calls with its service identity).

## Agent Registry - registration readiness (PLANNED ONLY)

See `docs/agent-registry-readiness.md` for the complete plan. Registration
is not executed as part of this build. Once a public HTTPS deployment of
this server exists, the exact command is:

```bash
gcloud agent-registry services create <service-id> \
      --project=elite-crossbar-505104-t9 \
      --location=global \
      --display-name="TrueMandate Governed Procurement Agent" \
      --agent-spec-type=a2a-agent-card \
      --agent-spec-content=@agent-card.json
```
