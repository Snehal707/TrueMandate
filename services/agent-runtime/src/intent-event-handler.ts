import type { CloudEventEnvelope } from "@truemandate/cloud-pubsub";
import type { ModelSecurityPort } from "@truemandate/cloud-security";
import {
  compileAndVerify,
  isTerminalIntentFinalizationFailure,
  type CompileAndVerifyDeps,
} from "@truemandate/intent-compiler";
import { ErrorCode, err, type Result } from "@truemandate/protocol";

export interface IntentCompileEventDeps extends CompileAndVerifyDeps {
  readonly modelSecurity: ModelSecurityPort;
}

/**
 * Pub/Sub handler for intent.events. Inspects compileAndVerify Result so
 * owner S2S / model failures are not ACK'd as success. Model Armor is
 * required: BLOCKED is a durable 2xx rejection; UNAVAILABLE is 5xx.
 */
export async function handleIntentCompileEvent(
  envelope: CloudEventEnvelope,
  deps: IntentCompileEventDeps,
): Promise<Result<unknown>> {
  const payload = envelope.payload as Record<string, unknown>;
  if (typeof payload.rawText !== "string" || typeof payload.principalId !== "string") {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Intent event missing rawText or principalId",
    );
  }
  const deadlineAtMs = Date.now() + 170_000;
  const result = await compileAndVerify(
    {
      principalId: payload.principalId,
      rawText: payload.rawText,
      intentId: typeof payload.intentId === "string" ? payload.intentId : undefined,
      taint: payload.taint,
      // Present only when IntentService.createIntent was called with a
      // domain context (RAW workflow submissions forward
      // request.domain.packId — see workflow-dispatcher.ts). Absent for the
      // standalone POST /v1/intents route, which stays free-form.
      packId: typeof payload.packId === "string" ? payload.packId : undefined,
    },
    {
      ...deps,
      modelBudget: {
        deadlineAtMs,
        compilationMs: 80_000,
        verificationMs: 70_000,
        maxAttempts: 2,
      },
    },
  );
  if (isTerminalIntentFinalizationFailure(result)) {
    return {
      ok: true,
      value: {
        status: "REJECTED",
        reason: "TERMINAL_SEMANTIC_FAILURE",
        intentId: typeof payload.intentId === "string" ? payload.intentId : undefined,
        errorCode: result.ok ? undefined : result.code,
      },
    };
  }
  return result;
}
