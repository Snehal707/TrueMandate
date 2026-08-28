import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultSummaryCard } from "./LiveDemoPage";
import { deriveRunSummary, type RunSummaryInput } from "./live-run-summary";
import { deriveStageRail, type LifecycleView, type RailInput } from "./live-stage-rail";

/**
 * When `workspace.lifecycle` is present it is authoritative: every stage's
 * done/blocked status and the true blocking stage/reason come directly from
 * the backend's own execution-order derivation, never from "the first stage
 * whose done flag happens to be false" and never from the Guardian placeholder.
 */

const BASE_RUN = {
  hasRun: true,
  workspacePresent: true,
  planArtifactsPresent: true,
  outcomePresent: false,
  resolutionPresent: false,
  requestInFlight: false,
} as const;

const BASE_RAIL = {
  hasRun: true,
  workspacePresent: true,
  artifactsPresent: true,
  evaluationPresent: true,
  outcomePresent: false,
  resolutionPresent: false,
  evidenceCount: 0,
  requestInFlight: false,
} as const;

const SUCCESSFUL_LIFECYCLE: LifecycleView = {
  stages: [
    { stage: "intent", status: "COMPLETED" },
    { stage: "verification", status: "COMPLETED", detail: "ACTIONABLE" },
    { stage: "evidence", status: "COMPLETED", detail: "5 of 5 required proofs satisfied" },
    { stage: "plan", status: "COMPLETED" },
    { stage: "planVerification", status: "COMPLETED", detail: "VERIFIED" },
    { stage: "guardian", status: "COMPLETED", detail: "ALLOW" },
    { stage: "authority", status: "COMPLETED", detail: "AUTHORIZED" },
    { stage: "preparedAction", status: "COMPLETED" },
    { stage: "execution", status: "COMPLETED", detail: "1 recorded side effect(s)" },
    { stage: "outcome", status: "COMPLETED" },
    { stage: "provenance", status: "COMPLETED", detail: "13 recorded node(s)" },
  ],
};

const ACTION_FIDELITY_LIFECYCLE: LifecycleView = {
  stages: [
    { stage: "intent", status: "COMPLETED" },
    { stage: "verification", status: "COMPLETED", detail: "ACTIONABLE" },
    { stage: "evidence", status: "COMPLETED", detail: "5 of 5 required proofs satisfied" },
    { stage: "plan", status: "COMPLETED" },
    { stage: "planVerification", status: "COMPLETED", detail: "VERIFIED" },
    { stage: "actionFidelity", status: "BLOCKED" },
    { stage: "guardian", status: "COMPLETED", detail: "ALLOW" },
    { stage: "authority", status: "NOT_REACHED" },
    { stage: "preparedAction", status: "NOT_REACHED" },
    { stage: "execution", status: "NOT_REACHED" },
    { stage: "outcome", status: "NOT_PRODUCED" },
    { stage: "provenance", status: "NOT_PRODUCED" },
  ],
  blockingStage: "actionFidelity",
  blockingReason: "The proposed action did not preserve the recorded human intent.",
};

const MISSING_PROOF_LIFECYCLE: LifecycleView = {
  stages: [
    { stage: "intent", status: "COMPLETED" },
    { stage: "verification", status: "COMPLETED", detail: "ACTIONABLE" },
    { stage: "evidence", status: "BLOCKED" },
    { stage: "plan", status: "COMPLETED" },
    { stage: "planVerification", status: "COMPLETED", detail: "VERIFIED" },
    { stage: "guardian", status: "COMPLETED", detail: "ALLOW" },
    { stage: "authority", status: "NOT_REACHED" },
    { stage: "preparedAction", status: "NOT_REACHED" },
    { stage: "execution", status: "NOT_REACHED" },
    { stage: "outcome", status: "NOT_PRODUCED" },
    { stage: "provenance", status: "NOT_PRODUCED" },
  ],
  blockingStage: "evidence",
  blockingReason: "Required proofs were not established: no verified evidence was bound to this workflow.",
};

