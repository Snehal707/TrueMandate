import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  MeaningClass,
  PROTOCOL_VERSION,
  SourceType,
  ToolPrivilegeClass,
  asConstraintId,
  type ActionProposal,
  type GuardianVerdict,
} from "@truemandate/protocol";
import { hashActionProposal } from "@truemandate/guardian-core";
import { IntentService } from "@truemandate/intent-service";
import { AuthorityService } from "@truemandate/authority-service";
import { ProvenanceService } from "@truemandate/provenance-service";
import { emptyTaint } from "@truemandate/provenance";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TwoPhaseGateway } from "./two-phase.js";
import { mintThenAuthorize } from "./integration/harness.js";
import { SnapshotExternalStateProvider } from "@truemandate/authority";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NOW = "2026-06-01T12:00:00.000Z";
const FUTURE = "2026-12-01T12:00:00.000Z";

async function seedIntent(intents: IntentService) {
  const intent = await intents.createIntent({
    id: "intent-p7",
    principalId: "principal-1",
    rawText: "Buy 500 food grade containers under INR 800000",
    createdAt: NOW,
  });
  expect(intent.ok).toBe(true);
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    intentId: intent.value.id,
    id: "state-p7",
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  expect(state.ok).toBe(true);
  if (!state.ok) throw new Error("state");
  return { intent: intent.value, state: state.value };
}

function actionFor(stateId: string, overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "act-p7" as ActionProposal["id"],
    intentId: "intent-p7" as ActionProposal["intentId"],
    intentStateId: stateId as ActionProposal["intentStateId"],
    agentId: "agent-1" as ActionProposal["agentId"],
    capability: "execute_payment",
    merchant: "ApprovedFoodChem",
    product: "food-grade-container",
    quantity: 500,
    amount: 742000,
    currency: "INR",
    refundable: true,
    parameters: { certificationRef: "FG-9981" },
    consequenceLevel: "HIGH",
    createdAt: NOW,
    ...overrides,
  };
}

function clearVerdict(action: ActionProposal, stateHash: string): GuardianVerdict {
  const actionContentHash = hashActionProposal(action);
  const withoutHash = {
    id: "gv-p7",
    actionId: action.id,
    intentId: action.intentId,
    intentStateId: action.intentStateId,
    intentStateHash: stateHash as GuardianVerdict["intentStateHash"],
    actionContentHash,
    evidenceSnapshotHash: "ev-empty" as GuardianVerdict["evidenceSnapshotHash"],
    decision: AuthorityDecision.ALLOW,
    semanticStatus: GuardianSemanticStatus.CLEAR,
    overallFidelity: 1,
    constraintClaims: [
      {
        constraintId: asConstraintId("c-food"),
        classification: GuardianConstraintClassification.SUPPORTED,
        applicability: "APPLICABLE" as const,
        confidence: 1,
        criticality: ConstraintKind.HARD,
      },
    ],
    contradictions: [],
    uncertainty: 0,
    criticalFailure: false,
    judgeResults: [
      {
        judgeId: JudgeId.FIDELITY,
        status: JudgeInvocationStatus.OK,
        findings: [],
      },
    ],
    protocolVersion: PROTOCOL_VERSION,
    promptVersions: {},
    schemaVersions: {},
    stale: false,
    createdAt: NOW,
  };
  return {
    ...withoutHash,
    verdictHash: actionContentHash,
  };
}

function blockVerdict(action: ActionProposal, stateHash: string): GuardianVerdict {
  return {
    ...clearVerdict(action, stateHash),
    decision: AuthorityDecision.BLOCK,
    semanticStatus: GuardianSemanticStatus.CRITICAL_FAILURE,
    criticalFailure: true,
  };
}

