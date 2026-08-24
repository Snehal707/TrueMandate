# Google Agent Registry — Registration + Access Truth

**Status: REGISTERED (2026-08-19).** Service
`truemandate-governed-agent` (us-central1, display name "TrueMandate
Governance Agent"), projected Agent
`agentregistry-00000000-0000-0000-d23b-6db9e368eaba` ("TrueMandate Governed
Procurement Agent" — see naming note below), skills `intent-record` +
`canonical-proof` indexed. The Agent Registry is discovery-only in
TrueMandate's architecture: it has zero path into AuthorityGrant /
PreparedAction / CommitToken / Gateway decision.

## Naming note (pending live update)

The projected Agent name derives from the Agent Card `name` field. The
deployed card still says "TrueMandate Governed Procurement Agent"; the
LOCAL card (this tree) now says **"TrueMandate Governance Agent"** —
procurement is the proof scenario, not the product identity. Live delta
required: web image rebuild (card static asset) + `gcloud agent-registry
services update` with the new card. Not yet executed.

## A2A access truth

- **Registry discovery never implies invocation.** Registration publishes
  discovery metadata only.
- Invocation of the A2A RPC requires an explicit
  `roles/run.invoker` grant on the `tm-dev-adk-a2a` Cloud Run service
  (identity tokens, no `allUsers`).
- Current invoker grant: one named operator principal
  (`user:snehalsatpute707@gmail.com`) — classified as **operator/demo
  access**, granted to execute the Stage 2 authenticated smoke and retained
  as the designated operator access until a production access policy
  exists. Recommended removal if no longer needed; not removed
  automatically.
- Cloud Run IAM is not representable as an A2A OAuth/OIDC scheme; the card
  declares it truthfully as an HTTP auth scheme
  (`httpAuthSecurityScheme` Bearer JWT, audience = service URL, explicit
  `run.invoker`, no allUsers) with a matching `securityRequirements`
  entry. (Present in the LOCAL card; pending the same live update as the
  name.)

## What the Agent Registry is — and is not

The Agent Registry:

- **discovers capabilities** — parses the Agent Card into a discoverable
  Agent (displayName, description, version, skills, protocols);
- **indexes A2A skills** — searches match metadata, descriptions, and the
  card's inline skill descriptions.

It does **NOT**:

- proxy privileged execution,
- authenticate economic authority,
- mint grants,
- mint CommitTokens,
- authorize Gateway COMMIT.

Registration publishes discovery metadata only. No TrueMandate secret,
token, grant, or endpoint credential is embedded in the card.

## Authentication and deployment truth

- The future ADK/A2A Cloud Run service **stays authenticated**: identity-token
  ingress with its own service identity (ADC at runtime), **no `allUsers`**.
- **No** public Gateway access, **no** public Authority access, **no** public
  BFF privilege is added anywhere by this plan.
- The Agent Card is *public metadata by A2A design*, served at
  `/.well-known/agent-card.json`. Recommended: serve the card as a static
  asset from the existing public web surface (no new public service), while
  the A2A JSON-RPC endpoint remains authenticated. If the card is served by
  the A2A service itself, only that one metadata route is reachable without
  service identity — never the RPC surface.
- Registration submits the **validated card content** via
  `--agent-spec-content=@agent-card.json`. This is a submission channel for
  the registry index, not an authorization channel: the submitted content
  must match the deployed card byte-for-byte (the registry synchronizes the
  card), and the deployed `supportedInterfaces[0].url` must be a live public
  HTTPS URL — submitting the file does not replace having a real, verified,
  authenticated endpoint.

## Verified API facts (2026-08-19)

- Agent Registry API is **GA** (since 2026-06-18): API `agentregistry/v1`;
  `gcloud agent-registry` (GA) and `gcloud alpha agent-registry` (v1alpha)
  installed with Cloud SDK 580.0.0. API already enabled in
  `elite-crossbar-505104-t9`.
- The writable registration unit is a **Service**; the discoverable unit is
  a read-only projected **Agent**.
- Asset spec type for A2A cards: **`A2A_AGENT_CARD`** (card content inline,
  validated against the A2A schema, **max 10 KB**).
- Locations: `global` or a region (e.g. `us-central1`). `us`/`eu`
  multi-regions unsupported.
- Required IAM: `roles/agentregistry.editor` (or `.admin`).

## Registration plan (after the authenticated A2A deployment exists)

1. Deploy `integrations/google-adk` as its own Cloud Run service with
   identity-token ingress (its own SA, Vertex AI + ADC at runtime), public
   HTTPS URL, `A2A_BASE_URL` set to that URL.
2. Serve `/.well-known/agent-card.json` (static metadata route) and verify:
   `curl -s https://<host>/.well-known/agent-card.json` → 200, card
   `protocolVersion: "1.0"`, size < 10 KB. The A2A RPC endpoint stays
   authenticated — no `allUsers`.
3. Fetch the card locally and register the SAME validated content (never
   registers credentials or secrets):
   ```bash
   gcloud agent-registry services create truemandate-governed-agent \
         --project=elite-crossbar-505104-t9 \
         --location=global \
         --display-name="TrueMandate Governed Procurement Agent" \
         --agent-spec-type=a2a-agent-card \
         --agent-spec-content=@agent-card.json
   ```
4. Verify: `gcloud agent-registry agents list --project=elite-crossbar-505104-t9 --location=global`
   and `gcloud agent-registry agents search --location=global --search-string="TrueMandate"`.
5. Terraform alternative (provider `hashicorp/google >= 7.39.0`), keeping
   the registry state in the same Terraform state layout as the rest of the
   infrastructure:
   ```hcl
   resource "google_agent_registry_service" "truemandate" {
     location     = "global"
     service_id   = "truemandate-governed-agent"
     display_name = "TrueMandate Governed Procurement Agent"
     agent_spec = {
       type    = "A2A_AGENT_CARD"
       content = file("agent-card.json")
     }
   }
   ```

## Discovery surface

The card advertises exactly two skills — `intent-record` and
`canonical-proof` — and no economic capability, so search results cannot
misrepresent the agent's powers.

## Hard boundaries (unchanged)

- No registration is executed in this build.
- The registry's data is discovery metadata; TrueMandate's authority path
  does not read from it.
- No `allUsers`, no public Gateway/Authority access, no public BFF
  privilege.
