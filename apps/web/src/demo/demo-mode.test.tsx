import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DemoWalkthrough } from "./DemoScenes";
import {
  DEMO_STAGES,
  RUN_STAGES,
  STAGE_DURATIONS_MS,
  TOTAL_AUTOPLAY_MS,
  nextStage,
  prevStage,
} from "./demoMachine";
import type { CanonicalProjection } from "@truemandate/read-model";
import { derivePresentation } from "./demoDerived";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";
import type { DemoController } from "./demoMachine";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* state machine (pure functions)                                      */
/* ------------------------------------------------------------------ */

describe("demo state machine", () => {
  it("defines the required stage order", () => {
    expect(DEMO_STAGES).toEqual([
      "IDLE",
      "INTENT",
      "AUTHORIZATION",
      "EXECUTION",
      "PAYMENT_RESULT",
      "OUTCOME_EVIDENCE",
      "OUTCOME_RESULT",
      "RESOLUTION",
      "COMPLETE",
    ]);
  });

  it("autoplay total is within the 60–90 second target", () => {
    expect(TOTAL_AUTOPLAY_MS).toBeGreaterThanOrEqual(60_000);
    expect(TOTAL_AUTOPLAY_MS).toBeLessThanOrEqual(90_000);
  });

  it("advances and retreats deterministically", () => {
    expect(nextStage("IDLE")).toBe("INTENT");
    expect(nextStage("RESOLUTION")).toBe("COMPLETE");
    expect(nextStage("COMPLETE")).toBe("COMPLETE");
    expect(prevStage("INTENT")).toBe("INTENT");
    expect(prevStage("COMPLETE")).toBe("RESOLUTION");
  });

  it("no stage autoplay dwell exceeds 12s (subtle pacing)", () => {
    for (const s of RUN_STAGES) {
      expect(STAGE_DURATIONS_MS[s]).toBeLessThanOrEqual(12_000);
    }
  });
});

/* ------------------------------------------------------------------ */
/* scene rendering per stage                                            */
/* ------------------------------------------------------------------ */

const stubController = (stage: (typeof DEMO_STAGES)[number]): DemoController => ({
  stage,
  running: stage !== "IDLE",
  paused: false,
  stageIndex: DEMO_STAGES.indexOf(stage),
  runIndex: Math.max(0, RUN_STAGES.indexOf(stage)),
  start: () => undefined,
  next: () => undefined,
  back: () => undefined,
  restart: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  exit: () => undefined,
});

function scene(stage: (typeof DEMO_STAGES)[number], projection: CanonicalProjection = CANONICAL_PHASE_C_V5): string {
  return renderToString(
    <DemoWalkthrough
      projection={projection}
      controller={stubController(stage)}
      onExit={() => undefined}
    />,
  );
}

describe("demo scenes derive from the projection", () => {
  it("Scene 1 — intent: summary, constraints, then verified badge", () => {
    const html = scene("INTENT");
    expect(html).toContain("Human intent");
    expect(html).toContain("Buy 500 food-grade containers from an approved supplier");
    expect(html).toContain("6 / 6 verified");
  });

  it("Scene 2 — authority: gate flow with canonical labels", () => {
    const html = scene("AUTHORIZATION");
    expect(html).toContain("HUMAN REVIEW REQUIRED");
    expect(html).toContain("authority decided: ALLOW");
    expect(html).toContain("ALLOW");
    expect(html).toContain("₹7,42,000");
  });

  it("Scene 3 — execution: match + once derived", () => {
    const html = scene("EXECUTION");
    expect(html).toContain("EXACT MATCH");
    expect(html).toContain("EXACTLY ONCE");
    expect(html).toContain("Mock payment");
  });

  it("Scene 4 — payment result only; outcome not yet revealed", () => {
    const html = scene("PAYMENT_RESULT");
    expect(html).toContain("Payment");
    expect(html).toContain("SUCCESS");
    expect(html).not.toContain("PARTIAL");
    expect(html).not.toContain("Required");
  });

  it("Scene 5 — evidence quantities come from the projection", () => {
    const html = scene("OUTCOME_EVIDENCE");
    expect(html).toContain("500");
    expect(html).toContain("dispatched");
    expect(html).toContain("450");
    expect(html).toContain("received");
    expect(html).toContain("Insufficient evidence");
  });

  it("Scene 6 — punchline with derived numbers", () => {
    const html = scene("OUTCOME_RESULT");
    expect(html).toContain("SUCCESS");
    expect(html).toContain("PARTIAL");
    expect(html).toContain("Payment success");
    expect(html).toContain("outcome success");
  });

  it("Scene 7 — resolution + remedies derived", () => {
    const html = scene("RESOLUTION");
    expect(html).toContain("50-unit destination shortfall");
    expect(html).toContain("UNKNOWN");
    const notExecuted = (html.match(/NOT EXECUTED/g) ?? []).length;
    expect(notExecuted).toBe(3);
    expect(html).toContain("No new economic authority");
  });

  it("Completion — replay + technical proof actions", () => {
    const html = scene("COMPLETE");
    expect(html).toContain("TrueMandate caught what payment infrastructure cannot.");
    expect(html).toContain("Replay demo");
    expect(html).toContain("Inspect technical proof");
  });

  it("scene values follow a mutated projection (no presentation constants)", () => {
    const mutated: CanonicalProjection = {
      ...CANONICAL_PHASE_C_V5,
      outcome: {
        ...CANONICAL_PHASE_C_V5.outcome,
        divergence: { requiredQuantity: 500, verifiedReceived: 493, shortfall: 7, evidenceClaimIds: ["x"] },
      },
      resolution: {
        ...CANONICAL_PHASE_C_V5.resolution,
        remedyExecutions: 3,
      },
    };
    const html = scene("RESOLUTION", mutated);
    expect(html).toContain("7-unit destination shortfall");
    expect(html).toContain("EXECUTIONS: 3");
    expect(html).not.toContain("NOT EXECUTED");
  });
});

