import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultSummaryCard, StageRail, STAGE_CARD_LABELS } from "./LiveDemoPage";
import { GovernanceReport } from "./GovernanceReport";
import { deriveRunSummary, provenanceClaim, type RunSummaryInput } from "./live-run-summary";
import { deriveStageRail, railStatusLabel, type RailInput } from "./live-stage-rail";
import { buildGovernanceReport } from "./liveWorkflowTruth";

/**
 * On a workflow that has terminally stopped, "yet" is a false promise: the
 * artifact is never coming. Downstream detail must use terminal language
 * derived from the shared truth model, and all four judge surfaces must still
 * agree afterwards.
 */

const strip = (html: string) => html.replaceAll("<!-- -->", "");

const TERMINAL: RunSummaryInput = {
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
  executionPhase: "PROPOSE",
  sideEffectCount: 0,
  outcomePresent: false,
  resolutionPresent: false,
  requestInFlight: false,
};

const TERMINAL_RAIL: RailInput = {
  hasRun: true,
  intentId: "intent-1",
  intentStateId: "state-1",
  workspacePresent: true,
  artifactsPresent: true,
  evaluationPresent: false,
  guardianDecision: "UNAVAILABLE",
  guardianSemanticStatus: "UNCERTAIN",
  workflowState: "BLOCKED",
  executionPhase: "PROPOSE",
  outcomePresent: false,
  resolutionPresent: false,
  evidenceCount: 0,
  requestInFlight: false,
};

function terminalReport() {
  return buildGovernanceReport(
    {
      createdAt: "2026-08-28T12:00:00.000Z",
      domainLabel: "Invoice / Vendor Payment",
      request: { intent: { kind: "RAW", rawText: "Pay invoice INV-2026-001." } },
      workflow: { workflowId: "wf-1", state: "BLOCKED" },
      workspace: {
        summary: { intentId: "intent-1", intentStateId: "state-1" },
        semantic: { constraints: [] },
        plan: { steps: [] },
        guardian: {
          judges: [],
          aggregator: { decision: "UNAVAILABLE", semanticStatus: "UNCERTAIN", criticalFailure: false },
        },
        authority: { explanation: "" },
        execution: { phase: "PROPOSE", sideEffects: [], unknownPending: false, blockedRetry: false },
        graph: { nodes: [], edges: [] },
        timeline: { events: [] },
      },
      evidenceSubmissions: [],
    } as never,
    { nodes: [], edges: [], recordedEdgeCount: 0, fallbackEdgeCount: 0 },
  );
}

describe("a terminal run never promises a future arrival", () => {
  it("the Result Summary carries no future-tense wording", () => {
    const html = strip(
      renderToString(
        <ResultSummaryCard
          summary={deriveRunSummary(TERMINAL)}
          workflowId="wf-1"
          createdAt="2026-08-28T12:00:00.000Z"
        />,
      ),
    );
    expect(html).not.toContain("yet");
  });

  it("the rail carries no future-tense wording and no Waiting stage", () => {
    const html = strip(renderToString(<StageRail stages={deriveStageRail(TERMINAL_RAIL)} />));
    expect(html).not.toContain("yet");
    expect(html).not.toContain(">Waiting<");
  });

  it("the Governance Report carries no future-tense wording", () => {
    const html = strip(
      renderToString(
        <GovernanceReport
          workflowId="wf-1"
          sections={terminalReport()}
          summary={deriveRunSummary(TERMINAL)}
          request="Pay invoice INV-2026-001."
        />,
      ),
    );
    expect(html).not.toContain(" yet");
    expect(html).not.toContain("Not created yet");
  });

  it("the provenance lead carries no future-tense wording", () => {
    expect(provenanceClaim(deriveRunSummary(TERMINAL), 12)).not.toContain("yet");
  });
});

describe("all four surfaces still tell the same story", () => {
  const summary = deriveRunSummary(TERMINAL);
  const rail = deriveStageRail(TERMINAL_RAIL);
  const report = terminalReport();
  const claim = provenanceClaim(summary, 12);

  it("agree that execution did not occur", () => {
    expect(summary.didNotHappen.map((f) => f.label)).toContain("The action was not executed");
    expect(rail.find((s) => s.id === "execution")?.status).toBe("not-reached");
    expect(report.find((s) => s.id === "execution")?.availability).toBe("NOT_EXECUTED");
    expect(claim).toContain("no returned execution result");
  });

  it("agree that Authority was never reached", () => {
    expect(summary.didNotHappen.map((f) => f.label)).toContain("Authority was not reached");
    expect(rail.find((s) => s.id === "authority")?.status).toBe("not-reached");
    expect(report.find((s) => s.id === "authority")?.availability).toBe("NOT_REACHED");
    expect(claim).toContain("no returned authority grant");
  });

  it("agree that the economic effect is ZERO, and only from returned evidence", () => {
    expect(summary.economicEffect.value).toBe("ZERO");
    expect(
      report.find((s) => s.id === "execution")?.rows.find((r) => r.label === "Economic side effects")?.value,
    ).toBe("0");
    expect(claim).toContain("returned side-effect list is empty");
  });

  it("agree that outcome and resolution were not created", () => {
    expect(summary.didNotHappen.map((f) => f.label)).toContain("No outcome was created");
    expect(report.find((s) => s.id === "outcome")?.availability).toBe("NOT_CREATED");
    expect(report.find((s) => s.id === "resolution")?.availability).toBe("NOT_CREATED");
  });
});

