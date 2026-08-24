import {
  ErrorCode,
  GrantConsumptionState,
  err,
  ok,
  type AuthorityGrant,
  type AuthorityGrantId,
  type Result,
} from "@truemandate/protocol";
import { isGrantExpired, revokeGrant } from "./grant.js";
import { parseAuthorityGrant } from "./durable-read.js";

/**
 * Persistence port for authority grants.
 * In-memory impl is NOT multi-instance safe — see docs/architecture/persistence.md.
 */
export interface GrantStore {
  get(grantId: AuthorityGrantId | string): Promise<Result<AuthorityGrant | undefined>>;
  put(grant: AuthorityGrant): Promise<Result<AuthorityGrant>>;
  revoke(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>>;
  consume(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>>;
  markPendingReconciliation(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>>;
}

export class InMemoryGrantStore implements GrantStore {
  private readonly grants = new Map<string, AuthorityGrant>();

  async get(grantId: AuthorityGrantId | string): Promise<Result<AuthorityGrant | undefined>> {
    const value = this.grants.get(String(grantId));
    return value === undefined ? ok(undefined) : parseAuthorityGrant(value);
  }

  async put(grant: AuthorityGrant): Promise<Result<AuthorityGrant>> {
    const parsed = parseAuthorityGrant(grant);
    if (!parsed.ok) return parsed;
    const existing = this.grants.get(grant.id);
    if (existing) {
      const parsedExisting = parseAuthorityGrant(existing);
      if (!parsedExisting.ok) return parsedExisting;
      if (existing.preparedActionHash !== grant.preparedActionHash) {
        return err(
          ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
          "Grant id already exists with a divergent PreparedAction hash",
          { grantId: grant.id },
        );
      }
      return ok(parsedExisting.value);
    }
    this.grants.set(grant.id, grant);
    return ok(grant);
  }

  async revoke(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    const loaded = await this.get(grantId);
    if (!loaded.ok) return loaded;
    const existing = loaded.value;
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
    }
    if (existing.consumptionState === GrantConsumptionState.REVOKED) {
      return ok(existing);
    }
    const revoked = revokeGrant(existing, now);
    this.grants.set(revoked.id, revoked);
    return ok(revoked);
  }

  async consume(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    const loaded = await this.get(grantId);
    if (!loaded.ok) return loaded;
    const existing = loaded.value;
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
    }
    if (existing.consumptionState === GrantConsumptionState.REVOKED || existing.revokedAt) {
      return err(ErrorCode.GRANT_REVOKED, "Grant has been revoked", { grantId });
    }
    if (existing.consumptionState === GrantConsumptionState.CONSUMED || existing.consumedAt) {
      return err(ErrorCode.GRANT_CONSUMED, "Grant already consumed", { grantId });
    }
    if (
      existing.consumptionState === GrantConsumptionState.EXPIRED ||
      isGrantExpired(existing, now)
    ) {
      return err(ErrorCode.GRANT_EXPIRED, "Grant expired", { grantId });
    }
    const consumed: AuthorityGrant = {
      ...existing,
      consumptionState: GrantConsumptionState.CONSUMED,
      consumedAt: now,
    };
    this.grants.set(consumed.id, consumed);
    return ok(consumed);
  }

  async markPendingReconciliation(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    const loaded = await this.get(grantId);
    if (!loaded.ok) return loaded;
    const existing = loaded.value;
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
    }
    if (existing.consumptionState === GrantConsumptionState.REVOKED) {
      return err(ErrorCode.GRANT_REVOKED, "Grant has been revoked", { grantId });
    }
    if (existing.consumptionState === GrantConsumptionState.CONSUMED) {
      return err(ErrorCode.GRANT_CONSUMED, "Grant already consumed", { grantId });
    }
    const locked: AuthorityGrant = {
      ...existing,
      consumptionState: GrantConsumptionState.PENDING_RECONCILIATION,
    };
    void now;
    this.grants.set(locked.id, locked);
    return ok(locked);
  }

  clear(): void {
    this.grants.clear();
  }
}
