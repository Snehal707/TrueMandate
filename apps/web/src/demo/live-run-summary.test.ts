import { describe, expect, it } from "vitest";
import {
  authorityGranted,
  deriveRunSummary,
  provenanceClaim,
  type RunSummaryInput,
} from "./live-run-summary";
import { buildGovernanceReport } from "./liveWorkflowTruth";
import { deriveStageRail, railProgressLabel, type RailInput } from "./live-stage-rail";

/**
 * The summary answers "what happened?" from returned artifacts only.
 *
 * The rule these tests defend is that absence is not evidence: a missing
 * Authority artifact means "not reached", never "denied", and a missing
 * execution record never licenses a zero-side-effect claim.
 */

const EMPTY: RunSummaryInput = {
  hasRun: false,
  workspacePresent: false,
  planArtifactsPresent: false,
  outcomePresent: false,
  resolutionPresent: false,
  requestInFlight: false,
};

/** The exact reported run: Guardian UNAVAILABLE, workflow BLOCKED. */
const GUARDIAN_UNAVAILABLE: RunSummaryInput = {
  ...EMPTY,
  hasRun: true,
  workspacePresent: true,
  workflowState: "BLOCKED",
  intentId: "intent-live-demo-invoice-1",
  intentStateId: "state-intent-live-demo-invoice-1-compiled-abc",
  constraintsTotal: 5,
  constraintsWithoutCriticalFailure: 5,
  planStepCount: 3,
  planArtifactsPresent: true,
  guardianDecision: "UNAVAILABLE",
  guardianSemanticStatus: "UNCERTAIN",
  executionPhase: "BLOCKED",
  sideEffectCount: 0,
};

describe("the reported Guardian-unavailable run", () => {
  const summary = deriveRunSummary(GUARDIAN_UNAVAILABLE);

  it("is classified as blocked before authorization, not as a governance refusal", () => {
    // Nothing judged this action — a required judgment was simply missing.
    expect(summary.outcomeClass).toBe("stopped-unavailable");
    expect(summary.headline).toBe("Workflow blocked before authorization");
    expect(summary.terminal).toBe(true);
  });

  it("states why, from the Guardian artifact", () => {
    expect(summary.reason).toContain("UNAVAILABLE");
    expect(summary.reason).toContain("UNCERTAIN");
    expect(summary.reasonSource).toBe("guardian.aggregator");
  });

  it("lists what actually succeeded, with returned values", () => {
    const labels = summary.succeeded.map((fact) => fact.label);
    expect(labels).toContain("Intent recorded");
    expect(labels).toContain("Constraints verified");
    expect(labels).toContain("Plan created");
    // Guardian did not succeed.
    expect(labels).not.toContain("Guardian returned a verdict");
    expect(
      summary.succeeded.find((fact) => fact.label === "Constraints verified")?.detail,
    ).toBe("5 of 5 without critical failure");
  });

  it("says Authority was NOT REACHED, never denied", () => {
    const labels = summary.didNotHappen.map((fact) => fact.label);
    expect(labels).toContain("Authority was not reached");
    expect(labels).toContain("The action was not executed");
    expect(labels).toContain("No outcome was created");
    expect(labels).not.toContain("Authority did not grant");
    const text = JSON.stringify(summary).toLowerCase();
    expect(text).not.toContain("denied");
    expect(text).not.toContain("rejected by authority");
  });

  it("reports zero economic effect, because a side-effect list was returned", () => {
    expect(summary.economicEffect.value).toBe("ZERO");
    expect(summary.economicEffect.statement).toBe("No economic action was taken.");
  });
});

