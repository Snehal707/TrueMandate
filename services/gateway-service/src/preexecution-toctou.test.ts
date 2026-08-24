import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { hashCanonical } from "@truemandate/crypto";
import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createAuthorityInternalRoutes } from "../../authority-service/src/internal-routes.js";
import { createOutcomeInternalRoutes } from "../../resolution-service/src/outcome-internal-routes.js";
import { createGatewayInternalRoutes } from "./internal-routes.js";
import { FUTURE, NOW, makeRuntime, parentScope } from "./integration/harness.js";

const H = (char: string) => char.repeat(64);

class MemoryEvaluations implements EvaluationStore {
  readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) {
    if (this.rows.has(id)) return ok(false);
    this.rows.set(id, value);
    return ok(true);
  }
}

/** A single owner-backed lineage; tests only change one owner result after a prior stage succeeds. */
async function chain() {
  const rt = await makeRuntime();
  const workflow = { id: "workflow-toctou", kind: "WORKFLOW", workflowId: "workflow-toctou", contentHash: H("a") };
  const actionHash = hashActionProposal(rt.action);
  const guardian = { id: rt.verdict.id, kind: "GUARDIAN", workflowId: workflow.id, contentHash: rt.verdict.verdictHash, payload: { verdict: rt.verdict } };
  const action = { id: rt.action.id, kind: "ACTION", workflowId: workflow.id, contentHash: actionHash, payload: { intentStateId: rt.state.id, intentStateHash: rt.state.stateHash, action: rt.action } };
  const artifacts = new Map<string, unknown>([[workflow.id, workflow], [action.id, action], [guardian.id, guardian]]);
  const evaluations = new MemoryEvaluations();
  const evaluationResult = await createEvaluationRecord(evaluations, {
    schemaVersion: 1, id: "evaluation-toctou", workflowId: workflow.id,
    workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: actionHash }, guardian: { id: guardian.id, hash: guardian.contentHash },
    evaluatedIntentState: { id: rt.state.id, hash: rt.state.stateHash, version: rt.state.version },
    decision: "ALLOW", scope: parentScope(), capability: "execute_payment", merchant: "approved-a", amount: 700000, currency: "INR",
    expiresAt: FUTURE, materializationEligible: true, createdAt: NOW,
  });
  if (!evaluationResult.ok) throw new Error(evaluationResult.message);
  const evaluation = evaluationResult.value;
  const outcomes = new OutcomeService();
  let tip: unknown = rt.state;
  let state: unknown = rt.state;
  const owners = {
    getEvaluation: async (id: string): Promise<Result<unknown>> => id === evaluation.id ? evaluations.get(id) : err(ErrorCode.VALIDATION_FAILED, "unknown evaluation"),
    getOutcomeContract: async (id: string): Promise<Result<unknown>> => outcomes.getContract(id),
    getArtifact: async (id: string): Promise<Result<unknown>> => artifacts.has(id) ? ok(artifacts.get(id)) : err(ErrorCode.VALIDATION_FAILED, "unknown artifact"),
    getState: async (id: string): Promise<Result<unknown>> => id === rt.state.id ? ok(state) : err(ErrorCode.VALIDATION_FAILED, "unknown state"),
    getTip: async (): Promise<Result<unknown>> => ok(tip),
  };
  const outcomeRoute = createOutcomeInternalRoutes(outcomes, owners as never).find((r) => r.pattern === "/internal/outcomes/procurement-contract")!;
  const gatewayRoutes = createGatewayInternalRoutes({ gateway: rt.gateway, owners });
  const prepareRoute = gatewayRoutes.find((r) => r.pattern === "/internal/gateway/prepare-references")!;
  const authorizeRoute = gatewayRoutes.find((r) => r.pattern === "/internal/gateway/authorize")!;
  let invalidPrepared = false;
  let preparedOverride: unknown;
  const authorityRoutes = createAuthorityInternalRoutes({
    authority: rt.authority, evaluations,
    preparedActions: { get: async (id) => {
      if (invalidPrepared) return err(ErrorCode.SCHEMA_PARSE_FAILED, "tampered PreparedAction row");
      if (preparedOverride !== undefined) return ok(preparedOverride);
      return rt.gateway.getPreparedActionStore().get(id);
    } },
    outcomeContracts: { get: (id) => outcomes.getContract(id) },
  });
  const mintRoute = authorityRoutes.find((r) => r.pattern === "/internal/authority/bind-and-mint")!;
  const outcomeBody = { evaluation: { id: evaluation.id, hash: evaluation.recordHash }, workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: actionHash }, idempotencyKey: "toctou" };
  const preparedId = `prep-${actionHash.slice(0, 12)}`;
  return {
    rt, evaluation, workflow, action, guardian, artifacts, outcomes, owners, outcomeRoute, prepareRoute, mintRoute, authorizeRoute, outcomeBody, preparedId,
    advanceTip: async () => {
      const advanced = await rt.intents.createIntentState({ id: "state-advanced", intentId: rt.intent.id, constraints: rt.state.constraints, createdBy: "principal-1", createdAt: "2026-06-01T12:01:00.000Z" });
      if (!advanced.ok) throw new Error(advanced.message);
      tip = advanced.value; state = advanced.value;
    },
    tamperPreparedRead: () => { invalidPrepared = true; },
    setPreparedOverride: (value: unknown) => { preparedOverride = value; },
  };
}

