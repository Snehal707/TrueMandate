import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoPage } from "./DemoApp";
import { QualificationPage } from "./QualificationPage";
import { AttackLabPage } from "./AttackLabPage";
import { StageRail } from "./LiveDemoPage";
import { deriveStageRail } from "./live-stage-rail";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * The semantic colour system must be applied by attribute, not by hand, so the
 * same concept looks identical on every surface. These tests pin the hooks and
 * the palette discipline rather than exact pixel values.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = (name: string) => readFileSync(path.join(HERE, name), "utf8");

const stageIds = ["intent", "verification", "planning", "guardian", "authority", "execution", "provenance"];

describe("semantic colour system", () => {
  it("defines an accent for every governed stage", () => {
    const source = css("semantic-color.css");
    for (const id of stageIds) {
      expect(source, `stage ${id}`).toContain(`[data-stage="${id}"]`);
    }
  });

  it("derives every stage accent from the existing four accents only", () => {
    const source = css("semantic-color.css");
    const block = source.slice(0, source.indexOf("Shared stage primitives"));
    // No raw hex or rgb() colours may be introduced in the stage token block.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    for (const token of ["--blue", "--emerald", "--amber"]) {
      expect(block, token).toContain(token);
    }
  });

  it("shifts the palette at the trust boundary rather than using seven hues", () => {
    const source = css("semantic-color.css");
    // Proposal side is blue-led, Guardian is the amber gate, provenance is emerald.
    expect(source).toMatch(/\[data-stage="intent"\][\s\S]{0,120}--blue/);
    expect(source).toMatch(/\[data-stage="guardian"\][\s\S]{0,120}--amber/);
    expect(source).toMatch(/\[data-stage="provenance"\][\s\S]{0,120}--emerald/);
  });

  it("gives TrueMandate and Baseline one identity each", () => {
    const source = css("semantic-color.css");
    expect(source).toMatch(/\[data-identity="truemandate"\][\s\S]{0,120}--emerald/);
    expect(source).toMatch(/\[data-identity="baseline"\][\s\S]{0,120}--red/);
  });
});

describe("stage hooks are applied consistently across surfaces", () => {
  const landing = renderToString(
    <DemoPage projection={CANONICAL_PHASE_C_V5} mode="landing" proofSurface="canonical-proof" />,
  );
  const architecture = renderToString(
    <DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />,
  );
  const rail = renderToString(<StageRail stages={deriveStageRail({
    hasRun: true,
    workspacePresent: false,
    artifactsPresent: false,
    evaluationPresent: false,
    outcomePresent: false,
    resolutionPresent: false,
    evidenceCount: 0,
    requestInFlight: false,
  })} />);

  it("the live rail tags every stage", () => {
    for (const id of stageIds) {
      expect(rail, `rail stage ${id}`).toContain(`data-stage="${id}"`);
    }
  });

  it("landing and architecture share the rail's stage vocabulary", () => {
    for (const surface of [landing, architecture]) {
      for (const id of ["intent", "verification", "authority", "execution", "provenance"]) {
        expect(surface, `stage ${id}`).toContain(`data-stage="${id}"`);
      }
    }
  });

  it("architecture marks the Guardian gate and the infrastructure substrate", () => {
    expect(architecture).toContain('data-stage="guardian"');
    expect(architecture).toContain('data-stage="planning"');
    expect(architecture).toContain('data-stage="infrastructure"');
  });
});

describe("architecture is judge-readable before it is technical", () => {
  const architecture = renderToString(
    <DemoPage projection={CANONICAL_PHASE_C_V5} view="architecture" />,
  );

  it("leads with the simplified layered view", () => {
    expect(architecture).toContain("How an agent action is governed");
    expect(architecture).toContain("Human / Client");
    expect(architecture).toContain("Semantic interpretation &amp; verification");
    expect(architecture).toContain("Google Cloud");
  });

  it("makes the trust boundary and the prohibition explicit", () => {
    expect(architecture).toContain("Trust boundary");
    expect(architecture).toContain("Data crosses. Authority does not.");
    expect(architecture).toContain("never go straight from output to execution");
  });

  it("moves the deep technical view into a disclosure without hiding it from the DOM", () => {
    expect(architecture).toContain("Full technical architecture");
    // Existing technical content is still rendered (not lazily mounted).
    expect(architecture).toContain("Model Armor");
    expect(architecture).toContain("Firestore");
  });

  it("cites current qualification evidence, not the superseded SAFE corpus", () => {
    expect(architecture).toContain("Paired correctness");
    expect(architecture).not.toMatch(/472<!-- --> \/ <!-- -->500/);
    expect(architecture).not.toContain("472 / 500");
  });
});

describe("identity is applied on the comparison surfaces", () => {
  it("qualification tags TrueMandate and Baseline", () => {
    const html = renderToString(<QualificationPage />);
    expect(html).toContain('data-identity="truemandate"');
    expect(html).toContain('data-identity="baseline"');
  });

  it("attack lab lanes carry the same identity vocabulary", () => {
    const html = renderToString(<AttackLabPage />);
    expect(html).toContain("tm-attack-scenario-card");
    // Lanes only render after a run; the identity hook lives in the same module.
    const source = readFileSync(path.join(HERE, "AttackLabPage.tsx"), "utf8");
    expect(source).toContain('data-identity="baseline"');
    expect(source).toContain('data-identity="truemandate"');
  });
});
