import { describe, expect, it } from "vitest";
import { EvidenceService } from "@truemandate/evidence-service";
import { DemoRuntime } from "@truemandate/observability-service";
import { ErrorCode, err, ok, type Intent, type IntentState, type Result } from "@truemandate/protocol";
import { createLivePublicBffPorts } from "./adapters.js";

function stubIntentCreate() {
  return {
    createIntent: (raw: unknown): Result<Intent> => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return err(ErrorCode.VALIDATION_FAILED, "Intent body must be an object");
      }
      const rec = raw as Record<string, unknown>;
      if (typeof rec.principalId !== "string" || typeof rec.rawText !== "string") {
        return err(ErrorCode.VALIDATION_FAILED, "Intent missing principalId or rawText");
      }
      return ok({
        id: "intent-stub-1",
        principalId: rec.principalId as Intent["principalId"],
        rawText: rec.rawText,
        createdAt: "2026-06-01T12:00:00.000Z",
        contentHash: "hash-stub",
      });
    },
  };
}

describe("public-bff live adapters", () => {
  it("createIntent uses injected port and does not return PRIVILEGED_PATH_INCOMPLETE", async () => {
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () =>
          ok({
            id: "intent-stub-1",
            principalId: "principal-1" as Intent["principalId"],
            rawText: "Buy food-grade containers under 800000 INR",
            createdAt: "2026-08-21T12:00:00.000Z",
            contentHash: "hash-stub",
          }),
        getTip: async () => err(ErrorCode.VALIDATION_FAILED, "No IntentState tip for intent"),
      },
      demoRuntime: new DemoRuntime(),
      evidence: new EvidenceService(),
    });
    const result = await Promise.resolve(
      ports.intentCreate.createIntent({
        principalId: "principal-1",
        rawText: "Buy food-grade containers under 800000 INR",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rawText).toContain("food-grade");
    }
  });

  it("unknown workspace fails closed without minting grants", async () => {
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () => err(ErrorCode.VALIDATION_FAILED, "Unknown intent"),
        getTip: async () => err(ErrorCode.VALIDATION_FAILED, "Unknown intent"),
      },
      demoRuntime: new DemoRuntime(),
      evidence: new EvidenceService(),
    });
    const result = await Promise.resolve(
      ports.workspaceRead.getWorkspace("intent-does-not-exist"),
    );
    expect(result.ok).toBe(false);
  });

  it("builds a durable workspace shell for a live intent even before the tip exists", async () => {
    const liveIntent: Intent = {
      id: "intent-live-1",
      principalId: "principal-live-1" as Intent["principalId"],
      rawText: "Book travel under policy",
      createdAt: "2026-08-21T13:00:00.000Z",
      contentHash: "hash-live-1",
    };
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () => ok(liveIntent),
        getTip: async () => err(ErrorCode.VALIDATION_FAILED, "No IntentState tip for intent"),
      },
      evidence: new EvidenceService(),
    });
    const result = await Promise.resolve(ports.workspaceRead.getWorkspace(liveIntent.id));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary).toMatchObject({
        intentId: liveIntent.id,
        principalId: liveIntent.principalId,
      });
      expect(result.value.semantic.constraints).toEqual([]);
      expect(result.value.timeline.events[0]).toMatchObject({
        type: "INTENT_RECORDED",
        relatedObjectIds: [liveIntent.id],
      });
    }
  });

  it("includes the finalized tip when the durable IntentState is available", async () => {
    const liveIntent: Intent = {
      id: "intent-live-2",
      principalId: "principal-live-2" as Intent["principalId"],
      rawText: "Buy approved goods",
      createdAt: "2026-08-21T14:00:00.000Z",
      contentHash: "hash-live-2",
    };
    const tip: IntentState = {
      id: "state-intent-live-2-v1" as IntentState["id"],
      intentId: liveIntent.id as IntentState["intentId"],
      rawIntentHash: liveIntent.contentHash,
      version: 1,
      constraints: [{
        id: "constraint-live-2",
        concept: "budget_max",
        operator: "LTE",
        value: 800000,
        kind: "FINANCIAL",
        importance: 1,
        confidence: 1,
        sourceType: "HUMAN",
        sourceText: "under INR 800000",
        sourceSpan: { start: 4, end: 21 },
        mutability: "HUMAN_REVISABLE",
        meaningClass: "EXPLICIT",
      }],
      assumptions: [],
      createdAt: "2026-08-21T14:01:00.000Z",
      createdBy: liveIntent.principalId as IntentState["createdBy"],
      stateHash: "s".repeat(64) as IntentState["stateHash"],
    };
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () => ok(liveIntent),
        getTip: async () => ok(tip),
      },
      evidence: new EvidenceService(),
    });
    const result = await Promise.resolve(ports.workspaceRead.getWorkspace(liveIntent.id));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary).toMatchObject({
        intentStateId: tip.id,
        intentStateVersion: 1,
        stateHash: tip.stateHash,
      });
      expect(result.value.semantic.constraints[0]?.sourceSpan).toEqual({
        start: 4,
        end: 21,
      });
      expect(result.value.timeline.events).toHaveLength(2);
      expect(result.value.timeline.events[1]).toMatchObject({
        type: "INTENT_STATE_FINALIZED",
        relatedObjectIds: [liveIntent.id, tip.id],
      });
    }
  });

  it("wires the generic workflow ports without exposing a privileged adapter surface", async () => {
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () =>
          ok({
            id: "intent-stub-1",
            principalId: "principal-1" as Intent["principalId"],
            rawText: "Buy food-grade containers under 800000 INR",
            createdAt: "2026-08-21T12:00:00.000Z",
            contentHash: "hash-stub",
          }),
        getTip: async () => err(ErrorCode.VALIDATION_FAILED, "No IntentState tip for intent"),
      },
      demoRuntime: new DemoRuntime(),
      evidence: new EvidenceService(),
      workflow: {
        submitWorkflow: async (raw) => ok({ echoed: raw }),
        getWorkflow: async (workflowId) => ok({ workflowId, state: "AUTHORIZED" }),
        resumeWorkflow: async (workflowId, body) => ok({ workflowId, body }),
        commitWorkflow: async (workflowId) => ok({ workflowId, status: "SUCCESS" }),
      },
      approvalRead: {
        getApproval: async (id) =>
          ok({
            id,
            workflowId: "wf-approval-1",
            intentId: "intent-1",
            intentStateId: "state-1",
            status: "APPROVED",
            requestedCapability: "execute_payment",
            requestedScope: { amount: 1, currency: "USD", merchant: "supplier-1" },
            requestedAt: "2026-08-21T00:00:00.000Z",
            expiresAt: "2026-08-22T00:00:00.000Z",
          }),
        getEvaluation: async (id) =>
          ok({
            id,
            decision: "ALLOW_WITH_MONITORING",
            evaluation: {
              id,
              hash: "h",
              materializationEligible: true,
              materializationReason: "PENDING_MONITORING",
              expiresAt: "2026-08-22T00:00:00.000Z",
            },
          }),
      },
      outcomeRead: {
        getOutcomeContract: async (id) =>
          ok({
            id,
            workflowId: "wf-1",
            intentId: "intent-1",
            intentStateId: "state-1",
            domain: "procurement",
            state: "AWAITING_OUTCOME",
            paymentStatus: "SUCCESS",
          }),
      },
      resolutionRead: {
        getCase: async () =>
          ok({
            case: {
              id: "rc-1",
              contractId: "oc-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              openedAt: "2026-08-21T00:00:00.000Z",
              responsibilityState: "UNKNOWN",
              state: "OPEN",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
          }),
        getCaseByOutcomeContract: async () =>
          ok({
            case: {
              id: "rc-1",
              contractId: "oc-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              openedAt: "2026-08-21T00:00:00.000Z",
              responsibilityState: "UNKNOWN",
              state: "OPEN",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
          }),
        getRemedies: async () => ok([{ id: "remedy-1" }]),
        getMandate: async () => ok({ id: "mandate-1" }),
      },
    });

    const submitted = await Promise.resolve(
      ports.workflowSubmit?.submitWorkflow({ workflowId: "wf-1" }) ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(submitted).toMatchObject({ ok: true, value: { echoed: { workflowId: "wf-1" } } });

    const resumed = await Promise.resolve(
      ports.workflowResume?.resumeWorkflow("wf-2", { approvalId: "approval-2" }) ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(resumed).toMatchObject({ ok: true, value: { workflowId: "wf-2", body: { approvalId: "approval-2" } } });

    const read = await Promise.resolve(
      ports.workflowRead?.getWorkflow("wf-2") ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(read).toMatchObject({
      ok: true,
      value: {
        workflowId: "wf-2",
        state: "AUTHORIZED",
        evaluation: { decision: "ALLOW_WITH_MONITORING" },
      },
    });

    const committed = await Promise.resolve(
      ports.workflowCommit?.commitWorkflow("wf-3") ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(committed).toMatchObject({ ok: true, value: { workflowId: "wf-3", status: "SUCCESS" } });

    const outcome = await Promise.resolve(
      ports.outcomeRead?.getOutcomeContract("outcome-1") ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(outcome).toMatchObject({ ok: true, value: { id: "outcome-1", paymentStatus: "SUCCESS" } });

    const resolution = await Promise.resolve(
      ports.resolutionRead?.getResolutionCaseByOutcome("outcome-1") ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );
    expect(resolution).toMatchObject({ ok: true, value: { id: "rc-1", state: "OPEN" } });
  });

  it("reconstructs AWAITING_APPROVAL from durable approval state", async () => {
    const ports = createLivePublicBffPorts({
      intentCreate: stubIntentCreate(),
      workspaceSource: {
        getIntent: async () =>
          ok({
            id: "intent-stub-1",
            principalId: "principal-1" as Intent["principalId"],
            rawText: "Pay invoice",
            createdAt: "2026-08-21T12:00:00.000Z",
            contentHash: "hash-stub",
          }),
        getTip: async () => err(ErrorCode.VALIDATION_FAILED, "No IntentState tip for intent"),
      },
      evidence: new EvidenceService(),
      workflow: {
        submitWorkflow: async (raw) => ok({ echoed: raw }),
        getWorkflow: async (workflowId) => ok({ workflowId, state: "AUTHORITY_EVALUATION" }),
        resumeWorkflow: async (workflowId, body) => ok({ workflowId, body }),
        commitWorkflow: async (workflowId) => ok({ workflowId, status: "SUCCESS" }),
      },
      approvalRead: {
        getApproval: async () =>
          ok({
            id: "approval-wf-awaiting-1",
            workflowId: "wf-awaiting-1",
            intentId: "intent-1",
            intentStateId: "state-1",
            status: "PENDING",
            requestedCapability: "pay_invoice",
            requestedScope: { amount: 24000, currency: "USD", merchant: "approved-payee" },
            requestedAt: "2026-08-29T19:57:32.461Z",
            expiresAt: "2026-11-30T00:00:00Z",
          }),
        getEvaluation: async () =>
          ok({
            decision: "REQUIRE_APPROVAL",
            evaluation: {
              id: "evaluation-wf-awaiting-1-authority-wf-awaiting-1",
              hash: "h",
              materializationEligible: false,
              materializationReason: "PENDING_APPROVAL",
              expiresAt: "2026-11-30T00:00:00Z",
            },
          }),
      },
    });

    const read = await Promise.resolve(
      ports.workflowRead?.getWorkflow("wf-awaiting-1") ?? err(ErrorCode.VALIDATION_FAILED, "missing"),
    );

    expect(read).toMatchObject({
      ok: true,
      value: {
        workflowId: "wf-awaiting-1",
        state: "AWAITING_APPROVAL",
        approval: { status: "PENDING" },
        evaluation: { decision: "REQUIRE_APPROVAL" },
      },
    });
  });
});
