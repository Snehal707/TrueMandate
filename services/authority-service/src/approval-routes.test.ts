import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import { ApprovalEventType, ApprovalRequestStatus, ErrorCode, ok, type ApprovalEvent, type ApprovalRequest } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createApprovalRoutes } from "./approval-routes.js";
import { FUTURE, NOW, makeRuntime, parentScope } from "../../gateway-service/src/integration/harness.js";

const H = (char: string) => char.repeat(64);

class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

class MemoryApprovals {
  readonly rows = new Map<string, ApprovalRequest>();
  readonly events = new Map<string, ApprovalEvent>();
  async get(id: string): Promise<ApprovalRequest | undefined> { return this.rows.get(id); }
  async putIfAbsent(id: string, value: ApprovalRequest): Promise<boolean> { if (this.rows.has(id)) return false; this.rows.set(id, value); return true; }
  async put(id: string, value: ApprovalRequest): Promise<void> { this.rows.set(id, value); }
  async putEvent(id: string, value: ApprovalEvent): Promise<boolean> { if (this.events.has(id)) return false; this.events.set(id, value); return true; }
}

async function fixture() {
  const rt = await makeRuntime();
  const workflowId = "workflow-approval";
  const actionHash = hashActionProposal(rt.action);
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-approval", workflowId, workflow: { id: workflowId, hash: H("a") },
    action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "REQUIRE_APPROVAL", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
    expiresAt: FUTURE, materializationEligible: false, materializationReason: "PENDING_APPROVAL", createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const approvals = new MemoryApprovals();
  const routes = createApprovalRoutes({
    approvals,
    approvalEvents: { putIfAbsent: (id, value) => approvals.putEvent(id, value) },
    evaluations,
    tip: { getCurrentIntentState: async () => ({ ok: true as const, value: { id: rt.state.id, stateHash: rt.state.stateHash } }) },
  });
  const createRoute = routes.find((route) => route.pattern === "/internal/approvals")!;
  const decideRoute = routes.find((route) => route.pattern === "/internal/approvals/:id/decide")!;
  const getRoute = routes.find((route) => route.pattern === "/internal/approvals/:id")!;
  const createBody = {
    id: "approval-workflow-approval",
    evaluationId: evaluation.value.id,
    intentId: "intent-approval",
    actionId: rt.action.id,
    requestedAt: NOW,
    expiresAt: FUTURE,
  };
  return { rt, evaluation: evaluation.value, approvals, createRoute, decideRoute, getRoute, createBody };
}

const CALLER = { email: "human-approver@example.com" };

