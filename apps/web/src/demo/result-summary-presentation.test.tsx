import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultSummaryCard, StageRail } from "./LiveDemoPage";
import { GovernanceReport } from "./GovernanceReport";
import { deriveRunSummary, type RunSummaryInput } from "./live-run-summary";
import { deriveStageRail, type RailInput } from "./live-stage-rail";

/**
 * The five questions a judge must answer from the first screen:
 * what was asked, what was verified, why it stopped, was it authorized or
 * executed, and did anything economic happen.
 */

const strip = (html: string) => html.replaceAll("<!-- -->", "");

const GUARDIAN_UNAVAILABLE: RunSummaryInput = {
  hasRun: true,
  workspacePresent: true,
  workflowState: "BLOCKED",
  intentId: "intent-1",
  intentStateId: "state-1",
  constraintsTotal: 5,
  constraintsWithoutCriticalFailure: 5,
  planStepCount: 3,
  planArtifactsPresent: true,
  guardianDecision: "UNAVAILABLE",
  guardianSemanticStatus: "UNCERTAIN",
  executionPhase: "BLOCKED",
  sideEffectCount: 0,
  outcomePresent: false,
  resolutionPresent: false,
  requestInFlight: false,
};

const RAIL_INPUT: RailInput = {
  hasRun: true,
  intentId: "intent-1",
  intentStateId: "state-1",
  workspacePresent: true,
  artifactsPresent: true,
  evaluationPresent: false,
  guardianDecision: "UNAVAILABLE",
  guardianSemanticStatus: "UNCERTAIN",
  workflowState: "BLOCKED",
  executionPhase: "BLOCKED",
  outcomePresent: false,
  resolutionPresent: false,
  evidenceCount: 0,
  requestInFlight: false,
};

function summaryHtml(input: RunSummaryInput = GUARDIAN_UNAVAILABLE): string {
  return strip(
    renderToString(
      <ResultSummaryCard
        summary={deriveRunSummary(input)}
        workflowId="wf-1"
        createdAt="2026-08-27T12:00:00.000Z"
      />,
    ),
  );
}

describe("result summary answers the five questions", () => {
  const html = summaryHtml();

  it("leads with the outcome, not with an identifier", () => {
    expect(html).toContain("Workflow blocked before authorization");
    const headlineAt = html.indexOf("Workflow blocked before authorization");
    const idAt = html.indexOf("wf-1");
    expect(headlineAt).toBeLessThan(idAt);
  });

  it("says why it stopped, without confidently blaming Guardian for a legacy placeholder", () => {
    // GUARDIAN_UNAVAILABLE carries no lifecycle: a historical/pre-projection
    // response. "UNAVAILABLE" here could be a genuine Guardian failure or the
    // legacy placeholder substituted whenever no workflow artifact was ever
    // projected — the client cannot tell which, so it must not assert Guardian
    // caused the stop.
    expect(html).toContain("Lifecycle detail unavailable for this historical run");
    expect(html).not.toContain("Required Guardian judgment was UNAVAILABLE");
  });

  it("separates what succeeded from what did not happen", () => {
    expect(html).toContain("What succeeded");
    expect(html).toContain("Intent recorded");
    expect(html).toContain("5 of 5 without critical failure");
    expect(html).toContain("Plan created");

    expect(html).toContain("What did not happen");
    expect(html).toContain("Authority was not reached");
    expect(html).toContain("The action was not executed");
    expect(html).toContain("No outcome was created");
  });

  it("states the economic effect as ZERO with its justification", () => {
    expect(html).toContain('data-effect="ZERO"');
    expect(html).toContain("No economic action was taken.");
  });

  it("never says Authority denied or blocked when no Authority artifact exists", () => {
    const lower = html.toLowerCase();
    expect(lower).not.toContain("authority denied");
    expect(lower).not.toContain("authority did not grant");
    expect(lower).not.toContain("blocked by authority");
  });

  it("renders a different outcome for an authorized, executed run", () => {
    const executed = summaryHtml({
      ...GUARDIAN_UNAVAILABLE,
      workflowState: "EXECUTED",
      executionPhase: "EXECUTE",
      guardianDecision: "ALLOW",
      guardianSemanticStatus: "FAITHFUL",
      authorityDecision: "ALLOW",
      executionStatus: "SUCCESS",
      sideEffectCount: 1,
      outcomePresent: true,
      outcomeState: "SATISFIED",
    });
    expect(executed).toContain("Authorized and executed under governance");
    expect(executed).toContain("Authority granted");
    expect(executed).toContain('data-effect="RECORDED"');
    expect(executed).not.toContain("Authority was not reached");
  });
});

describe("the rail no longer contradicts the report", () => {
  const html = strip(renderToString(<StageRail stages={deriveStageRail(RAIL_INPUT)} />));

  it("shows Authority as not reached, with no BLOCKED value beside it", () => {
    expect(html).toContain("Not reached");
    // The Authority row must not carry the overall workflow state as its detail.
    expect(html).not.toContain('<code class="detail">BLOCKED</code>');
  });

  it("marks Guardian as the stopping point and shows the Guardian decision", () => {
    expect(html).toContain("Stopped here");
    expect(html).toContain("UNAVAILABLE · UNCERTAIN");
  });

  it("does not tell the judge to wait for stages that will never run", () => {
    expect(html).not.toContain(">Waiting<");
  });

  it("reports counts that add up to the whole rail", () => {
    expect(html).toContain("Stopped at Guardian · 3 returned · 3 not reached");
  });
});

describe("governance report leads with plain language", () => {
  const html = strip(
    renderToString(
      <GovernanceReport
        workflowId="wf-1"
        sections={[
          { id: "observability", title: "Observability", availability: "NOT_PUBLIC", rows: [] },
        ]}
        summary={deriveRunSummary(GUARDIAN_UNAVAILABLE)}
        request="Pay approved vendor invoice INV-2026-001 one time for under USD 25000."
      />,
    ),
  );

  it("answers all six judge questions above the technical evidence", () => {
    for (const label of [
      "What was requested",
      "What TrueMandate verified",
      "Why it stopped",
      "Was authority granted",
      "Did execution occur",
      "Economic side effects",
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain("Pay approved vendor invoice INV-2026-001");
    expect(html).toContain("No — Authority was never reached.");
    expect(html).toContain("No — the action was never executed.");
  });

  it("puts the plain summary before the technical sections", () => {
    expect(html.indexOf("In plain language")).toBeLessThan(html.indexOf("Observability"));
  });

  it("describes private telemetry as private rather than unavailable", () => {
    expect(html).toContain("Private (internal)");
    expect(html).not.toContain("Not publicly available");
  });

  it("still renders without a summary, for callers that have none", () => {
    const bare = renderToString(
      <GovernanceReport workflowId="wf-1" sections={[]} />,
    );
    expect(bare).toContain("Governance Report");
    expect(bare).not.toContain("In plain language");
  });
});
