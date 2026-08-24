import type { IdempotencyStorePort, NonceStore } from "@truemandate/crypto";
import {
  ErrorCode,
  err,
  ok,
  type AuthorityGrantId,
  type CommitToken,
  type IntentState,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import { assertBundleReadyForCommit } from "./bundle.js";
import {
  assertNotRevokedAtCommit,
  loadAndValidateGrantForExecution,
  validateCommitToken,
} from "./grant.js";
import type { GrantStore } from "./grant-store.js";
import {
  assertPreparedActionIntegrity,
  requirePreparedAction,
  revalidateExternalState,
  type CriticalExternalState,
} from "./prepared-action.js";

export interface CommitContext {
  readonly now: string;
  readonly currentIntentState: IntentState;
  readonly preparedAction: PreparedAction | null | undefined;
  readonly grantId: AuthorityGrantId | string;
  readonly grantStore: GrantStore;
  readonly commitToken: CommitToken;
  readonly externalState: CriticalExternalState;
  readonly materialKeys?: readonly string[];
  readonly idempotencyKey?: string;
  readonly idempotencyStore: IdempotencyStorePort;
  readonly nonceStore: NonceStore;
  readonly committedPreparedActionIds?: ReadonlySet<string>;
  readonly bundleConstraintSatisfied?: boolean;
}

/**
 * Deterministic commit gate composing INV_016–022, INV_024–025.
 */
export async function validateCommit(
  context: CommitContext,
): Promise<Result<{ readonly prepared: PreparedAction }>> {
  const preparedResult = requirePreparedAction(context.preparedAction);
  if (!preparedResult.ok) {
    return preparedResult;
  }
  const prepared = preparedResult.value;

  const integrity = assertPreparedActionIntegrity(prepared);
  if (!integrity.ok) return integrity;

  const grantResult = await loadAndValidateGrantForExecution(
    context.grantStore,
    context.grantId,
    {
      now: context.now,
      currentIntentState: context.currentIntentState,
      preparedAction: prepared,
    },
  );
  if (!grantResult.ok) {
    return grantResult;
  }
  const grant = grantResult.value;

  const revocation = assertNotRevokedAtCommit(grant);
  if (!revocation.ok) {
    return revocation;
  }

  const tokenResult = validateCommitToken(
    context.commitToken,
    context.now,
    prepared.preparedActionHash,
  );
  if (!tokenResult.ok) {
    return tokenResult;
  }

  const external = revalidateExternalState(
    prepared,
    context.externalState,
    context.materialKeys ?? undefined,
  );
  if (!external.ok) {
    return external;
  }

  const keyResult = context.idempotencyStore.requireKey(context.idempotencyKey);
  if (!keyResult.ok) {
    return keyResult;
  }
  const begin = await context.idempotencyStore.begin(keyResult.value, context.now);
  if (!begin.ok) {
    return begin;
  }

  const nonceResult = await context.nonceStore.register(grant.nonce);
  if (!nonceResult.ok) {
    return nonceResult;
  }

  const bundleResult = assertBundleReadyForCommit(
    prepared,
    context.committedPreparedActionIds ?? new Set(),
    context.bundleConstraintSatisfied ?? true,
  );
  if (!bundleResult.ok) {
    return bundleResult;
  }

  if (grant.decision === "BLOCK" || grant.decision === "REQUIRE_APPROVAL") {
    return err(
      ErrorCode.AUTHORITY_BLOCKED,
      "Grant decision does not allow commit",
      { decision: grant.decision },
    );
  }

  return ok({ prepared });
}
