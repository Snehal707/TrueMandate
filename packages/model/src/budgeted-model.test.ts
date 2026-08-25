import { ErrorCode, err, ok } from "@truemandate/protocol";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createBudgetedModelPort } from "./budgeted-model.js";
import type { ModelPort } from "./types.js";

const request = {
  modelId: "fake",
  promptVersion: "v1",
  schemaId: "safe-schema",
  schemaVersion: "1",
  schema: z.object({ ok: z.boolean() }),
  systemInstruction: "private-system-instruction",
  userPayload: { credential: "private-payload" },
  requestId: "budget-request",
};

describe("budgeted model port", () => {
  it("retries a retryable structured failure within the same stage budget", async () => {
    let calls = 0;
    const base: ModelPort = {
      async generateStructured(input) {
        calls += 1;
        if (calls === 1) return err(ErrorCode.MODEL_OUTPUT_INVALID, "invalid", { retryable: true });
        return ok({ value: { ok: true }, modelId: input.modelId, promptVersion: input.promptVersion, schemaId: input.schemaId, schemaVersion: input.schemaVersion, protocolVersion: "0.1.0", requestId: input.requestId, latencyMs: 1, timestamp: "2026-01-01T00:00:00.000Z" }) as never;
      },
    };
    const model = createBudgetedModelPort(base, { deadlineAtMs: Date.now() + 1000, stageBudgetMs: 1000, attemptTimeoutMs: 400, maxAttempts: 2 });
    const result = await model.generateStructured(request);
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("fails closed instead of starting another attempt after budget exhaustion", async () => {
    let clock = 0;
    let calls = 0;
    const base: ModelPort = {
      async generateStructured() {
        calls += 1;
        clock = 101;
        return err(ErrorCode.MODEL_UNAVAILABLE, "timeout", { retryable: true });
      },
    };
    const model = createBudgetedModelPort(base, { deadlineAtMs: 100, stageBudgetMs: 100, attemptTimeoutMs: 50, maxAttempts: 2, now: () => clock });
    const result = await model.generateStructured(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.reason).toBe("MODEL_DEADLINE_EXCEEDED");
    expect(calls).toBe(1);
  });

  it("logs only safe correlation and budget metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const base: ModelPort = {
      async generateStructured(input) {
        return err(ErrorCode.MODEL_UNAVAILABLE, "provider unavailable", { requestId: input.requestId });
      },
    };
    const model = createBudgetedModelPort(base, { deadlineAtMs: Date.now() + 1000, stageBudgetMs: 1000, attemptTimeoutMs: 400, maxAttempts: 1 });
    await model.generateStructured(request);
    const logs = info.mock.calls.flat().join("\n");
    expect(logs).toContain("budget-request");
    expect(logs).not.toContain("private-system-instruction");
    expect(logs).not.toContain("private-payload");
  });
});
