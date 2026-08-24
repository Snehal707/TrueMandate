import {
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  type OutcomeRequirement,
} from "@truemandate/protocol";

export interface AggregateResult {
  readonly overallState: OutcomeContractState;
  readonly criticalFailure: boolean;
  readonly requirements: readonly OutcomeRequirement[];
}

function isCritical(c: OutcomeRequirementCriticality): boolean {
  return (
    c === OutcomeRequirementCriticality.HARD ||
    c === OutcomeRequirementCriticality.SAFETY_CRITICAL
  );
}

/**
 * Critical HARD/SAFETY_CRITICAL breaches dominate aggregates.
 * Soft misses never force BREACHED over a recoverable PARTIAL when no critical failure.
 */
export function aggregateRequirementStates(
  requirements: readonly OutcomeRequirement[],
): AggregateResult {
  let criticalFailure = false;
  let anyConflicted = false;
  let anyBreached = false;
  let anyPartial = false;
  let anyAtRisk = false;
  let anyAwaiting = false;
  let anyUnknown = false;
  let allSatisfied = requirements.length > 0;

  for (const req of requirements) {
    if (req.state !== OutcomeRequirementState.SATISFIED) {
      allSatisfied = false;
    }
    if (req.state === OutcomeRequirementState.CONFLICTED) {
      anyConflicted = true;
      if (isCritical(req.criticality)) criticalFailure = true;
    }
    if (req.state === OutcomeRequirementState.BREACHED) {
      anyBreached = true;
      if (isCritical(req.criticality)) criticalFailure = true;
    }
    if (req.state === OutcomeRequirementState.PARTIAL) anyPartial = true;
    if (req.state === OutcomeRequirementState.AT_RISK) anyAtRisk = true;
    if (req.state === OutcomeRequirementState.PENDING) anyAwaiting = true;
    if (req.state === OutcomeRequirementState.UNKNOWN) {
      anyUnknown = true;
      if (isCritical(req.criticality)) {
        // HARD semantic UNKNOWN blocks SATISFIED
        anyAwaiting = true;
      }
    }
  }

  if (criticalFailure && anyBreached) {
    return {
      overallState: OutcomeContractState.BREACHED,
      criticalFailure: true,
      requirements,
    };
  }
  if (anyConflicted && criticalFailure) {
    return {
      overallState: OutcomeContractState.CONFLICTED,
      criticalFailure: true,
      requirements,
    };
  }
  if (anyConflicted) {
    return {
      overallState: OutcomeContractState.CONFLICTED,
      criticalFailure: false,
      requirements,
    };
  }
  if (anyBreached && !criticalFailure) {
    // Soft-only breaches → PARTIAL while recoverable
    return {
      overallState: OutcomeContractState.PARTIAL,
      criticalFailure: false,
      requirements,
    };
  }
  if (anyPartial) {
    return {
      overallState: OutcomeContractState.PARTIAL,
      criticalFailure: false,
      requirements,
    };
  }
  if (anyAtRisk) {
    return {
      overallState: OutcomeContractState.AT_RISK,
      criticalFailure: false,
      requirements,
    };
  }
  if (anyAwaiting || anyUnknown) {
    return {
      overallState: OutcomeContractState.AWAITING_EVIDENCE,
      criticalFailure: false,
      requirements,
    };
  }
  if (allSatisfied) {
    return {
      overallState: OutcomeContractState.SATISFIED,
      criticalFailure: false,
      requirements,
    };
  }
  return {
    overallState: OutcomeContractState.IN_PROGRESS,
    criticalFailure: false,
    requirements,
  };
}

/** Model/agent must never rewrite requirement criticality. */
export function assertCriticalityLocked(
  original: readonly OutcomeRequirement[],
  proposed: readonly OutcomeRequirement[],
): boolean {
  const byId = new Map(original.map((r) => [r.id, r.criticality]));
  for (const p of proposed) {
    const expected = byId.get(p.id);
    if (expected !== undefined && p.criticality !== expected) return false;
  }
  return true;
}
