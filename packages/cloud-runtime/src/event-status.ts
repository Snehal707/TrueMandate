import { ErrorCode, type Result } from "@truemandate/protocol";

/**
 * Maps a bus/handler Result to Pub/Sub ACK HTTP status.
 *
 * 2xx — valid terminal domain outcome (including deterministic BLOCK) or duplicate.
 * 4xx — malformed / permanently invalid / out-of-order aggregate version.
 * 5xx — owner S2S transient failure, Vertex/Armor unavailable, model output invalid, Firestore, unexpected throw.
 */
export function eventHttpStatus(result: Result<unknown>): number {
  if (result.ok) return 200;

  const details = result.details ?? {};
  const status = typeof details.status === "number" ? details.status : undefined;

  if (details.retryable === true) return 503;
  if (result.code === ErrorCode.MODEL_UNAVAILABLE) return 503;
  if (result.code === ErrorCode.MODEL_OUTPUT_INVALID) return 503;
  if (result.code === ErrorCode.GUARDIAN_JUDGE_UNAVAILABLE) return 503;
  if (status === 429 || (status !== undefined && status >= 500)) return 503;

  if (details.unexpected === true) return 500;

  if (status !== undefined && status >= 400 && status < 500) return 400;

  if (result.code === ErrorCode.VALIDATION_FAILED) {
    return 400;
  }

  // SCHEMA_PARSE_FAILED retained for external/envelope parse paths only.
  if (result.code === ErrorCode.SCHEMA_PARSE_FAILED) {
    return 400;
  }

  return 500;
}
