import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SDK_CAPABILITIES } from "@truemandate/sdk-core";
import { DeveloperPage } from "./DeveloperPage";
import { DemoPage } from "./DemoApp";
import { BenchmarkPage } from "./BenchmarkPage";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

describe("developer view truth", () => {
  const html = renderToString(<DeveloperPage />);

  it("renders every SDK capability with its real classification", () => {
    for (const cap of Object.keys(SDK_CAPABILITIES) as (keyof typeof SDK_CAPABILITIES)[]) {
      expect(html, `capability ${cap} rendered`).toContain(cap);
      const descriptor = SDK_CAPABILITIES[cap];
      switch (descriptor.status) {
        case "supported":
          expect(html, `${cap} supported label`).toContain("supported — real route");
          break;
        case "demo-only":
          expect(html, `${cap} demo-only label`).toContain("demo-only — synthetic, not canonical");
          break;
        case "infrastructure-owned":
          expect(html, `${cap} infra-owned label`).toContain("infrastructure-owned — no SDK method");
          break;
      }
    }
    expect(html).toContain("demo-only — synthetic, not canonical");
    expect(html).toContain("not canonical production state");
    expect(html).toContain("The SDK proposes, transports and verifies");
    expect(html).toContain("Infrastructure authorizes");
  });

  it("shows the governed public routes and no internal path", () => {
    for (const path of [
      "POST /v1/intents",
      "GET /v1/demo/canonical-phase-c-v5",
      "POST /v1/workflows",
      "GET /v1/workflows/:workflowId",
      "POST /v1/workflows/:workflowId/resume-approval",
      "POST /v1/workflows/:workflowId/commit",
      "GET /v1/approvals/:id",
      "POST /v1/approvals/:id/decide",
      "POST /v1/evidence",
      "GET /v1/evidence/:id",
      "GET /v1/outcomes/contracts/:id",
      "GET /v1/resolutions/cases/:id",
      "GET /v1/resolutions/cases/by-outcome/:outcomeContractId",
      "GET /v1/resolutions/cases/:id/remedies",
      "GET /v1/resolutions/mandates/:id",
      "GET /v1/workspace/:intentId",
    ]) {
      expect(html).toContain(path);
    }
    expect(html).not.toContain("/internal/");
    expect(html).not.toContain("bind-and-mint");
  });

  it("is Agent Registry REGISTERED — discovery only, never authority", () => {
    expect(html).toContain("Agent Registry ready");
    expect(html).toContain("registered · discovery only");
    expect(html).toContain("Registered");
    expect(html).toContain("us-central1");
    expect(html).not.toMatch(/Registered ✓|Registered successfully/);
    expect(html).toContain("gcloud agent-registry services create");
    expect(html).toContain("--agent-spec-type=a2a-agent-card");
    expect(html).toContain("zero path");
    expect(html).toContain("no allUsers");
    expect(html).toContain("does NOT proxy privileged execution");
    expect(html).toContain("no authority and no execution permission");
  });

  it("names the verified package versions, backend, and the card path", () => {
    expect(html).toContain("@google/adk@1.6.0");
    expect(html).toContain("@a2a-js/sdk@1.0.1");
    expect(html).toContain("Vertex AI");
    expect(html).toContain("GOOGLE_GENAI_USE_VERTEXAI");
    expect(html).toContain("no API-key requirement");
    expect(html).toContain("/.well-known/agent-card.json");
    expect(html).toContain("true_mandate_record_intent");
    expect(html).toContain("true_mandate_canonical_proof");
    expect(html).toContain("No payment tool");
  });

  it("keeps ingress truth: recording an intent does not run it", () => {
    expect(html).toContain("Recording an intent does not run it");
    expect(html).toContain("does NOT automatically traverse the canonical procurement proof");
  });
});

describe("four-item judge navigation with nested surfaces", () => {
  it("shows exactly the four primary nav items", () => {
    const html = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />);
    const navLabels = [...html.matchAll(/class="tm-nav"[^>]*>([\s\S]*?)<\/span>/g)];
    const labels = (navLabels[0]?.[1] ?? "").replace(/<[^>]+>/g, " ");
    // Ordered to match the intended judge walkthrough.
    for (const label of ["Live Proof", "Attack Lab", "Production Qualification", "Architecture"]) {
      expect(labels, `primary nav label ${label}`).toContain(label);
    }
    expect(labels.indexOf("Live Proof")).toBeLessThan(labels.indexOf("Attack Lab"));
    expect(labels.indexOf("Attack Lab")).toBeLessThan(labels.indexOf("Production Qualification"));
    expect(labels.indexOf("Production Qualification")).toBeLessThan(labels.indexOf("Architecture"));
    for (const removed of ["Provenance", "500 Stress", "Developer SDK"]) {
      expect(labels, `no top-level ${removed}`).not.toContain(removed);
    }
  });

  it("shows Live Demo and Canonical Proof under Live Proof", () => {
    const html = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view="proof" />);
    expect(html).toContain("Live Demo");
    expect(html).toContain("Canonical Proof");
  });

  it("nests provenance under Canonical Proof", () => {
    const html = renderToString(
      <DemoPage
        projection={CANONICAL_PHASE_C_V5}
        view="proof"
        proofSurface="canonical-proof"
      />,
    );
    expect(html).toContain("Canonical walkthrough");
    expect(html).toContain("Canonical provenance graph");
    expect(html).toContain("Historical immutable evidence");
  });

  it("separates the current qualification evidence from historical SAFE evidence", () => {
    const html = renderToString(<BenchmarkPage />);
    // Current, multi-domain qualification is the judge-facing surface.
    expect(html).toContain("Production Qualification");
    expect(html).toContain("Five DomainPacks");
    // The superseded corpus is reachable but clearly labelled and not current.
    expect(html).toContain("Historical benchmark");
    expect(html).toContain("superseded procurement-era corpus");
    // Its numbers are not mounted until a judge deliberately opens it.
    expect(html).not.toContain("472 / 500");
    // Acceptance is never claimed.
    expect(html).toContain("Benchmark V2 full acceptance was not achieved");
  });

  it("nests SDK / ADK / A2A / Registry under Architecture", () => {
    const html = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />);
    expect(html).toContain("Trust architecture");
    expect(html).toContain("Developer SDK");
    expect(html).toContain("Google ADK · A2A");
    expect(html).toContain("Agent Registry");
    expect(html).toContain("TrueMandate Trust Architecture");
    expect(html).toContain("Human Intent");
    expect(html).toContain("Resolution / Learning");
    expect(html).toContain("BigQuery analytics");
    expect(html).toContain("OpenTelemetry");
    expect(html).not.toContain("FUTURE");
  });

  it("no presentation surface claims a human gate or approval", () => {
    for (const view of ["proof", "architecture", "benchmark", "attack"] as const) {
      const vhtml = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view={view} />);
      expect(vhtml, `view ${view}: no "gate satisfied"`).not.toContain("gate satisfied");
      expect(vhtml, `view ${view}: no "Human gate"`).not.toContain("Human gate");
      expect(vhtml, `view ${view}: no "Human approved"`).not.toContain("Human approved");
    }
    const dev = renderToString(<DeveloperPage />);
    expect(dev).not.toContain("gate satisfied");
    expect(dev).not.toContain("Human approved");
  });
});
