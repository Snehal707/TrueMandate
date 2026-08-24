import { ErrorCode, err } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { AuthoritativeIntentService } from "./authoritative-intent-service.js";

function ownerWithTip(tip: ReturnType<typeof err>) {
  return { getTip: async () => tip };
}

describe("AuthoritativeIntentService readiness", () => {
  it("maps only an absent owner tip to retryable readiness", async () => {
    const service = new AuthoritativeIntentService(ownerWithTip(err(
      ErrorCode.VALIDATION_FAILED,
      "unknown intent",
      { status: 404, retryable: false },
    )) as never);
    const result = await service.getCurrentStateForIntent("intent-a");
    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.INTENT_STATE_NOT_READY,
      details: { status: 404, retryable: true },
    });
  });

  it("preserves non-404 owner failures without converting them to readiness", async () => {
    const failure = err(ErrorCode.VALIDATION_FAILED, "caller denied", { status: 403, retryable: false });
    const service = new AuthoritativeIntentService(ownerWithTip(failure) as never);
    expect(await service.getCurrentStateForIntent("intent-a")).toEqual(failure);
  });
});
