import { describe, expect, it } from "vitest";
import type { WorkflowStageEvent, WorkflowStageRecorder } from "@truemandate/observability";
import { executePrivilegedPayment, makeRuntime } from "./integration/harness.js";

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

describe("TwoPhaseGateway workflow stage recording", () => {
  it("emits STARTED then COMPLETED for PREPARE, AUTHORIZE, and COMMIT on a successful payment", async () => {
    const recorder = new RecordingStageRecorder();
    const rt = await makeRuntime({ stageRecorder: recorder });

    const commit = await executePrivilegedPayment(rt);
    expect(commit.ok).toBe(true);

    const stages = recorder.events.map((event) => `${event.stage}:${event.status}`);
    expect(stages).toEqual([
      "PREPARE:STARTED",
      "PREPARE:COMPLETED",
      "AUTHORIZE:STARTED",
      "AUTHORIZE:COMPLETED",
      "COMMIT:STARTED",
      "COMMIT:COMPLETED",
    ]);

    for (const event of recorder.events) {
      expect(event.id).toBeTruthy();
      expect(event.occurredAt).toBeTruthy();
      if (event.status === "COMPLETED") {
        expect(event.durationMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("emits a FAILED PREPARE event when prepare is rejected", async () => {
    const recorder = new RecordingStageRecorder();
    const rt = await makeRuntime({ stageRecorder: recorder });

    const badPrepare = await rt.gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "no-such-tool",
      agentCapabilities: rt.parentScope.capabilities,
      externalState: {
        merchant: "approved-a",
        product: "fg-container",
        quantity: 500,
        amount: 700000,
        currency: "INR",
        refundability: true,
        sku: "FG-500",
      },
      idempotencyKey: "pay-bad-tool",
      expiresAt: "2026-12-01T12:00:00.000Z",
      createdAt: "2026-06-01T12:00:00.000Z",
    });

    expect(badPrepare.ok).toBe(false);
    expect(recorder.events.map((event) => `${event.stage}:${event.status}`)).toEqual([
      "PREPARE:STARTED",
      "PREPARE:FAILED",
    ]);
  });

  it("is fail-open: a throwing WorkflowStageRecorder never fails the payment flow", async () => {
    const rt = await makeRuntime({ stageRecorder: new ThrowingStageRecorder() });
    const commit = await executePrivilegedPayment(rt);
    expect(commit.ok).toBe(true);
  });
});