describe("absence is never evidence", () => {
  it("will not claim ZERO side effects when no execution record was returned", () => {
    const summary = deriveRunSummary({
      ...GUARDIAN_UNAVAILABLE,
      workspacePresent: false,
      sideEffectCount: undefined,
    });
    expect(summary.economicEffect.value).toBe("UNKNOWN");
    expect(summary.economicEffect.statement).toContain("no side-effect claim is made");
    expect(summary.economicEffect.value).not.toBe("ZERO");
  });

  it("will not call a run a governance refusal without a refusing artifact", () => {
    const summary = deriveRunSummary({ ...GUARDIAN_UNAVAILABLE, guardianDecision: undefined });
    expect(summary.outcomeClass).toBe("stopped-unavailable");
    expect(summary.outcomeClass).not.toBe("blocked-by-governance");
  });

  it("does call it a governance refusal when Authority actually refused", () => {
    const summary = deriveRunSummary({
      ...GUARDIAN_UNAVAILABLE,
      guardianDecision: "BLOCK",
      guardianSemanticStatus: "FAITHFUL",
      authorityDecision: "DENY",
      authorityExplanation: "Cumulative exposure ceiling exceeded.",
    });
    expect(summary.outcomeClass).toBe("blocked-by-governance");
    expect(summary.didNotHappen.map((f) => f.label)).toContain("Authority did not grant");
    expect(summary.reason).toBe("Cumulative exposure ceiling exceeded.");
    expect(summary.reasonSource).toBe("authority.decision");
  });

  it("prefers the backend's own stopReason over any derived wording", () => {
    const summary = deriveRunSummary({
      ...GUARDIAN_UNAVAILABLE,
      executionStopReason: "Guardian verdict required before authorization.",
    });
    expect(summary.reason).toBe("Guardian verdict required before authorization.");
    expect(summary.reasonSource).toBe("execution.stopReason");
  });
});

