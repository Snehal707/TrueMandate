import {
  ErrorCode,
  OutcomeContractState,
  PaymentStatus,
  err,
  ok,
  type OutcomeContract,
  type Result,
} from "@truemandate/protocol";
import { assertTransitionAllowed } from "./transitions.js";

/**
 * INV_009: Payment success cannot SATISFY an Outcome Contract.
 * SUCCESS → at most AWAITING_EXECUTION → AWAITING_OUTCOME.
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

  let nextState = contract.state;
  if (
    contract.state === OutcomeContractState.CREATED ||
    contract.state === OutcomeContractState.AWAITING_EXECUTION
  ) {
    nextState = OutcomeContractState.AWAITING_OUTCOME;
    if (contract.state === OutcomeContractState.CREATED) {
      const step1 = assertTransitionAllowed(
        OutcomeContractState.CREATED,
        OutcomeContractState.AWAITING_EXECUTION,
      );
      if (!step1.ok) return step1;
      const step2 = assertTransitionAllowed(
        OutcomeContractState.AWAITING_EXECUTION,
        OutcomeContractState.AWAITING_OUTCOME,
      );
      if (!step2.ok) return step2;
    } else {
      const step = assertTransitionAllowed(
        OutcomeContractState.AWAITING_EXECUTION,
        OutcomeContractState.AWAITING_OUTCOME,
      );
      if (!step.ok) return step;
    }
  }

  return ok({
    ...contract,
    paymentStatus: PaymentStatus.SUCCESS,
    state: nextState,
    updatedAt: now,
    executionBegunAt: contract.executionBegunAt ?? now,
  });
}

/** UNKNOWN execution: stay AWAITING_EXECUTION; never AWAITING_OUTCOME/SATISFIED. */
export function applyPaymentUnknown(
  contract: OutcomeContract,
  now: string,
): Result<OutcomeContract> {
  if (contract.state === OutcomeContractState.SATISFIED) {
    return err(
      ErrorCode.PAYMENT_CANNOT_SATISFY_OUTCOME,
      "UNKNOWN payment cannot satisfy outcome",
    );
  }
  let state = contract.state;
  if (contract.state === OutcomeContractState.CREATED) {
    const gate = assertTransitionAllowed(
      OutcomeContractState.CREATED,
      OutcomeContractState.AWAITING_EXECUTION,
    );
    if (!gate.ok) return gate;
    state = OutcomeContractState.AWAITING_EXECUTION;
  }
  return ok({
    ...contract,
    paymentStatus: PaymentStatus.UNKNOWN,
    state,
    updatedAt: now,
  });
}

export function applyPaymentFailed(
  contract: OutcomeContract,
  now: string,
): Result<OutcomeContract> {
  return ok({
    ...contract,
    paymentStatus: PaymentStatus.FAILED,
    // Remain AWAITING_EXECUTION / CANCELLED path — not fulfillment BREACHED
    state:
      contract.state === OutcomeContractState.CREATED
        ? OutcomeContractState.CANCELLED
        : contract.state,
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
  const gate = assertTransitionAllowed(contract.state, OutcomeContractState.SATISFIED);
  if (!gate.ok) return gate;
  return ok({
    ...contract,
    state: OutcomeContractState.SATISFIED,
    updatedAt: now,
  });
}
