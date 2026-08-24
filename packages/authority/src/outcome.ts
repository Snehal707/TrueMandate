import {
  ErrorCode,
  OutcomeContractState,
  PaymentStatus,
  err,
  ok,
  type OutcomeContract,
  type Result,
} from "@truemandate/protocol";

/**
 * INV_009: Payment success cannot automatically mark Outcome Contract SATISFIED.
 */
export function applyPaymentSuccess(
  contract: OutcomeContract,
  now: string,
): Result<OutcomeContract> {
  if (contract.state === OutcomeContractState.SATISFIED) {
    return err(
      ErrorCode.PAYMENT_CANNOT_SATISFY_OUTCOME,
      "Outcome Contract cannot be SATISFIED by payment alone",
    );
  }
  const nextState =
    contract.state === OutcomeContractState.CREATED ||
    contract.state === OutcomeContractState.AWAITING_EXECUTION
      ? OutcomeContractState.AWAITING_OUTCOME
      : contract.state;

  return ok({
    ...contract,
    paymentStatus: PaymentStatus.SUCCESS,
    state: nextState,
    updatedAt: now,
  });
}

export function markOutcomeSatisfied(
  contract: OutcomeContract,
  now: string,
  verificationPassed: boolean,
): Result<OutcomeContract> {
  if (!verificationPassed) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Outcome Contract may only become SATISFIED after requirement verification",
    );
  }
  return ok({
    ...contract,
    state: OutcomeContractState.SATISFIED,
    updatedAt: now,
  });
}
