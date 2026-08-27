import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SubmissionProgressPanel } from "./LiveDemoPage";
import {
  submitFreshWorkflowWhenReady,
  type FreshWorkflowProgress,
} from "./freshWorkflowSubmission";

/**
 * Creating a workflow takes minutes of real model-backed work. The progress
 * panel exists so that wait reads as work rather than as a hang -- but it must
 * report only what this client has done, never what the backend has reached.
 */

const ok = <T,>(value: T) => ({ ok: true as const, value });
const err = (code: string) => ({ ok: false as const, code, message: code });

const workspace = (intentStateId?: string, stateHash?: string) =>
  ok({ summary: { intentId: "intent-1", intentStateId, stateHash } });

/** SSR splits adjacent text nodes with `<!-- -->`; strip it so assertions read the text. */
function render(progress: FreshWorkflowProgress, elapsedSeconds = 0): string {
  return renderToString(
    <SubmissionProgressPanel progress={progress} elapsedSeconds={elapsedSeconds} />,
  ).replaceAll("<!-- -->", "");
}

describe("submission progress reports client facts only", () => {
  it("shows the recording step first, with later steps still waiting", () => {
    const html = render({ phase: "recording-intent" });
    expect(html).toContain("Recording the intent");
    expect(html).toContain("tm-submitting-step active");
    expect(html).toContain("tm-submitting-step waiting");
    expect(html).not.toContain("tm-submitting-step done");
  });

  it("marks earlier steps done once the client has moved past them", () => {
    const html = render({ phase: "submitting-workflow", intentStateId: "state-abc" });
    // Two done (recording, awaiting), one active (submitting), none waiting.
    expect(html.match(/tm-submitting-step done/g)).toHaveLength(2);
    expect(html.match(/tm-submitting-step active/g)).toHaveLength(1);
    expect(html).not.toContain("tm-submitting-step waiting");
    expect(html).toContain("state-abc");
  });

  it("reports the client's own poll count, singular and plural", () => {
    expect(render({ phase: "awaiting-intent-state", polls: 1 })).toContain("Checked 1 time");
    const many = render({ phase: "awaiting-intent-state", polls: 12 });
    expect(many).toContain("Checked 12");
    expect(many).toContain("times");
  });

  it("formats elapsed time as minutes and seconds", () => {
    expect(render({ phase: "recording-intent" }, 7)).toContain("0:07 elapsed");
    expect(render({ phase: "recording-intent" }, 103)).toContain("1:43 elapsed");
    expect(render({ phase: "recording-intent" }, 600)).toContain("10:00 elapsed");
  });

  it("never claims the backend reached a governance stage", () => {
    for (const progress of [
      { phase: "recording-intent" } as const,
      { phase: "awaiting-intent-state", polls: 4 } as const,
      { phase: "submitting-workflow", intentStateId: "state-abc" } as const,
    ]) {
      const html = render(progress);
      // No stage the backend alone can report.
      for (const claim of ["Guardian", "Authorized", "AUTHORIZED", "Executed", "Approved"]) {
        expect(html, `${progress.phase} must not claim ${claim}`).not.toContain(claim);
      }
      // And it stays explicit that this is live, not replayed.
      expect(html).toContain("Nothing here is simulated or replayed.");
    }
  });
});

describe("progress is reported from the real submission flow", () => {
  it("emits recording -> awaiting -> submitting across the two legs", async () => {
    const seen: FreshWorkflowProgress[] = [];
    const submitWorkflow = vi
      .fn()
      .mockResolvedValueOnce(err("INTENT_STATE_NOT_READY"))
      .mockResolvedValueOnce(ok({ workflowId: "wf-1", state: "BLOCKED" }));
    const readWorkspace = vi
      .fn()
      .mockResolvedValueOnce(workspace(undefined, undefined))
      .mockResolvedValueOnce(workspace("state-abc", "hash-abc"));

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace } as never,
      {
        workflowId: "wf-0",
        idempotencyKey: "idem-1",
        intent: { kind: "RAW", id: "intent-1", principalId: "p", rawText: "do the thing" },
      } as never,
      { delaysMs: [0, 0], wait: async () => {}, onProgress: (p) => seen.push(p) },
    );

    expect(result.ok).toBe(true);
    expect(seen.map((p) => p.phase)).toEqual([
      "recording-intent",
      "awaiting-intent-state",
      "awaiting-intent-state",
      "submitting-workflow",
    ]);
    expect(seen[1]).toMatchObject({ polls: 1 });
    expect(seen[2]).toMatchObject({ polls: 2 });
    expect(seen[3]).toMatchObject({ intentStateId: "state-abc" });
  });

  it("reports nothing beyond the first leg when the first submission succeeds", async () => {
    const seen: FreshWorkflowProgress[] = [];
    const submitWorkflow = vi.fn().mockResolvedValue(ok({ workflowId: "wf-1", state: "BLOCKED" }));

    await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace: vi.fn() } as never,
      {
        workflowId: "wf-0",
        idempotencyKey: "idem-1",
        intent: { kind: "RAW", id: "intent-1", principalId: "p", rawText: "do the thing" },
      } as never,
      { onProgress: (p) => seen.push(p) },
    );

    expect(seen.map((p) => p.phase)).toEqual(["recording-intent"]);
  });

  it("a throwing progress observer never breaks the submission", async () => {
    const submitWorkflow = vi
      .fn()
      .mockResolvedValueOnce(err("INTENT_STATE_NOT_READY"))
      .mockResolvedValueOnce(ok({ workflowId: "wf-1", state: "BLOCKED" }));
    const readWorkspace = vi.fn().mockResolvedValue(workspace("state-abc", "hash-abc"));

    const result = await submitFreshWorkflowWhenReady(
      { submitWorkflow, readWorkspace } as never,
      {
        workflowId: "wf-0",
        idempotencyKey: "idem-1",
        intent: { kind: "RAW", id: "intent-1", principalId: "p", rawText: "x" },
      } as never,
      {
        delaysMs: [0],
        wait: async () => {},
        onProgress: () => {
          throw new Error("observer blew up");
        },
      },
    );

    // Both legs still ran and the governed result came back intact.
    expect(result).toEqual(ok({ workflowId: "wf-1", state: "BLOCKED" }));
    expect(submitWorkflow).toHaveBeenCalledTimes(2);
  });
});
