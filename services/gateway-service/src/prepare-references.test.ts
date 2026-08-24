import {
  createApprovalRequest,
  createEvaluationRecord,
  decideApproval,
  supersedePending,
  type AuthorityEvaluationRecord,
  type EvaluationStore,
} from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ApprovalDecision, ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createGatewayInternalRoutes } from "./internal-routes.js";
import { FUTURE, NOW, makeRuntime, parentScope } from "./integration/harness.js";

const H = (char: string) => char.repeat(64);

class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

async function fixture(input?: {
  readonly decision?: AuthorityEvaluationRecord["decision"];
  readonly materializationEligible?: boolean;
  readonly materializationReason?: AuthorityEvaluationRecord["materializationReason"];
}) {
  const rt = await makeRuntime();
  const workflow = { id: "workflow-prepare", kind: "WORKFLOW", workflowId: "workflow-prepare", contentHash: H("a") };
  const actionHash = hashActionProposal(rt.action);
  const guardian = { id: rt.verdict.id, kind: "GUARDIAN", workflowId: workflow.id, contentHash: rt.verdict.verdictHash, payload: { verdict: rt.verdict } };
  const action = { id: rt.action.id, kind: "ACTION", workflowId: workflow.id, contentHash: H("b"), payload: { intentStateId: rt.state.id, intentStateHash: rt.state.stateHash, action: rt.action } };
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-prepare", workflowId: workflow.id,
    workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: action.contentHash },
    guardian: { id: guardian.id, hash: guardian.contentHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: input?.decision ?? "ALLOW",
    scope: parentScope(),
    capability: "execute_payment",
    merchant: "approved-a",
    amount: 700000,
    currency: "INR",
    expiresAt: FUTURE,
    materializationEligible: input?.materializationEligible ?? true,
    materializationReason: input?.materializationReason,
    createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-prepare", intentState: rt.state, principalId: "principal-1", merchant: "approved-a", quantity: 500,
    budgetMax: 700000, product: "fg-container", actionProposalId: action.id, actionContentHash: action.contentHash,
    createdAt: NOW, preExecutionBinding: {
      workflowId: workflow.id, workflowHash: workflow.contentHash as never, actionId: action.id, actionHash: action.contentHash as never,
      evaluationId: evaluation.value.id, evaluationHash: evaluation.value.recordHash as never,
      evaluatedIntentStateId: rt.state.id, evaluatedIntentStateHash: rt.state.stateHash, evaluatedIntentStateVersion: rt.state.version,
    },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const artifacts = new Map<string, unknown>([[workflow.id, workflow], [action.id, action], [guardian.id, guardian]]);
  const owners = {
    getEvaluation: async (id: string): Promise<Result<unknown>> => id === evaluation.value.id ? ok(evaluation.value) : err("VALIDATION_FAILED" as never, "missing evaluation"),
    getOutcomeContract: async (id: string): Promise<Result<unknown>> => id === outcome.value.id ? ok(outcome.value) : err("VALIDATION_FAILED" as never, "missing outcome"),
    getArtifact: async (id: string): Promise<Result<unknown>> => artifacts.has(id) ? ok(artifacts.get(id)) : err("VALIDATION_FAILED" as never, "missing artifact"),
    getState: async (id: string): Promise<Result<unknown>> => id === rt.state.id ? ok(rt.state) : err("VALIDATION_FAILED" as never, "missing state"),
    getTip: async (intentId: string): Promise<Result<unknown>> => intentId === rt.intent.id ? ok(rt.state) : err("VALIDATION_FAILED" as never, "missing tip"),
  };
  const route = createGatewayInternalRoutes({ gateway: rt.gateway, owners }).find((candidate) => candidate.pattern === "/internal/gateway/prepare-references")!;
  const body = { evaluation: { id: evaluation.value.id, hash: evaluation.value.recordHash }, outcomeContract: { id: outcome.value.id, hash: outcome.value.definitionHash! }, workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: action.contentHash }, idempotencyKey: "prepare-ref" };
  const preparedId = `prep-${actionHash.slice(0, 12)}`;
  return { rt, route, body, preparedId, artifacts, evaluation: evaluation.value, outcome: outcome.value, owners };
}