const PLAN_VERIFICATION_LIFECYCLE: LifecycleView = {
  stages: [
    { stage: "intent", status: "COMPLETED" },
    { stage: "verification", status: "COMPLETED", detail: "PLANNABLE" },
    { stage: "evidence", status: "NOT_REACHED" },
    { stage: "plan", status: "COMPLETED" },
    { stage: "planVerification", status: "BLOCKED" },
    { stage: "guardian", status: "NOT_REACHED" },
    { stage: "authority", status: "NOT_REACHED" },
    { stage: "preparedAction", status: "NOT_REACHED" },
    { stage: "execution", status: "NOT_REACHED" },
    { stage: "outcome", status: "NOT_PRODUCED" },
    { stage: "provenance", status: "NOT_PRODUCED" },
  ],
  blockingStage: "planVerification",
  blockingReason: "Plan verification did not verify the plan against the recorded intent.",
};

function summaryFor(lifecycle: LifecycleView, extra: Partial<RunSummaryInput> = {}): ReturnType<typeof deriveRunSummary> {
  const guardianStage = lifecycle.stages.find((s) => s.stage === "guardian");
  const executionStage = lifecycle.stages.find((s) => s.stage === "execution");
  const outcomeStage = lifecycle.stages.find((s) => s.stage === "outcome");
  const input: RunSummaryInput = {
    ...BASE_RUN,
    intentId: "intent-1",
    intentStateId: "state-1",
    workflowState: lifecycle.blockingStage ? "BLOCKED" : "AUTHORIZED",
    constraintsTotal: 5,
    constraintsWithoutCriticalFailure: 5,
    ...(guardianStage?.status === "COMPLETED" ? { guardianDecision: guardianStage.detail ?? "ALLOW" } : {}),
    ...(executionStage?.status === "COMPLETED" ? { executionStatus: "SUCCESS", sideEffectCount: 1 } : { sideEffectCount: 0 }),
    outcomePresent: outcomeStage?.status === "COMPLETED",
    lifecycle,
    ...extra,
  };
  return deriveRunSummary(input);
}

function railFor(lifecycle: LifecycleView): ReturnType<typeof deriveStageRail> {
  return deriveStageRail({ ...BASE_RAIL, intentId: "intent-1", intentStateId: "state-1", lifecycle });
}

