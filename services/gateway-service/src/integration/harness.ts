import { AuthorityService } from "@truemandate/authority-service";
import { IntentService } from "@truemandate/intent-service";
import { hashActionProposal } from "@truemandate/guardian-core";
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
  ProvenanceNodeKind,
  SemanticRelation,
  SourceType,
  TrustClass,
  asConstraintId,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type ActionProposal,
  type AuthorityGrant,
  type CommitToken,
  type Constraint,
  type GuardianVerdict,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { authorityExecutionProvenance, emptyTaint } from "@truemandate/provenance";
import { hashCanonical } from "@truemandate/crypto";
import { TwoPhaseGateway, type CommitResult } from "../two-phase.js";
import type { MockAdapterMode } from "../mock-adapter.js";
import type { WorkflowStageRecorder } from "@truemandate/observability";

export const NOW = "2026-06-01T12:00:00.000Z";
export const FUTURE = "2026-12-01T12:00:00.000Z";

export function foodGradeConstraint(): Constraint {
  return {
    id: asConstraintId("c-food"),
    concept: "food_grade",
    operator: ConstraintOperator.REQUIRE,
    value: true,
    kind: ConstraintKind.HARD,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    sourceText: "food-grade",
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
  };
}

export function parentScope() {
  return {
    capabilities: {
      search: AuthorityDecision.ALLOW,
      execute_payment: AuthorityDecision.ALLOW,
    },
    maxAmount: 800000,
    currency: "INR",
    allowedMerchants: ["approved-a", "approved-b"],
    deniedMerchants: ["blocked-x"],
    allowedCategories: ["containers"],
    resourceScope: ["procurement"],
    expiresAt: FUTURE,
    maxDelegationDepth: 2,
  };
}

export function actionFor(
  intentId: string,
  stateId: string,
  overrides: Partial<ActionProposal> = {},
): ActionProposal {
  return {
    id: "action-1" as ActionProposal["id"],
    intentId: intentId as ActionProposal["intentId"],
    intentStateId: stateId as ActionProposal["intentStateId"],
    agentId: "agent-1" as ActionProposal["agentId"],
    capability: "execute_payment",
    merchant: "approved-a",
    product: "fg-container",
    quantity: 500,
    amount: 700000,
    currency: "INR",
    refundable: true,
    parameters: { sku: "FG-500" },
    consequenceLevel: "HIGH",
    createdAt: NOW,
    ...overrides,
  };
}

export function clearVerdict(
  action: ActionProposal,
  stateHash: string,
): GuardianVerdict {
  const actionContentHash = hashActionProposal(action);
  return {
    id: "gv-p3",
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
    verdictHash: actionContentHash,
  };
}