async function createOutcome(f: Awaited<ReturnType<typeof chain>>) {
  const response = await f.outcomeRoute.handler({ body: f.outcomeBody, headers: {}, params: {} });
  expect(response.status).toBe(200);
  return response.body as { id: string; definitionHash: string };
}
async function prepare(f: Awaited<ReturnType<typeof chain>>, outcome: { id: string; definitionHash: string }) {
  const body = { evaluation: { id: f.evaluation.id, hash: f.evaluation.recordHash }, outcomeContract: { id: outcome.id, hash: outcome.definitionHash }, workflow: { id: f.workflow.id, hash: f.workflow.contentHash }, action: { id: f.action.id, hash: f.action.contentHash }, idempotencyKey: "toctou" };
  const response = await f.prepareRoute.handler({ body, headers: {}, params: {} });
  expect(response.status).toBe(200);
  return response.body as { id: string; preparedActionHash: string };
}
async function mint(f: Awaited<ReturnType<typeof chain>>, outcome: { id: string; definitionHash: string }, prepared: { id: string; preparedActionHash: string }) {
  return f.mintRoute.handler({ body: { evaluation: { id: f.evaluation.id, hash: f.evaluation.recordHash }, outcomeContract: { id: outcome.id, hash: outcome.definitionHash }, preparedAction: { id: prepared.id, hash: prepared.preparedActionHash }, idempotencyKey: "toctou" }, headers: {}, params: {} });
}

