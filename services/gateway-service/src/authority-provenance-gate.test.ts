import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ErrorCode, ok, type PreparedAction, type Result } from "@truemandate/protocol";
import type { CommitTokenStore } from "@truemandate/authority";
import { authorityExecutionProvenance, executionActionProvenance } from "@truemandate/provenance";
import { hashCanonical } from "@truemandate/crypto";
import { describe, expect, it } from "vitest";
import { TwoPhaseGateway } from "./two-phase.js";
import { FUTURE, NOW, makeRuntime, parentScope, provenanceOwnerFrom } from "./integration/harness.js";

const H = (char: string) => char.repeat(64);

class MemoryEvaluations implements EvaluationStore {
  private readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

/** Production-shaped mint fixture: complete evaluation lineage, outcome
 * contract, and a lineage-complete PreparedAction — the exact shape the
 * deployed coordinator produces before Authority bind-and-mint. */
async function productionFixture() {
  const rt = await makeRuntime();
  const workflowId = "workflow-gate";
  const actionHash = hashActionProposal(rt.action);
  const evaluations = new MemoryEvaluations();
  const evaluation = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-gate", workflowId, workflow: { id: workflowId, hash: H("a") },
    action: { id: rt.action.id, hash: actionHash }, guardian: { id: rt.verdict.id, hash: rt.verdict.verdictHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "ALLOW", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
    expiresAt: FUTURE, materializationEligible: true, createdAt: NOW,
  });
  if (!evaluation.ok) throw new Error(evaluation.message);
  const outcomes = new OutcomeService();
  const outcome = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-gate", intentState: rt.state, principalId: "principal-1", merchant: "approved-a", quantity: 500, budgetMax: 700000,
    product: "fg-container", actionProposalId: rt.action.id, actionContentHash: actionHash, createdAt: NOW,
    preExecutionBinding: { workflowId, workflowHash: H("a") as never, actionId: rt.action.id, actionHash: actionHash as never, evaluationId: evaluation.value.id, evaluationHash: evaluation.value.recordHash as never, evaluatedIntentStateId: rt.state.id, evaluatedIntentStateHash: rt.state.stateHash, evaluatedIntentStateVersion: rt.state.version },
  });
  if (!outcome.ok) throw new Error(outcome.message);
  const prepared = await rt.gateway.prepare({
    action: rt.action, verdict: rt.verdict, principalId: "principal-1", toolId: "payment.execute", agentCapabilities: parentScope().capabilities,
    authorityScope: parentScope(), externalState: { merchant: "approved-a", product: "fg-container", quantity: 500, amount: 700000, currency: "INR", refundability: true, sku: "FG-500" },
    idempotencyKey: "gate-mint", expiresAt: FUTURE, createdAt: NOW, evaluationRecordId: evaluation.value.id, evaluationRecordHash: evaluation.value.recordHash,
    outcomeContractId: outcome.value.id, outcomeContractHash: outcome.value.definitionHash, workflowId, workflowHash: H("a"), evaluatedIntentStateVersion: rt.state.version,
  });
  if (!prepared.ok) throw new Error(prepared.message);
  // The coordinator persists the execution-action node before authority
  // bind-and-mint; seed it so the AUTHORIZES edge endpoints exist.
  const executionSeed = executionActionProvenance({
    preparedActionId: prepared.value.id,
    preparedActionHash: prepared.value.preparedActionHash,
    actionId: prepared.value.actionProposalId,
    actionHash: prepared.value.actionContentHash,
    workflowId: prepared.value.workflowId,
    evaluationId: prepared.value.evaluationRecordId,
    evaluationHash: prepared.value.evaluationRecordHash,
    outcomeContractId: prepared.value.outcomeContractId,
    outcomeContractHash: prepared.value.outcomeContractHash,
    intentStateId: prepared.value.intentStateId,
    intentStateHash: prepared.value.intentStateHash,
    intentStateVersion: prepared.value.evaluatedIntentStateVersion,
  }, NOW);
  expect((await rt.provenance.recordNode(executionSeed.node)).ok).toBe(true);
  const minted = await rt.authority.mintGrantFromEvaluation({
    evaluation: evaluation.value,
    preparedAction: prepared.value as unknown as PreparedAction,
    outcomeContract: { ...outcome.value, definitionHash: outcome.value.definitionHash! },
    idempotencyKey: "gate-mint",
  });
  if (!minted.ok) throw new Error(minted.message);
  // Gated production-shaped gateway: same stores, provenance gate ACTIVE.
  const gated = new TwoPhaseGateway({
    intents: rt.intents,
    authority: rt.authority,
    provenance: rt.provenance,
    provenanceOwner: provenanceOwnerFrom(rt.provenance),
    outcomeBinding: { assertBinding: async () => ok() },
    preparedActionStore: rt.gateway.getPreparedActionStore(),
    tokenStore: rt.gateway.getCommitTokenStore(),
  });
  return { rt, gated, prepared: prepared.value, grant: minted.value, evaluation: evaluation.value };
}

