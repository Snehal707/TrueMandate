import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createAuthorityInternalRoutes } from "./internal-routes.js";
import { FUTURE, NOW, makeRuntime, parentScope } from "../../gateway-service/src/integration/harness.js";

const H = (char: string) => char.repeat(64);
class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

async function fixture(binding: Result<unknown> = ok({})) {
  const rt = await makeRuntime();
  const workflowId = "workflow-mint";
  const actionHash = hashActionProposal(rt.action);
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-mint", workflowId, workflow: { id: workflowId, hash: H("a") },
    action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "ALLOW", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
    expiresAt: FUTURE, materializationEligible: true, createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-mint", intentState: rt.state, principalId: "principal-1", merchant: "approved-a", quantity: 500, budgetMax: 700000,
    product: "fg-container", actionProposalId: rt.action.id, actionContentHash: actionHash, createdAt: NOW,
    preExecutionBinding: { workflowId, workflowHash: H("a") as never, actionId: rt.action.id, actionHash: actionHash as never, evaluationId: evaluation.value.id, evaluationHash: evaluation.value.recordHash as never, evaluatedIntentStateId: rt.state.id, evaluatedIntentStateHash: rt.state.stateHash, evaluatedIntentStateVersion: rt.state.version },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const prepared = await rt.gateway.prepare({
    action: rt.action, verdict: rt.verdict, principalId: "principal-1", toolId: "payment.execute", agentCapabilities: parentScope().capabilities,
    authorityScope: parentScope(), externalState: { merchant: "approved-a", product: "fg-container", quantity: 500, amount: 700000, currency: "INR", refundability: true, sku: "FG-500" },
    idempotencyKey: "mint-ref", expiresAt: FUTURE, createdAt: NOW, evaluationRecordId: evaluation.value.id, evaluationRecordHash: evaluation.value.recordHash,
    outcomeContractId: outcome.value.id, outcomeContractHash: outcome.value.definitionHash, workflowId, workflowHash: H("a"), evaluatedIntentStateVersion: rt.state.version,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  const route = createAuthorityInternalRoutes({ authority: rt.authority, evaluations, preparedActions: { get: async (id: string): Promise<Result<unknown>> => id === prepared.value.id ? await rt.gateway.getPreparedActionStore().get(id) : err("VALIDATION_FAILED" as never, "missing prepared") }, outcomeContracts: { get: async (id: string): Promise<Result<unknown>> => id === outcome.value.id ? ok(outcome.value) : err("VALIDATION_FAILED" as never, "missing outcome") }, provenance: { createAuthorityBinding: async () => binding } }).find((candidate) => candidate.pattern === "/internal/authority/bind-and-mint")!;
  const body = { evaluation: { id: evaluation.value.id, hash: evaluation.value.recordHash }, preparedAction: { id: prepared.value.id, hash: prepared.value.preparedActionHash }, outcomeContract: { id: outcome.value.id, hash: outcome.value.definitionHash! }, idempotencyKey: "mint-ref" };
  return { rt, route, body, evaluation: evaluation.value, prepared: prepared.value, outcome: outcome.value };
}

describe("Authority reference-only bind-and-mint", () => {
  it("mints one grant with complete durable lineage", async () => {
    const f = await fixture();
    const response = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ evaluationRecordId: f.evaluation.id, outcomeContractId: f.outcome.id, preparedActionId: f.prepared.id, workflowId: f.evaluation.workflowId, actionId: f.evaluation.action.id, stateHash: f.evaluation.evaluatedIntentState.hash });
  });

  it("fails closed when Authority provenance binding fails", async () => {
    const f = await fixture(err(ErrorCode.VALIDATION_FAILED, "Authority provenance binding failed"));
    const response = await f.route.handler({ body: f.body, headers: {}, params: {} });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "VALIDATION_FAILED" });
  });

  it.each(["evaluation", "preparedAction", "outcomeContract", "raw scope", "raw amount", "raw decision"])('rejects %s substitution before grant persistence', async (kind) => {
    const f = await fixture();
    const body: Record<string, unknown> = { ...f.body };
    if (kind === "evaluation") body.evaluation = { ...f.body.evaluation, hash: H("f") };
    if (kind === "preparedAction") body.preparedAction = { ...f.body.preparedAction, hash: H("f") };
    if (kind === "outcomeContract") body.outcomeContract = { ...f.body.outcomeContract, hash: H("f") };
    if (kind === "raw scope") body.scope = parentScope();
    if (kind === "raw amount") body.amount = 900000;
    if (kind === "raw decision") body.decision = "ALLOW";
    const response = await f.route.handler({ body, headers: {}, params: {} });
    expect(response.status).toBe(400);
    const expectedId = `grant-${(await import("@truemandate/crypto")).hashCanonical({ evaluation: f.evaluation.id, prepared: f.prepared.preparedActionHash, idempotencyKey: "mint-ref" }).slice(0, 16)}`;
    const stored = await f.rt.authority.getGrantStore().get(expectedId);
    expect(stored.ok && stored.value).toBeUndefined();
  });
});
