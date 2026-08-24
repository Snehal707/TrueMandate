import { SDK_CAPABILITIES, type SdkCapabilityStatus } from "@truemandate/sdk-core";

/**
 * Developer sections — SDK + Google ADK/A2A + Agent Registry readiness.
 * All facts render from the real SDK surface and the verified integration
 * (no invented endpoints). Split into reusable sections so the four-item
 * judge nav can nest them under Architecture; DeveloperPage below keeps the
 * combined composition.
 */

const STATUS_LABELS: Readonly<Record<SdkCapabilityStatus, { label: string; className: string }>> = {
  supported: { label: "supported — real route", className: "good" },
  degraded: { label: "degraded — experimental backing", className: "warn-cell" },
  "demo-only": { label: "demo-only — synthetic, not canonical", className: "warn-cell" },
  "infrastructure-owned": { label: "infrastructure-owned — no SDK method", className: "bad" },
};

export function DeveloperSdkSection() {
  return (
    <div>
      <h3 style={{ margin: "1.4rem 0 0.6rem", fontSize: "1.05rem" }}>
        Developer SDK · TypeScript · framework-neutral
      </h3>
      <p style={{ color: "var(--text-dim)", maxWidth: 780, margin: "0 0 1rem" }}>
        <code>@truemandate/sdk-core</code> + <code>@truemandate/sdk-agent</code> expose only
        real capabilities, each classified explicitly — never presented as equivalent
        production capabilities. <strong>The SDK proposes, transports and verifies.
        Infrastructure authorizes.</strong> Recording an intent does not run it; a newly
        recorded arbitrary Intent does NOT automatically traverse the canonical procurement
        proof.
      </p>

      <div className="tm-bm-table" role="table" aria-label="SDK capability classification table">
        <div className="tm-bm-row head" role="row">
          <span role="columnheader">Capability</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Real backing</span>
        </div>
        {(Object.keys(SDK_CAPABILITIES) as (keyof typeof SDK_CAPABILITIES)[]).map((cap) => {
          const descriptor = SDK_CAPABILITIES[cap];
          const status = STATUS_LABELS[descriptor.status];
          const route = "route" in descriptor ? descriptor.route : undefined;
          return (
            <div className="tm-bm-row" role="row" key={cap}>
              <span role="cell" className="name"><code>{cap}</code></span>
              <span role="cell" className={status.className}>{status.label}</span>
              <span role="cell">
                {route ? <code>{route}</code> : ""}
                {route ? " — " : ""}
                {descriptor.note}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdkA2aSection() {
  return (
    <div>
      <h3 style={{ margin: "1.4rem 0 0.6rem", fontSize: "1.05rem" }}>
        Google ADK + A2A · Agent Registry ready
      </h3>
      <p style={{ color: "var(--text-dim)", maxWidth: 780, margin: "0 0 1rem" }}>
        Reference integration on the official Google ADK package:{" "}
        <code>@google/adk@1.6.0</code> + <code>@a2a-js/sdk@1.0.1</code> (A2A 1.0), running on
        Vertex AI with Application Default Credentials (no API-key requirement). The agent
        exposes exactly two TrueMandate tools — <code>true_mandate_record_intent</code> and{" "}
        <code>true_mandate_canonical_proof</code> — both backed by the real SDK routes. No
        payment tool, no execution surface. The A2A service stays authenticated (no
        allUsers); the Agent Card is public metadata served at the well-known path.
      </p>
      <div className="tm-chips" style={{ marginTop: "0.4rem" }}>
        <span className="tm-chip"><b>Agent Card</b> — <code>/.well-known/agent-card.json</code> · A2A 1.0 · JSONRPC</span>
        <span className="tm-chip"><b>Model backend</b> — Vertex AI · ADC (GOOGLE_GENAI_USE_VERTEXAI)</span>
        <span className="tm-chip"><b>Protocol</b> — supportedInterfaces protocolVersion 1.0</span>
        <span className="tm-chip"><b>Card size</b> — under the 10 KB registry limit</span>
        <span className="tm-chip ok"><b>Agent Registry</b> — registered · discovery only</span>
      </div>
    </div>
  );
}

export function AgentRegistrySection() {
  return (
    <div>
      <h3 style={{ margin: "1.4rem 0 0.6rem", fontSize: "1.05rem" }}>
        Agent Registry readiness — discovery only
      </h3>
      <p style={{ color: "var(--text-dim)", maxWidth: 780, margin: "0 0 1rem" }}>
        The Agent Registry discovers capabilities and indexes A2A skills. It is
        discovery-only in TrueMandate's architecture — <strong>zero path</strong> into
        AuthorityGrant / PreparedAction / CommitToken / Gateway decision. It does NOT proxy
        privileged execution, authenticate economic authority, mint grants, mint
        CommitTokens, or authorize Gateway COMMIT. The A2A service stays authenticated
        (no allUsers, no public Gateway/Authority access, no public BFF privilege);
        registration submits the validated card content:
      </p>
      <pre style={{ overflowX: "auto", fontSize: "0.78rem", margin: "0.5rem 0" }}>{`gcloud agent-registry services create truemandate-governed-agent \\
      --project=elite-crossbar-505104-t9 \\
      --location=us-central1 \\
      --display-name="TrueMandate Governance Agent" \\
      --agent-spec-type=a2a-agent-card \\
      --agent-spec-content=<validated-agent-card>`}</pre>
      <p style={{ color: "var(--text-dim)", maxWidth: 780 }}>
        Status: <strong>Registered</strong> (us-central1) — the writable Service and the
        projected Agent exist, with both A2A skills indexed. Registration grants{" "}
        <strong>no authority and no execution permission</strong>: discovery never
        implies invocation. See <code>docs/agent-registry-readiness.md</code>.
      </p>
    </div>
  );
}

/** Combined developer composition (kept reusable; nested under Architecture in the nav). */
export function DeveloperPage() {
  return (
    <section className="tm-view" aria-label="Developer SDK and ADK">
      <p className="overline">Proof surface 5</p>
      <h2>Developer SDK + Google ADK + A2A</h2>
      <DeveloperSdkSection />
      <AdkA2aSection />
      <AgentRegistrySection />
    </section>
  );
}