describe("Authority durable approval routes", () => {
  it("creates a PENDING request derived from the evaluation with a durable event", async () => {
    const f = await fixture();
    const response = await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "approval-workflow-approval",
      workflowId: "workflow-approval",
      authorityEvaluationId: f.evaluation.id,
      intentStateHash: f.evaluation.evaluatedIntentState.hash,
      status: ApprovalRequestStatus.PENDING,
      requestedCapability: "execute_payment",
      requestedScope: { amount: 700000, currency: "INR", merchant: "approved-a" },
    });
    expect(f.approvals.events.has("approval-event-approval-workflow-approval-requested")).toBe(true);
  });

  it("rejects caller-supplied scope — the request derives ONLY from the evaluation", async () => {
    const f = await fixture();
    const body = { ...f.createBody, requestedScope: { amount: 1, currency: "USD", merchant: "forged" }, requestedCapability: "admin" };
    const response = await f.createRoute.handler({ body, headers: {}, params: {} });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "MALFORMED_JSON" });
    // Fail closed: no approval row was created from the forged scope.
    expect(await f.approvals.get("approval-workflow-approval")).toBeUndefined();
  });

  it("rejects creation from a non-REQUIRE_APPROVAL evaluation", async () => {
    const f = await fixture();
    const rt = await makeRuntime();
    const actionHash = hashActionProposal(rt.action);
    const evaluations = new MemoryEvaluations();
    const allowEvaluation = await createEvaluationRecord(evaluations, {
      schemaVersion: 1, id: "evaluation-allow", workflowId: "workflow-allow", workflow: { id: "workflow-allow", hash: H("a") },
      action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
      evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
      decision: "ALLOW", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
      expiresAt: FUTURE, materializationEligible: true, createdAt: NOW,
    });
    if (!allowEvaluation.ok) throw new Error(allowEvaluation.message);
    const approvals = new MemoryApprovals();
    const routes = createApprovalRoutes({
      approvals,
      approvalEvents: { putIfAbsent: (id, value) => approvals.putEvent(id, value) },
      evaluations,
      tip: { getCurrentIntentState: async () => ({ ok: true as const, value: { id: rt.state.id, stateHash: rt.state.stateHash } }) },
    });
    const response = await routes.find((route) => route.pattern === "/internal/approvals")!.handler({
      body: { ...f.createBody, evaluationId: allowEvaluation.value.id },
      headers: {}, params: {},
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: ErrorCode.APPROVAL_REQUIRED });
  });

  it("re-request supersedes the prior PENDING request and reuses the deterministic id", async () => {
    const f = await fixture();
    const first = await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    expect(first.status).toBe(200);
    const second = await f.createRoute.handler({ body: { ...f.createBody, expiresAt: "2031-01-01T00:00:00.000Z" }, headers: {}, params: {} });
    expect(second.status).toBe(400);
    // Same id space: the first doc became SUPERSEDED and the new expiry was rejected by putIfAbsent.
    const stored = await f.approvals.get("approval-workflow-approval");
    expect(stored?.status).toBe(ApprovalRequestStatus.SUPERSEDED);
    expect(stored?.supersededBy).toBe("approval-workflow-approval");
    expect(f.approvals.events.has("approval-event-approval-workflow-approval-superseded")).toBe(true);
  });

  it("decide requires the verified caller identity and records it as decidedBy", async () => {
    const f = await fixture();
    await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    const forged = await f.decideRoute.handler({ body: { decision: "APPROVE", decidedBy: "forged@example.com" }, headers: {}, params: { id: "approval-workflow-approval" } });
    expect(forged.status).toBe(400);
    const noCaller = await f.decideRoute.handler({ body: { decision: "APPROVE" }, headers: {}, params: { id: "approval-workflow-approval" } });
    expect(noCaller.status).toBe(400);
    expect(noCaller.body).toMatchObject({ error: ErrorCode.VALIDATION_FAILED });
    const decided = await f.decideRoute.handler({ body: { decision: "APPROVE", reason: "bounded and verified" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: ApprovalRequestStatus.APPROVED, decidedBy: CALLER.email, decision: "APPROVE", reason: "bounded and verified" });
    expect(f.approvals.events.has("approval-event-approval-workflow-approval-decided")).toBe(true);
  });

  it("a decided request is terminal — a second decide fails closed", async () => {
    const f = await fixture();
    await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    const first = await f.decideRoute.handler({ body: { decision: "APPROVE" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    expect(first.status).toBe(200);
    const second = await f.decideRoute.handler({ body: { decision: "DENY" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({ error: ErrorCode.APPROVAL_NOT_PENDING });
  });

  it("lazy-expires a PENDING request past its expiry and refuses the decide", async () => {
    const f = await fixture();
    const pastBody = { ...f.createBody, requestedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" };
    await f.createRoute.handler({ body: pastBody, headers: {}, params: {} });
    const decided = await f.decideRoute.handler({ body: { decision: "APPROVE" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    expect(decided.status).toBe(400);
    expect(decided.body).toMatchObject({ error: ErrorCode.APPROVAL_EXPIRED });
    const stored = await f.approvals.get("approval-workflow-approval");
    expect(stored?.status).toBe(ApprovalRequestStatus.EXPIRED);
    expect(f.approvals.events.has("approval-event-approval-workflow-approval-expired")).toBe(true);
  });

  it("refuses to decide when the IntentState tip has moved (fresh revalidation)", async () => {
    const f = await fixture();
    await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    const routes = createApprovalRoutes({
      approvals: f.approvals,
      approvalEvents: { putIfAbsent: (id, value) => f.approvals.putEvent(id, value) },
      evaluations: new MemoryEvaluations(),
      tip: { getCurrentIntentState: async () => ({ ok: true as const, value: { id: f.rt.state.id, stateHash: H("c") } }) },
    });
    const decideRoute = routes.find((route) => route.pattern === "/internal/approvals/:id/decide")!;
    const decided = await decideRoute.handler({ body: { decision: "APPROVE" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    expect(decided.status).toBe(400);
    expect(decided.body).toMatchObject({ error: ErrorCode.APPROVAL_STALE_INTENT_STATE });
    // Fail closed: the durable request stays PENDING (the caller may re-request
    // against a fresh evaluation of the new state instead).
    const stored = await f.approvals.get("approval-workflow-approval");
    expect(stored?.status).toBe(ApprovalRequestStatus.PENDING);
  });

  it("GET returns the hash-validated request and rejects a tampered durable row", async () => {
    const f = await fixture();
    await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    const read = await f.getRoute.handler({ body: undefined, headers: {}, params: { id: "approval-workflow-approval" } });
    expect(read.status).toBe(200);
    const row = await f.approvals.get("approval-workflow-approval");
    await f.approvals.put("approval-workflow-approval", { ...row!, requestedScope: { ...row!.requestedScope, amount: 1 } });
    const tampered = await f.getRoute.handler({ body: undefined, headers: {}, params: { id: "approval-workflow-approval" } });
    expect(tampered.status).toBe(400);
    expect(tampered.body).toMatchObject({ error: ErrorCode.VALIDATION_FAILED });
  });

  it("records the decided event with the verified actor identity", async () => {
    const f = await fixture();
    await f.createRoute.handler({ body: f.createBody, headers: {}, params: {} });
    await f.decideRoute.handler({ body: { decision: "DENY", reason: "risk" }, headers: {}, params: { id: "approval-workflow-approval" }, caller: CALLER });
    const event = f.approvals.events.get("approval-event-approval-workflow-approval-decided");
    expect(event?.type).toBe(ApprovalEventType.REJECTED);
    expect(event?.actor).toBe(CALLER.email);
    expect(event?.payload).toMatchObject({ decision: "DENY", reason: "risk" });
  });

  it("records APPROVAL STARTED on create and COMPLETED/FAILED on decide (fail-open)", async () => {
    const stages: Array<{ stage: string; status: string; workflowId: string }> = [];
    const stageRecorder = {
      recordStage: async (event: { stage: string; status: string; workflowId: string }) => {
        stages.push({ stage: event.stage, status: event.status, workflowId: event.workflowId });
      },
    };
    const rt = await makeRuntime();
    const workflowId = "workflow-approval";
    const actionHash = hashActionProposal(rt.action);
    const evaluations = new MemoryEvaluations();
    const evaluation = await createEvaluationRecord(evaluations, {
      schemaVersion: 1, id: "evaluation-approval-stage", workflowId, workflow: { id: workflowId, hash: H("a") },
      action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
      evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
      decision: "REQUIRE_APPROVAL", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
      expiresAt: FUTURE, materializationEligible: false, materializationReason: "PENDING_APPROVAL", createdAt: NOW,
    });
    if (!evaluation.ok) throw new Error(evaluation.message);
    const approvals = new MemoryApprovals();
    const routes = createApprovalRoutes({
      approvals,
      approvalEvents: { putIfAbsent: (id, value) => approvals.putEvent(id, value) },
      evaluations,
      tip: { getCurrentIntentState: async () => ({ ok: true as const, value: { id: rt.state.id, stateHash: rt.state.stateHash } }) },
      stageRecorder,
    });
    const createRoute = routes.find((route) => route.pattern === "/internal/approvals")!;
    const decideRoute = routes.find((route) => route.pattern === "/internal/approvals/:id/decide")!;
    const createBody = {
      id: "approval-stage-timing",
      evaluationId: evaluation.value.id,
      intentId: "intent-approval",
      actionId: rt.action.id,
      requestedAt: NOW,
      expiresAt: FUTURE,
    };
    await createRoute.handler({ body: createBody, headers: {}, params: {} });
    expect(stages.some((s) => s.stage === "APPROVAL" && s.status === "STARTED" && s.workflowId === workflowId)).toBe(true);
    await decideRoute.handler({ body: { decision: "APPROVE" }, headers: {}, params: { id: "approval-stage-timing" }, caller: CALLER });
    expect(stages.some((s) => s.stage === "APPROVAL" && s.status === "COMPLETED")).toBe(true);
  });
});
