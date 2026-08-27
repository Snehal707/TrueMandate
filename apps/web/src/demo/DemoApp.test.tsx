import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DemoApp, DemoPage } from "./DemoApp";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * Render smoke tests via react-dom/server (no browser needed).
 * DemoPage is pure — deterministic render of the three-act judge flow.
 */

describe("DemoPage main proof render (V2)", () => {
  function render(extra?: {
    source?: "live";
    view?: "attack" | "architecture";
    notice?: string;
    proofSurface?: "live-demo" | "canonical-proof";
  }): string {
    return renderToString(
      <DemoPage
        projection={CANONICAL_PHASE_C_V5}
        source={extra?.source}
        view={extra?.view}
        notice={extra?.notice}
        proofSurface={extra?.proofSurface ?? "canonical-proof"}
      />,
    );
  }

  it("hero reveals the punchline in the first viewport", () => {
    const html = render();
    expect(html).toContain("Autonomous agents can execute correctly");
    expect(html).toContain("violate human intent");
    expect(html).toContain("verifies both");
    expect(html).toContain("50 CONTAINERS MISSING");
    expect(html).toContain("Explore the live proof");
    expect(html).toContain("See what went wrong");
    // read-only: the misleading CTA must be gone
    expect(html).not.toContain("Run the 500-container scenario");
    // stale internal version label gone
    expect(html).not.toContain("Phase C v5");
    expect(html).toContain("Semantic trust for autonomous agents");
    // full mode keeps the canonical request card (procurement = proof scenario)
    expect(html).toContain("food-grade");
  });

  it("Live Demo is platform-first and exposes the six real workflow domains", () => {
    const html = renderToString(
      <DemoPage projection={CANONICAL_PHASE_C_V5} proofSurface="live-demo" />,
    );
    expect(html).toContain("SEMANTIC TRUST FOR AUTONOMOUS AGENTS");
    expect(html).toContain("Understand Intent");
    expect(html).toContain("Bound Authority");
    expect(html).toContain("Verify Outcomes");
    for (const domain of ["Procurement", "Travel", "SaaS / IT Spend", "Invoice / Vendor Payment", "Logistics / Fulfillment", "Custom Intent"]) {
      expect(html).toContain(domain);
    }
    expect(html).toContain("LIVE");
    expect(html).toContain("PUBLIC SDK / API");
    expect(html).not.toContain("CONTAINERS MISSING");
    expect(html).not.toContain("PARTIAL");
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.intent.id);
  });

  it("punchline strip carries authorized / executed / outcome", () => {
    const html = render();
    expect(html).toContain("Authorized");
    expect(html).toContain("Executed");
    expect(html).toContain("Outcome");
    expect(html).toContain("SUCCESS");
    expect(html).toContain("PARTIAL");
    expect(html).toContain("7,42,000");
  });

  it("renders the three acts with their judge questions", () => {
    const html = render();
    expect(html).toContain("Can the agent act?");
    expect(html).toContain("Did it execute exactly what was authorized?");
    expect(html).toContain("Did successful execution fulfill the human goal?");
    expect(html).toContain("ACT I");
    expect(html).toContain("ACT II");
    expect(html).toContain("ACT III");
  });

  it("act I renders constraints, authority and guardian canonically", () => {
    const html = render();
    expect(html).toContain("6 / 6 verified");
    expect(html).toContain("REQUIRE_APPROVAL");
    expect(html).toContain("HUMAN REVIEW REQUIRED");
    expect(html).toContain("authority decided: ALLOW");
    expect(html).toContain("ALLOW");
    expect(html).toContain("&lt; ₹");
    expect(html).toContain("8,00,000");
    expect(html).toContain("food-grade containers");
    expect(html).toContain("Dec 31, 2030");
    // presentation alias: internal supplier id only in details
    expect(html).toContain("Approved supplier");
    expect(html).toContain("Authorization proves permission, not understanding.");
    // Act I primary card shows the friendly derived summary, not raw internals
    expect(html).toContain("Human intent · summary");
    expect(html).toContain("an approved supplier");
    expect(html).toContain("View original canonical request");
    // grounded spans of the exact original request preserved behind disclosure
    expect(html).toContain("<mark>500</mark>");
  });

  it("act II renders exact-match comparison and exactly-once", () => {
    const html = render();
    expect(html).toContain("EXACT MATCH");
    expect(html).toContain("EXACTLY ONCE");
    expect(html).toContain("Mock payment");
    expect(html).toContain("Approved supplier");
    expect(html).toContain("phase-b-supplier"); // internal id preserved in details
    expect(html).toContain("The caller could not change amount, supplier or currency at COMMIT.");
    // proof behind disclosure
    expect(html).toContain("View execution proof");
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.execution.commitTokenId);
    expect(html).toContain("Authorized handle consumed exactly once");
    expect(html).toContain("mock-pay-phase-c-food-grade-500-v5");
    expect(html).toContain("IDEMPOTENT_REPLAY");
  });

  it("act III renders the centerpiece with large numbers", () => {
    const html = render();
    expect(html).toContain("Payment success");
    expect(html).toContain("is not");
    expect(html).toContain("outcome success");
    expect(html).toContain("450 received");
    expect(html).toContain("50 missing");
    expect(html).toContain("Required");
    expect(html).toContain("Verified received");
    expect(html).toContain("Missing");
  });

  it("evidence renders as a contradiction, not a card grid", () => {
    const html = render();
    expect(html).toContain("Merchant says");
    expect(html).toContain("dispatched");
    expect(html).toContain("Warehouse verified");
    expect(html).toContain("450 received");
    expect(html).toContain("Insufficient evidence to locate the loss");
    expect(html).toContain("versus");
    expect(html).toContain("50-unit destination shortfall");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("TrueMandate preserves the contradiction instead of inventing blame.");
    expect(html).toContain("Inspect accepted evidence");
  });

  it("resolution is simple and shows the economic boundary", () => {
    const html = render();
    expect(html).toContain("What should happen next?");
    expect(html).toContain("50 units are missing");
    expect(html).toContain("Supplier packing / count record");
    expect(html).toContain("Carrier pickup &amp; acceptance count");
    expect(html).toContain("Warehouse receiving record");
    expect(html).toContain("No new economic authority");
    const notExecuted = (html.match(/NOT EXECUTED/g) ?? []).length;
    expect(notExecuted).toBe(3);
    expect(html).toContain("Reasoning can recommend a remedy. It cannot authorize one.");
  });

  it("secondary views never show the fallback notice sentence", () => {
    const attack = renderToString(
      <DemoPage projection={CANONICAL_PHASE_C_V5} view="attack" notice="Live proof temporarily unavailable." />,
    );
    expect(attack).not.toContain("Live proof temporarily unavailable.");
    const arch = renderToString(
      <DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" notice="Live proof temporarily unavailable." />,
    );
    expect(arch).not.toContain("Live proof temporarily unavailable.");
  });

  it("attack lab is the real public workflow comparison, not part of the main proof", () => {
    const main = render();
    expect(main).not.toContain("Try to break TrueMandate yourself");
    const attack = render({ view: "attack" });
    expect(attack).toContain("Try to break TrueMandate yourself");
    expect(attack).toContain("Curated Attacks");
    expect(attack).toContain("Build Your Own Attack");
    expect(attack).toContain("REAL PUBLIC WORKFLOW PATH");
    expect(attack).toContain("Prompt Injection");
    expect(attack).toContain("Execution / TOCTOU");
  });

  it("benchmark view presents observed qualification without claiming acceptance", () => {
    const bm = renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} view="benchmark" />);
    expect(bm).toContain("Production Qualification");
    expect(bm).toContain("Benchmark V2 full acceptance was not achieved");
    expect(bm).toContain("Historical benchmark");
    // Superseded procurement-era numbers never reach the default judge path.
    expect(bm).not.toMatch(/472<!-- --> \/ <!-- -->500/);
    expect(bm).not.toMatch(/fully accepted|acceptedDataset/);
  });

  it("architecture is a layered presentation with the trust boundary", () => {
    const main = render();
    expect(main).not.toContain("How TrueMandate works");
    const arch = render({ view: "architecture" });
    expect(arch).toContain("TrueMandate Trust Architecture");
    expect(arch).toContain("LLMs reason. Infrastructure authorizes. Outcomes are verified.");
    expect(arch).toContain("Human Intent");
    expect(arch).toContain("Intent Provenance");
    expect(arch).toContain("Semantic Readiness / Guardian");
    expect(arch).toContain("Adaptive Authority");
    expect(arch).toContain("Governed Execution");
    expect(arch).toContain("Outcome Verification");
    expect(arch).toContain("Resolution / Learning");
    expect(arch).toContain("Gemini · Vertex AI");
    expect(arch).toContain("Model Armor");
    expect(arch).toContain("Firestore");
    expect(arch).toContain("BigQuery analytics");
    expect(arch).toContain("OpenTelemetry");
    expect(arch).toContain("Cloud Trace");
    expect(arch).toContain("Semantic Trust Runtime");
    expect(arch).toContain("DISCOVERY — not authority");
    expect(arch).toContain("Trust boundary — data can cross. Authority cannot.");
    expect(arch).toContain("TrueMandate");
    expect(arch).toContain("authorizes.");
    expect(arch).not.toContain("FUTURE");
    expect(arch).toContain("Pub/Sub");
    expect(arch).toContain("Artifact Registry");
    expect(arch).toContain("VPC · PSC");
  });

  it("top navigation offers the four proof surfaces", () => {
    const html = render();
    expect(html).toContain("Live Proof");
    expect(html).toContain("SAFE Benchmark");
    expect(html).toContain("Attack Lab");
    expect(html).toContain("Architecture");
    expect(html).not.toContain("Main Proof");
  });

  it("footer carries read-only + preservation facts", () => {
    const html = render();
    expect(html).toContain("Read-only demo evidence.");
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.preservation.phaseACanonicalTokenId);
    expect(html).toContain("Privileged authorization handles remain private.");
  });

  it("shows only a subtle notice when live mode fails (no raw errors)", () => {
    const html = render({ notice: "Live proof temporarily unavailable." });
    expect(html).toContain("Live proof temporarily unavailable.");
    expect(html).not.toContain("Unexpected token");
    expect(html).toContain("Autonomous agents can execute correctly");
  });

  it("data-source indicators: snapshot by default, live proof data when served by the BFF", () => {
    expect(render()).toContain("CANONICAL SNAPSHOT");
    expect(render({ source: "live" })).toContain("LIVE PROOF DATA");
    // wording must not imply a fresh execution occurred
    expect(render({ source: "live" })).not.toContain("Live canonical proof");
  });
});

describe("DemoApp state machine", () => {
  it("renders the loading frame first", () => {
    const html = renderToString(<DemoApp load={() => new Promise(() => undefined)} />);
    expect(html).toContain("Loading canonical proof");
  });
});