describe("other real run shapes", () => {
  it("recognises an authorized and executed run", () => {
    const summary = deriveRunSummary({
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
    expect(summary.outcomeClass).toBe("authorized-executed");
    expect(summary.terminal).toBe(false);
    expect(summary.economicEffect.value).toBe("RECORDED");
    expect(summary.economicEffect.statement).toBe("1 recorded side effect.");
    expect(summary.succeeded.map((f) => f.label)).toContain("Authority granted");
  });

  it("recognises a run held for human approval", () => {
    const summary = deriveRunSummary({
      ...GUARDIAN_UNAVAILABLE,
      workflowState: "AWAITING_APPROVAL",
      executionPhase: "AUTHORIZE",
      guardianDecision: "REQUIRE_APPROVAL",
      approvalStatus: "PENDING",
    });
    expect(summary.outcomeClass).toBe("awaiting-approval");
    expect(summary.terminal).toBe(false);
  });

  it("recognises a run that is still in progress", () => {
    const summary = deriveRunSummary({
      ...EMPTY,
      hasRun: true,
      intentId: "intent-1",
      requestInFlight: true,
    });
    expect(summary.outcomeClass).toBe("in-progress");
    expect(summary.terminal).toBe(false);
  });

  it("separates a transport failure from a governance outcome", () => {
    const summary = deriveRunSummary({ ...EMPTY, hasRun: true, errorCode: "VALIDATION_FAILED" });
    expect(summary.outcomeClass).toBe("request-failed");
    expect(summary.headline).toBe("The request never reached the governed pipeline");
  });

  it("treats an execution status with no recorded side effects as unresolved, not zero", () => {
    const summary = deriveRunSummary({
      ...GUARDIAN_UNAVAILABLE,
      executionStatus: "UNKNOWN",
      sideEffectCount: 0,
    });
    expect(summary.economicEffect.value).toBe("UNKNOWN");
    expect(summary.economicEffect.value).not.toBe("ZERO");
  });
});

describe("authorityGranted only accepts real granting decisions", () => {
  it("accepts grants and rejects everything else", () => {
    for (const yes of ["ALLOW", "allow", "GRANTED", "AUTHORIZED"]) {
      expect(authorityGranted(yes), yes).toBe(true);
    }
    for (const no of [undefined, "", "DENY", "BLOCK", "BLOCKED", "REQUIRE_APPROVAL"]) {
      expect(authorityGranted(no), String(no)).toBe(false);
    }
  });
});

describe("provenance claim describes only what the records show", () => {
  it("asserts the absence of authority and execution when both are genuinely absent", () => {
    const claim = provenanceClaim(deriveRunSummary(GUARDIAN_UNAVAILABLE), 9);
    expect(claim).toContain("9 recorded artifacts");
    expect(claim).toContain("no authority grant and no execution record");
    expect(claim).toContain("never authorized");
  });

  it("makes no absence claim once execution actually occurred", () => {
    const claim = provenanceClaim(
      deriveRunSummary({
        ...GUARDIAN_UNAVAILABLE,
        guardianDecision: "ALLOW",
        authorityDecision: "ALLOW",
        executionStatus: "SUCCESS",
        sideEffectCount: 1,
      }),
      12,
    );
    expect(claim).not.toContain("never authorized");
    expect(claim).not.toContain("no execution record");
  });

  it("says nothing at all when there are no records", () => {
    expect(provenanceClaim(deriveRunSummary(EMPTY), 0)).toContain("No public provenance records");
  });
});

/**
 * The actual bug: the rail and the Governance Report read different sources for
 * Authority and disagreed on screen. They must never diverge again.
 */
describe("rail and Governance Report agree about Authority", () => {
  const railInput: RailInput = {
    hasRun: true,
    intentId: GUARDIAN_UNAVAILABLE.intentId!,
    intentStateId: GUARDIAN_UNAVAILABLE.intentStateId!,
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

  const workspace = {
    summary: { intentId: railInput.intentId, intentStateId: railInput.intentStateId },
    semantic: { constraints: [] },
    plan: { steps: [] },
    guardian: { judges: [], aggregator: { decision: "UNAVAILABLE", semanticStatus: "UNCERTAIN", criticalFailure: false } },
    authority: { explanation: "" },
    execution: { phase: "BLOCKED", sideEffects: [], unknownPending: false, blockedRetry: false },
    graph: { nodes: [], edges: [] },
    timeline: { events: [] },
  };

  const report = buildGovernanceReport(
    {
      createdAt: "2026-08-27T12:00:00.000Z",
      domainLabel: "Invoice / Vendor Payment",
      request: { intent: { kind: "RAW", rawText: "Pay approved vendor invoice INV-2026-001." } },
      workflow: { workflowId: "wf-1", state: "BLOCKED" },
      workspace,
      evidenceSubmissions: [],
    } as never,
    { nodes: [], edges: [], recordedEdgeCount: 0, fallbackEdgeCount: 0 },
  );

  it("both say Authority was not reached", () => {
    const rail = deriveStageRail(railInput);
    const authorityStage = rail.find((stage) => stage.id === "authority")!;
    const authoritySection = report.find((section) => section.id === "authority")!;

    expect(authoritySection.availability).toBe("NOT_REACHED");
    expect(authorityStage.status).toBe("not-reached");
    // And the rail must not print the workflow state as an Authority value.
    expect(authorityStage.detail).toBeUndefined();
  });

  it("the summary agrees with both", () => {
    expect(deriveRunSummary(GUARDIAN_UNAVAILABLE).didNotHappen.map((f) => f.label)).toContain(
      "Authority was not reached",
    );
  });

  it("the rail header counts match the derived stages", () => {
    const rail = deriveStageRail(railInput);
    const label = railProgressLabel(rail);
    expect(label).toBe("Stopped at Guardian · 3 returned · 3 not reached");
    // 3 returned + 1 stopped + 3 not reached === the whole rail.
    expect(rail.filter((s) => s.status === "done")).toHaveLength(3);
    expect(rail.filter((s) => s.status === "blocked")).toHaveLength(1);
    expect(rail.filter((s) => s.status === "not-reached")).toHaveLength(3);
    expect(rail).toHaveLength(7);
  });
});
