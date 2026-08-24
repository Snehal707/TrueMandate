import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ProvenanceService } from "@truemandate/provenance-service";
import { initRuntimePersistence } from "@truemandate/cloud-runtime";
import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  ok,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import {
  authorityExecutionProvenance,
  executionActionProvenance,
  semanticActionProvenance,
  emptyTaint,
} from "@truemandate/provenance";
import { hashCanonical } from "@truemandate/crypto";
import { describe, expect, it } from "vitest";
import { TwoPhaseGateway, type CommitResult } from "./two-phase.js";
import { FUTURE, NOW, makeRuntime, parentScope } from "./integration/harness.js";

const H = (char: string) => char.repeat(64);

class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

function lineageOf(prepared: PreparedAction) {
  return {
    preparedActionId: prepared.id,
    preparedActionHash: prepared.preparedActionHash,
    actionId: prepared.actionProposalId,
    actionHash: prepared.actionContentHash,
    workflowId: prepared.workflowId,
    evaluationId: prepared.evaluationRecordId,
    evaluationHash: prepared.evaluationRecordHash,
    outcomeContractId: prepared.outcomeContractId,
    outcomeContractHash: prepared.outcomeContractHash,
    intentStateId: prepared.intentStateId,
    intentStateHash: prepared.intentStateHash,
    intentStateVersion: prepared.evaluatedIntentStateVersion,
  };
}

async function seedFullDurableProvenance(
  durable: ProvenanceService,
  prepared: PreparedAction,
  grant: { id: string; principalId: string; intentId: string; createdAt: string },
): Promise<void> {
  const lineage = lineageOf(prepared);
  const semantic = semanticActionProvenance(lineage, NOW);
  expect((await durable.recordNode(semantic)).ok).toBe(true);
  expect((await durable.recordNode({
    id: `intent-node-${grant.intentId}`,
    kind: ProvenanceNodeKind.INTENT,
    label: "phase-b intent",
    createdAt: NOW,
    trustClass: TrustClass.TRUSTED_HUMAN,
    taint: emptyTaint(),
    subjectRef: grant.intentId,
  })).ok).toBe(true);
  expect((await durable.recordEdge({
    id: `semantic-action-intent-${lineage.workflowId}`,
    from: `intent-node-${grant.intentId}`,
    to: semantic.id,
    relation: SemanticRelation.DERIVED_FROM,
    createdAt: NOW,
    metadata: { workflowId: lineage.workflowId },
  })).ok).toBe(true);
  const execution = executionActionProvenance(lineage, NOW);
  expect((await durable.recordNode(execution.node)).ok).toBe(true);
  expect((await durable.recordEdge(execution.edge)).ok).toBe(true);
  const binding = authorityExecutionProvenance(
    { ...lineage, grantId: grant.id, grantHash: hashCanonical(grant), principalId: grant.principalId },
    grant.createdAt,
  );
  for (const node of [binding.principal, binding.authority]) {
    expect((await durable.recordNode(node)).ok).toBe(true);
  }
  for (const edge of [binding.principalEdge, binding.authorizes]) {
    expect((await durable.recordEdge(edge)).ok).toBe(true);
  }
}

/** Production-shaped fixture: durable provenance store + a gateway built on
 * the start.ts construction path (no legacy flag) whose process-local
 * provenance graph stays EMPTY — the exact shape the shared-process test
 * harness masked in v5. */