function bindingFor(prepared: PreparedAction, grant: { id: string; principalId: string; createdAt: string }, grantHashOverride?: string) {
  return authorityExecutionProvenance(
    {
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
      grantId: grant.id,
      grantHash: grantHashOverride ?? hashCanonical(grant),
      principalId: grant.principalId,
    },
    grant.createdAt,
  );
}

const authorize = (gated: TwoPhaseGateway, prepared: PreparedAction, grantId: string) =>
  gated.authorize({ preparedActionId: prepared.id, grantId, expiresAt: FUTURE, createdAt: NOW });

const tokenIdFor = (grantId: string) => `ct-${hashCanonical(grantId).slice(0, 12)}`;

async function expectZeroTokens(store: CommitTokenStore, grantId: string) {
  const probe = await store.get(tokenIdFor(grantId));
  expect(probe.ok).toBe(true);
  expect(probe.ok && probe.value).toBeUndefined();
}

describe("Authorize-time authority-provenance gate (v4 orphan repair)", () => {
  it("blocks a durable orphan grant with no authority provenance (no token minted)", async () => {
    const f = await productionFixture();
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("blocks when only the principal node exists", async () => {
    const f = await productionFixture();
    const binding = bindingFor(f.prepared, f.grant);
    expect((await f.rt.provenance.recordNode(binding.principal)).ok).toBe(true);
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("blocks when the Authority node exists but AUTHORIZES is missing", async () => {
    const f = await productionFixture();
    const binding = bindingFor(f.prepared, f.grant);
    for (const node of [binding.principal, binding.authority]) {
      expect((await f.rt.provenance.recordNode(node)).ok).toBe(true);
    }
    expect((await f.rt.provenance.recordEdge(binding.principalEdge)).ok).toBe(true);
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("mints a CommitToken only after complete authority provenance; replay stays idempotent", async () => {
    const f = await productionFixture();
    const binding = bindingFor(f.prepared, f.grant);
    for (const node of [binding.principal, binding.authority]) {
      expect((await f.rt.provenance.recordNode(node)).ok).toBe(true);
    }
    for (const edge of [binding.principalEdge, binding.authorizes]) {
      expect((await f.rt.provenance.recordEdge(edge)).ok).toBe(true);
    }
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.commitToken).toBeDefined();
    // Binding replay (deterministic completion after a crash window) remains
    // idempotent and authorize keeps succeeding.
    for (const node of [binding.principal, binding.authority]) {
      expect((await f.rt.provenance.recordNode(node)).ok).toBe(true);
    }
    for (const edge of [binding.principalEdge, binding.authorizes]) {
      expect((await f.rt.provenance.recordEdge(edge)).ok).toBe(true);
    }
    const replay = await authorize(f.gated, f.prepared, f.grant.id);
    expect(replay.ok).toBe(true);
  });

  it("fails closed on divergent Authority provenance metadata", async () => {
    const f = await productionFixture();
    const divergent = bindingFor(f.prepared, f.grant, H("9"));
    for (const node of [divergent.principal, divergent.authority]) {
      expect((await f.rt.provenance.recordNode(node)).ok).toBe(true);
    }
    for (const edge of [divergent.principalEdge, divergent.authorizes]) {
      expect((await f.rt.provenance.recordEdge(edge)).ok).toBe(true);
    }
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("fails before grant persistence leaves no usable authority", async () => {
    const f = await productionFixture();
    const res = await authorize(f.gated, f.prepared, "grant-never-minted");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("production construction without a provenance owner fails closed (zero tokens)", async () => {
    const f = await productionFixture();
    const bare = new TwoPhaseGateway({
      intents: f.rt.intents,
      authority: f.rt.authority,
      provenance: f.rt.provenance,
      outcomeBinding: { assertBinding: async () => ok() },
      preparedActionStore: f.rt.gateway.getPreparedActionStore(),
      tokenStore: f.rt.gateway.getCommitTokenStore(),
    });
    const res = await authorize(bare, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("provenance owner unavailable blocks minting with zero tokens", async () => {
    const f = await productionFixture();
    const unavailable = new TwoPhaseGateway({
      intents: f.rt.intents,
      authority: f.rt.authority,
      provenance: f.rt.provenance,
      provenanceOwner: {
        getNode: async () => ({ ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" }),
        getEdge: async () => ({ ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" }),
      },
      outcomeBinding: { assertBinding: async () => ok() },
      preparedActionStore: f.rt.gateway.getPreparedActionStore(),
      tokenStore: f.rt.gateway.getCommitTokenStore(),
    });
    const res = await authorize(unavailable, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });

  it("exact v4 orphan shape: Phase A principal present, v4 Authority binding absent → blocked", async () => {
    const f = await productionFixture();
    // The Phase A-era stable principal node already exists; the v4 grant's
    // own Authority node and edges were never written (the v4 failure).
    const phaseA = authorityExecutionProvenance({
      preparedActionId: "prep-phase-a",
      preparedActionHash: H("a"),
      actionId: "action-phase-a",
      actionHash: H("b"),
      workflowId: "wf-phase-a",
      evaluationId: "evaluation-phase-a",
      evaluationHash: H("c"),
      outcomeContractId: "outcome-phase-a",
      outcomeContractHash: H("d"),
      intentStateId: "state-phase-a",
      intentStateHash: H("e"),
      intentStateVersion: 1,
      grantId: "grant-phase-a",
      grantHash: H("f"),
      principalId: f.grant.principalId,
    }, "2026-08-17T19:35:20.246Z");
    expect((await f.rt.provenance.recordNode(phaseA.principal)).ok).toBe(true);
    const res = await authorize(f.gated, f.prepared, f.grant.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    await expectZeroTokens(f.rt.gateway.getCommitTokenStore(), f.grant.id);
  });
});

describe("Authorize exact-replay shortcut (Wave 1 post-deploy fix)", () => {
  async function seedComplete(f: Awaited<ReturnType<typeof productionFixture>>) {
    const binding = bindingFor(f.prepared, f.grant);
    for (const node of [binding.principal, binding.authority]) {
      expect((await f.rt.provenance.recordNode(node)).ok).toBe(true);
    }
    for (const edge of [binding.principalEdge, binding.authorizes]) {
      expect((await f.rt.provenance.recordEdge(edge)).ok).toBe(true);
    }
  }

  it("existing CommitToken exact replay converges after first authorization", async () => {
    const f = await productionFixture();
    await seedComplete(f);
    const first = await authorize(f.gated, f.prepared, f.grant.id);
    expect(first.ok).toBe(true);
    const tokenId = first.ok ? first.value.commitToken?.id : undefined;
    expect(tokenId).toBeDefined();
    const replay = await authorize(f.gated, f.prepared, f.grant.id);
    expect(replay.ok).toBe(true);
    expect(replay.ok && replay.value.commitToken?.id).toBe(tokenId);
  });

  it("consumed-grant exact authorize replay still converges the mint-time CommitToken", async () => {
    const f = await productionFixture();
    await seedComplete(f);
    const first = await authorize(f.gated, f.prepared, f.grant.id);
    expect(first.ok).toBe(true);
    const tokenId = first.ok ? first.value.commitToken!.id : "";
    // Simulate post-COMMIT grant consumption while PreparedAction stays AUTHORIZED.
    const consumed = await f.rt.authority.consumeGrant(f.grant.id, NOW);
    expect(consumed.ok).toBe(true);
    const replay = await authorize(f.gated, f.prepared, f.grant.id);
    expect(replay.ok).toBe(true);
    expect(replay.ok && replay.value.commitToken?.id).toBe(tokenId);
  });

  it("different grant replay fails closed", async () => {
    const f = await productionFixture();
    await seedComplete(f);
    expect((await authorize(f.gated, f.prepared, f.grant.id)).ok).toBe(true);
    const other = await authorize(f.gated, f.prepared, "grant-other-lineage");
    expect(other.ok).toBe(false);
  });

  it("different PreparedAction replay fails closed", async () => {
    const f = await productionFixture();
    await seedComplete(f);
    expect((await authorize(f.gated, f.prepared, f.grant.id)).ok).toBe(true);
    const other = await f.gated.authorize({
      preparedActionId: "prepared-never-existed",
      grantId: f.grant.id,
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe(ErrorCode.PREPARED_ACTION_REQUIRED);
  });

  it("revoked authority cannot use the authorize replay shortcut", async () => {
    const f = await productionFixture();
    await seedComplete(f);
    expect((await authorize(f.gated, f.prepared, f.grant.id)).ok).toBe(true);
    const revoked = await f.rt.authority.revokeGrant(f.grant.id, NOW);
    expect(revoked.ok).toBe(true);
    const replay = await authorize(f.gated, f.prepared, f.grant.id);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe(ErrorCode.GRANT_REVOKED);
  });
});
