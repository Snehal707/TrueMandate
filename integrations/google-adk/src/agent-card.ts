import type { AgentCard } from "@a2a-js/sdk";

/**
 * A2A 1.0 Agent Card for the TrueMandate governed reference agent.
 *
 * Written against the A2A v1.0 shape (supportedInterfaces with JSONRPC
 * protocolBinding and protocolVersion "1.0"). Served at
 * `/.well-known/agent-card.json` (AGENT_CARD_PATH) — the exact path the
 * Google Agent Registry and A2A clients discover.
 *
 * Registration note: the Agent Registry accepts the card content via
 * `gcloud agent-registry services create --agent-spec-type=a2a-agent-card
 * --agent-spec-content=@agent-card.json` (max 10 KB). Registration is
 * PLANNED ONLY — never executed as part of this build.
 */
export function buildAgentCard(baseUrl: string): AgentCard {
  const card: AgentCard = {
    // The name is the PLATFORM identity, not the proof scenario. The
    // projected Agent Registry displayName derives from this field, so it
    // must describe the governance runtime, not procurement.
    name: "TrueMandate Governance Agent",
    description:
      "Governed reference agent for the TrueMandate semantic trust and governance " +
      "runtime. Records durable intents, submits and inspects governed workflows, " +
      "responds to approvals, submits and reads evidence, and reads outcome and " +
      "resolution status through the TrueMandate public API for procurement, travel, " +
      "SaaS/IT spend, invoice/vendor payment, logistics/fulfillment, and custom intent " +
      "through the same generic workflow surface. Holds zero direct " +
      "economic execution surface: proposals are transported and verified by the SDK, " +
      "and authorization happens only inside TrueMandate infrastructure. Procurement " +
      "is the canonical proof scenario, not the product surface.",
    version: "1.0.0",
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        tenant: "",
      },
    ],
    provider: {
      organization: "TrueMandate",
      url: "https://truemandate.example",
    },
    documentationUrl: "https://truemandate.example/docs",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    // Truthful representation of the deployed authentication model: Cloud
    // Run IAM — callers attach a Google-issued identity token (Bearer JWT,
    // audience = the service URL) and must hold an explicit run.invoker
    // grant. No allUsers. This is the OpenAPI HTTP auth scheme, NOT an
    // invented OAuth/OIDC scheme.
    //
    // SERIALIZATION TRUTH (verified against the installed @a2a-js/sdk
    // source, SecurityScheme.fromJSON/toJSON): the canonical A2A 1.0 JSON
    // uses the DIRECT oneof member name ("httpAuthSecurityScheme"), never
    // the internal $case/value wrapper. The TS convenience type describes
    // the internal shape, so the wire shape is constructed here with a
    // documented cast — the card handler serializes this object verbatim.
    securitySchemes: {
      // Canonical wire shape: the oneof member is a TOP-LEVEL key of the
      // scheme object (the installed SDK's SecurityScheme.toJSON emits
      // `{ httpAuthSecurityScheme: {...} }` — no "scheme" wrapper).
      cloudRunIdentity: {
        httpAuthSecurityScheme: {
          description:
            "Google Cloud Run IAM identity token. Callers present a Google-issued " +
            "ID token (audience = the service URL) as a Bearer credential and must " +
            "hold an explicit roles/run.invoker grant on the service. No allUsers " +
            "invocation exists.",
          scheme: "Bearer",
          bearerFormat: "JWT",
        },
      },
    } as unknown as AgentCard["securitySchemes"],
    securityRequirements: [
      {
        schemes: { cloudRunIdentity: { list: [] } },
      },
    ],
    signatures: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "intent-record",
        name: "Record governed intents",
        description:
          "Records a durable raw Intent in the TrueMandate trust core. Recording does not " +
          "compile, authorize, or execute anything — the trust pipeline starts only inside " +
          "TrueMandate infrastructure.",
        tags: ["intent", "governance", "record-only"],
        examples: [
          "Record this intent: buy 500 food-grade containers from an approved supplier for under INR 800000.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "canonical-proof",
        name: "Read the canonical proof",
        description:
          "Reads the canonical Phase C v5 proof projection — a fixed-allowlist, read-only view " +
          "of the verified governed procurement (intent, authority decision, execution, outcome, " +
          "resolution). No write path exists for this skill.",
        tags: ["proof", "read-only", "canonical"],
        examples: ["Show the canonical proof of the last governed procurement."],
        inputModes: [],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "workflow-submit",
        name: "Submit governed workflows",
        description:
          "Submits generic governed workflows through the domain-neutral TrueMandate " +
          "public workflow API. The top-level request surface stays generic and pack-driven, " +
          "not domain-specific.",
        tags: ["workflow", "submit", "generic"],
        examples: [
          "Submit a governed workflow for the travel pack using an existing intent id.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "workflow-read",
        name: "Read workflow status",
        description:
          "Reads sanitized workflow lifecycle state by workflow identity through the " +
          "domain-neutral governed public workflow API.",
        tags: ["workflow", "read", "status"],
        examples: [
          "Read the status of workflow wf-123.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "workflow-resume",
        name: "Resume approved workflows",
        description:
          "Resumes a governed workflow only after durable approval has already been satisfied. " +
          "This does not inline or bypass authority.",
        tags: ["workflow", "resume", "approval-gated"],
        examples: [
          "Resume workflow wf-123 after approval approval-123 was granted.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "approval-read",
        name: "Read approvals",
        description:
          "Reads durable approval requests through the governed public approval lifecycle.",
        tags: ["approval", "read", "governed"],
        examples: [
          "Read approval approval-123.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "approval-decide",
        name: "Decide approvals",
        description:
          "Records approval decisions through the governed public approval lifecycle. " +
          "This does not mint grants, expose tokens, or execute anything directly.",
        tags: ["approval", "decide", "governed"],
        examples: [
          "Record an APPROVE decision for approval approval-123 with a reason.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "evidence-submit-read",
        name: "Submit and read evidence",
        description:
          "Submits governed evidence and reads allowlisted evidence views through the public " +
          "evidence lifecycle. Evidence never creates authority.",
        tags: ["evidence", "submit", "read"],
        examples: [
          "Submit evidence for workflow wf-123.",
          "Read evidence envelope evidence-123.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "outcome-read",
        name: "Read outcomes",
        description:
          "Reads allowlisted OutcomeContract status through the governed public API. " +
          "This is an inspection-only lifecycle read.",
        tags: ["outcome", "read", "status"],
        examples: [
          "Read outcome outcome-123.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
      {
        id: "resolution-read",
        name: "Read resolutions",
        description:
          "Reads allowlisted resolution status either by case id or by linked outcome id " +
          "through the governed public API.",
        tags: ["resolution", "read", "status"],
        examples: [
          "Read resolution case rc-123.",
          "Read the resolution case linked to outcome outcome-123.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
    ],
  };
  return card;
}
