import {
  ErrorCode,
  RemediationMandateStatus,
  asRemediationMandateId,
  err,
  ok,
  type AuthorityGrant,
  type AuthorityGrantId,
  type PreparedAction,
  type PrincipalId,
  type RemediationMandate,
  type RemediationMandateId,
  type RemedyProposal,
  type RemedyProposalId,
  type ResolutionCaseId,
  type Result,
} from "@truemandate/protocol";

export interface IssueRemediationMandateInput {
  readonly id?: string;
  readonly resolutionCaseId: ResolutionCaseId;
  readonly remedyProposalId: RemedyProposalId;
  readonly principalId: PrincipalId | string;
  readonly maxAmount: number;
  readonly currency: string;
  readonly allowedCapabilities: readonly string[];
  readonly allowedMerchants: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
}

/**
 * Issue a remediation scope mandate — prerequisite only, not executable.
 */
export function issueRemediationMandate(
  input: IssueRemediationMandateInput,
): RemediationMandate {
  return {
    id: asRemediationMandateId(input.id ?? `mandate-${input.remedyProposalId}`),
    resolutionCaseId: input.resolutionCaseId,
    remedyProposalId: input.remedyProposalId,
    principalId: input.principalId as PrincipalId,
    maxAmount: input.maxAmount,
    currency: input.currency,
    allowedCapabilities: [...input.allowedCapabilities],
    allowedMerchants: [...input.allowedMerchants],
    expiresAt: input.expiresAt,
    status: RemediationMandateStatus.ACTIVE,
    createdAt: input.createdAt,
  };
}

/**
 * INV_010 / INV_023: financial remedies require an independent RemediationMandate,
 * never the original purchase AuthorityGrant id.
 */
export function assertIndependentRemedyAuthority(
  remedy: RemedyProposal,
  originalPaymentGrantId: AuthorityGrantId,
  mandate?: RemediationMandate | null,
): Result<void> {
  if (!remedy.requiresFinancialAction) {
    return ok();
  }
  if (!remedy.requiredRemediationMandateId) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_REQUIRED,
      "Financial resolution actions require a RemediationMandate (not an execution grant)",
      { remedyId: remedy.id },
    );
  }
  // Mandate id must never be confused with the original payment grant
  if (String(remedy.requiredRemediationMandateId) === String(originalPaymentGrantId)) {
    return err(
      ErrorCode.COMPENSATION_REQUIRES_INDEPENDENT_AUTHORITY,
      "RemediationMandate cannot reuse the original payment grant identity",
      {
        remedyId: remedy.id,
        originalPaymentGrantId,
      },
    );
  }
  if (mandate) {
    return assertRemediationMandateValid(mandate, {
      remedy,
      resolutionCaseId: remedy.resolutionCaseId,
      now: remedy.createdAt,
      originalPaymentGrantId,
    });
  }
  return ok();
}

export interface MandateValidationContext {
  readonly remedy: RemedyProposal;
  readonly resolutionCaseId: ResolutionCaseId | string;
  readonly now: string;
  readonly originalPaymentGrantId?: AuthorityGrantId;
  readonly proposedMerchant?: string;
  readonly proposedCapability?: string;
  readonly proposedAmount?: number;
}

/**
 * Validate mandate as remediation prerequisite. Never authorizes PreparedAction execution.
 */
