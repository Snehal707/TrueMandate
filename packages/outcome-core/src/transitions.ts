import {
  ErrorCode,
  OutcomeContractState,
  err,
  ok,
  type OutcomeContractState as State,
  type Result,
} from "@truemandate/protocol";

/** Legal contract state transitions (fail closed). */
const ALLOWED: Readonly<Record<State, readonly State[]>> = {
  [OutcomeContractState.CREATED]: [
    OutcomeContractState.AWAITING_EXECUTION,
    OutcomeContractState.CANCELLED,
  ],
  [OutcomeContractState.AWAITING_EXECUTION]: [
    OutcomeContractState.AWAITING_OUTCOME,
    OutcomeContractState.CANCELLED,
    OutcomeContractState.AWAITING_EXECUTION,
  ],
  [OutcomeContractState.AWAITING_OUTCOME]: [
    OutcomeContractState.IN_PROGRESS,
    OutcomeContractState.AT_RISK,
    OutcomeContractState.PARTIAL,
    OutcomeContractState.SATISFIED,
    OutcomeContractState.BREACHED,
    OutcomeContractState.CONFLICTED,
    OutcomeContractState.AWAITING_EVIDENCE,
    OutcomeContractState.MONITORING,
  ],
  [OutcomeContractState.IN_PROGRESS]: [
    OutcomeContractState.AT_RISK,
    OutcomeContractState.PARTIAL,
    OutcomeContractState.SATISFIED,
    OutcomeContractState.BREACHED,
    OutcomeContractState.CONFLICTED,
    OutcomeContractState.AWAITING_EVIDENCE,
    OutcomeContractState.MONITORING,
  ],
  [OutcomeContractState.AT_RISK]: [
    OutcomeContractState.IN_PROGRESS,
    OutcomeContractState.PARTIAL,
    OutcomeContractState.SATISFIED,
    OutcomeContractState.BREACHED,
    OutcomeContractState.CONFLICTED,
    OutcomeContractState.AWAITING_EVIDENCE,
  ],
  [OutcomeContractState.PARTIAL]: [
    OutcomeContractState.SATISFIED,
    OutcomeContractState.BREACHED,
    OutcomeContractState.AT_RISK,
    OutcomeContractState.RESOLUTION_ACTIVE,
    OutcomeContractState.AWAITING_EVIDENCE,
  ],
  [OutcomeContractState.SATISFIED]: [
    OutcomeContractState.CLOSED,
    OutcomeContractState.MONITORING,
  ],
  [OutcomeContractState.BREACHED]: [
    OutcomeContractState.RESOLUTION_ACTIVE,
    OutcomeContractState.CLOSED,
  ],
  [OutcomeContractState.CONFLICTED]: [
    OutcomeContractState.AWAITING_EVIDENCE,
    OutcomeContractState.PARTIAL,
    OutcomeContractState.BREACHED,
    OutcomeContractState.SATISFIED,
    OutcomeContractState.RESOLUTION_ACTIVE,
  ],
  [OutcomeContractState.AWAITING_EVIDENCE]: [
    OutcomeContractState.IN_PROGRESS,
    OutcomeContractState.PARTIAL,
    OutcomeContractState.SATISFIED,
    OutcomeContractState.BREACHED,
    OutcomeContractState.CONFLICTED,
    OutcomeContractState.AT_RISK,
  ],
  [OutcomeContractState.RESOLUTION_ACTIVE]: [
    OutcomeContractState.RESOLVED,
    OutcomeContractState.CLOSED,
  ],
  [OutcomeContractState.RESOLVED]: [OutcomeContractState.CLOSED],
  [OutcomeContractState.MONITORING]: [
    OutcomeContractState.CLOSED,
    OutcomeContractState.AT_RISK,
    OutcomeContractState.BREACHED,
  ],
  [OutcomeContractState.CLOSED]: [],
  [OutcomeContractState.CANCELLED]: [],
};

export function assertTransitionAllowed(
  from: State,
  to: State,
): Result<void> {
  if (from === to) return ok();
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    return err(
      ErrorCode.OUTCOME_TRANSITION_INVALID,
      `Illegal OutcomeContract transition ${from} → ${to}`,
      { from, to },
    );
  }
  return ok();
}
