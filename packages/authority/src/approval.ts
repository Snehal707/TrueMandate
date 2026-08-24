import { hashCanonical } from "@truemandate/crypto";
import {
  ApprovalDecision,
  ErrorCode,
  asHashDigest,
  err,
  ok,
  type ApprovalArtifact,
  type PreparedAction,
  type PrincipalId,
  type Result,
} from "@truemandate/protocol";

export function createApprovalArtifact(input: {
  readonly id: string;
  readonly principalId: PrincipalId | string;
  readonly preparedAction: PreparedAction;
  readonly decision: ApprovalDecision;
  readonly createdAt: string;
}): ApprovalArtifact {
  const preparedActionHash = input.preparedAction.preparedActionHash;
  const withoutHash = {
    id: input.id,
    principalId: input.principalId as PrincipalId,
    preparedActionHash,
    decision: input.decision,
    createdAt: input.createdAt,
    amount: input.preparedAction.parameters.amount,
    currency: input.preparedAction.parameters.currency,
    merchant: input.preparedAction.parameters.merchant,
  };
  return {
    ...withoutHash,
    artifactHash: asHashDigest(hashCanonical(withoutHash)),
  };
}

export function validateApprovalForPreparedAction(
  artifact: ApprovalArtifact,
  prepared: PreparedAction,
  principalId: string,
): Result<void> {
  if (artifact.decision === ApprovalDecision.DENY) {
    return err(ErrorCode.APPROVAL_DENIED, "Approval artifact denies action");
  }
  if (artifact.principalId !== principalId) {
    return err(ErrorCode.APPROVAL_MISMATCH, "Approval principal mismatch");
  }
  if (artifact.preparedActionHash !== prepared.preparedActionHash) {
    return err(
      ErrorCode.APPROVAL_MISMATCH,
      "Approval does not bind to this PreparedAction hash",
      {
        approvalHash: artifact.preparedActionHash,
        preparedHash: prepared.preparedActionHash,
      },
    );
  }
  if (
    artifact.amount !== undefined &&
    prepared.parameters.amount !== undefined &&
    artifact.amount !== prepared.parameters.amount
  ) {
    return err(
      ErrorCode.APPROVAL_MISMATCH,
      "Approval amount does not match PreparedAction",
    );
  }
  if (
    artifact.merchant !== undefined &&
    prepared.parameters.merchant !== undefined &&
    artifact.merchant !== prepared.parameters.merchant
  ) {
    return err(
      ErrorCode.APPROVAL_MISMATCH,
      "Approval merchant does not match PreparedAction",
    );
  }
  return ok();
}