export async function makeRuntime(opts?: {
  skipPrincipalLink?: boolean;
  taintAuthority?: boolean;
  stageRecorder?: WorkflowStageRecorder;
}) {
  const intents = new IntentService();
  const provenance = new ProvenanceService();
  const authority = new AuthorityService(intents);
  const gateway = TwoPhaseGateway.createForUnboundLegacyTests({
    intents,
    authority,
    provenance,
    stageRecorder: opts?.stageRecorder,
  });

  const intent = await intents.createIntent({
    id: "intent-1",
    principalId: "principal-1",
    rawText: "Buy 500 food-grade containers under INR 800000",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error(intent.message);

  const state = await intents.createIntentState({
    id: "state-1",
    intentId: intent.value.id,
    constraints: [foodGradeConstraint()],
    createdBy: "principal-1",
    createdAt: NOW,
  });
  if (!state.ok) throw new Error(state.message);

  const principalId = asProvenanceNodeId("node-principal");
  const intentNodeId = asProvenanceNodeId("node-intent");
  const authNodeId = asProvenanceNodeId("node-authority");
  const actionNodeId = asProvenanceNodeId("node-action");

  await provenance.recordNode({
    id: principalId,
    kind: ProvenanceNodeKind.PRINCIPAL,
    label: "principal-1",
    createdAt: NOW,
    trustClass: TrustClass.TRUSTED_HUMAN,
    taint: emptyTaint(),
  });
  await provenance.recordNode({
    id: intentNodeId,
    kind: ProvenanceNodeKind.INTENT,
    label: intent.value.rawText,
    createdAt: NOW,
    trustClass: TrustClass.TRUSTED_HUMAN,
    taint: emptyTaint(),
    subjectRef: intent.value.id,
  });
  await provenance.recordNode({
    id: authNodeId,
    kind: ProvenanceNodeKind.AUTHORITY,
    label: "grant-authority",
    createdAt: NOW,
    trustClass: opts?.taintAuthority
      ? TrustClass.UNTRUSTED_EXTERNAL
      : TrustClass.TRUSTED_SYSTEM,
    taint: opts?.taintAuthority
      ? {
          classes: ["EXTERNAL_CONTENT"],
          origins: [asProvenanceNodeId("ext-evil")],
        }
      : emptyTaint(),
  });
  await provenance.recordNode({
    id: actionNodeId,
    kind: ProvenanceNodeKind.ACTION,
    label: "execute_payment",
    createdAt: NOW,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: emptyTaint(),
  });

  if (!opts?.skipPrincipalLink) {
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e-p-i"),
      from: principalId,
      to: intentNodeId,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e-p-a"),
      from: principalId,
      to: authNodeId,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
  }
  await provenance.recordEdge({
    id: asProvenanceEdgeId("e-i-act"),
    from: intentNodeId,
    to: actionNodeId,
    relation: SemanticRelation.RESULTED_IN,
    createdAt: NOW,
  });
  await provenance.recordEdge({
    id: asProvenanceEdgeId("e-auth-act"),
    from: authNodeId,
    to: actionNodeId,
    relation: SemanticRelation.AUTHORIZES,
    createdAt: NOW,
  });

  const action = actionFor(intent.value.id, state.value.id);
  const verdict = clearVerdict(action, state.value.stateHash);

  return {
    intents,
    provenance,
    authority,
    gateway,
    intent: intent.value,
    state: state.value,
    action,
    verdict,
    actionNodeId,
    authNodeId,
    principalId,
    intentNodeId,
    parentScope: parentScope(),
    grantEraConstraints: [foodGradeConstraint()],
  };
}

export type Runtime = Awaited<ReturnType<typeof makeRuntime>>;

/** Authorize-time authority-provenance gate port over an in-memory service. */
export function provenanceOwnerFrom(provenance: ProvenanceService) {
  return {
    getNode: async (id: string) => provenance.getNode(id),
    getEdge: async (id: string) => provenance.getEdge(id),
  };
}

/** Seeds the production-shaped authority binding records when the prepared
 * action carries the complete production lineage. Legacy-lane prepared
 * actions (no lineage) are skipped — the authorize gate does not run there. */
export async function seedAuthorityBinding(
  provenance: ProvenanceService,
  preparedAction: PreparedAction,
  grant: AuthorityGrant,
): Promise<Result<unknown>> {
  const lineage = {
    preparedActionId: preparedAction.id,
    preparedActionHash: preparedAction.preparedActionHash,
    actionId: preparedAction.actionProposalId,
    actionHash: preparedAction.actionContentHash,
    workflowId: preparedAction.workflowId,
    evaluationId: preparedAction.evaluationRecordId,
    evaluationHash: preparedAction.evaluationRecordHash,
    outcomeContractId: preparedAction.outcomeContractId,
    outcomeContractHash: preparedAction.outcomeContractHash,
    intentStateId: preparedAction.intentStateId,
    intentStateHash: preparedAction.intentStateHash,
    intentStateVersion: preparedAction.evaluatedIntentStateVersion,
    grantId: grant.id,
    grantHash: hashCanonical(grant),
    principalId: grant.principalId,
  };
  if (Object.values(lineage).some((value) => value === undefined || value === "")) {
    return { ok: true, value: undefined };
  }
  const binding = authorityExecutionProvenance(lineage, grant.createdAt);
  for (const node of [binding.principal, binding.authority]) {
    const saved = await provenance.recordNode(node);
    if (!saved.ok) return saved;
  }
  for (const edge of [binding.principalEdge, binding.authorizes]) {
    const saved = await provenance.recordEdge(edge);
    if (!saved.ok) return saved;
  }
  return { ok: true, value: undefined };
}

export async function mintThenAuthorize(
  ports: {
    readonly authority: Runtime["authority"];
    readonly gateway: Runtime["gateway"];
    readonly provenance: ProvenanceService;
  },
  input: {
    readonly preparedAction: PreparedAction;
    readonly authorityRequest: unknown;
    readonly expiresAt: string;
    readonly createdAt?: string;
    readonly grantId?: string;
    readonly action?: ActionProposal;
    readonly verdict?: GuardianVerdict;
  },
): Result<{
  readonly decision: import("@truemandate/protocol").AuthorityDecision;
  readonly grant?: import("@truemandate/protocol").AuthorityGrant;
  readonly commitToken?: CommitToken;
  readonly reasons: readonly string[];
}> {
  void input.action;
  void input.verdict;
  const createdAt = input.createdAt ?? NOW;
  const grant = await ports.authority.createGrant({
    request: input.authorityRequest,
    preparedAction: input.preparedAction,
    decision: AuthorityDecision.ALLOW,
    expiresAt: input.expiresAt,
    createdAt,
    id: input.grantId,
  });
  if (!grant.ok) return grant;
  // Production-shaped authority provenance: AUTHORIZE requires the durable
  // binding records (stable principal, grant-scoped Authority node,
  // INTRODUCED_BY and AUTHORIZES edges). Seed them exactly as the
  // authority-binding route would, derived from the minted grant lineage.
  // Legacy-lane prepared actions may lack the production lineage fields; the
  // gate is skipped in that TEST-ONLY lane, so seeding is conditional.
  const seeded = await seedAuthorityBinding(ports.provenance, input.preparedAction, grant.value);
  if (!seeded.ok) return seeded;
  return ports.gateway.authorize({
    preparedActionId: input.preparedAction.id,
    grantId: grant.value.id,
    expiresAt: input.expiresAt,
    createdAt,
  });
}

export async function prepareAuthorize(
  rt: Runtime,
  opts?: {
    readonly action?: ActionProposal;
    readonly verdict?: GuardianVerdict;
    readonly idempotencyKey?: string;
    readonly merchant?: string;
    readonly amount?: number;
    readonly grantId?: string;
    readonly createdAt?: string;
    readonly scope?: ReturnType<typeof parentScope>;
  },
): Result<{
  readonly prepared: PreparedAction;
  readonly grantId: string;
  readonly commitToken: CommitToken;
}> {
  const action = opts?.action ?? rt.action;
  const tip = await rt.intents.getCurrentIntentState(action.intentId);
  if (!tip.ok) return tip;
  const verdict = opts?.verdict ?? clearVerdict(action, tip.value.stateHash);
  const amount = opts?.amount ?? action.amount ?? 700000;
  const merchant = opts?.merchant ?? action.merchant ?? "approved-a";
  const idempotencyKey = opts?.idempotencyKey ?? "pay-default";
  const createdAt = opts?.createdAt ?? NOW;
  const scope = opts?.scope ?? rt.parentScope;

  const prepared = await rt.gateway.prepare({
    action,
    verdict,
    principalId: "principal-1",
    toolId: "payment.execute",
    agentCapabilities: scope.capabilities,
    externalState: {
      merchant,
      product: action.product ?? "fg-container",
      quantity: action.quantity ?? 500,
      amount,
      currency: action.currency ?? "INR",
      refundability: action.refundable ?? true,
      sku:
        typeof action.parameters.sku === "string"
          ? action.parameters.sku
          : "FG-500",
    },
    idempotencyKey,
    expiresAt: FUTURE,
    createdAt,
  });
  if (!prepared.ok) return prepared;

  const grant = await rt.authority.createGrant({
    request: {
      id: `req-${idempotencyKey}`,
      principalId: "principal-1",
      agentId: action.agentId,
      intentId: action.intentId,
      intentStateId: tip.value.id,
      actionId: action.id,
      preparedActionId: prepared.value.id,
      capability: "execute_payment",
      scope,
      merchant,
      amount,
      currency: action.currency ?? "INR",
      createdAt,
    },
    preparedAction: prepared.value,
    decision: AuthorityDecision.ALLOW,
    expiresAt: FUTURE,
    createdAt,
    id: opts?.grantId,
  });
  if (!grant.ok) return grant;

  const authz = await rt.gateway.authorize({
    preparedActionId: prepared.value.id,
    grantId: grant.value.id,
    expiresAt: FUTURE,
    createdAt,
  });
  if (!authz.ok) return authz;
  if (!authz.value.grant || !authz.value.commitToken) {
    return err(ErrorCode.AUTHORITY_BLOCKED, "authorize did not issue grant/token");
  }

  return ok({
    prepared: prepared.value,
    grantId: authz.value.grant.id,
    commitToken: authz.value.commitToken,
  });
}

export async function executePrivilegedPayment(
  rt: Runtime,
  opts?: {
    readonly action?: ActionProposal;
    readonly verdict?: GuardianVerdict;
    readonly idempotencyKey?: string;
    readonly merchant?: string;
    readonly amount?: number;
    readonly agentId?: string;
    readonly adapterMode?: MockAdapterMode;
    readonly exposureThreshold?: number;
    readonly relatedGroupId?: string;
    readonly grantEraConstraints?: readonly Constraint[];
    readonly preparedAction?: PreparedAction;
    readonly grantId?: string;
    readonly commitToken?: CommitToken;
    readonly now?: string;
    readonly scope?: ReturnType<typeof parentScope>;
  },
): Result<CommitResult> {
  const now = opts?.now ?? NOW;
  let prepared = opts?.preparedAction;
  let grantId = opts?.grantId;
  let commitToken = opts?.commitToken;

  if (!prepared || !grantId || !commitToken) {
    const auth = await prepareAuthorize(rt, {
      action: opts?.action,
      verdict: opts?.verdict,
      idempotencyKey: opts?.idempotencyKey,
      merchant: opts?.merchant,
      amount: opts?.amount,
      scope: opts?.scope,
    });
    if (!auth.ok) return auth;
    prepared = auth.value.prepared;
    grantId = auth.value.grantId;
    commitToken = auth.value.commitToken;
  }

  // Only attach a verdict when explicitly provided or when we still have the
  // matching ActionProposal — never recompute from rt.action for a different prep.
  let verdict = opts?.verdict;
  if (!verdict && opts?.action) {
    const tip = await rt.intents.getCurrentIntentState(prepared.intentId);
    if (tip.ok) verdict = clearVerdict(opts.action, tip.value.stateHash);
  }

  return rt.gateway.commit({
    preparedAction: prepared,
    grantId,
    commitToken,
    agentId: opts?.agentId ?? "agent-1",
    actionNodeId: rt.actionNodeId,
    authorityNodeId: rt.authNodeId,
    now,
    adapterMode: opts?.adapterMode,
    exposureThreshold: opts?.exposureThreshold,
    relatedGroupId: opts?.relatedGroupId,
    grantEraConstraints: opts?.grantEraConstraints ?? rt.grantEraConstraints,
    verdict,
  });
}
