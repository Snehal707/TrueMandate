import { describe, expect, it } from "vitest";
import { assembleWorkspace, projectLifecycle, type LifecycleArtifactRow } from "./projectors.js";

/**
 * Stage truth derived from durable artifacts.
 *
 * The blocking stage is the first gate that failed in EXECUTION order, not the
 * first stage a reader finds incomplete. Those differ, and the difference is the
 * whole point: a run can complete Guardian and still have been stopped by
 * something evaluated before it.
 */

const workflow = (state: string): LifecycleArtifactRow => ({ kind: "WORKFLOW", payload: { state } });
const plan = (): LifecycleArtifactRow => ({ kind: "PLAN", payload: { plan: { steps: [] } } });
const planVerification = (status: string): LifecycleArtifactRow => ({
  kind: "PLAN_VERIFICATION",
  payload: { verification: { status } },
});
const proof = (status: string, method: string, constraintId: string): LifecycleArtifactRow => ({
  kind: "PROOF",
  payload: { status, method, constraintId },
});
const action = (preservesIntent: boolean, capabilityMatches = true): LifecycleArtifactRow => ({
  kind: "ACTION",
  payload: {
    deterministicActionFidelity: { preservesIntent },
    capabilityFidelity: { matches: capabilityMatches, actual: "execute_payment", expected: "arrange_fulfillment" },
  },
});
const guardian = (decision: string, criticalFailure = false): LifecycleArtifactRow => ({
  kind: "GUARDIAN",
  payload: { verdict: { decision, semanticStatus: "CLEAR", criticalFailure } },
});
const outcome = (): LifecycleArtifactRow => ({ kind: "OUTCOME_CONTRACT", payload: { id: "outcome-1" } });
const executionAuthorization = (): LifecycleArtifactRow => ({
  kind: "EXECUTION_AUTHORIZATION",
  payload: {
    commitTokenId: "ct-1",
    preparedActionId: "prep-1",
    grantId: "grant-1",
    outcomeContractId: "outcome-1",
  },
});

const satisfiedProofs = (n: number) =>
  Array.from({ length: n }, (_, i) => proof("SATISFIED", "authoritative-proof-handoff", `c-${i}`));

const stageOf = (view: ReturnType<typeof projectLifecycle>, stage: string) =>
  view.stages.find((row) => row.stage === stage);

describe("successful evidenced workflow", () => {
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("AUTHORIZED"),
      outcome(),
    ],
    readiness: "ACTIONABLE",
    sideEffectCount: 1,
    provenanceNodeCount: 13,
  });

  it("reports no blocking stage", () => {
    expect(view.blockingStage).toBeUndefined();
    expect(view.blockingReason).toBeUndefined();
  });

  it("projects Guardian completed, Authority reached, execution and outcome produced", () => {
    expect(stageOf(view, "guardian")?.status).toBe("COMPLETED");
    expect(stageOf(view, "guardian")?.detail).toBe("ALLOW");
    expect(stageOf(view, "authority")?.status).toBe("COMPLETED");
    expect(stageOf(view, "preparedAction")?.status).toBe("COMPLETED");
    expect(stageOf(view, "execution")?.status).toBe("COMPLETED");
    expect(stageOf(view, "outcome")?.status).toBe("COMPLETED");
    expect(stageOf(view, "provenance")?.status).toBe("COMPLETED");
    expect(stageOf(view, "verification")?.detail).toBe("ACTIONABLE");
    expect(stageOf(view, "evidence")?.detail).toBe("5 of 5 required proofs satisfied");
  });
});

