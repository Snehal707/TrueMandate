import type { CloudEventEnvelope } from "@truemandate/cloud-pubsub";
import type { ModelSecurityPort } from "@truemandate/cloud-security";
import {
  compileAndVerify,
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
  return compileAndVerify(
    {
      principalId: payload.principalId,
      rawText: payload.rawText,
      intentId: typeof payload.intentId === "string" ? payload.intentId : undefined,
      taint: payload.taint,
    },
    deps,
  );
}