describe("Gateway reference-only PREPARE", () => {
  it("creates exactly one PreparedAction from a complete owner-resolved lineage", async () => {
    const f = await fixture();
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(200);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeTruthy();
    if (prepared.ok && prepared.value) {
      expect(prepared.value.preparedAction.actionContentHash).toBe(f.evaluation.action.hash);
      expect(prepared.value.preparedAction.actionContentHash).not.toBe(hashActionProposal(f.rt.action));
    }
  });

  it("accepts ALLOW_WITH_MONITORING when materializationEligible=true", async () => {
    const f = await fixture({
      decision: "ALLOW_WITH_MONITORING",
      materializationEligible: true,
      materializationReason: "PENDING_MONITORING",
    });
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(200);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeTruthy();
  });

  it("fails closed for ALLOW_WITH_MONITORING when materializationEligible=false", async () => {
    const f = await fixture({
      decision: "ALLOW_WITH_MONITORING",
      materializationEligible: false,
      materializationReason: "PENDING_MONITORING",
    });
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.AUTHORITY_BLOCKED });
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it.each([
    "evaluation hash", "outcome hash", "workflow hash", "action hash", "raw action", "raw economics",
  ])("rejects DTO smuggling or reference mismatch: %s", async (kind) => {
    const f = await fixture();
    const body: Record<string, unknown> = { ...f.body };
    if (kind === "evaluation hash") body.evaluation = { ...f.body.evaluation, hash: H("f") };
    if (kind === "outcome hash") body.outcomeContract = { ...f.body.outcomeContract, hash: H("f") };
    if (kind === "workflow hash") body.workflow = { ...f.body.workflow, hash: H("f") };
    if (kind === "action hash") body.action = { ...f.body.action, hash: H("f") };
    if (kind === "raw action") body.action = f.rt.action;
    if (kind === "raw economics") body.amount = 900000;
    const result = await f.route.handler({ body, headers: {}, params: {} });
    expect(result.status).toBe(400);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it.each([
    "non-materializable evaluation", "expired evaluation", "OutcomeContract binding", "workflow artifact", "action workflow", "Guardian kind", "Action state hash", "current tip",
  ])("fails closed before persistence when %s is mutated", async (kind) => {
    const f = await fixture();
    if (kind === "non-materializable evaluation") {
      (f.evaluation as { materializationEligible: boolean }).materializationEligible = false;
    } else if (kind === "expired evaluation") {
      (f.evaluation as { expiresAt?: string }).expiresAt = "2020-01-01T00:00:00.000Z";
    } else if (kind === "OutcomeContract binding") {
      (f.outcome.preExecutionBinding as { actionId: string }).actionId = "other-action";
    } else if (kind === "workflow artifact") {
      f.artifacts.set(f.body.workflow.id, { id: f.body.workflow.id, kind: "WORKFLOW", workflowId: f.body.workflow.id, contentHash: H("b") });
    } else if (kind === "action workflow") {
      const a = f.artifacts.get(f.body.action.id) as { workflowId: string }; a.workflowId = "other-workflow";
    } else if (kind === "Guardian kind") {
      const g = f.artifacts.get(f.evaluation.guardian.id) as { kind: string }; g.kind = "ACTION";
    } else if (kind === "Action state hash") {
      const a = f.artifacts.get(f.body.action.id) as { payload: { intentStateHash: string } }; a.payload.intentStateHash = H("e");
    } else {
      f.owners.getTip = async () => ok({ id: "advanced", stateHash: H("d") });
    }
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(400);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it("does not permit owner-record economics or capability broadening", async () => {
    const f = await fixture();
    const action = f.artifacts.get(f.body.action.id) as { payload: { action: { amount: number } } };
    action.payload.action.amount = 700001;
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(400);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });
});

async function requireApprovalFixture() {
  const rt = await makeRuntime();
  const workflow = { id: "workflow-approval-prep", kind: "WORKFLOW", workflowId: "workflow-approval-prep", contentHash: H("a") };
  const actionHash = hashActionProposal(rt.action);
  const guardian = { id: rt.verdict.id, kind: "GUARDIAN", workflowId: workflow.id, contentHash: rt.verdict.verdictHash, payload: { verdict: rt.verdict } };
  const action = {
    id: rt.action.id,
    kind: "ACTION",
    workflowId: workflow.id,
    contentHash: H("b"),
    payload: { intentStateId: rt.state.id, intentStateHash: rt.state.stateHash, action: rt.action },
  };
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1,
    id: "evaluation-approval-prep",
    workflowId: workflow.id,
    workflow: { id: workflow.id, hash: workflow.contentHash },
    action: { id: action.id, hash: action.contentHash },
    guardian: { id: guardian.id, hash: guardian.contentHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "REQUIRE_APPROVAL",
    scope: parentScope(),
    capability: "execute_payment",
    merchant: "approved-a",
    amount: 700000,
    currency: "INR",
    expiresAt: FUTURE,
    materializationEligible: false,
    materializationReason: "PENDING_APPROVAL",
    createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-approval-prep",
    intentState: rt.state,
    principalId: "principal-1",
    merchant: "approved-a",
    quantity: 500,
    budgetMax: 700000,
    product: "fg-container",
    actionProposalId: action.id,
    actionContentHash: action.contentHash,
    createdAt: NOW,
    preExecutionBinding: {
      workflowId: workflow.id,
      workflowHash: workflow.contentHash as never,
      actionId: action.id,
      actionHash: action.contentHash as never,
      evaluationId: evaluation.value.id,
      evaluationHash: evaluation.value.recordHash as never,
      evaluatedIntentStateId: rt.state.id,
      evaluatedIntentStateHash: rt.state.stateHash,
      evaluatedIntentStateVersion: rt.state.version,
    },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const artifacts = new Map<string, unknown>([
    [workflow.id, workflow],
    [action.id, action],
    [guardian.id, guardian],
  ]);
  const owners = {
    getEvaluation: async (id: string): Promise<Result<unknown>> =>
      id === evaluation.value.id ? ok(evaluation.value) : err("VALIDATION_FAILED" as never, "missing evaluation"),
    getOutcomeContract: async (id: string): Promise<Result<unknown>> =>
      id === outcome.value.id ? ok(outcome.value) : err("VALIDATION_FAILED" as never, "missing outcome"),
    getArtifact: async (id: string): Promise<Result<unknown>> =>
      artifacts.has(id) ? ok(artifacts.get(id)) : err("VALIDATION_FAILED" as never, "missing artifact"),
    getState: async (id: string): Promise<Result<unknown>> =>
      id === rt.state.id ? ok(rt.state) : err("VALIDATION_FAILED" as never, "missing state"),
    getTip: async (intentId: string): Promise<Result<unknown>> =>
      intentId === rt.intent.id ? ok(rt.state) : err("VALIDATION_FAILED" as never, "missing tip"),
  };
  const approvals = new Map<string, unknown>();
  const pending = createApprovalRequest({
    draft: {
      id: "approval-prep-1",
      workflowId: workflow.id,
      intentId: rt.intent.id,
      intentStateId: rt.state.id,
      intentStateHash: rt.state.stateHash,
      authorityEvaluationId: evaluation.value.id,
      requestedCapability: "execute_payment",
      requestedScope: { amount: 700000, currency: "INR", merchant: "approved-a" },
      requestedAt: NOW,
      expiresAt: FUTURE,
    },
    evaluation: {
      decision: "REQUIRE_APPROVAL",
      capability: "execute_payment",
      merchant: "approved-a",
      amount: 700000,
      currency: "INR",
      evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash },
    },
  });
  if (!pending.ok) throw new Error(pending.message);
  const decided = decideApproval(pending.value, {
    decision: ApprovalDecision.APPROVE,
    decidedBy: "human-approver@example.com",
    at: NOW,
    eventId: "approval-event-prep-1-decided",
    currentIntentStateHash: rt.state.stateHash,
  });
  if (!decided.ok) throw new Error(decided.message);
  approvals.set(decided.value.updated.id, decided.value.updated);
  const route = createGatewayInternalRoutes({
    gateway: rt.gateway,
    owners,
    approvalReadPort: { get: async (id) => approvals.get(id) },
  }).find((candidate) => candidate.pattern === "/internal/gateway/prepare-references")!;
  const body = {
    evaluation: { id: evaluation.value.id, hash: evaluation.value.recordHash },
    outcomeContract: { id: outcome.value.id, hash: outcome.value.definitionHash! },
    workflow: { id: workflow.id, hash: workflow.contentHash },
    action: { id: action.id, hash: action.contentHash },
    idempotencyKey: "prepare-approval-ref",
    approvalId: decided.value.updated.id,
  };
  const preparedId = `prep-${actionHash.slice(0, 12)}`;
  return {
    rt,
    route,
    body,
    preparedId,
    approvals,
    approval: decided.value.updated,
    pending: pending.value,
    evaluation: evaluation.value,
  };
}

describe("Gateway prepare-references — durable approval unlock", () => {
  it("proceeds when a durable APPROVED approval unlocks REQUIRE_APPROVAL", async () => {
    const f = await requireApprovalFixture();
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(200);
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeTruthy();
  });

  it("fails closed with APPROVAL_REQUIRED when approvalId is missing", async () => {
    const f = await requireApprovalFixture();
    const { approvalId: _drop, ...withoutApproval } = f.body;
    const result = await f.route.handler({ body: withoutApproval, headers: {}, params: {} });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.APPROVAL_REQUIRED });
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it("fails closed when the durable approval row is missing", async () => {
    const f = await requireApprovalFixture();
    f.approvals.clear();
    const result = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.APPROVAL_NOT_PENDING });
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it("fails closed when approval is SUPERSEDED", async () => {
    const f = await requireApprovalFixture();
    const superseded = supersedePending(f.pending, {
      supersededBy: "approval-prep-2",
      eventId: "approval-event-prep-1-superseded",
      at: NOW,
    });
    if (!superseded.ok || !superseded.value.updated) throw new Error("supersede failed");
    f.approvals.set(f.pending.id, superseded.value.updated);
    const result = await f.route.handler({
      body: { ...f.body, approvalId: f.pending.id },
      headers: {},
      params: {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.AUTHORITY_BLOCKED });
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it("fails closed on authorityEvaluationId / IntentState unlock mismatch", async () => {
    const f = await requireApprovalFixture();
    const wrongEval = createApprovalRequest({
      draft: {
        id: "approval-prep-wrong-eval",
        workflowId: f.evaluation.workflowId,
        intentId: f.rt.intent.id,
        intentStateId: f.rt.state.id,
        intentStateHash: f.rt.state.stateHash,
        authorityEvaluationId: "evaluation-other",
        requestedCapability: "execute_payment",
        requestedScope: { amount: 700000, currency: "INR", merchant: "approved-a" },
        requestedAt: NOW,
        expiresAt: FUTURE,
      },
      evaluation: {
        decision: "REQUIRE_APPROVAL",
        capability: "execute_payment",
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        evaluatedIntentState: { id: f.rt.state.id, hash: f.rt.state.stateHash },
      },
    });
    if (!wrongEval.ok) throw new Error(wrongEval.message);
    const wrongDecided = decideApproval(wrongEval.value, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "human-approver@example.com",
      at: NOW,
      eventId: "approval-event-prep-wrong-eval-decided",
      currentIntentStateHash: f.rt.state.stateHash,
    });
    if (!wrongDecided.ok) throw new Error(wrongDecided.message);
    f.approvals.set(wrongDecided.value.updated.id, wrongDecided.value.updated);
    const result = await f.route.handler({
      body: { ...f.body, approvalId: wrongDecided.value.updated.id },
      headers: {},
      params: {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.AUTHORITY_BLOCKED });
    const prepared = await f.rt.gateway.getPreparedActionStore().get(f.preparedId);
    expect(prepared.ok && prepared.value).toBeUndefined();
  });

  it("fails closed on merchant scope mismatch", async () => {
    const f = await requireApprovalFixture();
    const wrongMerchant = createApprovalRequest({
      draft: {
        id: "approval-prep-wrong-merchant",
        workflowId: f.evaluation.workflowId,
        intentId: f.rt.intent.id,
        intentStateId: f.rt.state.id,
        intentStateHash: f.rt.state.stateHash,
        authorityEvaluationId: f.evaluation.id,
        requestedCapability: "execute_payment",
        requestedScope: { amount: 700000, currency: "INR", merchant: "other-merchant" },
        requestedAt: NOW,
        expiresAt: FUTURE,
      },
      evaluation: {
        decision: "REQUIRE_APPROVAL",
        capability: "execute_payment",
        merchant: "other-merchant",
        amount: 700000,
        currency: "INR",
        evaluatedIntentState: { id: f.rt.state.id, hash: f.rt.state.stateHash },
      },
    });
    if (!wrongMerchant.ok) throw new Error(wrongMerchant.message);
    const decided = decideApproval(wrongMerchant.value, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "human-approver@example.com",
      at: NOW,
      eventId: "approval-event-prep-wrong-merchant-decided",
      currentIntentStateHash: f.rt.state.stateHash,
    });
    if (!decided.ok) throw new Error(decided.message);
    f.approvals.set(decided.value.updated.id, decided.value.updated);
    const result = await f.route.handler({
      body: { ...f.body, approvalId: decided.value.updated.id },
      headers: {},
      params: {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: ErrorCode.AUTHORITY_BLOCKED });
  });
});
