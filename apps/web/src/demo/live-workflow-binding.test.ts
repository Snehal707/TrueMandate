import { describe, expect, it } from "vitest";
import type { IntentWorkspaceView, Result, SdkWorkflowView } from "@truemandate/sdk-core";
import { refreshWorkflowChain, type LiveRunState, type RefreshWorkflowSdk } from "./LiveDemoPage";
import { buildLiveDemoWorkflowRequest } from "./liveDemoPresets";

/**
 * `refreshWorkflowChain` is the exact function `LiveDemoPage` calls on every
 * poll and every explicit refresh. Its one governing rule: a workspace read
 * is always bound to THIS run's own intentId + workflowId pair, read
 * together — never a stale pair left over from a previous run. These tests
 * exercise the exported function directly, against a fake backend that only
 * answers a `readWorkspace` call when the pair it receives actually matches
 * a submitted workflow — so any accidental cross-pairing shows up as a
 * failed read rather than silently passing.
 */

function requestIntentId(request: LiveRunState["request"]): string {
  return (request.intent.kind === "RAW" ? request.intent.id : request.intent.intentId)!;
}

function workspaceFor(intentId: string): IntentWorkspaceView {
  return {
    summary: {
      intentId,
      rawIntent: "Book a refundable stay through an approved provider.",
      principalId: "live-demo-web",
      createdAt: "2026-08-24T10:00:00.000Z",
      intentStateId: `${intentId}-state`,
      historicalStateIds: [],
    },
  } as unknown as IntentWorkspaceView;
}

const NOT_FOUND = { ok: false, code: "VALIDATION_FAILED", message: "no such record" } as const;

/**
 * A fake backend keyed by the exact (intentId, workflowId) pairs it was told
 * about via `register`. `readWorkspace` only succeeds when both halves of
 * the pair it receives match a single registered submission — so if
 * `refreshWorkflowChain` ever mixed one run's intentId with another run's
 * workflowId, this backend would fail the read instead of masking the bug.
 */
function fakeBackend() {
  const pairs = new Map<string, { readonly workflow: SdkWorkflowView; readonly intentId: string }>();
  const workspaceCalls: Array<{ intentId: string; workflowId: string | undefined }> = [];

  function register(intentId: string, workflow: SdkWorkflowView): void {
    pairs.set(workflow.workflowId, { workflow, intentId });
  }

  const sdk: RefreshWorkflowSdk = {
    async readWorkflow(workflowId): Promise<Result<SdkWorkflowView>> {
      const entry = pairs.get(workflowId);
      return entry ? { ok: true, value: entry.workflow } : NOT_FOUND;
    },
    async readWorkspace(intentId, workflowId): Promise<Result<IntentWorkspaceView>> {
      workspaceCalls.push({ intentId, workflowId });
      const entry = workflowId ? pairs.get(workflowId) : undefined;
      return entry && entry.intentId === intentId ? { ok: true, value: workspaceFor(intentId) } : NOT_FOUND;
    },
    async readApproval(): Promise<Result<never>> {
      return NOT_FOUND as Result<never>;
    },
    async readOutcome(): Promise<Result<never>> {
      return NOT_FOUND as Result<never>;
    },
    async readResolutionCase(): Promise<Result<never>> {
      return NOT_FOUND as Result<never>;
    },
    async readResolutionByOutcome(): Promise<Result<never>> {
      return NOT_FOUND as Result<never>;
    },
  };

  return { sdk, register, workspaceCalls };
}

function runFor(request: LiveRunState["request"], workflow: SdkWorkflowView): LiveRunState {
  return {
    createdAt: "2026-08-24T10:00:00.000Z",
    domainId: "travel",
    request,
    workflow,
    evidenceSubmissions: [],
  };
}

describe("successful Live Proof uses returned workflowId in workspace reads", () => {
  it("reads the workspace using the exact intentId + workflowId this run's own workflow read returned", async () => {
    const request = buildLiveDemoWorkflowRequest("travel");
    const intentId = requestIntentId(request);
    const workflow: SdkWorkflowView = { workflowId: request.workflowId!, state: "BLOCKED" };
    const backend = fakeBackend();
    backend.register(intentId, workflow);

    const result = await refreshWorkflowChain(backend.sdk, runFor(request, workflow));

    expect(backend.workspaceCalls).toEqual([{ intentId, workflowId: workflow.workflowId }]);
    expect(result.workspace?.summary.intentId).toBe(intentId);
  });
});

describe("new run cannot reuse prior workflowId", () => {
  it("a second, independent run's refresh only ever reads its own pair, never the first run's", async () => {
    const requestA = buildLiveDemoWorkflowRequest("travel");
    const requestB = buildLiveDemoWorkflowRequest("travel");
    const intentIdA = requestIntentId(requestA);
    const intentIdB = requestIntentId(requestB);

    // buildLiveDemoWorkflowRequest mints fresh UUIDs on every call — this is
    // the mechanism that makes a genuinely fresh run possible in the first
    // place. If this ever collided, the rest of the test would be moot.
    expect(requestA.workflowId).not.toBe(requestB.workflowId);
    expect(intentIdA).not.toBe(intentIdB);

    const workflowA: SdkWorkflowView = { workflowId: requestA.workflowId!, state: "BLOCKED" };
    const workflowB: SdkWorkflowView = { workflowId: requestB.workflowId!, state: "BLOCKED" };

    // One shared backend across both calls, so a hidden module-level leak
    // inside refreshWorkflowChain itself (not just "two separate mocks
    // never talk to each other") would also be caught.
    const backend = fakeBackend();
    backend.register(intentIdA, workflowA);
    backend.register(intentIdB, workflowB);

    const resultA = await refreshWorkflowChain(backend.sdk, runFor(requestA, workflowA));
    // Mirrors launchFreshWorkflow: the visible run is cleared (setRun(undefined))
    // before the new submission is established, so this second refresh has
    // no access to resultA — only to its own run's request/workflow pair.
    const resultB = await refreshWorkflowChain(backend.sdk, runFor(requestB, workflowB));

    expect(backend.workspaceCalls).toEqual([
      { intentId: intentIdA, workflowId: workflowA.workflowId },
      { intentId: intentIdB, workflowId: workflowB.workflowId },
    ]);
    expect(resultA.workspace?.summary.intentId).toBe(intentIdA);
    expect(resultB.workspace?.summary.intentId).toBe(intentIdB);
    expect(resultB.workspace?.summary.intentId).not.toBe(resultA.workspace?.summary.intentId);
  });
});