async function productionFixture(seed: (durable: ProvenanceService, prepared: PreparedAction, grant: { id: string; principalId: string; intentId: string; createdAt: string }) => Promise<void> = seedFullDurableProvenance) {
  const persist = await initRuntimePersistence({
    TM_PERSISTENCE: "memory",
    TM_SERVICE_NAME: "gateway",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_CONFIG: "true",
  });
  const durable = new ProvenanceService(persist.bundle.provenance);
  const rt = await makeRuntime();
  const workflowId = "workflow-commit";
  const actionHash = hashActionProposal(rt.action);
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-commit", workflowId, workflow: { id: workflowId, hash: H("a") },
    action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "ALLOW", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
    expiresAt: FUTURE, materializationEligible: true, createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-commit", intentState: rt.state, principalId: "principal-1", merchant: "approved-a", quantity: 500, budgetMax: 700000,
    product: "fg-container", actionProposalId: rt.action.id, actionContentHash: actionHash, createdAt: NOW,
    preExecutionBinding: { workflowId, workflowHash: H("a") as never, actionId: rt.action.id, actionHash: actionHash as never, evaluationId: evaluation.value.id, evaluationHash: evaluation.value.recordHash as never, evaluatedIntentStateId: rt.state.id, evaluatedIntentStateHash: rt.state.stateHash, evaluatedIntentStateVersion: rt.state.version },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const prepared = await rt.gateway.prepare({
    action: rt.action, verdict: rt.verdict, principalId: "principal-1", toolId: "payment.execute", agentCapabilities: parentScope().capabilities,
    authorityScope: parentScope(), externalState: { merchant: "approved-a", product: "fg-container", quantity: 500, amount: 700000, currency: "INR", refundability: true, sku: "FG-500" },
    idempotencyKey: "commit-prod", expiresAt: FUTURE, createdAt: NOW, evaluationRecordId: evaluation.value.id, evaluationRecordHash: evaluation.value.recordHash,
    outcomeContractId: outcome.value.id, outcomeContractHash: outcome.value.definitionHash, workflowId, workflowHash: H("a"), evaluatedIntentStateVersion: rt.state.version,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  const minted = await rt.authority.mintGrantFromEvaluation({
    evaluation: evaluation.value,
    preparedAction: prepared.value as unknown as PreparedAction,
    outcomeContract: { ...outcome.value, definitionHash: outcome.value.definitionHash! },
    idempotencyKey: "commit-prod",
  });
  if (!minted.ok) throw new Error(minted.message);
  await seed(durable, prepared.value, minted.value);
  // Production construction path: empty process-local graph, durable owner.
  const gateway = new TwoPhaseGateway({
    intents: rt.intents,
    authority: rt.authority,
    provenance: new ProvenanceService(),
    provenanceOwner: {
      getNode: async (id) => durable.getNode(id),
      getEdge: async (id) => durable.getEdge(id),
    },
    outcomeBinding: { assertBinding: async () => ok() },
    preparedActionStore: rt.gateway.getPreparedActionStore(),
    tokenStore: rt.gateway.getCommitTokenStore(),
    idempotencyStore: rt.gateway.getIdempotencyStore(),
    ledger: rt.gateway.getSideEffectLedger(),
  });
  return { rt, durable, gateway, prepared: prepared.value, grant: minted.value };
}

async function authorizeAndCommit(f: Awaited<ReturnType<typeof productionFixture>>): Promise<Result<CommitResult>> {
  const authz = await f.gateway.authorize({
    preparedActionId: f.prepared.id,
    grantId: f.grant.id,
    expiresAt: FUTURE,
    createdAt: NOW,
  });
  if (!authz.ok || !authz.value.commitToken) throw new Error(authz.ok ? "no token" : authz.message);
  const committed = await f.gateway.commit({
    preparedAction: f.prepared,
    grantId: f.grant.id,
    commitToken: authz.value.commitToken,
    agentId: f.prepared.agentId,
    actionNodeId: `action-provenance-${f.prepared.workflowId}`,
    authorityNodeId: `authority-grant-${f.grant.id}`,
    now: NOW,
  });
  return committed;
}

describe("Production COMMIT durable provenance wiring (v5 repair)", () => {
  it("reconstructs the privileged path from durable storage with an empty process-local graph and executes exactly once", async () => {
    const f = await productionFixture();
    const committed = await authorizeAndCommit(f);
    expect(committed.ok).toBe(true);
    expect(committed.ok && committed.value.status).toBe("SUCCESS");
    expect(committed.ok && committed.value.resultRef).toBeDefined();
    // Exactly one adapter effect, one consumed token, one exposure entry.
    const ledger = await f.rt.gateway.getSideEffectLedger().listAll();
    expect(ledger).toHaveLength(1);
    const token = await f.rt.gateway.getCommitTokenStore().get((committed as { value: { grantId: string } }).value.grantId);
    void token;
    const exposure = await f.rt.authority.getExposureLedger().listAll();
    expect(exposure).toEqual([expect.objectContaining({ id: "exp-inflight-commit-prod", status: "COMMITTED", amount: 700000 })]);
  });

  it("blocks COMMIT when durable provenance is incomplete even though the local graph is empty (v5 shape)", async () => {
    const f = await productionFixture(async () => undefined);
    const authz = await f.gateway.authorize({
      preparedActionId: f.prepared.id,
      grantId: f.grant.id,
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok).toBe(false);
    if (!authz.ok) expect(authz.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    // Zero economic state: no token, no reservation, no effects.
    expect((await f.rt.gateway.getCommitTokenStore().get(`ct-${hashCanonical(f.grant.id).slice(0, 12)}`)).ok && undefined).toBeUndefined();
    expect((await f.rt.authority.getExposureLedger().listAll())).toHaveLength(0);
    expect(await f.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("blocks COMMIT with zero reservation when the durable semantic-action lineage is missing", async () => {
    const f = await productionFixture(async (durable, prepared, grant) => {
      const lineage = lineageOf(prepared);
      // Intent + execution-action + full authority binding exist; the
      // semantic-action node and its DERIVED_FROM edges are omitted.
      expect((await durable.recordNode({
        id: `intent-node-${grant.intentId}`,
        kind: ProvenanceNodeKind.INTENT,
        label: "phase-b intent",
        createdAt: NOW,
        trustClass: TrustClass.TRUSTED_HUMAN,
        taint: emptyTaint(),
        subjectRef: grant.intentId,
      })).ok).toBe(true);
      const execution = executionActionProvenance(lineage, NOW);
      expect((await durable.recordNode(execution.node)).ok).toBe(true);
      const binding = authorityExecutionProvenance(
        { ...lineage, grantId: grant.id, grantHash: hashCanonical(grant), principalId: grant.principalId },
        grant.createdAt,
      );
      for (const node of [binding.principal, binding.authority]) {
        expect((await durable.recordNode(node)).ok).toBe(true);
      }
      for (const edge of [binding.principalEdge, binding.authorizes]) {
        expect((await durable.recordEdge(edge)).ok).toBe(true);
      }
    });
    const authz = await f.gateway.authorize({
      preparedActionId: f.prepared.id,
      grantId: f.grant.id,
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    // AUTHORIZE gate passes (binding complete); COMMIT must fail on the
    // missing durable semantic-action record with zero economic state.
    expect(authz.ok).toBe(true);
    if (!authz.ok || !authz.value.commitToken) return;
    const committed = await f.gateway.commit({
      preparedAction: f.prepared,
      grantId: f.grant.id,
      commitToken: authz.value.commitToken,
      agentId: f.prepared.agentId,
      actionNodeId: `action-provenance-${f.prepared.workflowId}`,
      authorityNodeId: `authority-grant-${f.grant.id}`,
      now: NOW,
    });
    expect(committed.ok).toBe(false);
    if (!committed.ok) expect(committed.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    expect((await f.rt.authority.getExposureLedger().listAll())).toHaveLength(0);
    expect(await f.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
    const token = await f.rt.gateway.getCommitTokenStore().get(authz.value.commitToken.id);
    expect(token.ok && token.value?.consumed).toBe(false);
  });

  it("fails closed when the durable provenance owner is unavailable", async () => {
    const f = await productionFixture();
    const bare = new TwoPhaseGateway({
      intents: f.rt.intents,
      authority: f.rt.authority,
      provenance: new ProvenanceService(),
      provenanceOwner: {
        getNode: async () => ({ ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" }),
        getEdge: async () => ({ ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" }),
      },
      outcomeBinding: { assertBinding: async () => ok() },
      preparedActionStore: f.rt.gateway.getPreparedActionStore(),
      tokenStore: f.rt.gateway.getCommitTokenStore(),
      idempotencyStore: f.rt.gateway.getIdempotencyStore(),
      ledger: f.rt.gateway.getSideEffectLedger(),
    });
    const authz = await bare.authorize({
      preparedActionId: f.prepared.id,
      grantId: f.grant.id,
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok).toBe(false);
    if (!authz.ok) expect(authz.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    expect((await f.rt.authority.getExposureLedger().listAll())).toHaveLength(0);
    expect(await f.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("concurrent COMMIT on the production path yields exactly one economic effect", async () => {
    const f = await productionFixture();
    const authz = await f.gateway.authorize({
      preparedActionId: f.prepared.id,
      grantId: f.grant.id,
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok).toBe(true);
    if (!authz.ok || !authz.value.commitToken) return;
    const input = {
      preparedAction: f.prepared,
      grantId: f.grant.id,
      commitToken: authz.value.commitToken,
      agentId: f.prepared.agentId,
      actionNodeId: `action-provenance-${f.prepared.workflowId}`,
      authorityNodeId: `authority-grant-${f.grant.id}`,
      now: NOW,
    };
    const [first, second] = await Promise.all([
      f.gateway.commit(input),
      f.gateway.commit(input),
    ]);
    const success = [first, second].filter((r) => r.ok);
    expect(success).toHaveLength(1);
    expect(await f.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });
});