describe("durable approval awaiting action", () => {
  it("reports the Authority decision without claiming authorization or execution", () => {
    const view = projectLifecycle({
      artifacts: [
        ...satisfiedProofs(5), plan(), planVerification("VERIFIED"), action(true),
        guardian("ALLOW_WITH_MONITORING"), workflow("AUTHORITY_EVALUATION"),
      ],
      authorityDecision: "REQUIRE_APPROVAL",
      approvalStatus: "PENDING",
    });
    expect(stageOf(view, "authority")).toMatchObject({ status: "COMPLETED", detail: "REQUIRE_APPROVAL" });
    expect(stageOf(view, "preparedAction")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
  });
});

describe("action-fidelity blocked workflow", () => {
  // Proofs all pass and the plan verifies: the evidence attests the intent
  // truthfully. What fails is that the proposed action no longer matches it.
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(false),
      guardian("ALLOW"),
      workflow("BLOCKED"),
    ],
    readiness: "ACTIONABLE",
  });

  it("blames action fidelity, not Guardian", () => {
    expect(view.blockingStage).toBe("actionFidelity");
    expect(view.blockingReason).toContain("did not preserve the recorded human intent");
  });

  it("still reports Guardian as completed, and Authority as not reached", () => {
    expect(stageOf(view, "guardian")?.status).toBe("COMPLETED");
    expect(stageOf(view, "evidence")?.status).toBe("COMPLETED");
    expect(stageOf(view, "planVerification")?.status).toBe("COMPLETED");
    expect(stageOf(view, "authority")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("capability-fidelity blocked workflow", () => {
  // Proofs pass, the plan verifies, and the rest of the proposed action
  // preserves intent (preservesIntent: true) — action fidelity never checks
  // action.capability. What fails is capability identity specifically: the
  // submitted capability is not the one the selected domain pack owns.
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true, false),
      guardian("ALLOW"),
      workflow("BLOCKED"),
    ],
    readiness: "ACTIONABLE",
  });

  it("blames capability fidelity, not action fidelity, Guardian, or Authority", () => {
    expect(view.blockingStage).toBe("capabilityFidelity");
    expect(view.blockingReason).toBe("The proposed capability is outside the capability authorized by this workflow domain.");
    expect(view.blockingStage).not.toBe("actionFidelity");
    expect(view.blockingStage).not.toBe("guardian");
    expect(view.blockingStage).not.toBe("authorityEligibility");
  });

  it("still reports Guardian as completed, and Authority as not reached", () => {
    expect(stageOf(view, "guardian")?.status).toBe("COMPLETED");
    expect(stageOf(view, "evidence")?.status).toBe("COMPLETED");
    expect(stageOf(view, "planVerification")?.status).toBe("COMPLETED");
    expect(stageOf(view, "authority")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("proof-missing workflow", () => {
  const view = projectLifecycle({
    artifacts: [
      proof("UNKNOWN", "authoritative-proof-handoff-absent", "c-0"),
      proof("UNKNOWN", "authoritative-proof-handoff-absent", "c-1"),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("BLOCKED"),
    ],
    readiness: "ACTIONABLE",
  });

  it("names evidence as the blocker and says why", () => {
    expect(view.blockingStage).toBe("evidence");
    expect(view.blockingReason).toContain("no verified evidence was bound");
    expect(stageOf(view, "evidence")?.status).toBe("BLOCKED");
  });

  it("does not blame Guardian for a missing proof summary", () => {
    expect(stageOf(view, "guardian")?.status).toBe("COMPLETED");
    expect(view.blockingStage).not.toBe("guardian");
  });
});

describe("Guardian-not-reached workflow", () => {
  // Plan verification rejected, so the run never got to Guardian.
  const view = projectLifecycle({
    artifacts: [plan(), planVerification("REJECTED"), workflow("BLOCKED")],
    readiness: "PLANNABLE",
  });

  it("represents Guardian as NOT_REACHED, never as unavailable", () => {
    expect(stageOf(view, "guardian")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "guardian")?.detail).toBeUndefined();
  });

  it("names plan verification as the blocker", () => {
    expect(view.blockingStage).toBe("planVerification");
    expect(stageOf(view, "planVerification")?.status).toBe("BLOCKED");
    expect(stageOf(view, "authority")?.status).toBe("NOT_REACHED");
  });
});

describe("historical workflow with an incomplete artifact set", () => {
  // Older runs predate several artifact kinds. Assembly must not crash, and must
  // not invent stages it has no evidence for.
  const view = projectLifecycle({ artifacts: [workflow("AUTHORIZED")] });

  it("assembles without throwing and reports what it cannot see", () => {
    expect(stageOf(view, "intent")?.status).toBe("COMPLETED");
    expect(stageOf(view, "evidence")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "plan")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "planVerification")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "guardian")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "outcome")?.status).toBe("NOT_PRODUCED");
    expect(stageOf(view, "provenance")?.status).toBe("NOT_PRODUCED");
  });

  it("claims no blocker it cannot evidence", () => {
    expect(view.blockingStage).toBeUndefined();
  });
});

