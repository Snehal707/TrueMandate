/**
 * Ephemeral ADK session / conversation state.
 *
 * This is intentionally separate from protocol objects:
 * - IntentState (verified human intent)
 * - OutcomeContract / OutcomeState
 * - ResolutionCase
 *
 * AdkSessionState holds turn counters, scratch context, and UI/session metadata.
 * It must never be treated as authority-bearing protocol state.
 */
export interface AdkSessionState {
  readonly sessionId: string;
  readonly agentId: string;
  readonly startedAt: string;
  readonly turnCount: number;
  readonly scratch: Readonly<Record<string, unknown>>;
}

export function createAdkSessionState(
  agentId: string,
  sessionId?: string,
): AdkSessionState {
  return {
    sessionId: sessionId ?? crypto.randomUUID(),
    agentId,
    startedAt: new Date().toISOString(),
    turnCount: 0,
    scratch: {},
  };
}

export function nextAdkTurn(state: AdkSessionState): AdkSessionState {
  return {
    ...state,
    turnCount: state.turnCount + 1,
  };
}