describe("pre-execution owner-bound TOCTOU", () => {
  it("allows the untouched durable chain to issue one unconsumed CommitToken only", async () => {
    const f = await chain(); const outcome = await createOutcome(f); const prepared = await prepare(f, outcome);
    const minted = await mint(f, outcome, prepared); expect(minted.status).toBe(200);
    const grant = minted.body as { id: string };
    const authorized = await f.authorizeRoute.handler({ body: { preparedActionId: prepared.id, grantId: grant.id, expiresAt: FUTURE }, headers: {}, params: {} });
    expect(authorized.status).toBe(200);
    const tokenId = (authorized.body as { commitToken: { id: string } }).commitToken.id;
    const token = await f.rt.gateway.getCommitTokenStore().get(tokenId);
    expect(token.ok && token.value?.consumed).toBe(false);
    expect(await f.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("rejects a state advanced after evaluation before creating an OutcomeContract", async () => {
    const f = await chain(); await f.advanceTip();
    const response = await f.outcomeRoute.handler({ body: f.outcomeBody, headers: {}, params: {} });
    expect(response.status).toBe(400);
    expect((await f.outcomes.getContract("outcome-missing")).value).toBeUndefined();
    expect((await f.rt.gateway.getPreparedActionStore().get(f.preparedId)).value).toBeUndefined();
  });

  it.each(["advanced tip", "ACTION replacement", "Guardian replacement", "Outcome binding substitution"])("rejects Outcome-to-PREPARE %s without a PreparedAction", async (kind) => {
    const f = await chain(); const outcome = await createOutcome(f);
    if (kind === "advanced tip") await f.advanceTip();
    if (kind === "ACTION replacement") f.artifacts.set(f.action.id, { ...(f.action as object), contentHash: H("c") });
    if (kind === "Guardian replacement") f.artifacts.set(f.guardian.id, { ...(f.guardian as object), workflowId: "other-workflow" });
    if (kind === "Outcome binding substitution") (outcome as { definitionHash: string }).definitionHash = H("d");
    const body = { evaluation: { id: f.evaluation.id, hash: f.evaluation.recordHash }, outcomeContract: { id: outcome.id, hash: outcome.definitionHash }, workflow: { id: f.workflow.id, hash: f.workflow.contentHash }, action: { id: f.action.id, hash: f.action.contentHash }, idempotencyKey: "toctou" };
    const response = await f.prepareRoute.handler({ body, headers: {}, params: {} });
    expect(response.status).toBe(400);
    expect((await f.rt.gateway.getPreparedActionStore().get(f.preparedId)).value).toBeUndefined();
  });

  it.each(["advanced tip", "expired evaluation", "Outcome substitution", "invalid PreparedAction durable read", "ACTION hash", "scope", "merchant", "amount", "currency", "expiry"])("rejects PREPARE-to-mint %s without a usable grant", async (kind) => {
    const f = await chain(); const outcome = await createOutcome(f); const prepared = await prepare(f, outcome);
    if (kind === "advanced tip") await f.advanceTip();
    if (kind === "expired evaluation") (f.evaluation as { expiresAt?: string }).expiresAt = "2020-01-01T00:00:00.000Z";
    if (kind === "Outcome substitution") (outcome as { definitionHash: string }).definitionHash = H("e");
    if (kind === "invalid PreparedAction durable read") f.tamperPreparedRead();
    if (["ACTION hash", "scope", "merchant", "amount", "currency", "expiry"].includes(kind)) {
      const record = await f.rt.gateway.getPreparedActionStore().get(prepared.id);
      if (record.ok && record.value) {
        const p = { ...record.value.preparedAction } as Record<string, unknown>;
        if (kind === "ACTION hash") p.actionContentHash = H("f");
        if (kind === "scope") p.authorityScope = { ...parentScope(), maxAmount: 799999 };
        if (kind === "expiry") p.expiresAt = "2027-01-01T00:00:00.000Z";
        if (["merchant", "amount", "currency"].includes(kind)) p.parameters = { ...p.parameters as Record<string, unknown>, [kind]: kind === "amount" ? 700001 : kind === "currency" ? "USD" : "approved-b" };
        f.setPreparedOverride({ ...record.value, preparedAction: p });
      }
    }
    const response = await mint(f, outcome, prepared);
    expect(response.status).toBe(400);
    const expected = `grant-${hashCanonical({ evaluation: f.evaluation.id, prepared: prepared.preparedActionHash, idempotencyKey: "toctou" }).slice(0, 16)}`;
    expect((await f.rt.authority.getGrantStore().get(expected)).value).toBeUndefined();
  });

  it.each(["expired", "revoked", "PreparedAction swap", "invalid PreparedAction", "invalid grant"])("rejects mint-to-AUTHORIZE %s without a CommitToken", async (kind) => {
    const f = await chain(); const outcome = await createOutcome(f); const prepared = await prepare(f, outcome);
    const minted = await mint(f, outcome, prepared); expect(minted.status).toBe(200);
    const grant = minted.body as { id: string };
    if (kind === "expired") { const stored = await f.rt.authority.getGrantStore().get(grant.id); if (stored.ok && stored.value) await f.rt.authority.getGrantStore().put({ ...stored.value, id: `${grant.id}-expired`, expiresAt: "2020-01-01T00:00:00.000Z" }); grant.id = `${grant.id}-expired`; }
    if (kind === "revoked") await f.rt.authority.getGrantStore().revoke(grant.id, NOW);
    const body = { preparedActionId: kind === "PreparedAction swap" ? "other-prepared" : prepared.id, grantId: grant.id, expiresAt: FUTURE };
    if (kind === "invalid PreparedAction") { (f.rt.gateway.getPreparedActionStore() as unknown as { records: Map<string, unknown> }).records?.set(prepared.id, { bad: true }); }
    if (kind === "invalid grant") { (f.rt.authority.getGrantStore() as unknown as { grants: Map<string, unknown> }).grants?.set(grant.id, { bad: true }); }
    const response = await f.authorizeRoute.handler({ body, headers: {}, params: {} });
    expect(response.status).toBe(400);
    expect((await f.rt.gateway.getCommitTokenStore().get(`token-${grant.id}`)).value).toBeUndefined();
  });
});