describe("workflow frozen at an early state, but Authority actually granted", () => {
  // The durable WORKFLOW artifact is written once, immutably, at Guardian time
  // and never updated as the workflow progresses further. EXECUTION_AUTHORIZATION
  // is only ever written after bindAndMint succeeds, so its presence is
  // authoritative proof Authority granted -- regardless of what the frozen
  // workflow.state snapshot says.
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("AUTHORITY_EVALUATION"),
      executionAuthorization(),
    ],
    readiness: "ACTIONABLE",
  });

  it("reports Authority and PreparedAction completed, not stuck at NOT_REACHED", () => {
    expect(stageOf(view, "authority")?.status).toBe("COMPLETED");
    expect(stageOf(view, "authority")?.detail).toBe("AUTHORIZED");
    expect(stageOf(view, "preparedAction")?.status).toBe("COMPLETED");
  });

  it("does not also claim execution or outcome without their own evidence", () => {
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("execution confirmed by a resolved outcome contract", () => {
  // Neither generic-workflow-engine.ts's semantic artifacts nor the caller's
  // sideEffectCount ever populate after commit in production. The durable
  // OutcomeContract's own paymentStatus is the real, separate write the
  // commit step makes -- and is sufficient on its own.
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("AUTHORITY_EVALUATION"),
      executionAuthorization(),
    ],
    readiness: "ACTIONABLE",
    outcomeContract: { state: "RESOLVED", paymentStatus: "SUCCESS" },
  });

  it("completes execution from the outcome contract alone, with no side-effect count supplied", () => {
    expect(stageOf(view, "execution")?.status).toBe("COMPLETED");
  });

  it("completes outcome", () => {
    expect(stageOf(view, "outcome")?.status).toBe("COMPLETED");
  });
});

describe("outcome contract exists but payment has not resolved yet", () => {
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("AUTHORITY_EVALUATION"),
      executionAuthorization(),
    ],
    readiness: "ACTIONABLE",
    outcomeContract: { state: "AWAITING_OUTCOME", paymentStatus: "PENDING" },
  });

  it("does not claim execution completed while payment is still pending", () => {
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
  });

  it("still reports outcome as completed, since a contract now exists", () => {
    expect(stageOf(view, "outcome")?.status).toBe("COMPLETED");
  });
});

describe("blocked workflow stays fully unreached even with the new inputs absent", () => {
  // Confirms the fix is additive-only: a workflow that never reached Authority
  // must not be spuriously promoted merely because the new signals are missing.
  const view = projectLifecycle({
    artifacts: [
      ...satisfiedProofs(5),
      plan(),
      planVerification("VERIFIED"),
      action(true),
      guardian("ALLOW"),
      workflow("BLOCKED"),
    ],
    readiness: "ACTIONABLE",
  });

  it("reports authority, preparedAction, execution, and outcome as unreached", () => {
    expect(stageOf(view, "authority")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "preparedAction")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "execution")?.status).toBe("NOT_REACHED");
    expect(stageOf(view, "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("workspace assembly stays backward compatible", () => {
  const base = {
    summary: { intentId: "i-1" } as never,
    semantic: { intentId: "i-1", constraints: [] } as never,
    graph: { nodes: [], edges: [] } as never,
    timeline: { events: [] } as never,
  };

  it("omits lifecycle entirely when none is supplied", () => {
    const workspace = assembleWorkspace(base);
    expect(workspace.lifecycle).toBeUndefined();
    // The legacy Guardian default is untouched for callers that pass no Guardian.
    expect(workspace.guardian.aggregator.decision).toBe("UNAVAILABLE");
  });

  it("carries lifecycle through when supplied", () => {
    const lifecycle = projectLifecycle({ artifacts: [workflow("BLOCKED"), plan(), planVerification("REJECTED")] });
    const workspace = assembleWorkspace({ ...base, lifecycle });
    expect(workspace.lifecycle?.blockingStage).toBe("planVerification");
  });
});
