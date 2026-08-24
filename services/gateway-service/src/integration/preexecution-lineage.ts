import {
  createEvaluationRecord,
  type AuthorityEvaluationRecord,
  type EvaluationStore,
} from "@truemandate/authority";
import { hashCanonical } from "@truemandate/crypto";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ErrorCode, asHashDigest, err, ok, type Result } from "@truemandate/protocol";
import { FUTURE, NOW, makeRuntime, parentScope } from "./harness.js";

export class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();

  async get(id: string) {
    return ok(this.rows.get(id));
  }

  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) {
    if (this.rows.has(id)) return ok(false);
    this.rows.set(id, value);
    return ok(true);
  }
}

/** Canonical owner-backed pre-execution lineage for Gateway route tests. */
export async function createPreExecutionLineage() {
  const rt = await makeRuntime();
  const workflow = {
    id: "workflow-route",
    kind: "WORKFLOW",
    workflowId: "workflow-route",
    contentHash: hashCanonical({ id: "workflow-route", kind: "WORKFLOW" }),
  };
  const actionHash = hashActionProposal(rt.action);
  const guardian = {
    id: rt.verdict.id,
    kind: "GUARDIAN",
    workflowId: workflow.id,
    contentHash: rt.verdict.verdictHash,
    payload: { verdict: rt.verdict },
  };
  const action = {
    id: rt.action.id,
    kind: "ACTION",
    workflowId: workflow.id,
    contentHash: actionHash,
    payload: {
      intentStateId: rt.state.id,
      intentStateHash: rt.state.stateHash,
      action: rt.action,
    },
  };
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1,
    id: "evaluation-route",
    workflowId: workflow.id,
    workflow: { id: workflow.id, hash: workflow.contentHash },
    action: { id: action.id, hash: action.contentHash },
    guardian: { id: guardian.id, hash: guardian.contentHash },
    evaluatedIntentState: {
      id: rt.state.id,
      hash: rt.state.stateHash,
      version: rt.state.version,
    },
    decision: "ALLOW",
    scope: parentScope(),
    capability: "execute_payment",
    merchant: "approved-a",
    amount: 700000,
    currency: "INR",
    expiresAt: FUTURE,
    materializationEligible: true,
    createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);

  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-route",
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
      workflowHash: workflow.contentHash,
      actionId: action.id,
      actionHash: action.contentHash,
      evaluationId: evaluation.value.id,
      evaluationHash: asHashDigest(evaluation.value.recordHash),
      evaluatedIntentStateId: rt.state.id,
      evaluatedIntentStateHash: rt.state.stateHash,
      evaluatedIntentStateVersion: rt.state.version,
    },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const outcomeDefinitionHash = outcome.value.definitionHash;
  if (!outcomeDefinitionHash) {
    throw new Error("Pre-execution OutcomeContract is missing its definition hash");
  }

  const artifacts = new Map<string, unknown>([
    [workflow.id, workflow],
    [action.id, action],
    [guardian.id, guardian],
  ]);
  const owners = {
    getEvaluation: async (id: string): Promise<Result<unknown>> =>
      id === evaluation.value.id
        ? ok(evaluation.value)
        : err(ErrorCode.VALIDATION_FAILED, "missing evaluation"),
    getOutcomeContract: async (id: string): Promise<Result<unknown>> =>
      id === outcome.value.id
        ? ok(outcome.value)
        : err(ErrorCode.VALIDATION_FAILED, "missing outcome"),
    getArtifact: async (id: string): Promise<Result<unknown>> =>
      artifacts.has(id)
        ? ok(artifacts.get(id))
        : err(ErrorCode.VALIDATION_FAILED, "missing artifact"),
    getState: async (id: string): Promise<Result<unknown>> =>
      id === rt.state.id
        ? ok(rt.state)
        : err(ErrorCode.VALIDATION_FAILED, "missing state"),
    getTip: async (intentId: string): Promise<Result<unknown>> =>
      intentId === rt.intent.id
        ? ok(rt.state)
        : err(ErrorCode.VALIDATION_FAILED, "missing tip"),
  };

  return {
    rt,
    evaluations,
    outcomes,
    owners,
    evaluation: evaluation.value,
    outcome: outcome.value,
    prepareBody: {
      evaluation: { id: evaluation.value.id, hash: evaluation.value.recordHash },
      outcomeContract: { id: outcome.value.id, hash: outcomeDefinitionHash },
      workflow: { id: workflow.id, hash: workflow.contentHash },
      action: { id: action.id, hash: action.contentHash },
      idempotencyKey: "gateway-route",
    },
  };
}