describe("successful lifecycle renders no blocker", () => {
  const summary = summaryFor(SUCCESSFUL_LIFECYCLE);
  const rail = railFor(SUCCESSFUL_LIFECYCLE);

  it("reports no reason and is not classified as blocked", () => {
    expect(summary.reason).toBeUndefined();
    expect(summary.outcomeClass).not.toBe("blocked-by-governance");
    expect(summary.outcomeClass).not.toBe("stopped-unavailable");
  });

  it("every rail stage reads done, none blocked or not-reached", () => {
    for (const stage of rail) {
      expect(stage.status).toBe("done");
    }
  });

  it("describes execution as governed mock execution, never a real payment", () => {
    const label = summary.succeeded.find((fact) => fact.detail === "SUCCESS")?.label;
    expect(label).toBe("Governed mock execution completed");
    const serialized = JSON.stringify(summary).toLowerCase();
    for (const forbidden of ["real payment", "real booking", "real purchase", "real shipment", "real subscription"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("action fidelity lifecycle renders actionFidelity as the blocker", () => {
  const summary = summaryFor(ACTION_FIDELITY_LIFECYCLE);
  const rail = railFor(ACTION_FIDELITY_LIFECYCLE);

  it("names actionFidelity in the reason source, not Guardian", () => {
    expect(summary.reasonSource).toBe("lifecycle.actionFidelity");
    expect(summary.reason).toBe("The proposed action did not preserve the recorded human intent.");
    expect(summary.reason).not.toMatch(/guardian/i);
  });

  it("does not say Guardian stopped it", () => {
    const serialized = JSON.stringify(summary).toLowerCase();
    expect(serialized).not.toContain("guardian judgment");
    expect(serialized).not.toContain("guardian stopped");
  });
});

describe("Guardian completed plus Authority not reached is represented correctly", () => {
  const summary = summaryFor(ACTION_FIDELITY_LIFECYCLE);
  const rail = railFor(ACTION_FIDELITY_LIFECYCLE);

  it("the summary lists Guardian as succeeded with its real decision", () => {
    const labels = summary.succeeded.map((fact) => fact.label);
    expect(labels).toContain("Guardian returned a verdict");
    expect(summary.succeeded.find((fact) => fact.label === "Guardian returned a verdict")?.detail).toBe("ALLOW");
  });

  it("the summary lists Authority as not reached, never denied", () => {
    const labels = summary.didNotHappen.map((fact) => fact.label);
    expect(labels).toContain("Authority was not reached");
    expect(labels).not.toContain("Authority did not grant");
  });

  it("the rail shows Guardian done and Authority not-reached, and blocks Planning instead", () => {
    const byId = Object.fromEntries(rail.map((stage) => [stage.id, stage.status]));
    expect(byId.guardian).toBe("done");
    expect(byId.authority).toBe("not-reached");
    expect(byId.execution).toBe("not-reached");
    // actionFidelity has no rail slot of its own; it shares Planning's slot
    // ("the proposed action, checked back against the verified intent"), which
    // must show as the stopping point instead of Guardian.
    expect(byId.planning).toBe("blocked");
    expect(byId.guardian).not.toBe("blocked");
  });
});

describe("missing proof lifecycle renders evidence as the blocker", () => {
  const summary = summaryFor(MISSING_PROOF_LIFECYCLE);
  const rail = railFor(MISSING_PROOF_LIFECYCLE);

  it("names evidence in the reason source", () => {
    expect(summary.reasonSource).toBe("lifecycle.evidence");
    expect(summary.reason).toContain("no verified evidence was bound");
  });

  it("does not collapse the reason into Guardian unavailable", () => {
    expect(summary.reason).not.toMatch(/guardian/i);
    const labels = summary.succeeded.map((fact) => fact.label);
    expect(labels).toContain("Guardian returned a verdict");
  });

  it("the rail blocks Planning, not Guardian", () => {
    const byId = Object.fromEntries(rail.map((stage) => [stage.id, stage.status]));
    expect(byId.planning).toBe("blocked");
    expect(byId.guardian).toBe("done");
  });
});

describe("plan-verification lifecycle renders planVerification as the blocker", () => {
  const summary = summaryFor(PLAN_VERIFICATION_LIFECYCLE);
  const rail = railFor(PLAN_VERIFICATION_LIFECYCLE);

  it("names planVerification, and Guardian is not-reached (it truly never ran)", () => {
    expect(summary.reasonSource).toBe("lifecycle.planVerification");
    const labels = summary.didNotHappen.map((fact) => fact.label);
    // Guardian never returned a decision on this input, so it is silent rather
    // than falsely claimed as succeeded or blamed.
    expect(labels).not.toContain("Guardian did not return a usable verdict");
    const byId = Object.fromEntries(rail.map((stage) => [stage.id, stage.status]));
    expect(byId.guardian).toBe("not-reached");
    expect(byId.planning).toBe("blocked");
  });
});

describe("workspace lifecycle absent does not invent a Guardian failure", () => {
  it("stays silent about Guardian when no legacy Guardian field was supplied either", () => {
    const summary = deriveRunSummary({
      ...BASE_RUN,
      workflowState: "BLOCKED",
      intentId: "intent-1",
    });
    expect(summary.succeeded.map((f) => f.label)).not.toContain("Guardian returned a verdict");
    expect(summary.didNotHappen.map((f) => f.label)).not.toContain("Guardian did not return a usable verdict");
    expect(JSON.stringify(summary).toLowerCase()).not.toContain("guardian");
  });
});

describe("zero economic effect is only claimed from an actual returned side-effect count", () => {
  it("a blocked, lifecycle-driven run with no returned side-effect count makes no ZERO claim", () => {
    const summary = summaryFor(ACTION_FIDELITY_LIFECYCLE, { sideEffectCount: undefined });
    expect(summary.economicEffect.value).not.toBe("ZERO");
  });

  it("a returned empty side-effect list does license the ZERO claim", () => {
    const summary = summaryFor(ACTION_FIDELITY_LIFECYCLE, { sideEffectCount: 0 });
    expect(summary.economicEffect.value).toBe("ZERO");
  });
});

describe("mock execution is rendered, never as a real external execution", () => {
  const html = renderToString(
    <ResultSummaryCard
      summary={summaryFor(SUCCESSFUL_LIFECYCLE)}
      workflowId="wf-lifecycle-success"
      createdAt="2026-08-27T12:00:00.000Z"
    />,
  );

  it("names it a governed mock execution in the rendered card", () => {
    expect(html).toContain("Governed mock execution completed");
  });

  it("never renders language implying a real payment, booking, purchase, shipment, or subscription occurred", () => {
    const lower = html.toLowerCase();
    for (const forbidden of [
      "real payment",
      "real booking",
      "real purchase",
      "real shipment",
      "real subscription",
      "payment confirmed",
      "booking confirmed",
      "order shipped",
      "money was sent",
      "funds were transferred",
    ]) {
      expect(lower, `must not render "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
