import {
  ApprovalDecision,
  AuthorityDecision,
  ExecutionState,
  GuardianSemanticStatus,
  asActionId,
  asAgentId,
  asHashDigest,
  asIntentId,
  asIntentStateId,
  asPreparedActionId,
} from "@truemandate/protocol";
import {
  projectAuthority,
  projectExecution,
  projectGuardian,
} from "@truemandate/read-model";
import { describe, expect, it } from "vitest";
import { DemoRuntime } from "./demo-runtime.js";

describe("DemoRuntime Phase 10", () => {
  it("procurement demo: payment SUCCESS + outcome PARTIAL + ResolutionCase", async () => {
    const rt = new DemoRuntime();
    const { intentId } = await rt.seedProcurementPartial();
    const ws = await rt.getWorkspace(intentId);
    expect(ws.summary.rawIntent).toContain("food-grade");
    expect(ws.outcome?.paymentStatus).toBe("SUCCESS");
    expect(ws.outcome?.contractState).toBe("PARTIAL");
    expect(ws.resolution?.state).toBeTruthy();
    expect(ws.resolution?.responsibilityState).toBe("UNKNOWN");
    expect(ws.resolution?.blameHonest).toBe(true);
    expect(ws.graph.edges.length).toBeGreaterThan(0);
    expect(ws.graph.traceToHuman?.[ws.graph.traceToHuman.length - 1]).toContain(
      "principal",
    );
    const outcome = await rt.getCanonicalOutcome(intentId);
    expect(outcome?.state).toBe("PARTIAL");
    expect(outcome?.paymentStatus).toBe("SUCCESS");
    const rc = await rt.getCanonicalResolutionCase(intentId);
    expect(rc).toBeTruthy();
    expect(ws.resolution?.firstDivergence).toBe("quantity_received:450/500");
  });

  it("workspace guardian/authority/execution match seeded canonical projections", async () => {
    const rt = new DemoRuntime();
    const { intentId } = await rt.seedProcurementPartial();
    const ws = await rt.getWorkspace(intentId);

    const expectedGuardian = projectGuardian({
      id: "gv-demo-proc",
      actionId: asActionId("action-demo-proc"),
      intentId: asIntentId(intentId),
      intentStateId: asIntentStateId("state-demo-proc"),
      intentStateHash: asHashDigest("ignored-for-decision"),
      actionContentHash: asHashDigest("action-content-demo-proc"),
      evidenceSnapshotHash: asHashDigest("evidence-demo-proc"),
      decision: AuthorityDecision.ALLOW,
      semanticStatus: GuardianSemanticStatus.CLEAR,
      constraintClaims: [],
      contradictions: [],
      uncertainty: 0,
      criticalFailure: false,
      judgeResults: [
        {
          judgeId: "FIDELITY" as never,
          status: "OK" as never,
          findings: [],
        },
      ],
      protocolVersion: "0.1.0",
      promptVersions: {},
      schemaVersions: {},
      stale: false,
      createdAt: "2026-06-04T12:00:00.000Z",
      verdictHash: asHashDigest("verdict-demo-proc"),
      overallFidelity: 1,
    });
    expect(ws.guardian.aggregator.decision).toBe(expectedGuardian.aggregator.decision);
    expect(ws.guardian.aggregator.semanticStatus).toBe(
      expectedGuardian.aggregator.semanticStatus,
    );
    expect(ws.guardian.aggregator.criticalFailure).toBe(false);

    const expectedAuthority = projectAuthority({
      guardianDecision: AuthorityDecision.ALLOW,
      authorityDecision: AuthorityDecision.ALLOW,
      capability: "execute_payment",
      principalId: "principal-1",
      agentId: "agent-1",
      merchant: "ApprovedFoodChem",
      amount: 700000,
      currency: "INR",
      grantState: "ACTIVE",
    });
    expect(ws.authority.guardianRecommendation).toBe(
      expectedAuthority.guardianRecommendation,
    );
    expect(ws.authority.decision).toBe(expectedAuthority.decision);
    expect(ws.authority.merchant).toBe(expectedAuthority.merchant);
    expect(ws.authority.amount).toBe(expectedAuthority.amount);
    expect(ws.authority.grantState).toBe(expectedAuthority.grantState);

    const expectedExecution = projectExecution({
      prepared: {
        id: asPreparedActionId("prep-demo-proc"),
        actionId: asActionId("action-demo-proc"),
        intentId: asIntentId(intentId),
        intentStateId: asIntentStateId("state-demo-proc"),
        agentId: asAgentId("agent-1"),
        capability: "execute_payment",
        parameters: {
          merchant: "ApprovedFoodChem",
          amount: 700000,
          currency: "INR",
          quantity: 500,
          product: "fg",
          toolParameters: {},
        },
        parameterHash: asHashDigest("any"),
        createdAt: "2026-06-04T12:00:00.000Z",
      },
      sideEffects: [
        {
          executionId: "exec-demo-proc",
          preparedActionId: asPreparedActionId("prep-demo-proc"),
          preparedActionHash: asHashDigest("any"),
          commitTokenId: "ct-demo-proc" as never,
          grantId: "grant-demo-proc" as never,
          toolId: "payment.execute",
          amount: 700000,
          currency: "INR",
          idempotencyKey: "idem-demo-proc",
          requestTimestamp: "2026-06-04T12:00:00.000Z",
          resultState: ExecutionState.SUCCESS,
          reconciliationState: "NOT_REQUIRED" as never,
        },
      ],
      unknownPending: false,
      blockedRetry: false,
    });
    expect(ws.execution.phase).toBe(expectedExecution.phase);
    expect(ws.execution.phase).toBe("EXECUTE");
    expect(ws.execution.preparedAction?.merchant).toBe("ApprovedFoodChem");
    expect(ws.execution.sideEffects[0]?.result).toBe(ExecutionState.SUCCESS);
  });

  it("AT_RISK demo distinct from BREACHED", async () => {
    const rt = new DemoRuntime();
    const { intentId } = await rt.seedAtRiskDelivery();
    const ws = await rt.getWorkspace(intentId);
    expect(ws.outcome?.contractState).toBe("AT_RISK");
    expect(ws.outcome?.contractState).not.toBe("BREACHED");
    expect(ws.outcome?.atRisk).toBeTruthy();
    expect(ws.outcome?.atRisk?.basis).toBeUndefined();
    expect((await rt.getCanonicalOutcome(intentId))?.state).toBe("AT_RISK");
  });

  it("approval creates ApprovalArtifact only; hash change invalidates open approval", async () => {
    const rt = new DemoRuntime();
    await rt.seedProcurementPartial();
    const prepared = {
      id: asPreparedActionId("pa-1"),
      actionId: asActionId("a1"),
      intentId: asIntentId("intent-demo-proc"),
      intentStateId: asIntentStateId("state-demo-proc"),
      agentId: asAgentId("agent-1"),
      capability: "execute_payment",
      parameters: {
        merchant: "x",
        amount: 100,
        currency: "INR",
        toolParameters: {},
      },
      parameterHash: asHashDigest("hash-a"),
      preparedActionHash: asHashDigest("hash-a"),
      createdAt: "2026-06-04T12:00:00.000Z",
    };
    const a1 = rt.submitApproval({
      prepared,
      principalId: "principal-1",
      decision: ApprovalDecision.APPROVE,
    });
    expect(a1.preparedActionHash).toBe("hash-a");
    expect(rt.getPendingApproval()?.id).toBe(a1.id);

    const prepared2 = {
      ...prepared,
      parameterHash: asHashDigest("hash-b"),
      preparedActionHash: asHashDigest("hash-b"),
    };
    rt.submitApproval({
      prepared: prepared2,
      principalId: "principal-1",
      decision: ApprovalDecision.APPROVE,
    });
    expect(rt.getPendingApproval()?.preparedActionHash).toBe("hash-b");
  });

  it("frontend cannot mint grant or resolve case directly", async () => {
    const rt = new DemoRuntime();
    expect(() => rt.forbidDirectGrantMint()).toThrow(
      "FRONTEND_CANNOT_MINT_AUTHORITY_GRANT",
    );
    expect(() => rt.forbidDirectResolveCase()).toThrow(
      "FRONTEND_CANNOT_RESOLVE_CASE",
    );
  });

  it("duplicate live events do not duplicate timeline entries", async () => {
    const rt = new DemoRuntime();
    const { intentId } = await rt.seedProcurementPartial();
    rt.getEventPort().publish({
      id: "ev-partial-dup",
      topic: "outcome",
      type: "OUTCOME_PARTIAL",
      at: "2026-06-04T12:00:00.000Z",
      payload: {},
      dedupeKey: `partial:oc-demo-proc`,
    });
    const ws = await rt.getWorkspace(intentId);
    const pays = ws.timeline.events.filter((e) => e.type === "PAYMENT_SUCCESS");
    expect(pays).toHaveLength(1);
  });
});
