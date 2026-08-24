import { hashCanonical } from "@truemandate/crypto";
import {
  AuthorityDecision,
  ConstraintMutability,
  ConstraintOperator,
  GrantConsumptionState,
  MeaningClass,
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  PaymentStatus,
  SourceType,
  asActionId,
  asAgentId,
  asAuthorityGrantId,
  asAuthorityRequestId,
  asConstraintId,
  asHashDigest,
  asIntentId,
  asIntentStateId,
  asNonce,
  asOutcomeContractId,
  asOutcomeRequirementId,
  asPrincipalId,
  asRemedyProposalId,
  asResolutionCaseId,
  type AuthorityGrant,
  type CapabilityScope,
  type CommitToken,
  type Constraint,
  type Intent,
  type IntentState,
  type OutcomeContract,
  type PreparedAction,
  type RemedyProposal,
} from "@truemandate/protocol";
import { createIntentState } from "./intent-state.js";
import { createPreparedAction } from "./prepared-action.js";
import { issueCommitToken } from "./grant.js";

export const NOW = "2026-06-01T12:00:00.000Z";
export const LATER = "2026-06-01T13:00:00.000Z";
export const PAST = "2026-05-01T12:00:00.000Z";
export const FUTURE = "2026-12-01T12:00:00.000Z";

export function makeConstraint(
  overrides: Partial<Constraint> & Pick<Constraint, "id" | "concept" | "kind">,
): Constraint {
  return {
    operator: ConstraintOperator.REQUIRE,
    value: true,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    sourceText: overrides.concept,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    ...overrides,
    id: asConstraintId(overrides.id),
  };
}

export function makeIntent(rawText = "Buy 500 food-grade containers under INR 800000"): Intent {
  return {
    id: asIntentId("intent-1"),
    principalId: asPrincipalId("principal-1"),
    rawText,
    createdAt: NOW,
    contentHash: hashCanonical({ rawText }),
  };
}

export function makeIntentState(
  intent: Intent,
  constraints: readonly Constraint[],
  id = "state-1",
  version = 1,
): IntentState {
  const result = createIntentState({
    id: asIntentStateId(id),
    intent,
    version,
    constraints,
    createdAt: NOW,
    createdBy: intent.principalId,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.value;
}

export function makeParentScope(): CapabilityScope {
  return {
    capabilities: {
      search: AuthorityDecision.ALLOW,
      compare: AuthorityDecision.ALLOW,
      execute_payment: AuthorityDecision.ALLOW,
      compensate: AuthorityDecision.REQUIRE_APPROVAL,
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

export function makePrepared(
  intent: Intent,
  state: IntentState,
  params?: Partial<PreparedAction["parameters"]>,
): PreparedAction {
  const result = createPreparedAction({
    id: "prep-1",
    actionId: asActionId("action-1"),
    intentId: intent.id,
    intentStateId: state.id,
    agentId: asAgentId("agent-1"),
    capability: "execute_payment",
    parameters: {
      merchant: "approved-a",
      product: "food-grade-container",
      quantity: 500,
      amount: 700000,
      currency: "INR",
      refundability: true,
      deliveryTerms: "standard",
      toolParameters: { sku: "FG-500" },
      ...params,
    },
    createdAt: NOW,
  });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

export function makeGrant(
  state: IntentState,
  prepared: PreparedAction,
  overrides: Partial<AuthorityGrant> = {},
): AuthorityGrant {
  return {
    id: asAuthorityGrantId("grant-1"),
    requestId: asAuthorityRequestId("req-1"),
    principalId: asPrincipalId("principal-1"),
    agentId: asAgentId("agent-1"),
    intentId: state.intentId,
    intentStateId: state.id,
    actionId: prepared.actionId,
    preparedActionId: prepared.id,
    capability: prepared.capability,
    merchant: prepared.parameters.merchant,
    amount: prepared.parameters.amount,
    currency: prepared.parameters.currency,
    scope: makeParentScope(),
    decision: AuthorityDecision.ALLOW,
    expiresAt: FUTURE,
    nonce: asNonce("nonce-1"),
    stateHash: state.stateHash,
    preparedActionHash: prepared.preparedActionHash,
    consumptionState: GrantConsumptionState.ACTIVE,
    createdAt: NOW,
    transferable: false,
    ...overrides,
  };
}

export function makeCommitToken(
  grant: AuthorityGrant,
  prepared: PreparedAction,
  overrides: Partial<Pick<CommitToken, "id" | "expiresAt" | "createdAt" | "consumed">> = {},
): CommitToken {
  const issued = issueCommitToken({
    id: overrides.id,
    grant,
    preparedAction: prepared,
    expiresAt: overrides.expiresAt ?? FUTURE,
    createdAt: overrides.createdAt ?? NOW,
  });
  if (!issued.ok) throw new Error(issued.message);
  return {
    ...issued.value,
    consumed: overrides.consumed ?? issued.value.consumed,
  };
}

export function makeOutcomeContract(state: IntentState): OutcomeContract {
  return {
    id: asOutcomeContractId("oc-1"),
    intentId: state.intentId,
    intentStateId: state.id,
    requirements: [
      {
        id: asOutcomeRequirementId("or-1"),
        concept: "quantity",
        operator: ConstraintOperator.GTE,
        value: 500,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.UNKNOWN,
      },
    ],
    state: OutcomeContractState.AWAITING_EXECUTION,
    paymentStatus: PaymentStatus.PENDING,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

export function makeRemedy(
  overrides: Partial<RemedyProposal> = {},
): RemedyProposal {
  return {
    id: asRemedyProposalId("remedy-1"),
    resolutionCaseId: asResolutionCaseId("res-1"),
    description: "Procure missing 50 units",
    requiresFinancialAction: true,
    estimatedAmount: 80000,
    currency: "INR",
    createdAt: NOW,
    ...overrides,
  };
}

export function unusedHash(): ReturnType<typeof asHashDigest> {
  return asHashDigest("0".repeat(64));
}
