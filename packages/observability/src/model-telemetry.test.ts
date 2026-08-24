import { describe, expect, it, vi } from "vitest";
import type { ModelCallTelemetryEvent } from "@truemandate/protocol";
import {
  failOpenModelTelemetry,
  InMemoryModelTelemetryCollector,
  type ModelTelemetryPort,
} from "./model-telemetry.js";

const EVENT: ModelCallTelemetryEvent = {
  id: "evt-1",
  service: "agent-runtime",
  operation: "generateStructured",
  modelId: "gemini-3.7-flash",
  status: "SUCCESS",
  latencyMs: 120,
  requestId: "req-1",
  timestamp: new Date().toISOString(),
};

describe("failOpenModelTelemetry", () => {
  it("does not throw when the wrapped port's record() rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingPort: ModelTelemetryPort = {
      record: async () => {
        throw new Error("firestore unavailable");
      },
    };
    const wrapped = failOpenModelTelemetry(throwingPort, "agent-runtime");
    await expect(wrapped.record(EVENT)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("delegates to the wrapped port on success", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const wrapped = failOpenModelTelemetry({ record }, "agent-runtime");
    await wrapped.record(EVENT);
    expect(record).toHaveBeenCalledWith(EVENT);
  });
});

describe("InMemoryModelTelemetryCollector", () => {
  it("accumulates events in memory without any durable side effect", async () => {
    const collector = new InMemoryModelTelemetryCollector();
    await collector.record(EVENT);
    await collector.record({ ...EVENT, id: "evt-2", status: "MODEL_UNAVAILABLE" });

    expect(collector.count).toBe(2);
    expect(collector.getEvents()).toEqual([
      EVENT,
      { ...EVENT, id: "evt-2", status: "MODEL_UNAVAILABLE" },
    ]);
    expect(collector.summary()).toEqual({
      total: 2,
      byStatus: { SUCCESS: 1, MODEL_UNAVAILABLE: 1 },
    });
  });
});
