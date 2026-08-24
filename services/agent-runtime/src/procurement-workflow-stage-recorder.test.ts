import { describe, expect, it } from "vitest";
import type { WorkflowStageEvent, WorkflowStageRecorder } from "@truemandate/observability";
import { request, runtime } from "./generic-workflow.e2e.test.js";

class RecordingStageRecorder implements WorkflowStageRecorder {
  readonly events: WorkflowStageEvent[] = [];
  async recordStage(event: WorkflowStageEvent): Promise<void> {
    this.events.push(event);
  }
}

class ThrowingStageRecorder implements WorkflowStageRecorder {
  async recordStage(): Promise<void> {
    throw new Error("telemetry backend unavailable");
  }
}

describe("GenericWorkflowEngine GUARDIAN stage recording", () => {
  it("emits GUARDIAN STARTED then COMPLETED when the action proposal clears Guardian", async () => {
    const recorder = new RecordingStageRecorder();
    const r = await runtime({ stageRecorder: recorder });

    const result = await r.coordinator.run({
      ...request(),
      expectedIntentStateId: r.state.id,
    });

    expect(result.ok).toBe(true);
    const guardianEvents = recorder.events.filter((event) => event.stage === "GUARDIAN");
    expect(guardianEvents.map((event) => event.status)).toEqual(["STARTED", "COMPLETED"]);
    expect(guardianEvents[1]?.durationMs).toBeGreaterThanOrEqual(0);
    for (const event of guardianEvents) {
      expect(event.intentId).toBe("intent-e2e");
    }
  });

  it("is fail-open: a throwing WorkflowStageRecorder never fails the workflow", async () => {
    const r = await runtime({ stageRecorder: new ThrowingStageRecorder() });
    const result = await r.coordinator.run({
      ...request(),
      expectedIntentStateId: r.state.id,
    });
    expect(result.ok).toBe(true);
  });
});