async function seedProvenance(prov: ProvenanceService, actionNodeId: string, authNodeId: string) {
  const principal = "principal-node";
  const intentNode = "intent-node";
  for (const [id, kind, label] of [
    [principal, "PRINCIPAL", "principal"],
    [intentNode, "INTENT", "intent"],
    [authNodeId, "AUTHORITY", "authority"],
    [actionNodeId, "ACTION", "action"],
  ] as const) {
    await prov.recordNode({
      id,
      kind,
      label,
      createdAt: NOW,
      trustClass: "TRUSTED_SYSTEM",
      taint: emptyTaint(),
    });
  }
  await prov.recordEdge({
    id: "e1",
    from: principal,
    to: intentNode,
    relation: "DERIVED_FROM",
    createdAt: NOW,
  });
  await prov.recordEdge({
    id: "e2",
    from: intentNode,
    to: authNodeId,
    relation: "AUTHORIZES",
    createdAt: NOW,
  });
  await prov.recordEdge({
    id: "e3",
    from: authNodeId,
    to: actionNodeId,
    relation: "AUTHORIZES",
    createdAt: NOW,
  });
}

function scope() {
  return {
    capabilities: { execute_payment: AuthorityDecision.ALLOW, search: AuthorityDecision.ALLOW },
    maxAmount: 800000,
    currency: "INR",
    allowedMerchants: ["ApprovedFoodChem"],
  };
}

async function makeStack() {
  const intents = new IntentService();
  const { intent, state } = await seedIntent(intents);
  const authority = new AuthorityService(intents);
  const provenance = new ProvenanceService();
  const gateway = TwoPhaseGateway.createForUnboundLegacyTests({
    intents,
    authority,
    provenance,
  });
  const action = actionFor(state.id);
  const verdict = clearVerdict(action, state.stateHash);
  const actionNodeId = "action-node";
  const authNodeId = "auth-node";
  await seedProvenance(provenance, actionNodeId, authNodeId);
  return {
    intents,
    authority,
    provenance,
    gateway,
    intent,
    state,
    action,
    verdict,
    actionNodeId,
    authNodeId,
  };
}

