import {
  ErrorCode,
  GrantConsumptionState,
  err,
  ok,
  type AuthorityGrant,
  type AuthorityGrantId,
  type Result,
} from "@truemandate/protocol";
import type { GrantStore } from "@truemandate/authority";
import { isGrantExpired, parseAuthorityGrant, revokeGrant } from "@truemandate/authority";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

/** Durable GrantStore — transactional consume (INV_010 / INV_018). */
export class FirestoreGrantStore implements GrantStore {
  constructor(private readonly store: DocumentStore) {}

  async get(grantId: AuthorityGrantId | string): Promise<Result<AuthorityGrant | undefined>> {
    const value = await this.store.get(docPath(COLLECTIONS.grants, String(grantId)));
    return value === undefined ? ok(undefined) : parseAuthorityGrant(value);
  }

  async put(grant: AuthorityGrant): Promise<Result<AuthorityGrant>> {
    const parsed = parseAuthorityGrant(grant);
    if (!parsed.ok) return parsed;
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.grants, grant.id);
      const existing = await tx.get<AuthorityGrant>(path);
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
      await tx.set(path, grant);
      return ok(grant);
    });
  }

  async revoke(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.grants, String(grantId));
      const existing = await tx.get<AuthorityGrant>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
      }
      const parsedExisting = parseAuthorityGrant(existing);
      if (!parsedExisting.ok) return parsedExisting;
      const trusted = parsedExisting.value;
      if (trusted.consumptionState === GrantConsumptionState.REVOKED) {
        return ok(trusted);
      }
      const revoked = revokeGrant(trusted, now);
      await tx.set(path, revoked);
      return ok(revoked);
    });
  }

  async consume(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.grants, String(grantId));
      const existing = await tx.get<AuthorityGrant>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
      }
      const parsedExisting = parseAuthorityGrant(existing);
      if (!parsedExisting.ok) return parsedExisting;
      const trusted = parsedExisting.value;
      if (
        trusted.consumptionState === GrantConsumptionState.REVOKED ||
        trusted.revokedAt
      ) {
        return err(ErrorCode.GRANT_REVOKED, "Grant has been revoked", { grantId });
      }
      if (
        trusted.consumptionState === GrantConsumptionState.CONSUMED ||
        trusted.consumedAt
      ) {
        return err(ErrorCode.GRANT_CONSUMED, "Grant already consumed", { grantId });
      }
      if (
        trusted.consumptionState === GrantConsumptionState.EXPIRED ||
        isGrantExpired(trusted, now)
      ) {
        return err(ErrorCode.GRANT_EXPIRED, "Grant expired", { grantId });
      }
      const consumed: AuthorityGrant = {
        ...trusted,
        consumptionState: GrantConsumptionState.CONSUMED,
        consumedAt: now,
      };
      await tx.set(path, consumed);
      return ok(consumed);
    });
  }

  async markPendingReconciliation(
    grantId: AuthorityGrantId | string,
    now: string,
  ): Promise<Result<AuthorityGrant>> {
    void now;
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.grants, String(grantId));
      const existing = await tx.get<AuthorityGrant>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", { grantId });
      }
      const parsedExisting = parseAuthorityGrant(existing);
      if (!parsedExisting.ok) return parsedExisting;
      const trusted = parsedExisting.value;
      if (trusted.consumptionState === GrantConsumptionState.REVOKED) {
        return err(ErrorCode.GRANT_REVOKED, "Grant has been revoked", { grantId });
      }
      if (trusted.consumptionState === GrantConsumptionState.CONSUMED) {
        return err(ErrorCode.GRANT_CONSUMED, "Grant already consumed", { grantId });
      }
      const locked: AuthorityGrant = {
        ...trusted,
        consumptionState: GrantConsumptionState.PENDING_RECONCILIATION,
      };
      await tx.set(path, locked);
      return ok(locked);
    });
  }
}
