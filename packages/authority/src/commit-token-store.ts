import {
  ErrorCode,
  err,
  ok,
  type CommitToken,
  type CommitTokenId,
  type Result,
} from "@truemandate/protocol";
import { parseCommitToken } from "./durable-read.js";

/**
 * Single-use CommitToken store. consume() must be atomic (compare-and-set).
 * In-memory: single-process only — persistent TX required for multi-instance.
 * See docs/archive/phase-7-stop-report.md.
 */
export interface CommitTokenStore {
  put(token: CommitToken): Promise<Result<CommitToken>>;
  get(id: CommitTokenId | string): Promise<Result<CommitToken | undefined>>;
  /** Atomically mark consumed; fails if already consumed/missing. */
  consume(id: CommitTokenId | string, now: string): Promise<Result<CommitToken>>;
}

export class InMemoryCommitTokenStore implements CommitTokenStore {
  private readonly tokens = new Map<string, CommitToken>();

  async put(token: CommitToken): Promise<Result<CommitToken>> {
    const parsed = parseCommitToken(token);
    if (!parsed.ok) return parsed;
    const existing = this.tokens.get(token.id);
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
    this.tokens.set(token.id, token);
    return ok(token);
  }

  async get(id: CommitTokenId | string): Promise<Result<CommitToken | undefined>> {
    const value = this.tokens.get(String(id));
    return value === undefined ? ok(undefined) : parseCommitToken(value);
  }

  async consume(
    id: CommitTokenId | string,
    now: string,
  ): Promise<Result<CommitToken>> {
    const loaded = await this.get(id);
    if (!loaded.ok) return loaded;
    const existing = loaded.value;
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown CommitToken", { id });
    }
    if (existing.consumed) {
      return err(ErrorCode.COMMIT_TOKEN_CONSUMED, "Commit token is single-use", {
        tokenId: existing.id,
      });
    }
    if (Date.parse(now) > Date.parse(existing.expiresAt)) {
      return err(ErrorCode.COMMIT_TOKEN_EXPIRED, "Commit token has expired", {
        tokenId: existing.id,
      });
    }
    const consumed: CommitToken = { ...existing, consumed: true };
    this.tokens.set(consumed.id, consumed);
    return ok(consumed);
  }

  clear(): void {
    this.tokens.clear();
  }
}
