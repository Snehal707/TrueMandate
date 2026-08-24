import {
  ErrorCode,
  err,
  ok,
  type CommitToken,
  type CommitTokenId,
  type Result,
} from "@truemandate/protocol";
import type { CommitTokenStore } from "@truemandate/authority";
import { parseCommitToken } from "@truemandate/authority";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

export class FirestoreCommitTokenStore implements CommitTokenStore {
  constructor(private readonly store: DocumentStore) {}

  async put(token: CommitToken): Promise<Result<CommitToken>> {
    const parsed = parseCommitToken(token);
    if (!parsed.ok) return parsed;
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.commitTokens, token.id);
      const existing = await tx.get<CommitToken>(path);
      if (existing) {
        const parsedExisting = parseCommitToken(existing);
        if (!parsedExisting.ok) return parsedExisting;
        if (existing.preparedActionHash !== token.preparedActionHash) {
          return err(
            ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
            "CommitToken id already exists with a divergent PreparedAction hash",
            { tokenId: token.id },
          );
        }
        return ok(parsedExisting.value);
      }
      await tx.set(path, token);
      return ok(token);
    });
  }

  async get(id: CommitTokenId | string): Promise<Result<CommitToken | undefined>> {
    const value = await this.store.get(docPath(COLLECTIONS.commitTokens, String(id)));
    return value === undefined ? ok(undefined) : parseCommitToken(value);
  }

  async consume(
    id: CommitTokenId | string,
    now: string,
  ): Promise<Result<CommitToken>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.commitTokens, String(id));
      const existing = await tx.get<CommitToken>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown CommitToken", { id });
      }
      const parsedExisting = parseCommitToken(existing);
      if (!parsedExisting.ok) return parsedExisting;
      const trusted = parsedExisting.value;
      if (trusted.consumed) {
        return err(ErrorCode.COMMIT_TOKEN_CONSUMED, "Commit token is single-use", {
          tokenId: trusted.id,
        });
      }
      if (Date.parse(now) > Date.parse(trusted.expiresAt)) {
        return err(ErrorCode.COMMIT_TOKEN_EXPIRED, "Commit token has expired", {
          tokenId: trusted.id,
        });
      }
      const consumed: CommitToken = { ...trusted, consumed: true };
      await tx.set(path, consumed);
      return ok(consumed);
    });
  }
}
