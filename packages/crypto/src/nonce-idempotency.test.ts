import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "./idempotency.js";
import { NonceRegistry, generateNonce } from "./nonce.js";

describe("NonceRegistry", () => {
  it("accepts a fresh nonce and rejects replay", async () => {
    const registry = new NonceRegistry();
    const nonce = generateNonce();
    expect((await registry.register(nonce)).ok).toBe(true);
    const replay = await registry.register(nonce);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe(ErrorCode.NONCE_REPLAY);
    }
  });
});

describe("IdempotencyStore", () => {
  it("requires an idempotency key for economic writes", async () => {
    const store = new IdempotencyStore();
    const missing = store.requireKey("");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
    }
  });

  it("blocks blind retry of UNKNOWN", async () => {
    const store = new IdempotencyStore();
    const keyResult = store.requireKey("pay-1");
    expect(keyResult.ok).toBe(true);
    if (!keyResult.ok) return;
    await store.begin(keyResult.value, "2026-01-01T00:00:00.000Z");
    await store.markUnknown(keyResult.value, "2026-01-01T00:00:30.000Z");
    const retry = await store.attemptRetry(keyResult.value);
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.code).toBe(ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY);
    }
  });

  it("allows idempotent replay after SUCCESS", async () => {
    const store = new IdempotencyStore();
    const keyResult = store.requireKey("pay-2");
    if (!keyResult.ok) return;
    await store.begin(keyResult.value, "2026-01-01T00:00:00.000Z");
    await store.complete(keyResult.value, "SUCCESS", "2026-01-01T00:01:00.000Z", "txn-1");
    const replay = await store.attemptRetry(keyResult.value);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.state).toBe("SUCCESS");
    }
  });
});
