import { describe, expect, it } from "vitest";
import { MemoryTransactionalStore } from "./document-store.js";
import { FirestoreModelConcurrencyLimiter } from "./model-concurrency-limiter.js";

describe("FirestoreModelConcurrencyLimiter", () => {
  it("enforces one shared ceiling across runtime instances", async () => {
    const store = new MemoryTransactionalStore();
    const first = new FirestoreModelConcurrencyLimiter(store, {
      limit: 12,
      ownerId: "instance-a",
      pollMs: 1,
    });
    const second = new FirestoreModelConcurrencyLimiter(store, {
      limit: 12,
      ownerId: "instance-b",
      pollMs: 1,
    });
    const initial = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? first : second).acquire({
        requestId: `initial-${index}`,
        schemaId: index % 2 ? "guardian" : "planner",
        deadlineAtMs: Date.now() + 2_000,
      })));
    expect(initial.every((result) => result.ok)).toBe(true);
    expect(new Set(initial.flatMap((result) => result.ok ? [result.value.slotId] : [])).size).toBe(12);

    let thirteenthSettled = false;
    const thirteenth = first.acquire({
      requestId: "thirteenth",
      schemaId: "verifier",
      deadlineAtMs: Date.now() + 2_000,
    }).then((result) => {
      thirteenthSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(thirteenthSettled).toBe(false);
    const released = initial[0];
    if (released?.ok) await released.value.release();
    const acquired = await thirteenth;
    expect(acquired.ok).toBe(true);
    await Promise.all(initial.slice(1).map((result) => result.ok ? result.value.release() : undefined));
    if (acquired.ok) await acquired.value.release();
  });

  it("recovers an expired lease without allowing an ownership-mismatched release", async () => {
    const store = new MemoryTransactionalStore();
    let now = Date.now();
    const first = new FirestoreModelConcurrencyLimiter(store, {
      limit: 1,
      ownerId: "instance-a",
      leaseMs: 10,
      pollMs: 1,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    });
    const second = new FirestoreModelConcurrencyLimiter(store, {
      limit: 1,
      ownerId: "instance-b",
      leaseMs: 10,
      pollMs: 1,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    });
    const abandoned = await first.acquire({ requestId: "abandoned", schemaId: "compiler", deadlineAtMs: now + 100 });
    expect(abandoned.ok).toBe(true);
    now += 11;
    const recovered = await second.acquire({ requestId: "recovered", schemaId: "compiler", deadlineAtMs: now + 100 });
    expect(recovered.ok).toBe(true);
    if (abandoned.ok) await abandoned.value.release();
    const current = await store.listCollection("modelConcurrencySlots");
    expect(current).toHaveLength(1);
    if (recovered.ok) await recovered.value.release();
  });
});