describe("Phase 7 two-phase gateway", () => {
  it("A: valid prepare→authorize→commit executes once with ledger", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        product: "food-grade-container",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        refundability: true,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-a",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-a",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        preparedActionId: prepared.value.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok).toBe(true);
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;

    const commit = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        refundability: true,
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
      verdict: rt.verdict,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.value.status).toBe("SUCCESS");
    expect((await rt.gateway.getSideEffectLedger().listAll()).length).toBe(1);

    const replay = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        refundability: true,
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.value.status).toBe("IDEMPOTENT_REPLAY");
    expect((await rt.gateway.getSideEffectLedger().listAll()).length).toBe(1);
  });

  it("Guardian BLOCK cannot produce executable authority", async () => {
    const rt = await makeStack();
    const blocked = blockVerdict(rt.action, rt.state.stateHash);
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: blocked,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: { amount: 742000, currency: "INR", merchant: "ApprovedFoodChem" },
      idempotencyKey: "p7-block",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe(ErrorCode.SEMANTIC_GATE_BLOCKED);
  });

  it("B: TOCTOU price change → PREPARED_ACTION_STALE", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-b",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const provider = rt.gateway.getExternalStateProvider();
    if (provider instanceof SnapshotExternalStateProvider) {
      provider.setOverride(prepared.value.id, {
        merchant: "ApprovedFoodChem",
        amount: 815000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        refundability: true,
        deliveryTerms: prepared.value.parameters.deliveryTerms,
        certificationRef: "FG-9981",
        counterparty: "ApprovedFoodChem",
        sku: undefined,
      });
    }
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-b",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok && authz.value.commitToken && authz.value.grant).toBeTruthy();
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;

    const commit = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 815000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe(ErrorCode.PREPARED_ACTION_STALE);
  });

  it("irrelevant pageViewCount does not stale", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-views",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-v",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;
    const commit = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
        pageViewCount: 99999,
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(commit.ok).toBe(true);
  });

  it("C: UNKNOWN does not blindly retry", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-c",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!prepared.ok) return;
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-c",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;
    const first = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
      adapterMode: "success_response_lost",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.status).toBe("UNKNOWN");
      expect(first.value.reconciliationRequired).toBe(true);
    }
    const second = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe(ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY);
    }
  });

  it("D: revoke after CommitToken blocks commit", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-d",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!prepared.ok) return;
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-d",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;
    await rt.authority.revokeGrant(authz.value.grant.id, NOW);
    const commit = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe(ErrorCode.GRANT_REVOKED);
  });

  it("E: ActionProposal change invalidates old GuardianVerdict", async () => {
    const rt = await makeStack();
    const changed = { ...rt.action, amount: 810000 };
    const prepared = await rt.gateway.prepare({
      action: changed,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 810000,
        currency: "INR",
      },
      idempotencyKey: "p7-e",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe(ErrorCode.ACTION_PROPOSAL_MISMATCH);
  });

  it("F: Search Agent cannot see or invoke payment tool", async () => {
    const rt = await makeStack();
    const visible = rt.gateway.listVisibleTools({ search: AuthorityDecision.ALLOW });
    expect(visible.some((t) => t.toolId === "payment.execute")).toBe(false);
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: { search: AuthorityDecision.ALLOW },
      externalState: { amount: 742000, currency: "INR", merchant: "ApprovedFoodChem" },
      idempotencyKey: "p7-f",
      expiresAt: FUTURE,
      createdAt: NOW,
      claimedPrivilegeClass: ToolPrivilegeClass.T0_READ,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe(ErrorCode.TOOL_NOT_VISIBLE);
  });

  it("registry privilege cannot be elevated by agent claim", async () => {
    const rt = await makeStack();
    const deny = rt.gateway.getToolRegistry().assertInvocable(
      "payment.execute",
      { execute_payment: AuthorityDecision.ALLOW },
      ToolPrivilegeClass.T3_HIGH_CONSEQUENCE,
    );
    // T3 claim > T2 registry → denied
    expect(deny.ok).toBe(false);
  });

  it("G: Guardian ALLOW but cumulative exposure blocks", async () => {
    const rt = await makeStack();
    await rt.authority.recordExposure({
      id: "exp-prior",
      amount: 45000,
      currency: "INR",
      relatedGroupId: `${rt.intent.id}:INR`,
      status: "COMMITTED",
    });
    const prepared = await rt.gateway.prepare({
      action: { ...rt.action, amount: 9000 },
      verdict: clearVerdict({ ...rt.action, amount: 9000 }, rt.state.stateHash),
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 9000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-g",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!prepared.ok) return;
    const action = { ...rt.action, amount: 9000 };
    const verdict = clearVerdict(action, rt.state.stateHash);
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action,
      verdict,
      authorityRequest: {
        id: "req-g",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: action.id,
        capability: "execute_payment",
        scope: { ...scope(), maxAmount: 50000 },
        merchant: "ApprovedFoodChem",
        amount: 9000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok).toBe(true);
    if (!authz.ok) return;
    expect(authz.value.decision).toBe(AuthorityDecision.ALLOW);
    expect(authz.value.grant).toBeDefined();
    if (!authz.value.grant || !authz.value.commitToken) return;
    const committed = await rt.gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
      exposureThreshold: 50000,
      relatedGroupId: `${rt.intent.id}:INR`,
    });
    expect(committed.ok).toBe(false);
    if (committed.ok) return;
    expect(committed.code).toBe(ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED);
  });

  it("single-use race: at most one commit succeeds", async () => {
    const rt = await makeStack();
    const prepared = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: scope().capabilities,
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      idempotencyKey: "p7-race",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!prepared.ok) return;
    const authz = await mintThenAuthorize(rt, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-race",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: scope(),
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;
    const args = {
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "ApprovedFoodChem",
        amount: 742000,
        currency: "INR",
        product: "food-grade-container",
        quantity: 500,
        certificationRef: "FG-9981",
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    };
    const [a, b] = await Promise.all([
      rt.gateway.commit(args),
      rt.gateway.commit(args),
    ]);
    const successes = [a, b].filter(
      (r) => r.ok && (r.value.status === "SUCCESS" || r.value.status === "IDEMPOTENT_REPLAY"),
    );
    const hardSuccess = [a, b].filter((r) => r.ok && r.value.status === "SUCCESS");
    expect(hardSuccess.length).toBeLessThanOrEqual(1);
    expect(successes.length).toBeGreaterThanOrEqual(1);
  });

  it("SAFE fixtures exist for A–G", async () => {
    for (const name of [
      "valid-execution.json",
      "toctou-price.json",
      "unknown-execution.json",
      "revocation.json",
      "stale-guardian.json",
      "capability-misuse.json",
      "cumulative-exposure.json",
    ]) {
      const p = path.join(root, "scenarios/procurement/phase7", name);
      expect(JSON.parse(readFileSync(p, "utf8")).id).toBeTruthy();
    }
  });

  it("mutating one prepared field breaks prior authorization reuse", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          "amount",
          "currency",
          "merchant",
          "product",
          "quantity",
          "capability",
          "agentId",
        ),
        async (field) => {
          const rt = await makeStack();
          const prepared = await rt.gateway.prepare({
            action: rt.action,
            verdict: rt.verdict,
            principalId: "principal-1",
            toolId: "payment.execute",
            agentCapabilities: scope().capabilities,
            externalState: {
              merchant: "ApprovedFoodChem",
              amount: 742000,
              currency: "INR",
              product: "food-grade-container",
              quantity: 500,
              certificationRef: "FG-9981",
            },
            idempotencyKey: `p7-mut-${field}-${Math.random()}`,
            expiresAt: FUTURE,
            createdAt: NOW,
          });
          expect(prepared.ok).toBe(true);
          if (!prepared.ok) return;
          const authz = await mintThenAuthorize(rt, {
            preparedAction: prepared.value,
            action: rt.action,
            verdict: rt.verdict,
            authorityRequest: {
              id: `req-mut-${field}-${Math.random()}`,
              principalId: "principal-1",
              agentId: "agent-1",
              intentId: rt.intent.id,
              intentStateId: rt.state.id,
              actionId: rt.action.id,
              capability: "execute_payment",
              scope: scope(),
              merchant: "ApprovedFoodChem",
              amount: 742000,
              currency: "INR",
              createdAt: NOW,
            },
            expiresAt: FUTURE,
            createdAt: NOW,
          });
          expect(authz.ok && authz.value.grant && authz.value.commitToken).toBeTruthy();
          if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;

          let mutated = prepared.value;
          if (field === "amount") {
            mutated = {
              ...prepared.value,
              parameters: { ...prepared.value.parameters, amount: 1 },
            };
          } else if (field === "currency") {
            mutated = {
              ...prepared.value,
              parameters: { ...prepared.value.parameters, currency: "USD" },
            };
          } else if (field === "merchant") {
            mutated = {
              ...prepared.value,
              parameters: { ...prepared.value.parameters, merchant: "Other" },
            };
          } else if (field === "product") {
            mutated = {
              ...prepared.value,
              parameters: { ...prepared.value.parameters, product: "other" },
            };
          } else if (field === "quantity") {
            mutated = {
              ...prepared.value,
              parameters: { ...prepared.value.parameters, quantity: 1 },
            };
          } else if (field === "capability") {
            mutated = { ...prepared.value, capability: "search" };
          } else if (field === "agentId") {
            mutated = {
              ...prepared.value,
              agentId: "agent-x" as ActionProposal["agentId"],
            };
          }

          const commit = await rt.gateway.commit({
            preparedAction: mutated,
            grantId: authz.value.grant.id,
            commitToken: authz.value.commitToken,
            agentId: field === "agentId" ? "agent-x" : "agent-1",
            externalState: {
              merchant: mutated.parameters.merchant,
              amount: mutated.parameters.amount,
              currency: mutated.parameters.currency,
              product: mutated.parameters.product,
              quantity: mutated.parameters.quantity,
              certificationRef: "FG-9981",
            },
            actionNodeId: rt.actionNodeId,
            authorityNodeId: rt.authNodeId,
            now: NOW,
          });
          expect(commit.ok).toBe(false);
        },
      ),
      { numRuns: 7 },
    );
  });
});
