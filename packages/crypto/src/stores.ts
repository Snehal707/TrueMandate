import {
  ErrorCode,
  ExecutionState,
  asIdempotencyKey,
  err,
  ok,
  type ExecutionState as ExecutionStateType,
  type IdempotencyKey,
  type Nonce,
  type Result,
} from "@truemandate/protocol";

/**
 * Persistence port for nonce replay protection.
 * In-memory impls are NOT multi-instance safe — see docs/architecture/persistence.md.
 */
export interface NonceStore {
  register(nonce: Nonce): Promise<Result<void>>;
  has(nonce: Nonce): Promise<boolean>;
}

export interface IdempotencyRecord {
  readonly key: IdempotencyKey;
  readonly state: ExecutionStateType;
  readonly resultRef?: string;
  readonly updatedAt: string;
}

/**
 * Persistence port for economic-write idempotency (INV_021, INV_022).
 */
export interface IdempotencyStorePort {
  requireKey(key: string | undefined | null): Result<IdempotencyKey>;
  get(key: IdempotencyKey): Promise<IdempotencyRecord | undefined>;
  begin(key: IdempotencyKey, now: string): Promise<Result<IdempotencyRecord>>;
  complete(
    key: IdempotencyKey,
    state: typeof ExecutionState.SUCCESS | typeof ExecutionState.FAILED,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>>;
  markUnknown(
    key: IdempotencyKey,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>>;
  attemptRetry(key: IdempotencyKey): Promise<Result<IdempotencyRecord>>;
}

/** Local/test-only. Not safe across multiple service instances. */
export class InMemoryNonceStore implements NonceStore {
  private readonly used = new Set<string>();

  async register(nonce: Nonce): Promise<Result<void>> {
    if (this.used.has(nonce)) {
      return err(ErrorCode.NONCE_REPLAY, "Nonce has already been used", { nonce });
    }
    this.used.add(nonce);
    return ok();
  }

  async has(nonce: Nonce): Promise<boolean> {
    return this.used.has(nonce);
  }

  clear(): void {
    this.used.clear();
  }
}

/** @deprecated Prefer InMemoryNonceStore */
export class NonceRegistry extends InMemoryNonceStore {}

/** Local/test-only. Not safe across multiple service instances. */
export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly records = new Map<string, IdempotencyRecord>();

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
    return this.records.get(key);
  }

  async begin(key: IdempotencyKey, now: string): Promise<Result<IdempotencyRecord>> {
    const existing = this.records.get(key);
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
        this.records.set(key, record);
        return ok(record);
      }
      return ok(existing);
    }
    const record: IdempotencyRecord = {
      key,
      state: ExecutionState.PENDING,
      updatedAt: now,
    };
    this.records.set(key, record);
    return ok(record);
  }

  async complete(
    key: IdempotencyKey,
    state: typeof ExecutionState.SUCCESS | typeof ExecutionState.FAILED,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>> {
    const existing = this.records.get(key);
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown idempotency key", { key });
    }
    const record: IdempotencyRecord = {
      key,
      state,
      resultRef,
      updatedAt: now,
    };
    this.records.set(key, record);
    return ok(record);
  }

  async markUnknown(
    key: IdempotencyKey,
    now: string,
    resultRef?: string,
  ): Promise<Result<IdempotencyRecord>> {
    const existing = this.records.get(key);
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown idempotency key", { key });
    }
    const record: IdempotencyRecord = {
      key,
      state: ExecutionState.UNKNOWN,
      resultRef,
      updatedAt: now,
    };
    this.records.set(key, record);
    return ok(record);
  }

  async attemptRetry(key: IdempotencyKey): Promise<Result<IdempotencyRecord>> {
    const existing = this.records.get(key);
    if (!existing) {
      return err(ErrorCode.VALIDATION_FAILED, "No prior execution for key", { key });
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

  clear(): void {
    this.records.clear();
  }
}

/** @deprecated Prefer InMemoryIdempotencyStore */
export class IdempotencyStore extends InMemoryIdempotencyStore {}
