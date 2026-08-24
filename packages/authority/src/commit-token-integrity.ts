import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  asHashDigest,
  err,
  ok,
  type CommitToken,
  type HashDigest,
  type Result,
} from "@truemandate/protocol";

/** Immutable CommitToken issuance/binding payload. Consumption is deliberately mutable. */
export function commitTokenHash(token: Omit<CommitToken, "tokenHash"> | CommitToken): HashDigest {
  return asHashDigest(
    hashCanonical({
      id: token.id,
      grantId: token.grantId,
      preparedActionId: token.preparedActionId,
      preparedActionHash: token.preparedActionHash,
      nonce: token.nonce,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
      intentStateHash: token.intentStateHash,
      agentId: token.agentId,
      capability: token.capability,
    }),
  );
}

export function assertCommitTokenIntegrity(token: CommitToken): Result<void> {
  const expected = commitTokenHash(token);
  if (token.tokenHash !== expected) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "CommitToken immutable binding hash mismatch",
      { tokenId: token.id, expected, actual: token.tokenHash },
    );
  }
  return ok();
}
