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

type FreshWorkflowSubmissionOptions = {
  readonly delaysMs?: readonly number[];
  readonly wait?: (delayMs: number) => Promise<void>;
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
  for (const delayMs of options.delaysMs ?? DEFAULT_READINESS_DELAYS_MS) {
    await wait(delayMs);
    const workspace = await sdk.readWorkspace(request.intent.id);
    if (!workspace.ok) continue;
    const stateId = workspace.value.summary.intentStateId;
    const stateHash = workspace.value.summary.stateHash;
    if (!stateId || !stateHash || stateId === attemptedStateId) continue;
    attemptedStateId = stateId;
    const { workflowId: _rawWorkflowId, ...stateBoundRequest } = request;

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
