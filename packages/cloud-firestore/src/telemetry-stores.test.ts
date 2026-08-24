import { describe, expect, it, vi } from "vitest";
import type { ModelCallTelemetryEvent, WorkflowStageEvent } from "@truemandate/protocol";
import { MemoryTransactionalStore } from "./document-store.js";
import { FirestoreModelTelemetryStore, FirestoreWorkflowStageStore } from "./telemetry-stores.js";

function modelEvent(overrides: Partial<ModelCallTelemetryEvent> = {}): ModelCallTelemetryEvent {
  return {
    id: `call-${Math.random()}`,
    service: "agent-runtime",
    operation: "generateStructured",
    modelId: "gemini-3.7-flash",
    status: "SUCCESS",
    latencyMs: 250,
    requestId: `req-${Math.random()}`,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function stageEvent(overrides: Partial<WorkflowStageEvent> = {}): WorkflowStageEvent {
  return {
    id: `stage-${Math.random()}`,
    workflowId: "workflow-1",
    stage: "COMPILATION",
    status: "STARTED",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FirestoreModelTelemetryStore", () => {
  it("writes and reads back a model call telemetry event", async () => {
    const store = new FirestoreModelTelemetryStore(new MemoryTransactionalStore());
    const event = modelEvent({ id: "call-1" });
    await store.record(event);
    expect(await store.get("call-1")).toEqual(event);
  });

  it("is fail-open: does not throw for a schema-invalid event, and just logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new FirestoreModelTelemetryStore(new MemoryTransactionalStore());
    const invalidEvent = { id: "call-bad" } as unknown as ModelCallTelemetryEvent;
    await expect(store.record(invalidEvent)).resolves.toBeUndefined();
    expect(await store.get("call-bad")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("is fail-open: does not throw when the underlying store write rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingStore = new MemoryTransactionalStore();
    throwingStore.set = async () => {
      throw new Error("simulated firestore outage");
    };
    const store = new FirestoreModelTelemetryStore(throwingStore);
    await expect(store.record(modelEvent())).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("FirestoreWorkflowStageStore", () => {
  it("records stage events and lists them by workflowId via the secondary index", async () => {
    const store = new FirestoreWorkflowStageStore(new MemoryTransactionalStore());
    const started = stageEvent({ id: "stage-1", workflowId: "wf-1", stage: "COMPILATION", status: "STARTED" });
    const completed = stageEvent({ id: "stage-2", workflowId: "wf-1", stage: "COMPILATION", status: "COMPLETED" });
    const otherWorkflow = stageEvent({ id: "stage-3", workflowId: "wf-2", stage: "VERIFICATION", status: "STARTED" });

    await store.recordStage(started);
    await store.recordStage(completed);
    await store.recordStage(otherWorkflow);

    const wf1Stages = await store.listStages("wf-1");
    expect(wf1Stages.map((s) => s.id).sort()).toEqual(["stage-1", "stage-2"]);

    const wf2Stages = await store.listStages("wf-2");
    expect(wf2Stages.map((s) => s.id)).toEqual(["stage-3"]);
  });

  it("does not duplicate an event id recorded twice (idempotent index)", async () => {
    const store = new FirestoreWorkflowStageStore(new MemoryTransactionalStore());
    const event = stageEvent({ id: "stage-dup", workflowId: "wf-dup" });
    await store.recordStage(event);
    await store.recordStage(event);
    const stages = await store.listStages("wf-dup");
    expect(stages).toHaveLength(1);
  });

  it("returns an empty list for an unknown workflowId", async () => {
    const store = new FirestoreWorkflowStageStore(new MemoryTransactionalStore());
    expect(await store.listStages("unknown-workflow")).toEqual([]);
  });

  it("is fail-open: does not throw for a schema-invalid event, and just logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new FirestoreWorkflowStageStore(new MemoryTransactionalStore());
    const invalidEvent = { id: "stage-bad", workflowId: "wf-bad" } as unknown as WorkflowStageEvent;
    await expect(store.recordStage(invalidEvent)).resolves.toBeUndefined();
    expect(await store.listStages("wf-bad")).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
