import { describe, expect, it, vi } from "vitest";
import type { WorkflowStageEvent } from "@truemandate/protocol";
import {
  failOpenWorkflowStageRecorder,
  type WorkflowStageRecorder,
} from "./workflow-stage.js";

const EVENT: WorkflowStageEvent = {
  id: "stage-evt-1",
  workflowId: "wf-1",
  stage: "COMPILATION",
  status: "STARTED",
  occurredAt: new Date().toISOString(),
};

describe("failOpenWorkflowStageRecorder", () => {
  it("does not throw when the wrapped recorder's recordStage() rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingRecorder: WorkflowStageRecorder = {
      recordStage: async () => {
        throw new Error("firestore unavailable");
      },
    };
    const wrapped = failOpenWorkflowStageRecorder(throwingRecorder, "agent-runtime");
    await expect(wrapped.recordStage(EVENT)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("delegates to the wrapped recorder on success", async () => {
    const recordStage = vi.fn().mockResolvedValue(undefined);
    const wrapped = failOpenWorkflowStageRecorder({ recordStage }, "agent-runtime");
    await wrapped.recordStage(EVENT);
    expect(recordStage).toHaveBeenCalledWith(EVENT);
  });
});
