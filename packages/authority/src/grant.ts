import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  GrantConsumptionState,
  asCommitTokenId,
  err,
  ok,
  type AuthorityGrant,
  type AuthorityGrantId,
  type CommitToken,
  type HashDigest,
  type IntentState,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import type { GrantStore } from "./grant-store.js";
import { assertCommitTokenIntegrity, commitTokenHash } from "./commit-token-integrity.js";

export function isGrantExpired(grant: AuthorityGrant, now: string): boolean {
  return Date.parse(now) > Date.parse(grant.expiresAt);
}

export interface GrantExecutionContext {
  readonly now: string;
  /** Live tip IntentState required for stale-state detection (INV_008). */
  readonly currentIntentState: IntentState;
  readonly preparedAction: PreparedAction;
}

/**
 * INV_006, INV_007, INV_008, INV_018, INV_025 — grant validity for execution/commit.
 * Requires the live IntentState tip; grants bound to earlier states fail closed.
 */
export function validateGrantForExecution(
  grant: AuthorityGrant,
  context: GrantExecutionContext,
): Result<void> {
  if (grant.consumptionState === GrantConsumptionState.REVOKED || grant.revokedAt) {
    return err(ErrorCode.GRANT_REVOKED, "Grant has been revoked", {
      grantId: grant.id,
    });
  }
  if (
    grant.consumptionState === GrantConsumptionState.PENDING_RECONCILIATION
  ) {
    return err(
      ErrorCode.RECONCILIATION_REQUIRED,
      "Grant locked pending UNKNOWN execution reconciliation",
      { grantId: grant.id },
    );
  }
  if (grant.consumptionState === GrantConsumptionState.CONSUMED || grant.consumedAt) {
    return err(ErrorCode.GRANT_CONSUMED, "Consumed grants cannot be replayed", {
      grantId: grant.id,
    });
  }
  if (
    grant.consumptionState === GrantConsumptionState.EXPIRED ||
    isGrantExpired(grant, context.now)
  ) {
    return err(ErrorCode.GRANT_EXPIRED, "Expired grants cannot execute actions", {
      grantId: grant.id,
      expiresAt: grant.expiresAt,
      now: context.now,
    });
  }

  const tip = context.currentIntentState;
  if (grant.intentStateId !== tip.id || grant.stateHash !== tip.stateHash) {
    return err(
      ErrorCode.GRANT_INTENT_STATE_MISMATCH,
      "Grant is bound to a stale IntentState; tip has advanced",
      {
        grantIntentStateId: grant.intentStateId,
        tipIntentStateId: tip.id,
        grantStateHash: grant.stateHash,
        tipStateHash: tip.stateHash,
      },
    );
  }

  if (grant.preparedActionId !== context.preparedAction.id) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Grant preparedActionId does not match PreparedAction",
    );
  }
  if (grant.preparedActionHash !== context.preparedAction.preparedActionHash) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Authority binds to exact PreparedAction hash",
      {
        grantHash: grant.preparedActionHash,
        preparedHash: context.preparedAction.preparedActionHash,
      },
    );
  }
  return ok();
}

/**
 * Reload grant from store at execution time so revocation is not trusted from caller snapshots.
 */
export async function loadAndValidateGrantForExecution(
  store: GrantStore,
  grantId: AuthorityGrantId | string,
  context: GrantExecutionContext,
): Promise<Result<AuthorityGrant>> {
  const loaded = await store.get(grantId);
  if (!loaded.ok) return loaded;
  const fresh = loaded.value;
  if (!fresh) {
    return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
  }
  const validated = validateGrantForExecution(fresh, context);
  if (!validated.ok) {
    return validated;
  }
  return ok(fresh);
}

export function bindGrantToIntentState(
  grant: AuthorityGrant,
  state: IntentState,
): Result<void> {
  if (grant.intentStateId !== state.id || grant.stateHash !== state.stateHash) {
    return err(
      ErrorCode.GRANT_INTENT_STATE_MISMATCH,
      "Authority is bound to one IntentState",
    );
  }
  return ok();
}

