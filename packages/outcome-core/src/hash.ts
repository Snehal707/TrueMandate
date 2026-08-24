import { hashCanonical } from "@truemandate/crypto";
import type {
  HashDigest,
  OutcomeContract,
  OutcomeRequirement,
} from "@truemandate/protocol";

/**
 * Immutable success criteria for binding — excludes runtime/execution fields
 * and preparedAction linkage (those are linked via execution binding events).
 *
 * Staged binding (non-circular):
 *   IntentState → Plan → ActionProposal → OutcomeContractDefinition
 *   → definitionHash → PreparedAction.outcomeContractHash binds that hash
 *   → execution binding event links final PreparedAction to the contract
 */
export interface OutcomeContractDefinition {
  readonly intentId: string;
  readonly intentStateId: string;
  readonly intentStateHash?: string;
  readonly principalId?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly requirements: readonly OutcomeRequirement[];
  readonly version?: number;
  readonly finalityPolicy?: Readonly<Record<string, unknown>>;
  readonly evidencePolicy?: Readonly<Record<string, unknown>>;
}

/** Fields intentionally excluded from definition hash (runtime / PA linkage). */
const EXCLUDED_FROM_DEFINITION = [
  "preparedActionId",
  "preparedActionHash",
  "executionBegunAt",
  "paymentStatus",
  "state",
  "updatedAt",
  "contractHash",
  "definitionHash",
  "createdAt",
  "id",
  "actionId",
] as const;

export function toOutcomeContractDefinition(
  contract: Pick<
    OutcomeContract,
    | "intentId"
    | "intentStateId"
    | "intentStateHash"
    | "principalId"
    | "planId"
    | "planVersion"
    | "actionProposalId"
    | "actionContentHash"
    | "requirements"
    | "version"
    | "finalityPolicy"
    | "evidencePolicy"
  >,
): OutcomeContractDefinition {
  return {
    intentId: contract.intentId,
    intentStateId: contract.intentStateId,
    intentStateHash: contract.intentStateHash,
    principalId: contract.principalId,
    planId: contract.planId,
    planVersion: contract.planVersion,
    actionProposalId: contract.actionProposalId,
    actionContentHash: contract.actionContentHash,
    requirements: contract.requirements.map((r) => ({
      id: r.id,
      concept: r.concept,
      operator: r.operator,
      value: r.value,
      criticality: r.criticality,
      // Binding uses PENDING canonical state for requirements in definition
      state: r.state,
      type: r.type,
      sourceConstraintId: r.sourceConstraintId,
      predicate: r.predicate,
      evidencePolicy: r.evidencePolicy,
      evaluationMethod: r.evaluationMethod,
      deadline: r.deadline,
      observationWindow: r.observationWindow,
      dependencies: r.dependencies,
    })),
    version: contract.version,
    finalityPolicy: contract.finalityPolicy,
    evidencePolicy: contract.evidencePolicy,
  };
}

export function hashOutcomeContractDefinition(
  definition: OutcomeContractDefinition,
): HashDigest {
  return hashCanonical(definition) as HashDigest;
}

/**
 * Binding digest for PreparedAction.outcomeContractHash.
 * Equals definitionHash — never includes preparedActionHash (avoids cycles).
 */
export function hashOutcomeContract(contract: OutcomeContract): HashDigest {
  const definition = toOutcomeContractDefinition(contract);
  return hashOutcomeContractDefinition(definition);
}

/** Runtime state hash (optional audit) — excludes definition binding fields. */
export function hashOutcomeContractState(contract: OutcomeContract): HashDigest {
  const {
    contractHash: _c,
    definitionHash: _d,
    updatedAt: _u,
    ...rest
  } = contract as OutcomeContract & { definitionHash?: HashDigest };
  void _c;
  void _d;
  void _u;
  void EXCLUDED_FROM_DEFINITION;
  return hashCanonical({
    id: rest.id,
    state: rest.state,
    paymentStatus: rest.paymentStatus,
    requirements: rest.requirements,
    executionBegunAt: rest.executionBegunAt,
    preparedActionId: rest.preparedActionId,
    preparedActionHash: rest.preparedActionHash,
  }) as HashDigest;
}

/**
 * True when PreparedAction.parameterHash cannot include outcomeContractHash
 * and definition hash cannot include preparedActionHash — structural non-cycle.
 */
export function assertNonCircularBinding(input: {
  readonly parameterHash: string;
  readonly outcomeContractHash: string;
  readonly definitionIncludesPreparedActionHash: boolean;
  readonly parameterHashIncludesOutcomeContractHash: boolean;
}): boolean {
  return (
    !input.definitionIncludesPreparedActionHash &&
    !input.parameterHashIncludesOutcomeContractHash &&
    input.parameterHash !== input.outcomeContractHash
  );
}
