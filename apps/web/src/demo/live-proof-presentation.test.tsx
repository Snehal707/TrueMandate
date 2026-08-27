import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FailClosedPanel, StageRail } from "./LiveDemoPage";
import { deriveStageRail, type RailInput } from "./live-stage-rail";

/**
 * Presentation guarantees for the Live Proof surface:
 * a refusal never reads as a successful or unsafe execution, and the rail shows
 * only what the backend actually returned.
 */
const EMPTY: RailInput = {
  hasRun: true,
  workspacePresent: false,
  artifactsPresent: false,
  evaluationPresent: false,
  outcomePresent: false,
  resolutionPresent: false,
  evidenceCount: 0,
  requestInFlight: false,
};

describe("fail-closed presentation", () => {
  it("presents an unavailable verifier as a stop, not an execution", () => {
    const html = renderToString(
      <FailClosedPanel error={{ code: "MODEL_UNAVAILABLE", message: "Vertex rate limited" }} />,
    );
    expect(html).toContain("Execution stopped because required verification could not be completed.");
    expect(html).toContain("No economic action was taken.");
    expect(html).toContain("verification-unavailable");
    // The raw detail stays available but secondary.
    expect(html).toContain("MODEL_UNAVAILABLE");
    expect(html).toContain("Technical detail");
  });

  it("distinguishes a governance refusal from a transport failure", () => {
    const refusal = renderToString(
      <FailClosedPanel error={{ code: "AUTHORITY_BLOCKED", message: "blocked" }} />,
    );
    const transport = renderToString(
      <FailClosedPanel error={{ code: "VALIDATION_FAILED", message: "bad gateway" }} />,
    );
    expect(refusal).toContain("TrueMandate refused this action.");
    expect(refusal).toContain("governance-refusal");
    expect(transport).toContain("The request could not be completed.");
    expect(transport).toContain("request-failure");
    expect(refusal).not.toEqual(transport);
  });

  it("never renders a failure as success", () => {
    for (const code of ["MODEL_UNAVAILABLE", "VALIDATION_FAILED", "SEMANTIC_GATE_BLOCKED"]) {
      const html = renderToString(<FailClosedPanel error={{ code, message: "x" }} />);
      expect(html.toLowerCase(), code).not.toMatch(/executed successfully|payment success|authorized and executed/);
      expect(html, code).toContain("No economic action was taken.");
    }
  });
});

describe("stage rail presentation", () => {
  it("renders the seven stages with derived status", () => {
    const html = renderToString(<StageRail stages={deriveStageRail(EMPTY)} />);
    for (const label of ["Intent", "Verification", "Planning", "Guardian", "Authority", "Execution", "Provenance"]) {
      expect(html, label).toContain(label);
    }
    // EMPTY has a run, so Intent is already returned: 1 of 7.
    expect(html.replace(/<!-- -->/g, "")).toContain("1 of 7 stages returned");
  });

  it("answers the judge questions in plain language", () => {
    const html = renderToString(<StageRail stages={deriveStageRail(EMPTY)} />);
    expect(html).toContain("Was this action actually authorized?");
    expect(html).toContain("What evidence proves what happened?");
  });

  it("marks the in-flight stage active so long stages do not look frozen", () => {
    const html = renderToString(
      <StageRail stages={deriveStageRail({ ...EMPTY, intentId: "i-1", requestInFlight: true })} />,
    );
    expect(html).toContain("Working…");
    expect(html).toContain('aria-current="step"');
  });

  it("shows a blocked run as stopped rather than executed", () => {
    const html = renderToString(
      <StageRail
        stages={deriveStageRail({
          ...EMPTY,
          intentId: "i-1",
          intentStateId: "s-1",
          workspacePresent: true,
          artifactsPresent: true,
          evaluationPresent: true,
          authorityDecision: "BLOCK",
          workflowState: "BLOCKED",
        })}
      />,
    );
    expect(html).toContain("Stopped");
    expect(html).toContain("Stopped at Execution");
    expect(html).not.toContain("Working…");
  });
});