export function assertRemediationMandateValid(
  mandate: RemediationMandate,
  ctx: MandateValidationContext,
): Result<void> {
  if (mandate.resolutionCaseId !== ctx.resolutionCaseId) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_CASE_MISMATCH,
      "RemediationMandate cannot be reused across unrelated ResolutionCases",
      {
        mandateCaseId: mandate.resolutionCaseId,
        requestedCaseId: ctx.resolutionCaseId,
      },
    );
  }
  if (mandate.remedyProposalId !== ctx.remedy.id) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_STALE,
      "RemediationMandate is bound to a different remedy proposal",
      {
        mandateRemedyId: mandate.remedyProposalId,
        remedyId: ctx.remedy.id,
      },
    );
  }
  if (
    ctx.remedy.requiredRemediationMandateId &&
    mandate.id !== ctx.remedy.requiredRemediationMandateId
  ) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_INVALID,
      "Remedy references a different mandate id",
      {
        remedyMandateId: ctx.remedy.requiredRemediationMandateId,
        mandateId: mandate.id,
      },
    );
  }
  if (mandate.status === RemediationMandateStatus.REVOKED) {
    return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "RemediationMandate revoked", {
      mandateId: mandate.id,
    });
  }
  if (mandate.status === RemediationMandateStatus.CONSUMED) {
    return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "RemediationMandate already consumed", {
      mandateId: mandate.id,
    });
  }
  if (
    mandate.status === RemediationMandateStatus.EXPIRED ||
    Date.parse(ctx.now) > Date.parse(mandate.expiresAt)
  ) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_STALE,
      "Stale RemediationMandate cannot authorize a newer remedy",
      { mandateId: mandate.id, expiresAt: mandate.expiresAt, now: ctx.now },
    );
  }
  if (ctx.originalPaymentGrantId && String(mandate.id) === String(ctx.originalPaymentGrantId)) {
    return err(
      ErrorCode.COMPENSATION_REQUIRES_INDEPENDENT_AUTHORITY,
      "RemediationMandate id collides with original payment grant",
    );
  }

  const amount =
    ctx.proposedAmount ??
    ctx.remedy.financialCost ??
    ctx.remedy.estimatedAmount ??
    0;
  if (amount > mandate.maxAmount) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_SCOPE,
      "Remedy amount exceeds RemediationMandate maxAmount",
      { amount, maxAmount: mandate.maxAmount },
    );
  }
  if (ctx.remedy.currency && ctx.remedy.currency !== mandate.currency) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_SCOPE,
      "Remedy currency outside RemediationMandate scope",
      { remedyCurrency: ctx.remedy.currency, mandateCurrency: mandate.currency },
    );
  }
  const capability =
    ctx.proposedCapability ??
    ctx.remedy.requiredCapabilities?.[0] ??
    "execute_payment";
  if (
    mandate.allowedCapabilities.length > 0 &&
    !mandate.allowedCapabilities.includes(capability)
  ) {
    return err(
      ErrorCode.REMEDIATION_MANDATE_SCOPE,
      "Capability outside RemediationMandate scope",
      { capability, allowed: mandate.allowedCapabilities },
    );
  }
  if (ctx.proposedMerchant && mandate.allowedMerchants.length > 0) {
    if (!mandate.allowedMerchants.includes(ctx.proposedMerchant)) {
      return err(
        ErrorCode.REMEDIATION_MANDATE_SCOPE,
        "Merchant outside RemediationMandate scope",
        { merchant: ctx.proposedMerchant, allowed: mandate.allowedMerchants },
      );
    }
  }
  return ok();
}

/**
 * A RemediationMandate must never be treated as an execution AuthorityGrant.
 */
export function assertMandateCannotExecutePreparedAction(
  mandate: RemediationMandate,
  prepared: PreparedAction,
): Result<void> {
  void prepared;
  return err(
    ErrorCode.REMEDIATION_MANDATE_NOT_EXECUTABLE,
    "RemediationMandate is a scope prerequisite only; execution requires PreparedAction-bound AuthorityGrant",
    {
      mandateId: mandate.id,
      preparedActionId: prepared.id,
      preparedActionHash: prepared.preparedActionHash,
    },
  );
}

/**
 * Execution grant must bind exact PreparedAction hash (INV_018).
 */
export function assertExecutionGrantBoundToPreparedAction(
  grant: AuthorityGrant,
  prepared: PreparedAction,
): Result<void> {
  if (grant.preparedActionId !== prepared.id) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Execution grant preparedActionId does not match PreparedAction",
      { grantPreparedId: grant.preparedActionId, preparedId: prepared.id },
    );
  }
  if (grant.preparedActionHash !== prepared.preparedActionHash) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Execution grant must bind exact remedy PreparedAction hash",
      {
        grantHash: grant.preparedActionHash,
        preparedHash: prepared.preparedActionHash,
      },
    );
  }
  return ok();
}

export function markMandateConsumed(
  mandate: RemediationMandate,
  now: string,
): RemediationMandate {
  return {
    ...mandate,
    status: RemediationMandateStatus.CONSUMED,
    consumedAt: now,
  };
}

export function markMandateExpired(mandate: RemediationMandate): RemediationMandate {
  return { ...mandate, status: RemediationMandateStatus.EXPIRED };
}

export type { RemediationMandateId };
