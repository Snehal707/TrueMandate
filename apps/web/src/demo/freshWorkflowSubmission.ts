import type {
  IntentWorkspaceView,
  Result,
  SdkWorkflowRequest,
  SdkWorkflowView,
} from "@truemandate/sdk-core";

type FreshWorkflowSdk = {
  submitWorkflow(input: SdkWorkflowRequest): Promise<Result<SdkWorkflowView>>;
  readWorkspace(intentId: string): Promise<Result<IntentWorkspaceView>>;
};

/**
 * Where this client currently is in the two-leg submission.
 *
 * Each variant is a fact about this browser — a request it has outstanding, or
 * a poll it has performed. None of them is a claim that the backend reported a
 * stage. Presentation must keep that distinction.
 */
export type FreshWorkflowProgress =
  | { readonly phase: "recording-intent" }
  | { readonly phase: "awaiting-intent-state"; readonly polls: number }
  | { readonly phase: "submitting-workflow"; readonly intentStateId: string };

type FreshWorkflowSubmissionOptions = {
  readonly delaysMs?: readonly number[];
  readonly wait?: (delayMs: number) => Promise<void>;
  /** Observational only. Never affects submission control flow. */
  readonly onProgress?: (progress: FreshWorkflowProgress) => void;
};

const DEFAULT_READINESS_DELAYS_MS = Array.from(
  { length: 60 },
  () => 3_000,
);

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

/**
 * RAW intent finalization is asynchronous. Once the public workspace exposes
 * its finalized tip, continue with a state-bound REFERENCE submission.
 */
export async function submitFreshWorkflowWhenReady(
  sdk: FreshWorkflowSdk,
  request: SdkWorkflowRequest,
  options: FreshWorkflowSubmissionOptions = {},
): Promise<Result<SdkWorkflowView>> {
  // Presentation must never be able to break a live submission.
  const report = (progress: FreshWorkflowProgress): void => {
    try {
      options.onProgress?.(progress);
    } catch {
      // A failing observer is a presentation problem, not a submission problem.
    }
  };

  report({ phase: "recording-intent" });
  let submitted = await sdk.submitWorkflow(request);
  if (
    submitted.ok ||
    submitted.code !== "INTENT_STATE_NOT_READY" ||
    request.intent.kind !== "RAW" ||
    !request.intent.id
  ) {
    return submitted;
  }

  const retryableStateCodes = new Set([
    "INTENT_STATE_NOT_READY",
    "GUARDIAN_VERDICT_STALE",
    "PLAN_STALE",
  ]);
  const wait = options.wait ?? defaultWait;
  let attemptedStateId: string | undefined;
  let polls = 0;
  for (const delayMs of options.delaysMs ?? DEFAULT_READINESS_DELAYS_MS) {
    polls += 1;
    report({ phase: "awaiting-intent-state", polls });
    await wait(delayMs);
    const workspace = await sdk.readWorkspace(request.intent.id);
    if (!workspace.ok) continue;
    const stateId = workspace.value.summary.intentStateId;
    const stateHash = workspace.value.summary.stateHash;
    if (!stateId || !stateHash || stateId === attemptedStateId) continue;
    attemptedStateId = stateId;
    const { workflowId: _rawWorkflowId, ...stateBoundRequest } = request;

    report({ phase: "submitting-workflow", intentStateId: stateId });
    submitted = await sdk.submitWorkflow({
      ...stateBoundRequest,
      intent: {
        kind: "REFERENCE",
        intentId: request.intent.id,
        expectedIntentStateId: stateId,
        expectedIntentStateHash: stateHash,
      },
      idempotencyKey: `${request.idempotencyKey}:finalized:${stateId}`,
    });
    if (submitted.ok || !retryableStateCodes.has(submitted.code)) {
      return submitted;
    }
  }

  return submitted;
}