/**
 * INV_019: Commit tokens are single-use and expiring.
 */
export function validateCommitToken(
  token: CommitToken,
  now: string,
  preparedActionHash: HashDigest,
): Result<void> {
  const integrity = assertCommitTokenIntegrity(token);
  if (!integrity.ok) return integrity;
  if (token.consumed) {
    return err(ErrorCode.COMMIT_TOKEN_CONSUMED, "Commit token is single-use", {
      tokenId: token.id,
    });
  }
  if (Date.parse(now) > Date.parse(token.expiresAt)) {
    return err(ErrorCode.COMMIT_TOKEN_EXPIRED, "Commit token has expired", {
      tokenId: token.id,
      expiresAt: token.expiresAt,
      now,
    });
  }
  if (token.preparedActionHash !== preparedActionHash) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Commit token prepared-action hash mismatch",
    );
  }
  return ok();
}

export function issueCommitToken(input: {
  readonly id?: string;
  readonly grant: AuthorityGrant;
  readonly preparedAction: PreparedAction;
  readonly expiresAt: string;
  readonly createdAt: string;
}): Result<CommitToken> {
  if (input.grant.preparedActionHash !== input.preparedAction.preparedActionHash) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Cannot issue CommitToken for mismatched PreparedAction",
    );
  }
  if (
    input.grant.consumptionState === GrantConsumptionState.REVOKED ||
    input.grant.revokedAt
  ) {
    return err(ErrorCode.GRANT_REVOKED, "Cannot issue CommitToken for revoked grant");
  }
  const withoutHash = {
    id: asCommitTokenId(
      input.id ?? `ct-${hashCanonical(input.grant.id).slice(0, 12)}`,
    ),
    grantId: input.grant.id,
    preparedActionId: input.preparedAction.id,
    preparedActionHash: input.preparedAction.preparedActionHash,
    nonce: input.grant.nonce,
    expiresAt: input.expiresAt,
    consumed: false as const,
    createdAt: input.createdAt,
    intentStateHash: input.grant.stateHash,
    agentId: input.grant.agentId,
    capability: input.grant.capability,
  };
  const token: CommitToken = {
    ...withoutHash,
    tokenHash: commitTokenHash(withoutHash),
  };
  return ok(token);
}

export function consumeGrant(
  grant: AuthorityGrant,
  now: string,
): Result<AuthorityGrant> {
  if (grant.consumptionState === GrantConsumptionState.CONSUMED) {
    return err(ErrorCode.GRANT_CONSUMED, "Grant already consumed");
  }
  if (grant.consumptionState === GrantConsumptionState.REVOKED || grant.revokedAt) {
    return err(ErrorCode.GRANT_REVOKED, "Grant revoked");
  }
  if (
    grant.consumptionState === GrantConsumptionState.EXPIRED ||
    isGrantExpired(grant, now)
  ) {
    return err(ErrorCode.GRANT_EXPIRED, "Grant expired");
  }
  return ok({
    ...grant,
    consumptionState: GrantConsumptionState.CONSUMED,
    consumedAt: now,
  });
}

export function revokeGrant(grant: AuthorityGrant, now: string): AuthorityGrant {
  return {
    ...grant,
    consumptionState: GrantConsumptionState.REVOKED,
    revokedAt: now,
  };
}

/**
 * INV_025: Revocation must be checked at commit time against the store-fresh grant.
 */
export function assertNotRevokedAtCommit(grant: AuthorityGrant): Result<void> {
  if (grant.consumptionState === GrantConsumptionState.REVOKED || grant.revokedAt) {
    return err(ErrorCode.GRANT_REVOKED, "Revocation checked at commit: grant revoked", {
      grantId: grant.id,
    });
  }
  return ok();
}
