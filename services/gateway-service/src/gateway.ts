import { ErrorCode, err, type Result } from "@truemandate/protocol";

export interface MockPaymentResult {
  readonly status: "SUCCESS" | "FAILED" | "UNKNOWN" | "IDEMPOTENT_REPLAY";
  readonly resultRef?: string;
  readonly grantId: string;
}

/**
 * @deprecated Phase 7 hardening: MockGateway is no longer a privileged economic path.
 * Use {@link TwoPhaseGateway} prepare → authorize → commit exclusively for T2/T3.
 */
export class MockGateway {
  /**
   * Fail-closed: legacy single-shot T2 bypass is removed.
   * INV: no successful T2/T3 side effect without SideEffectRecord + CommitToken.
   */
  executeMockPayment(_raw: unknown): Result<MockPaymentResult> {
    return err(
      ErrorCode.TOOL_PRIVILEGE_DENIED,
      "MockGateway.executeMockPayment is deprecated; use TwoPhaseGateway prepare/authorize/commit",
    );
  }
}
