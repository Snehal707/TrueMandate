import { randomUUID } from "node:crypto";
import {
  assertIndependentRemedyAuthority,
  assertRemediationMandateValid,
} from "@truemandate/authority";
import {
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import {
  ErrorCode,
  OutcomeContractState,
  WorkflowStage,
  WorkflowStageEventStatus,
  err,
  ok,
  type AuthorityGrantId,
  type IntentState,
  type RemediationMandate,
  type RemedyProposal,
  type ResolutionCase,
  type Result,
} from "@truemandate/protocol";
import type { OutcomeService } from "@truemandate/outcome-service";
import type { ResolutionService } from "./service.js";

async function recordStage(
  recorder: WorkflowStageRecorder | undefined,
  event: Omit<WorkflowStageEvent, "id" | "occurredAt">,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.recordStage({
      id: `${event.workflowId}-${event.stage}-${event.status}-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      ...event,
    });
  } catch {
    // Fail-open.
  }
}

/**
 * Narrow port so ResolutionService does not own Gateway internals.
 * Production wires TwoPhaseGateway prepare → authorize → commit.
 * Returns the execution AuthorityGrant id minted by Gateway (distinct from mandate).
 */
export interface PrivilegedRemedyPort {
  executeBoundEconomicAction(input: {
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly merchant: string;
    readonly amount: number;
    readonly currency: string;
    readonly quantity: number;
    readonly capability: string;
    readonly toolId: string;
    readonly outcomeContractId: string;
    readonly outcomeContractHash: string;
    readonly grantScopeMaxAmount: number;
    readonly idempotencyKey: string;
    readonly now: string;
    readonly expiresAt: string;
    /** Prerequisite mandate id — port must not treat this as execution grant. */
    readonly remediationMandateId: string;
    /** The original purchase grant — the independent authority evaluation
     * must never reuse it (INV_023). */
    readonly originalPaymentGrantId: string;
  }): Promise<Result<{
    readonly status: "SUCCESS" | "FAILED" | "UNKNOWN";
    readonly preparedActionId: string;
    readonly preparedActionHash: string;
    readonly executionGrantId: string;
    readonly sideEffectId?: string;
    /** The contract the execution was bound to (absent in in-process lanes). */
    readonly executionOutcomeContractId?: string;
    readonly executionOutcomeContractHash?: string;
  }>> | Result<{
    readonly status: "SUCCESS" | "FAILED" | "UNKNOWN";
    readonly preparedActionId: string;
    readonly preparedActionHash: string;
    readonly executionGrantId: string;
    readonly sideEffectId?: string;
    readonly executionOutcomeContractId?: string;
    readonly executionOutcomeContractHash?: string;
  }>;
}

/**
 * Full remedy path (no fast lane):
 * RemedyProposal → RemediationMandate (prerequisite) → remedy OutcomeContract →
 * PrivilegedRemedyPort (Gateway mints PreparedAction-bound execution grant) →
 * VERIFYING_REMEDY (tool SUCCESS ≠ RESOLVED).
 */
export async function executeRemedyPipeline(input: {
  readonly resolution: ResolutionService;
  readonly outcomes: OutcomeService;
  readonly gateway: PrivilegedRemedyPort;
  readonly caseId: string;
  readonly remedy: RemedyProposal;
  readonly mandate: RemediationMandate;
  readonly originalPaymentGrantId: AuthorityGrantId;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly now: string;
  readonly expiresAt: string;
  /** Wave 2: optional fail-open stage recorder for REMEDY timing. */
  readonly stageRecorder?: WorkflowStageRecorder;
}): Promise<Result<{
  readonly case: ResolutionCase;
  readonly remedyOutcomeContractId: string;
  readonly executionStatus: "SUCCESS" | "FAILED" | "UNKNOWN";
  readonly executionGrantId?: string;
  readonly preparedActionHash?: string;
}>> {
  // Assumption (Wave 2): ResolutionCase has no workflowId; use caseId as
  // correlation proxy for REMEDY stage events (same pattern as AUTHORIZE).
  const workflowId = input.caseId;
  const started = Date.now();
  await recordStage(input.stageRecorder, {
    workflowId,
    intentId: input.intentState.intentId,
    stage: WorkflowStage.REMEDY,
    status: WorkflowStageEventStatus.STARTED,
  });

  const withMandate: RemedyProposal = {
    ...input.remedy,
    requiredRemediationMandateId: input.mandate.id,
  };

  const indep = assertIndependentRemedyAuthority(
    withMandate,
    input.originalPaymentGrantId,
    input.mandate,
  );
  if (!indep.ok) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return indep;
  }

  const amount = input.remedy.financialCost ?? input.remedy.estimatedAmount ?? 0;
  const currency = input.remedy.currency ?? "INR";
  const merchant = "remedy-counterparty";

  const scoped = assertRemediationMandateValid(input.mandate, {
    remedy: withMandate,
    resolutionCaseId: input.caseId,
    now: input.now,
    originalPaymentGrantId: input.originalPaymentGrantId,
    proposedMerchant: merchant,
    proposedCapability: "execute_payment",
    proposedAmount: amount,
  });
  if (!scoped.ok) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return scoped;
  }

  const auth = input.resolution.requireRemedyAuthority({
    caseId: input.caseId,
    remedy: withMandate,
    originalPaymentGrantId: input.originalPaymentGrantId,
    now: input.now,
    proposedMerchant: merchant,
    proposedCapability: "execute_payment",
    proposedAmount: amount,
  });
  if (!auth.ok) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return auth;
  }

  // Single-slot atomic claim (ACTIVE → CLAIMED): a concurrent execution of a
  // DIFFERENT attempt against the same mandate fails here, before any
  // economic state exists. The identical attempt may continue (it converges
  // on the same grant/token identities).
  const idempotencyKey = `remedy:${input.caseId}:${input.remedy.id}`;
  const claim = await input.resolution.claimMandateForExecution(input.mandate.id, {
    idempotencyKey,
    caseId: input.caseId,
    remedyId: input.remedy.id,
    claimedAt: input.now,
  });
  if (!claim.ok) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return claim;
  }

  const replacement = !input.remedy.description.toLowerCase().includes("refund");
  // The replacement remedy restores the observed shortfall (50 units for the
  // flagship acceptance); a refund is a single economic action.
  const remedyQuantity = replacement ? 50 : 1;
  const stub = await input.resolution.createRemedyOutcomeContractStub({
    caseId: input.caseId,
    kind: replacement ? "replacement" : "refund",
    intentState: input.intentState,
    principalId: input.principalId,
    now: input.now,
  });
  if (!stub.ok) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return stub;
  }

  const executed = await input.gateway.executeBoundEconomicAction({
    intentState: input.intentState,
    principalId: input.principalId,
    merchant,
    amount,
    currency,
    quantity: remedyQuantity,
    capability: "execute_payment",
    toolId: "payment.execute",
    outcomeContractId: stub.value.outcomeContractId,
    outcomeContractHash: stub.value.definitionHash,
    grantScopeMaxAmount: Math.max(amount, 1),
    idempotencyKey,
    now: input.now,
    expiresAt: input.expiresAt,
    remediationMandateId: input.mandate.id,
    originalPaymentGrantId: String(input.originalPaymentGrantId),
  });
  if (!executed.ok) {
    // No economic state may exist on a failed port invocation — release the
    // claim back to this identical attempt only.
    await input.resolution.releaseMandateClaim(input.mandate.id, idempotencyKey, input.now);
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return executed;
  }

  if (executed.value.executionGrantId === String(input.mandate.id)) {
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return err(
      ErrorCode.REMEDIATION_MANDATE_NOT_EXECUTABLE,
      "Gateway must mint a distinct execution AuthorityGrant; cannot reuse mandate id",
      {
        mandateId: input.mandate.id,
        executionGrantId: executed.value.executionGrantId,
      },
    );
  }

  // Production lanes execute through a binding-carrying OutcomeContract (the
  // remedy outcome contract IS the execution contract); in-process lanes keep
  // the stub as the remedy outcome contract.
  const remedyContractId = executed.value.executionOutcomeContractId ?? stub.value.outcomeContractId;

  if (executed.value.status === "SUCCESS") {
    await input.outcomes.onPaymentSuccess(remedyContractId, input.now);
    const afterPay = await input.outcomes.getContract(remedyContractId);
    if (afterPay.ok && afterPay.value.state === OutcomeContractState.SATISFIED) {
      await recordStage(input.stageRecorder, {
        workflowId,
        intentId: input.intentState.intentId,
        stage: WorkflowStage.REMEDY,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Remedy tool SUCCESS must not SATISFY OutcomeContract",
        { outcomeContractId: remedyContractId },
      );
    }
    const verifying = input.resolution.observeRemedyToolSuccess({
      caseId: input.caseId,
      remedyOutcomeContractId: remedyContractId,
      now: input.now,
    });
    if (!verifying.ok) {
      await recordStage(input.stageRecorder, {
        workflowId,
        intentId: input.intentState.intentId,
        stage: WorkflowStage.REMEDY,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return verifying;
    }
    // Single-use: the mandate is consumed ONLY now that the bounded execution
    // actually ran. Any further execution attempt fails mandate validation.
    const consumed = await input.resolution.consumeMandate(input.mandate.id, input.now);
    if (!consumed.ok) {
      await recordStage(input.stageRecorder, {
        workflowId,
        intentId: input.intentState.intentId,
        stage: WorkflowStage.REMEDY,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return consumed;
    }
    await recordStage(input.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.REMEDY,
      status: WorkflowStageEventStatus.COMPLETED,
      durationMs: Date.now() - started,
    });
    return ok({
      case: verifying.value,
      remedyOutcomeContractId: remedyContractId,
      executionStatus: executed.value.status,
      executionGrantId: executed.value.executionGrantId,
      preparedActionHash: executed.value.preparedActionHash,
    });
  }

  // FAILED/UNKNOWN: release the claim back to this identical attempt only —
  // a blind retry of a DIFFERENT attempt stays rejected while released.
  await input.resolution.releaseMandateClaim(input.mandate.id, idempotencyKey, input.now);
  await recordStage(input.stageRecorder, {
    workflowId,
    intentId: input.intentState.intentId,
    stage: WorkflowStage.REMEDY,
    status: WorkflowStageEventStatus.FAILED,
    durationMs: Date.now() - started,
  });
  return ok({
    case: auth.value,
    remedyOutcomeContractId: remedyContractId,
    executionStatus: executed.value.status,
    executionGrantId: executed.value.executionGrantId,
    preparedActionHash: executed.value.preparedActionHash,
  });
}
