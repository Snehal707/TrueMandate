import { describe, expect, it } from "vitest";
import { buildGovernanceReport, type GovernanceReportSection } from "./liveWorkflowTruth";
import { deriveRunSummary, type RunSummaryInput } from "./live-run-summary";
import { deriveStageRail, type RailInput } from "./live-stage-rail";

/**
 * An execution *proposal* and an execution *occurrence* are different facts.
 *
 * The public workspace returns an execution record for runs that never executed:
 * `{ phase: "PROPOSE", sideEffects: [] }`. Treating that record's phase as a
 * status made the Governance Report announce "Recorded / PROPOSE" while the rail
 * correctly showed Execution as never reached. PROPOSE is the pipeline stage the
 * run got to, not evidence the action ran.
 */

const EMPTY_GRAPH = { nodes: [], edges: [], recordedEdgeCount: 0, fallbackEdgeCount: 0 };

/** The reported run: Guardian unavailable, Authority never reached, nothing executed. */
function blockedWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    summary: { intentId: "intent-1", intentStateId: "state-1", rawIntent: "Pay invoice INV-2026-001." },
    semantic: { constraints: [] },
    plan: { steps: [{ id: "s1" }] },
    guardian: { judges: [], aggregator: { decision: "UNAVAILABLE", semanticStatus: "UNCERTAIN", criticalFailure: false } },
    authority: { explanation: "" },
    execution: { phase: "PROPOSE", sideEffects: [], unknownPending: false, blockedRetry: false },
    graph: { nodes: [], edges: [] },
    timeline: { events: [] },
    ...overrides,
  };
}

function report(
  workspaceOverrides: Record<string, unknown> = {},
  workflowOverrides: Record<string, unknown> = {},
): readonly GovernanceReportSection[] {
  return buildGovernanceReport(
    {
      createdAt: "2026-08-27T12:00:00.000Z",
      domainLabel: "Invoice / Vendor Payment",
      request: { intent: { kind: "RAW", rawText: "Pay invoice INV-2026-001." } },
      workflow: { workflowId: "wf-1", state: "BLOCKED", ...workflowOverrides },
      workspace: blockedWorkspace(workspaceOverrides),
      evidenceSubmissions: [],
    } as never,
    EMPTY_GRAPH,
  );
}

const executionSection = (sections: readonly GovernanceReportSection[]) =>
  sections.find((section) => section.id === "execution")!;

const rowValue = (section: GovernanceReportSection, label: string) =>
  section.rows.find((row) => row.label === label)?.value;

