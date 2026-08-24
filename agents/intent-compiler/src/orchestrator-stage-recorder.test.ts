import { ProvenanceService } from "@truemandate/provenance-service";
import type { WorkflowStageEvent, WorkflowStageRecorder } from "@truemandate/observability";
import { describe, expect, it } from "vitest";
import { compileAndVerify } from "./orchestrator.js";
import { modelsFor, TestIntentOwner } from "./phase4.test.js";
import { cleanCompilerOutput, cleanVerifierOutput } from "./test-fixtures.js";

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

const RAW_TEXT = "Buy 500 food-grade containers under INR 800000";

describe("compileAndVerify workflow stage recording", () => {
  it("emits STARTED then COMPLETED for COMPILATION and VERIFICATION on a clean compile", async () => {
    const recorder = new RecordingStageRecorder();
    const intents = new TestIntentOwner();
    const provenance = new ProvenanceService();
    const { compilerModel, verifierModel } = modelsFor(cleanCompilerOutput, cleanVerifierOutput);

    const result = await compileAndVerify(
      { principalId: "principal-1", rawText: RAW_TEXT, intentId: "intent-stage-1", createdAt: "2026-06-01T12:00:00.000Z" },
      { intents, provenance, compilerModel, verifierModel, stageRecorder: recorder },
    );

    expect(result.ok).toBe(true);
    const stages = recorder.events.map((event) => `${event.stage}:${event.status}`);
    expect(stages).toEqual([
      "COMPILATION:STARTED",
      "COMPILATION:COMPLETED",
      "VERIFICATION:STARTED",
      "VERIFICATION:COMPLETED",
    ]);
    for (const event of recorder.events) {
      expect(event.intentId).toBe("intent-stage-1");
      if (event.status === "COMPLETED") {
        expect(event.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is fail-open: a throwing WorkflowStageRecorder never fails compileAndVerify", async () => {
    const intents = new TestIntentOwner();
    const provenance = new ProvenanceService();
    const { compilerModel, verifierModel } = modelsFor(cleanCompilerOutput, cleanVerifierOutput);

    const result = await compileAndVerify(
      { principalId: "principal-1", rawText: RAW_TEXT, intentId: "intent-stage-2", createdAt: "2026-06-01T12:00:00.000Z" },
      { intents, provenance, compilerModel, verifierModel, stageRecorder: new ThrowingStageRecorder() },
    );

    expect(result.ok).toBe(true);
  });
});
