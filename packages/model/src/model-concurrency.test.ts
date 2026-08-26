import { ErrorCode, err, ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  FifoModelConcurrencyLimiter,
  modelConcurrencyLimitFromEnv,
  type ModelConcurrencyEvent,
  type ModelAttemptPermit,
  type ModelAttemptPermitRequest,
} from "./model-concurrency.js";

const request = (id: string, schemaId = "planner"): ModelAttemptPermitRequest => ({
  requestId: id,
  schemaId,
  deadlineAtMs: Date.now() + 5_000,
});

describe("FifoModelConcurrencyLimiter", () => {
  it("defaults to 12 and rejects invalid startup configuration", () => {
    expect(modelConcurrencyLimitFromEnv({})).toBe(12);
    expect(modelConcurrencyLimitFromEnv({ TM_VERTEX_MODEL_CONCURRENCY: "7" })).toBe(7);
    expect(() => modelConcurrencyLimitFromEnv({ TM_VERTEX_MODEL_CONCURRENCY: "0" })).toThrow();
    expect(() => modelConcurrencyLimitFromEnv({ TM_VERTEX_MODEL_CONCURRENCY: "many" })).toThrow();
  });

  it("admits local work in FIFO order", async () => {
    const acquired: string[] = [];
    const limiter = new FifoModelConcurrencyLimiter(2, async (input) => {
      acquired.push(input.requestId);
      return ok<ModelAttemptPermit>({
        leaseId: input.requestId,
        slotId: input.requestId,
        queueWaitMs: 0,
        release: async () => undefined,
      });
    });
    const permits = await Promise.all([
      limiter.acquire(request("one")),
      limiter.acquire(request("two")),
      limiter.acquire(request("three")),
    ]);
    expect(acquired).toEqual(["one", "two", "three"]);
    await Promise.all(permits.map((permit) => permit.ok ? permit.value.release() : undefined));
  });

  it("emits bounded queue, active, wait, and per-stage state transitions", async () => {
    const events: ModelConcurrencyEvent[] = [];
    const limiter = new FifoModelConcurrencyLimiter(
      12,
      async (input) => ok<ModelAttemptPermit>({
        leaseId: input.requestId,
        slotId: "slot-00",
        queueWaitMs: 7,
        release: async () => undefined,
      }),
      { record: (event) => { events.push(event); } },
    );
    const acquired = await limiter.acquire(request("observed", "judge.fidelity.v1"));
    expect(acquired.ok).toBe(true);
    if (acquired.ok) await acquired.value.release();
    expect(events.map((event) => event.outcome)).toEqual([
      "ENQUEUED",
      "ACQUIRED",
      "RELEASED",
    ]);
    expect(events[1]).toMatchObject({
      active: 1,
      queued: 0,
      stageActive: 1,
      queueWaitMs: 7,
      maxQueueDepth: 1,
    });
    expect(events[2]).toMatchObject({ active: 0, stageActive: 0 });
  });

  it("fails closed when distributed storage is unavailable", async () => {
    const limiter = new FifoModelConcurrencyLimiter(12, async () =>
      err(ErrorCode.MODEL_UNAVAILABLE, "store failed", {
        reason: "MODEL_BACKPRESSURE_UNAVAILABLE",
      }));
    const result = await limiter.acquire(request("unavailable"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.reason).toBe("MODEL_BACKPRESSURE_UNAVAILABLE");
  });

  it("does not acquire work whose deadline expired in the queue", async () => {
    let calls = 0;
    const limiter = new FifoModelConcurrencyLimiter(12, async () => {
      calls += 1;
      return err(ErrorCode.MODEL_UNAVAILABLE, "unexpected");
    });
    const result = await limiter.acquire({
      requestId: "expired",
      schemaId: "guardian",
      deadlineAtMs: Date.now() - 1,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});