describe("a proposal phase is never reported as an execution", () => {
  const section = executionSection(report());

  it("is NOT_EXECUTED, not PRESENT", () => {
    expect(section.availability).toBe("NOT_EXECUTED");
    expect(section.availability).not.toBe("PRESENT");
  });

  it("reports the phase as a phase and the result as absent", () => {
    expect(rowValue(section, "Pipeline phase")).toBe("PROPOSE");
    expect(rowValue(section, "Execution result")).toBe("None returned");
    // The old conflated row is gone entirely.
    expect(rowValue(section, "Status")).toBeUndefined();
  });

  it("does not claim a proposal artifact that was never returned", () => {
    expect(rowValue(section, "Proposal artifact")).toBe("Not returned");
  });

  it("proves zero side effects from the returned list", () => {
    expect(rowValue(section, "Economic side effects")).toBe("0");
  });

  it("explains in plain language that execution was never reached", () => {
    const explanation = rowValue(section, "What this means")!;
    expect(explanation).toContain("PROPOSE");
    expect(explanation).toContain("never reached");
    expect(explanation).toContain("no execution result");
  });

  it("never uses wording that implies the action ran", () => {
    const text = JSON.stringify(section).toLowerCase();
    for (const forbidden of ["executed successfully", "execution succeeded", "payment sent", "action performed"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // No row may simply read "Recorded" for a run that did not execute.
    expect(section.rows.map((row) => row.value)).not.toContain("Recorded");
  });

  it("says Recorded for the proposal only once one is genuinely returned", () => {
    const withProposal = executionSection(
      report({ execution: { phase: "PREPARE", sideEffects: [], preparedAction: { id: "pa-1" }, unknownPending: false, blockedRetry: false } }),
    );
    expect(withProposal.availability).toBe("NOT_EXECUTED");
    expect(rowValue(withProposal, "Proposal artifact")).toBe("Recorded (identifiers are private)");
    expect(rowValue(withProposal, "What this means")).toBe(
      "A proposed action was recorded, but governed execution was never reached.",
    );
  });

  it("preserves the returned execution artifact for technical inspection, sanitized", () => {
    expect(section.details).toMatchObject({ phase: "PROPOSE", sideEffects: [] });
    const withProposal = executionSection(
      report({ execution: { phase: "PREPARE", sideEffects: [], preparedAction: { id: "pa-1" }, unknownPending: false, blockedRetry: false } }),
    );
    // The raw artifact is carried through; preparedAction is redacted at render
    // time by sanitizePublicPresentationValue, which GovernanceReport applies.
    expect(withProposal.details).toBeDefined();
  });
});

describe("a genuine execution is still reported as one", () => {
  const section = executionSection(
    report(
      { execution: { phase: "EXECUTE", sideEffects: [{ id: "se-1" }], unknownPending: false, blockedRetry: false } },
      { state: "EXECUTED", execution: { status: "SUCCESS", executionId: "exec-1", resultRef: "mock-result" } },
    ),
  );

  it("is PRESENT with the real execution status", () => {
    expect(section.availability).toBe("PRESENT");
    expect(rowValue(section, "Execution result")).toBe("SUCCESS");
    expect(rowValue(section, "Execution")).toBe("exec-1");
    expect(rowValue(section, "Result")).toBe("mock-result");
  });

  it("is never labelled not-executed and adds no did-not-run explanation", () => {
    expect(section.availability).not.toBe("NOT_EXECUTED");
    expect(rowValue(section, "What this means")).toBeUndefined();
  });

  it("reports the real side-effect count rather than zero", () => {
    expect(rowValue(section, "Economic side effects")).toBe("1");
  });
});

describe("no execution record at all is still NOT_REACHED", () => {
  it("distinguishes an absent record from a record showing no execution", () => {
    const sections = buildGovernanceReport(
      {
        createdAt: "2026-08-27T12:00:00.000Z",
        domainLabel: "Invoice / Vendor Payment",
        request: { intent: { kind: "RAW", rawText: "Pay invoice." } },
        workflow: { workflowId: "wf-1", state: "BLOCKED" },
        evidenceSubmissions: [],
      } as never,
      EMPTY_GRAPH,
    );
    const section = executionSection(sections);
    expect(section.availability).toBe("NOT_REACHED");
    expect(rowValue(section, "Economic side effects")).toBeUndefined();
    expect(rowValue(section, "Proposal artifact")).toBeUndefined();
  });
});

/**
 * The property that actually prevents recurrence: all three judge-facing surfaces
 * must agree on whether execution occurred.
 */
describe("Result Summary, rail, and Governance Report agree about execution", () => {
  const summaryInput: RunSummaryInput = {
    hasRun: true,
    workspacePresent: true,
    workflowState: "BLOCKED",
    intentId: "intent-1",
    intentStateId: "state-1",
    planStepCount: 1,
    planArtifactsPresent: true,
    guardianDecision: "UNAVAILABLE",
    guardianSemanticStatus: "UNCERTAIN",
    executionPhase: "PROPOSE",
    sideEffectCount: 0,
    outcomePresent: false,
    resolutionPresent: false,
    requestInFlight: false,
  };

  const railInput: RailInput = {
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

  it("all three say execution did not occur for the blocked run", () => {
    const summary = deriveRunSummary(summaryInput);
    const rail = deriveStageRail(railInput);
    const section = executionSection(report());

    expect(summary.didNotHappen.map((f) => f.label)).toContain("The action was not executed");
    expect(summary.succeeded.map((f) => f.label)).not.toContain("Execution ran");
    expect(rail.find((stage) => stage.id === "execution")?.status).toBe("not-reached");
    expect(section.availability).toBe("NOT_EXECUTED");
    // And the economic claim is consistent and proven.
    expect(summary.economicEffect.value).toBe("ZERO");
    expect(rowValue(section, "Economic side effects")).toBe("0");
  });

  it("all three say execution occurred for the executed run", () => {
    const summary = deriveRunSummary({
      ...summaryInput,
      workflowState: "EXECUTED",
      executionPhase: "EXECUTE",
      guardianDecision: "ALLOW",
      authorityDecision: "ALLOW",
      executionStatus: "SUCCESS",
      sideEffectCount: 1,
    });
    const rail = deriveStageRail({
      ...railInput,
      workflowState: "EXECUTED",
      executionPhase: "EXECUTE",
      guardianDecision: "ALLOW",
      authorityDecision: "ALLOW",
      executionStatus: "SUCCESS",
    });
    const section = executionSection(
      report(
        { execution: { phase: "EXECUTE", sideEffects: [{ id: "se-1" }], unknownPending: false, blockedRetry: false } },
        { state: "EXECUTED", execution: { status: "SUCCESS", executionId: "exec-1" } },
      ),
    );

    expect(summary.succeeded.map((f) => f.label)).toContain("Execution ran");
    expect(rail.find((stage) => stage.id === "execution")?.status).toBe("done");
    expect(section.availability).toBe("PRESENT");
  });
});
