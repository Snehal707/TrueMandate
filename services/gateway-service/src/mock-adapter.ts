import {
  ExecutionState,
  type PreparedAction,
  type Result,
  err,
  ok,
  ErrorCode,
} from "@truemandate/protocol";

export type MockAdapterMode =
  | "success"
  | "fail_before_side_effect"
  | "success_response_lost"
  | "timeout_unknown"
  | "malformed";

export interface MockAdapterRequest {
  readonly preparedAction: PreparedAction;
  readonly idempotencyKey: string;
  readonly mode?: MockAdapterMode;
}

export interface MockAdapterResult {
  readonly state: typeof ExecutionState.SUCCESS | typeof ExecutionState.FAILED | typeof ExecutionState.UNKNOWN;
  readonly externalReference?: string;
  readonly sideEffectOccurred: boolean;
}

/**
 * Deterministic mock procurement/payment adapter for Phase 7.
 * No real money movement.
 */
export class MockPaymentAdapter {
  invoke(request: MockAdapterRequest): Result<MockAdapterResult> {
    const mode = request.mode ?? "success";
    switch (mode) {
      case "fail_before_side_effect":
        return ok({
          state: ExecutionState.FAILED,
          sideEffectOccurred: false,
        });
      case "success_response_lost":
      case "timeout_unknown":
        return ok({
          state: ExecutionState.UNKNOWN,
          externalReference: `lost-${request.idempotencyKey}`,
          sideEffectOccurred: true,
        });
      case "malformed":
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Malformed external adapter result",
        );
      case "success":
      default:
        return ok({
          state: ExecutionState.SUCCESS,
          externalReference: `mock-pay-${request.idempotencyKey}`,
          sideEffectOccurred: true,
        });
    }
  }
}