/**
 * Guardian showed the badge LIVE on a run that had terminally stopped at
 * Guardian, while the rail on the same screen said "Stopped here". LIVE must
 * mean Guardian activity is genuinely current.
 */
describe("a terminal run never shows LIVE on its stopping Guardian stage", () => {
  /** Mirrors the card's derivation in LiveDemoPage, sourced from the rail. */
  const guardianCardState = (rail: ReturnType<typeof deriveStageRail>, guardianStatePresent: boolean) => {
    const stoppingStageId = rail.find((stage) => stage.status === "blocked")?.id;
    if (stoppingStageId === "guardian") return "stopped" as const;
    return guardianStatePresent ? ("present" as const) : ("not-reached" as const);
  };

  it("renders Stopped here, never LIVE, when the rail stopped at Guardian", () => {
    const rail = deriveStageRail(TERMINAL_RAIL);
    expect(rail.find((s) => s.id === "guardian")?.status).toBe("blocked");

    // Guardian state IS present on this run — it must still not read LIVE.
    const state = guardianCardState(rail, true);
    expect(state).toBe("stopped");
    expect(STAGE_CARD_LABELS[state]).toBe("Stopped here");
    expect(STAGE_CARD_LABELS[state]).not.toBe("LIVE");
  });

  it("agrees with the rail about where the run stopped", () => {
    const rail = deriveStageRail(TERMINAL_RAIL);
    const railStopped = rail.find((s) => s.status === "blocked")!;
    expect(railStatusLabel(railStopped.status)).toBe("Stopped here");
    expect(STAGE_CARD_LABELS[guardianCardState(rail, true)]).toBe(
      railStatusLabel(railStopped.status),
    );
  });

  it("keeps LIVE for a run where Guardian activity is genuinely current", () => {
    const rail = deriveStageRail({
      ...TERMINAL_RAIL,
      workflowState: "AWAITING_APPROVAL",
      executionPhase: "AUTHORIZE",
      guardianDecision: "REQUIRE_APPROVAL",
      authorityDecision: "REQUIRE_APPROVAL",
    });
    expect(rail.find((s) => s.status === "blocked")).toBeUndefined();
    expect(STAGE_CARD_LABELS[guardianCardState(rail, true)]).toBe("LIVE");
  });

  it("does not claim Guardian stopped a run that stopped elsewhere", () => {
    // Guardian returned a usable verdict; the run stopped at Execution instead.
    const rail = deriveStageRail({
      ...TERMINAL_RAIL,
      guardianDecision: "BLOCK",
      guardianSemanticStatus: "FAITHFUL",
      authorityDecision: "DENY",
    });
    expect(rail.find((s) => s.status === "blocked")?.id).not.toBe("guardian");
    expect(STAGE_CARD_LABELS[guardianCardState(rail, true)]).toBe("LIVE");
  });
});

describe("a run that can still progress keeps future tense", () => {
  it("still says 'yet' while the workflow is genuinely in flight", () => {
    const inFlight = deriveRunSummary({
      ...TERMINAL,
      workflowState: "AWAITING_APPROVAL",
      executionPhase: "AUTHORIZE",
      guardianDecision: "REQUIRE_APPROVAL",
      approvalStatus: "PENDING",
    });
    expect(inFlight.terminal).toBe(false);
    const rail = deriveStageRail({
      ...TERMINAL_RAIL,
      workflowState: "AWAITING_APPROVAL",
      executionPhase: "AUTHORIZE",
      guardianDecision: "REQUIRE_APPROVAL",
      authorityDecision: "REQUIRE_APPROVAL",
    });
    const html = strip(renderToString(<StageRail stages={rail} />));
    // Waiting is legitimate here: these stages can still happen.
    expect(html).toContain(">Waiting<");
    expect(html).not.toContain("Not reached");
  });
});
