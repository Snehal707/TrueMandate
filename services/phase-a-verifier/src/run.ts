import { ErrorCode, type Result } from "@truemandate/protocol";
import { phaseARawEvent, phaseAWorkflow } from "./fixture.js";

export const PHASE_A_RETRY_WINDOW_MS = 120_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

export interface PhaseAVerifierDeps {
  readonly publishRawIntent: (event: ReturnType<typeof phaseARawEvent>) => Promise<void>;
  readonly submitWorkflow: (workflow: ReturnType<typeof phaseAWorkflow>) => Promise<Result<unknown>>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * The verifier only supplies deterministic fixture inputs.  Agent Runtime owns
 * all authoritative state reads and is the only caller that can retry after a
 * missing finalized tip.
 */
export async function runPhaseAVerifier(deps: PhaseAVerifierDeps): Promise<unknown> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  await deps.publishRawIntent(phaseARawEvent());

  const workflow = phaseAWorkflow();
  const deadline = now() + PHASE_A_RETRY_WINDOW_MS;
  let delay = INITIAL_BACKOFF_MS;
  while (true) {
    const result = await deps.submitWorkflow(workflow);
    if (result.ok) {
      // A successful HTTP/coordinator result is not Phase A success. Only the
      // canonical unconsumed CommitToken outcome satisfies the Phase A success
      // condition; BLOCKED / REJECTED / stale workflow replays are reported as
      // explicit terminal failures.
      const value = result.value as {
        state?: string;
        authorization?: { commitToken?: { id?: string }; grant?: { id?: string } };
      };
      if (
        value.state === "AUTHORIZED" &&
        value.authorization?.commitToken?.id &&
        value.authorization?.grant?.id
      ) {
        return result.value;
      }
      throw new Error(JSON.stringify({
        outcome: "PHASE_A_NOT_COMPLETE",
        state: value.state ?? "UNKNOWN",
        message: "Workflow did not reach a canonical unconsumed CommitToken",
      }));
    }
    if (result.code !== ErrorCode.INTENT_STATE_NOT_READY || result.details?.retryable !== true) {
      throw new Error(JSON.stringify({ code: result.code, message: result.message, details: result.details }));
    }
    if (now() >= deadline) {
      throw new Error(JSON.stringify({
        code: ErrorCode.INTENT_STATE_NOT_READY,
        message: "IntentState tip did not finalize within the Phase A retry window",
      }));
    }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_BACKOFF_MS);
  }
}
