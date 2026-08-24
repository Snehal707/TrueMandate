import {
  ErrorCode,
  ExecutionState,
  asIdempotencyKey,
  err,
  ok,
  type IdempotencyKey,
  type Nonce,
  type Result,
} from "@truemandate/protocol";
import type {
  IdempotencyRecord,
  IdempotencyStorePort,
  NonceStore,
} from "@truemandate/crypto";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

export class FirestoreNonceStore implements NonceStore {
  constructor(private readonly store: DocumentStore) {}

  async register(nonce: Nonce): Promise<Result<void>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.nonces, nonce);
      if (await tx.get(path)) {
        return err(ErrorCode.NONCE_REPLAY, "Nonce has already been used", {
          nonce,
        });
      }
      await tx.set(path, { nonce, usedAt: new Date().toISOString() });
      return ok();
    });
  }

  async has(nonce: Nonce): Promise<boolean> {
    return (await this.store.get(docPath(COLLECTIONS.nonces, nonce))) !== undefined;
  }
}

export class FirestoreIdempotencyStore implements IdempotencyStorePort {
  constructor(private readonly store: DocumentStore) {}

  requireKey(key: string | undefined | null): Result<IdempotencyKey> {
    if (key === undefined || key === null || key.trim() === "") {
      return err(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        "Economic writes require an idempotency key",
      );
    }
    return ok(asIdempotencyKey(key));
  }

  async get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined> {
    return this.store.get(docPath(COLLECTIONS.idempotency, key));
  }

  async begin(
    key: IdempotencyKey,
    now: string,
  ): Promise<Result<IdempotencyRecord>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.idempotency, key);
      const existing = await tx.get<IdempotencyRecord>(path);
      if (existing) {
        if (existing.state === ExecutionState.UNKNOWN) {
          return err(
            ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY,
            "UNKNOWN execution state cannot be blindly retried",
            { key },
          );
        }
        if (existing.state === ExecutionState.SUCCESS) {
          return ok(existing);
        }
        if (existing.state === ExecutionState.FAILED) {
          const record: IdempotencyRecord = {
            key,
            state: ExecutionState.PENDING,
            updatedAt: now,
          };
          await tx.set(path, record);
          return ok(record);
        }
        return ok(existing);
      }
      const record: IdempotencyRecord = {
        key,
        state: ExecutionState.PENDING,
        updatedAt: now,
      };
      await tx.set(path, record);
      return ok(record);
    });
  }

  async complete(
    key: IdempotencyKey,
    state: typeof ExecutionState.SUCCESS | typeof ExecutionState.FAILED,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.idempotency, key);
      const existing = await tx.get<IdempotencyRecord>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown idempotency key", {
          key,
        });
      }
      const record: IdempotencyRecord = {
        key,
        state,
        resultRef,
        updatedAt: now,
      };
      await tx.set(path, record);
      return ok(record);
    });
  }

  async markUnknown(
    key: IdempotencyKey,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.idempotency, key);
      const existing = await tx.get<IdempotencyRecord>(path);
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown idempotency key", {
          key,
        });
      }
      const record: IdempotencyRecord = {
        key,
        state: ExecutionState.UNKNOWN,
        resultRef,
        updatedAt: now,
      };
      await tx.set(path, record);
      return ok(record);
    });
  }

  async attemptRetry(key: IdempotencyKey): Promise<Result<IdempotencyRecord>> {
    const existing = await this.get(key);
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "No prior execution for key", {
        key,
      });
    }
    if (existing.state === ExecutionState.UNKNOWN) {
      return err(
        ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY,
        "UNKNOWN execution state cannot be blindly retried; reconcile first",
        { key },
      );
    }
    return ok(existing);
  }
}
