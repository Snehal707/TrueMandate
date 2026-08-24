import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { DemoPage } from "./DemoApp";
import { DeveloperPage } from "./DeveloperPage";
import { BenchmarkPage } from "./BenchmarkPage";
import { StressPage } from "./StressPage";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";
import { STRESS_READ_MODEL } from "./stress-readmodel";

/**
 * SUBMISSION TRUTH FREEZE.
 *
 * MAY-claim (all verified live in the deployment pass, all rendered from
 * artifacts/constants — never inline): TypeScript SDK implemented · Google
 * ADK live · A2A 1.0 live · Agent Registry registered · Vertex Gemini live
 * · Model Armor live · 472/500 deterministic adversarial scenarios · 0
 * unauthorized executions · 0 critical incidents.
 *
 * MUST-NOT-claim (absence enforced across every presentation source).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = [
  "DemoApp.tsx",
  "DemoScenes.tsx",
  "demoDerived.ts",
  "DeveloperPage.tsx",
  "StressPage.tsx",
  "BenchmarkPage.tsx",
  "AttackLabPage.tsx",
  "ProvenancePage.tsx",
  "demoMachine.ts",
];

const FORBIDDEN = [
  "npm package published",
  "arbitrary external intents execute",
  "BigQuery deployed",
  "preference memory implemented",
  "adaptive trust implemented",
  "complete model telemetry",
  "ALLOW_WITH_MONITORING loop",
  "Agent Registry grants authority",
  "Human approved",
  "gate satisfied",
  "500/500",
];

describe("submission truth freeze", () => {
  it("renders only the verified MAY-claim facts", () => {
    const dev = renderToString(<DeveloperPage />);
    const stress = renderToString(<StressPage />);
    const bench = renderToString(<BenchmarkPage />);
    // Model Armor is live and stated in the deployed Architecture view.
    const arch = renderToString(
      <DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />,
    );

    expect(dev).toContain("TypeScript");
    expect(dev).toContain("@google/adk@1.6.0");
    expect(dev).toContain("@a2a-js/sdk@1.0.1");
    expect(dev).toContain("Registered");
    expect(dev).toContain("Vertex AI");
    expect(arch).toContain("Model Armor");
    expect(bench).toBeTruthy();
    // React SSR inserts comment separators between text nodes — compare on
    // comment-stripped text.
    const stressText = stress.replace(/<!-- -->/g, "");
    expect(stressText).toContain("472 / 500");
    expect(stressText).toContain("0 unauthorized");
    expect(stressText).toContain("0 critical");
    // All three stress numbers come from the artifact-derived read model.
    expect(STRESS_READ_MODEL.combined.trumandateFull).toMatchObject({
      total: 500,
      passed: 472,
      criticalIncidentCount: 0,
      unauthorizedExecutionCount: 0,
    });
  });

  it("no presentation source claims any forbidden fact", () => {
    for (const f of SOURCES) {
      const src = readFileSync(path.join(HERE, f), "utf8");
      for (const bad of FORBIDDEN) {
        expect(src, `${f} must not claim: ${bad}`).not.toContain(bad);
      }
    }
    // Rendered double-check for the highest-risk claims.
    const html = [
      renderToString(<DeveloperPage />),
      renderToString(<StressPage />),
      renderToString(<DemoPage projection={CANONICAL_PHASE_C_V5} />),
    ].join("\n");
    for (const bad of ["BigQuery deployed", "Human approved", "500/500", "Agent Registry grants authority"]) {
      expect(html, `rendered UI must not claim: ${bad}`).not.toContain(bad);
    }
  });

  it("Registry copy states discovery never implies invocation", () => {
    const html = renderToString(<DeveloperPage />);
    expect(html).toContain("discovery only");
    expect(html).toContain("no authority and no execution permission");
    expect(html).toContain("discovery never implies invocation");
  });
});
