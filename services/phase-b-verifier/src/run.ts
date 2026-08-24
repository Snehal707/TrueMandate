import { ErrorCode, type Result } from "@truemandate/protocol";
import { phaseBRawEvent, phaseBWorkflow } from "./fixture.js";

/**
 * Bounded authorization-readiness window (2026-08-18 repair).
 *
 * The deployed v3 proof measured the event-driven compile+verify pipeline at
 * ~2m30s (AR scale-to-zero cold start + Vertex + Model Armor screening):
 * COMPILATION persisted 8s after the old 120s window had already expired,
 * and the IntentState finalized 22s after the verifier exited. 300s is the
 * named Phase B lifecycle bound that covers the observed worst case with
 * margin while remaining strictly below the 600s job timeout. Polling stays
 * deterministic and fail-closed: only INTENT_STATE_NOT_READY with
 * retryable:true is ever retried, and the window expiring throws.
 */
export const PHASE_B_RETRY_WINDOW_MS = 300_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

export interface PhaseBVerifierDeps {
  readonly publishRawIntent: (event: ReturnType<typeof phaseBRawEvent>) => Promise<void>;
  readonly submitWorkflow: (workflow: ReturnType<typeof phaseBWorkflow>) => Promise<Result<unknown>>;
  readonly submitCommit: (body: { readonly commitTokenId: string }) => Promise<Result<unknown>>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface PhaseBCommitSuccess {
  readonly status: "SUCCESS";
  readonly resultRef?: string;
  readonly grantId: string;
  readonly executionId?: string;
}

/**
 * Phase B verification: first drive the normal deployed authorization chain
 * (the verifier creates no owner records), then explicitly COMMIT the fresh
 * token through the Agent Runtime execution boundary. Exit 0 requires the
 * strict durable success contract below — an HTTP 200 alone is never enough.
 */
export async function runPhaseBVerifier(deps: PhaseBVerifierDeps): Promise<unknown> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  await deps.publishRawIntent(phaseBRawEvent());

  const workflow = phaseBWorkflow();
  const deadline = now() + PHASE_B_RETRY_WINDOW_MS;
  let delay = INITIAL_BACKOFF_MS;
  let workflowResult: Record<string, unknown> | undefined;
  while (true) {
    const result = await deps.submitWorkflow(workflow);
    if (result.ok) {
      workflowResult = result.value as Record<string, unknown>;
      break;
    }
    if (result.code !== ErrorCode.INTENT_STATE_NOT_READY || result.details?.retryable !== true) {
      throw new Error(JSON.stringify({ code: result.code, message: result.message, details: result.details }));
    }
    if (now() >= deadline) {
      throw new Error(JSON.stringify({
        code: ErrorCode.INTENT_STATE_NOT_READY,
        message: "IntentState tip did not finalize within the Phase B retry window",
      }));
    }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_BACKOFF_MS);
  }

  // The authorized chain must terminate at a fresh unconsumed CommitToken
  // with the fixture's own economics — never a stale Phase A token.
  const authorization = (workflowResult as { authorization?: { commitToken?: { id?: string }; grant?: { id?: string; amount?: number; currency?: string; merchant?: string } } }).authorization;
  const tokenId = authorization?.commitToken?.id;
  const grant = authorization?.grant;
  if ((workflowResult as { state?: string }).state !== "AUTHORIZED" || !tokenId || !grant?.id) {
    throw new Error(JSON.stringify({
      outcome: "PHASE_B_AUTHORIZATION_NOT_COMPLETE",
      state: (workflowResult as { state?: string }).state ?? "UNKNOWN",
      message: "Workflow did not reach a canonical unconsumed CommitToken",
    }));
  }
  if (grant.amount !== 742000 || grant.currency !== "INR" || grant.merchant !== "phase-b-supplier") {
    throw new Error(JSON.stringify({ outcome: "PHASE_B_ECONOMICS_MISMATCH", grant }));
  }

  const commit = await deps.submitCommit({ commitTokenId: tokenId });
  if (!commit.ok) {
    throw new Error(JSON.stringify({ outcome: "PHASE_B_COMMIT_FAILED", code: commit.code, message: commit.message, details: commit.details }));
  }
  const first = commit.value as PhaseBCommitSuccess;
  if (first.status !== "SUCCESS" || !first.executionId || !first.resultRef || !first.grantId) {
    throw new Error(JSON.stringify({ outcome: "PHASE_B_EXECUTION_NOT_SUCCESS", value: first }));
  }

  // Exactly-once proof: replaying the same reference must return the same
  // idempotent economic effect — never a second execution.
  const replay = await deps.submitCommit({ commitTokenId: tokenId });
  if (!replay.ok) {
    throw new Error(JSON.stringify({ outcome: "PHASE_B_REPLAY_CHECK_FAILED", code: replay.code, message: replay.message }));
  }
  const second = replay.value as { status?: string; resultRef?: string; grantId?: string };
  if (second.status !== "IDEMPOTENT_REPLAY" || second.resultRef !== first.resultRef) {
    throw new Error(JSON.stringify({ outcome: "PHASE_B_EXACTLY_ONCE_VIOLATED", first, second }));
  }

  return {
    fixture: "phase-b-food-grade-500-v1",
    execution: { status: first.status, executionId: first.executionId, resultRef: first.resultRef, grantId: first.grantId },
    exactlyOnce: { replayStatus: second.status, sameResultRef: true },
  };
}