/* ------------------------------------------------------------------ */
/* canonical-value hard-code audit                                     */
/* ------------------------------------------------------------------ */

describe("no duplicated authoritative constants in presentation", () => {
  const FILES = ["DemoApp.tsx", "DemoScenes.tsx", "demoDerived.ts"];
  const NUMERIC_AUTHORITATIVE = /\b(742000|800000|450|500|50)\b/;

  it("presentation files contain no hard-coded authoritative numbers", () => {
    for (const f of FILES) {
      const src = readFileSync(path.join(HERE, f), "utf8");
      expect(src, `${f} must not hard-code 742000/800000/450/500/50`).not.toMatch(
        NUMERIC_AUTHORITATIVE,
      );
    }
  });

  it("authoritative decision strings live only as label-map keys in demoDerived", () => {
    for (const f of ["DemoApp.tsx", "DemoScenes.tsx"]) {
      const src = readFileSync(path.join(HERE, f), "utf8");
      expect(src, `${f} must not render canonical decisions from literals`).not.toMatch(
        /"REQUIRE_APPROVAL"|"PARTIAL"|"SUCCESS"|"ALLOW"/,
      );
    }
  });

  it("frozen projection remains the only offline data provider", () => {
    const frozen = readFileSync(path.join(HERE, "canonical-phase-c-v5.ts"), "utf8");
    expect(frozen).toContain("OFFLINE DEMO FALLBACK");
  });
});

/* ------------------------------------------------------------------ */
/* derived presentation                                                */
/* ------------------------------------------------------------------ */

describe("derivePresentation", () => {
  it("maps canonical values to judge-friendly labels", () => {
    const d = derivePresentation(CANONICAL_PHASE_C_V5);
    expect(d.intent.summarySentence).toBe(
      "Buy 500 food-grade containers from an approved supplier for under ₹8,00,000, before Dec 31, 2030.",
    );
    expect(d.intent.verifiedLabel).toBe("6 / 6 verified");
    expect(d.gate.guardianLabel).toBe("HUMAN REVIEW REQUIRED");
    expect(d.gate.gateSatisfied).toBe(true);
    expect(d.gate.authorityLabel).toBe("ALLOW");
    expect(d.gate.amountLabel).toBe("₹7,42,000");
    expect(d.execution.exactMatch).toBe(true);
    expect(d.execution.onceLabel).toBe("EXACTLY ONCE");
    expect(d.outcome.missingHeadline).toBe("50 CONTAINERS MISSING");
    expect(d.outcome.divergenceLabel).toBe("50-unit destination shortfall");
    expect(d.resolution.responsibilityLabel).toBe("UNKNOWN");
    expect(d.resolution.rootCauseLabel).toBe("UNKNOWN");
    expect(d.resolution.remediesNotExecuted).toBe(true);
  });

  it("fails honest when canonical values disagree (no invented success)", () => {
    const mutated: CanonicalProjection = {
      ...CANONICAL_PHASE_C_V5,
      guardian: { ...CANONICAL_PHASE_C_V5.guardian, decision: "OTHER" },
      authority: { ...CANONICAL_PHASE_C_V5.authority, decision: "BLOCK", amount: 741999 },
      execution: { ...CANONICAL_PHASE_C_V5.execution, sideEffectCountForFixture: 2 },
    };
    const d = derivePresentation(mutated);
    expect(d.gate.guardianLabel).toBe("OTHER");
    expect(d.gate.gateSatisfied).toBe(false);
    expect(d.gate.gateLabel).toBe("authority decided: BLOCK");
    expect(d.gate.authorityLabel).toBe("BLOCK");
    expect(d.execution.exactMatch).toBe(false);
    expect(d.execution.onceLabel).toBe("NOT PROVEN");
    expect(d.gate.amountLabel).toBe("₹7,41,999");
  });
});
