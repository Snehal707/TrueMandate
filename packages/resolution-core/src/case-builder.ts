import {
  EstablishmentState,
  ResolutionCaseState,
  ResponsibilityState,
  asResolutionCaseId,
  type CausalTimelineEvent,
  type IntentState,
  type OutcomeContract,
  type OutcomeEvent,
  type ResolutionCase,
} from "@truemandate/protocol";

export interface StructuredHistoryInput {
  readonly principalId: string;
  readonly intentState: IntentState;
  readonly contract: OutcomeContract;
  readonly triggerEvent: OutcomeEvent;
  readonly actionProposalId?: string;
  readonly preparedActionId?: string;
  readonly sideEffectExecutionId?: string;
  readonly provenanceRootId?: string;
  readonly firstDivergenceNodeId?: string;
  readonly parentCaseId?: string;
  readonly recursionDepth?: number;
  readonly now: string;
}

/**
 * Builds a ResolutionCase from immutable structured history — no invented narrative.
 */
export function buildResolutionCase(
  input: StructuredHistoryInput,
): ResolutionCase {
  const triggerIdentity = input.triggerEvent.triggerIdentity;
  return {
    id: asResolutionCaseId(
      `rc-${input.contract.id}-${String(triggerIdentity).slice(0, 16)}`,
    ),
    contractId: input.contract.id,
    intentId: input.intentState.intentId,
    intentStateId: input.intentState.id,
    openedAt: input.now,
    updatedAt: input.now,
    firstDivergenceNodeId:
      input.firstDivergenceNodeId as ResolutionCase["firstDivergenceNodeId"],
    responsibilityState: ResponsibilityState.UNKNOWN,
    missingEvidence: [],
    state: ResolutionCaseState.OPEN,
    status: "OPEN",
    principalId: input.principalId as ResolutionCase["principalId"],
    outcomeContractHash: input.contract.definitionHash ?? input.contract.contractHash,
    triggerState: input.contract.state,
    triggerEventId: input.triggerEvent.id,
    triggerIdentity,
    actionProposalId: input.actionProposalId as ResolutionCase["actionProposalId"],
    preparedActionId: input.preparedActionId as ResolutionCase["preparedActionId"],
    sideEffectExecutionId: input.sideEffectExecutionId,
    provenanceRootId: input.provenanceRootId as ResolutionCase["provenanceRootId"],
    caseVersion: 1,
    parentCaseId: input.parentCaseId as ResolutionCase["parentCaseId"],
    recursionDepth: input.recursionDepth ?? 0,
  };
}

export function buildCausalTimeline(input: {
  readonly contract: OutcomeContract;
  readonly events: readonly OutcomeEvent[];
  readonly now: string;
}): CausalTimelineEvent[] {
  const timeline: CausalTimelineEvent[] = [
    {
      id: `cte-intent-${input.contract.intentStateId}`,
      type: "INTENT_STATE",
      eventTime: input.contract.createdAt,
      ingestionTime: input.contract.createdAt,
      actor: "principal",
      establishmentState: EstablishmentState.ESTABLISHED_FACT,
      confidence: 1,
    },
    {
      id: `cte-contract-${input.contract.id}`,
      type: "OUTCOME_CONTRACT",
      eventTime: input.contract.createdAt,
      ingestionTime: input.contract.createdAt,
      actor: "system",
      establishmentState: EstablishmentState.ESTABLISHED_FACT,
      confidence: 1,
    },
  ];
  for (const ev of input.events) {
    timeline.push({
      id: `cte-${ev.id ?? ev.type}-${ev.observedAt}`,
      type: String(ev.type),
      eventTime: ev.observedAt,
      ingestionTime: input.now,
      actor: "system",
      evidenceRefs: ev.evidenceIds?.map(String),
      establishmentState: EstablishmentState.CLAIM,
      confidence: 0.5,
    });
  }
  // Quantity claims remain claims until elevated
  const qty = input.contract.requirements.find(
    (r) => r.concept === "quantity_received",
  );
  if (qty && (qty.state === "PARTIAL" || qty.state === "CONFLICTED")) {
    timeline.push({
      id: `cte-qty-claim-${input.contract.id}`,
      type: "QUANTITY_OBSERVATION",
      eventTime: input.now,
      ingestionTime: input.now,
      actor: "warehouse",
      establishmentState: EstablishmentState.CLAIM,
      confidence: 0.6,
    });
  }
  return timeline;
}

/** First confirmed divergence ≠ root cause. */
export function describeFirstDivergence(
  contract: OutcomeContract,
): { readonly description: string; readonly isRootCause: false } {
  const qty = contract.requirements.find((r) => r.concept === "quantity_received");
  if (qty?.state === "PARTIAL" || qty?.state === "BREACHED") {
    return {
      description: `received quantity ${String(qty.value)} unmet vs ordered requirement`,
      isRootCause: false,
    };
  }
  const food = contract.requirements.find((r) => r.concept === "food_grade");
  if (food?.state === "BREACHED") {
    return {
      description: "food_grade requirement breached on received goods",
      isRootCause: false,
    };
  }
  return {
    description: `outcome state ${contract.state}`,
    isRootCause: false,
  };
}
