import {
  ErrorCode,
  ResolutionCaseState,
  err,
  ok,
  type ResolutionCaseState as State,
  type Result,
} from "@truemandate/protocol";

const ALLOWED: Readonly<Record<State, readonly State[]>> = {
  [ResolutionCaseState.OPEN]: [
    ResolutionCaseState.GATHERING_EVIDENCE,
    ResolutionCaseState.ANALYZING,
    ResolutionCaseState.ESCALATED,
    ResolutionCaseState.CLOSED,
  ],
  [ResolutionCaseState.GATHERING_EVIDENCE]: [
    ResolutionCaseState.ANALYZING,
    ResolutionCaseState.REMEDY_PROPOSED,
    ResolutionCaseState.ESCALATED,
  ],
  [ResolutionCaseState.ANALYZING]: [
    ResolutionCaseState.GATHERING_EVIDENCE,
    ResolutionCaseState.REMEDY_PROPOSED,
    ResolutionCaseState.AWAITING_AUTHORITY,
    ResolutionCaseState.ESCALATED,
  ],
  [ResolutionCaseState.REMEDY_PROPOSED]: [
    ResolutionCaseState.AWAITING_AUTHORITY,
    ResolutionCaseState.REMEDIATING,
    ResolutionCaseState.ESCALATED,
  ],
  [ResolutionCaseState.AWAITING_AUTHORITY]: [
    ResolutionCaseState.REMEDIATING,
    ResolutionCaseState.ESCALATED,
    ResolutionCaseState.CLOSED,
  ],
  [ResolutionCaseState.REMEDIATING]: [
    ResolutionCaseState.VERIFYING_REMEDY,
    ResolutionCaseState.ESCALATED,
  ],
  [ResolutionCaseState.VERIFYING_REMEDY]: [
    ResolutionCaseState.RESOLVED,
    ResolutionCaseState.REMEDY_PROPOSED,
    ResolutionCaseState.ESCALATED,
  ],
  [ResolutionCaseState.RESOLVED]: [ResolutionCaseState.CLOSED],
  [ResolutionCaseState.ESCALATED]: [ResolutionCaseState.CLOSED],
  [ResolutionCaseState.CLOSED]: [],
};

export function assertResolutionTransition(
  from: State,
  to: State,
): Result<void> {
  if (from === to) return ok();
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    return err(
      ErrorCode.RESOLUTION_TRANSITION_INVALID,
      `Illegal ResolutionCase transition ${from} → ${to}`,
      { from, to },
    );
  }
  return ok();
}

export function isTerminalResolutionState(state: State): boolean {
  return (
    state === ResolutionCaseState.RESOLVED ||
    state === ResolutionCaseState.CLOSED ||
    state === ResolutionCaseState.ESCALATED
  );
}
