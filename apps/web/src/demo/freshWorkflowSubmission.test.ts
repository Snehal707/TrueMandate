import { describe, expect, it, vi } from "vitest";
import type {
  IntentWorkspaceView,
  Result,
  SdkWorkflowRequest,
  SdkWorkflowView,
} from "@truemandate/sdk-core";
import { submitFreshWorkflowWhenReady } from "./freshWorkflowSubmission";

const request = {
  workflowId: "wf-live",
  idempotencyKey: "idem-live",
  intent: {
    kind: "RAW",
    id: "intent-live",
    principalId: "live-demo",
    rawText: "Book a governed trip.",
  },
  action: {
    capability: "book_travel",
    merchant: "Meridian Travel Partners",
    product: "Seaside Lodge",
    quantity: 1,
    amount: 500,
    currency: "USD",
    consequenceLevel: "HIGH",
    parameters: {},
  },
  domain: { packId: "travel", payload: {} },
} satisfies SdkWorkflowRequest;

const notReady = {
  ok: false,
  code: "INTENT_STATE_NOT_READY",
  message: "IntentState tip is not finalized",
} as const;

const workflow = {
  workflowId: "wf-live",
  state: "BLOCKED",
  domain: "travel",
} as SdkWorkflowView;

describe("submitFreshWorkflowWhenReady", () => {
  it("returns an immediate workflow without polling", async () => {
    const submitWorkflow = vi.fn().mockResolvedValue({ ok: true, value: workflow });
    const readWorkspace = vi.fn();

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace },
      request,
    );

    expect(result).toEqual({ ok: true, value: workflow });
    expect(readWorkspace).not.toHaveBeenCalled();
  });

  it("waits for durable workspace state and submits a tip-bound reference", async () => {
    const submitWorkflow = vi
      .fn<(_request: SdkWorkflowRequest) => Promise<Result<SdkWorkflowView>>>()
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce({ ok: true, value: workflow });
    const readWorkspace = vi
      .fn<(_id: string) => Promise<Result<IntentWorkspaceView>>>()
      .mockResolvedValueOnce({
        ok: false,
        code: "INTENT_STATE_NOT_READY",
        message: "not finalized",
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          summary: {
            intentId: "intent-live",
            rawIntent: "Book a governed trip.",
            principalId: "live-demo",
            createdAt: "2026-08-24T00:00:00.000Z",
            intentStateId: "state-live-v1",
            stateHash: "hash-live-v1",
            historicalStateIds: [],
          },
        } as unknown as IntentWorkspaceView,
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace },
      request,
      { delaysMs: [1, 2], wait },
    );

    expect(result).toEqual({ ok: true, value: workflow });
    expect(submitWorkflow).toHaveBeenCalledTimes(2);
    expect(submitWorkflow.mock.calls[0]![0]).toBe(request);
    expect(submitWorkflow.mock.calls[1]![0]).toEqual({
      idempotencyKey: "idem-live:finalized:state-live-v1",
      intent: {
        kind: "REFERENCE",
        intentId: "intent-live",
        expectedIntentStateId: "state-live-v1",
        expectedIntentStateHash: "hash-live-v1",
      },
      action: request.action,
      domain: request.domain,
    });
    expect(readWorkspace).toHaveBeenNthCalledWith(1, "intent-live");
    expect(readWorkspace).toHaveBeenNthCalledWith(2, "intent-live");
  });

  it("fails closed when readiness never appears", async () => {
    const submitWorkflow = vi.fn().mockResolvedValue(notReady);
    const readWorkspace = vi.fn().mockResolvedValue(notReady);

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace },
      request,
      { delaysMs: [0, 0], wait: async () => undefined },
    );

    expect(result).toBe(notReady);
    expect(submitWorkflow).toHaveBeenCalledTimes(1);
  });

  it("rebinds to a newer authoritative tip after a stale state rejection", async () => {
    const stale = {
      ok: false,
      code: "GUARDIAN_VERDICT_STALE",
      message: "ActionProposal IntentState is not the current tip",
    } as const;
    const submitWorkflow = vi
      .fn<(_request: SdkWorkflowRequest) => Promise<Result<SdkWorkflowView>>>()
      .mockResolvedValueOnce(notReady)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ ok: true, value: workflow });
    const workspace = (stateId: string, stateHash: string) => ({
      ok: true,
      value: {
        summary: {
          intentId: "intent-live",
          rawIntent: "Book a governed trip.",
          principalId: "live-demo",
          createdAt: "2026-08-24T00:00:00.000Z",
          intentStateId: stateId,
          stateHash,
          historicalStateIds: [],
        },
      } as unknown as IntentWorkspaceView,
    } as const);
    const readWorkspace = vi
      .fn<(_id: string) => Promise<Result<IntentWorkspaceView>>>()
      .mockResolvedValueOnce(workspace("state-live-v1", "hash-live-v1"))
      .mockResolvedValueOnce(workspace("state-live-v2", "hash-live-v2"));

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace },
      request,
      { delaysMs: [0, 0], wait: async () => undefined },
    );

    expect(result).toEqual({ ok: true, value: workflow });
    expect(submitWorkflow).toHaveBeenCalledTimes(3);
    expect(submitWorkflow.mock.calls[2]![0]).toMatchObject({
      intent: {
        kind: "REFERENCE",
        expectedIntentStateId: "state-live-v2",
        expectedIntentStateHash: "hash-live-v2",
      },
      idempotencyKey: "idem-live:finalized:state-live-v2",
    });
  });

  it("does not retry terminal workflow errors", async () => {
    const denied = {
      ok: false,
      code: "AUTHORITY_BLOCKED",
      message: "blocked",
    } as const;
    const submitWorkflow = vi.fn().mockResolvedValue(denied);
    const readWorkspace = vi.fn();

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace },
      request,
    );

    expect(result).toBe(denied);
    expect(readWorkspace).not.toHaveBeenCalled();
  });
});
