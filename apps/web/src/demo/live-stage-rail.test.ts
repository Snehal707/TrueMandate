import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  deriveStageRail,
  railProgressLabel,
  type RailInput,
} from "./live-stage-rail";

/**
 * The rail must reflect the real lifecycle and nothing else. These tests pin the
 * two properties that matter: it never invents progress the backend has not
 * reported, and a provider failure is never presented as an unsafe execution.
 */
const EMPTY: RailInput = {
  hasRun: false,
  workspacePresent: false,
  artifactsPresent: false,
  evaluationPresent: false,
  outcomePresent: false,
  resolutionPresent: false,
  evidenceCount: 0,
  requestInFlight: false,
};

const stageIds = ["intent", "verification", "planning", "guardian", "authority", "execution", "provenance"];

describe("stage rail derivation", () => {
  it("exposes the seven judge-facing stages in lifecycle order", () => {
    expect(deriveStageRail(EMPTY).map((stage) => stage.id)).toEqual(stageIds);
  });

  it("is deterministic — identical input yields identical output", () => {
    const input: RailInput = { ...EMPTY, hasRun: true, intentId: "intent-1", requestInFlight: true };
    expect(deriveStageRail(input)).toEqual(deriveStageRail(input));
  });

  it("reports nothing as done before the backend returns anything", () => {
    expect(deriveStageRail(EMPTY).every((stage) => stage.status === "waiting")).toBe(true);
  });

  it("marks a stage done only when its artifact is actually present", () => {
    const rail = deriveStageRail({ ...EMPTY, hasRun: true, intentId: "intent-1" });
    expect(rail.find((s) => s.id === "intent")?.status).toBe("done");
    // Nothing downstream may be claimed from an intent alone.
    for (const id of ["verification", "planning", "guardian", "authority", "execution", "provenance"]) {
      expect(rail.find((s) => s.id === id)?.status, id).not.toBe("done");
    }
  });

  it("never synthesises progress ahead of the returned artifacts", () => {
    const rail = deriveStageRail({
      ...EMPTY,
      hasRun: true,
      intentId: "intent-1",
      intentStateId: "state-1",
      workspacePresent: true,
      requestInFlight: true,
    });
    expect(rail.find((s) => s.id === "verification")?.status).toBe("done");
    // Planning is merely the frontier; it is active, not done.
    expect(rail.find((s) => s.id === "planning")?.status).toBe("active");
    expect(rail.filter((s) => s.status === "done").map((s) => s.id)).toEqual(["intent", "verification"]);
  });

  it("shows active only while a request is in flight, and only at the frontier", () => {
    const base: RailInput = { ...EMPTY, hasRun: true, intentId: "intent-1" };
    const idle = deriveStageRail(base);
    const working = deriveStageRail({ ...base, requestInFlight: true });

    expect(idle.some((stage) => stage.status === "active")).toBe(false);
    const activeStages = working.filter((stage) => stage.status === "active");
    expect(activeStages).toHaveLength(1);
    expect(activeStages[0]?.id).toBe("verification");
  });

  it("marks the frontier blocked when the workflow state is genuinely blocked", () => {
    const rail = deriveStageRail({
      ...EMPTY,
      hasRun: true,
      intentId: "intent-1",
      intentStateId: "state-1",
      workspacePresent: true,
      artifactsPresent: true,
      evaluationPresent: true,
      authorityDecision: "BLOCK",
      workflowState: "BLOCKED",
    });
    expect(rail.find((s) => s.id === "execution")?.status).toBe("blocked");
    // A block is not an execution.
    expect(rail.find((s) => s.id === "execution")?.detail).toBeUndefined();
  });

  it("does not mark anything blocked for a plain request failure", () => {
    const rail = deriveStageRail({ ...EMPTY, hasRun: true, errorCode: "VALIDATION_FAILED" });
    expect(rail.some((stage) => stage.status === "blocked")).toBe(false);
  });

  it("surfaces real backend values as stage detail rather than invented text", () => {
    const rail = deriveStageRail({
      ...EMPTY,
      hasRun: true,
      intentId: "intent-42",
      executionStatus: "SUCCESS",
      outcomePresent: true,
      outcomeState: "PARTIAL",
    });
    expect(rail.find((s) => s.id === "intent")?.detail).toBe("intent-42");
    expect(rail.find((s) => s.id === "execution")?.detail).toBe("SUCCESS");
    expect(rail.find((s) => s.id === "provenance")?.detail).toBe("PARTIAL");
  });

  it("summarises progress from the derived stages", () => {
    expect(railProgressLabel(deriveStageRail(EMPTY))).toContain("0 of 7");
    const blocked = deriveStageRail({ ...EMPTY, hasRun: true, workflowState: "BLOCKED" });
    expect(railProgressLabel(blocked)).toContain("Stopped at");
  });
});

describe("failure classification", () => {
  it("returns nothing when there is no error", () => {
    expect(classifyFailure(undefined)).toBeUndefined();
  });

  it("treats an unavailable model as fail-closed, not unsafe execution", () => {
    const failure = classifyFailure("MODEL_UNAVAILABLE");
    expect(failure?.kind).toBe("verification-unavailable");
    expect(failure?.headline).toBe(
      "Execution stopped because required verification could not be completed.",
    );
    expect(failure?.explanation).toContain("not an unsafe execution");
  });

  it("separates a transport failure from a governance verdict", () => {
    expect(classifyFailure("VALIDATION_FAILED")?.kind).toBe("request-failure");
    expect(classifyFailure("SEMANTIC_GATE_BLOCKED")?.kind).toBe("governance-refusal");
    expect(classifyFailure("AUTHORITY_BLOCKED")?.kind).toBe("governance-refusal");
    expect(classifyFailure("CUMULATIVE_EXPOSURE_EXCEEDED")?.kind).toBe("governance-refusal");
  });

  it("always states that no economic action was taken", () => {
    for (const code of ["MODEL_UNAVAILABLE", "VALIDATION_FAILED", "SEMANTIC_GATE_BLOCKED"]) {
      expect(classifyFailure(code)?.economicEffect, code).toBe("No economic action was taken.");
    }
  });

  it("never describes a failure as a success", () => {
    for (const code of ["MODEL_UNAVAILABLE", "VALIDATION_FAILED", "AUTHORITY_BLOCKED"]) {
      const failure = classifyFailure(code)!;
      const text = `${failure.headline} ${failure.explanation}`.toLowerCase();
      expect(text, code).not.toMatch(/succeeded|completed successfully|authorized and executed/);
    }
  });
});
