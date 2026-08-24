import {
  ErrorCode,
  PreparedActionLifecycle,
  err,
  ok,
  type PreparedActionId,
  type PreparedActionRecord,
  type Result,
} from "@truemandate/protocol";
import { parsePreparedActionRecord } from "./durable-read.js";

export interface PreparedActionStore {
  get(
    id: PreparedActionId | string,
  ): Promise<Result<PreparedActionRecord | undefined>>;
  putIfAbsent(
    record: PreparedActionRecord,
  ): Promise<Result<PreparedActionRecord>>;
  transition(input: {
    readonly id: PreparedActionId | string;
    readonly from: PreparedActionLifecycle;
    readonly to: PreparedActionLifecycle;
    readonly expectedVersion: number;
    readonly patch?: Partial<
      Pick<PreparedActionRecord, "grantId" | "commitTokenId">
    >;
    readonly now: string;
  }): Promise<Result<PreparedActionRecord>>;
}

export class InMemoryPreparedActionStore implements PreparedActionStore {
  private readonly records = new Map<string, PreparedActionRecord>();
  private chain: Promise<void> = Promise.resolve();

  private serialized<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => {
      const prev = this.chain;
      this.chain = new Promise<void>((r) => {
        release = r;
      });
      void prev.then(() => resolve());
    });
    return acquired
      .then(() => fn())
      .finally(() => {
        release();
      });
  }

  async get(
    id: PreparedActionId | string,
  ): Promise<Result<PreparedActionRecord | undefined>> {
    const value = this.records.get(String(id));
    return value === undefined ? ok(undefined) : parsePreparedActionRecord(value);
  }

  async putIfAbsent(
    record: PreparedActionRecord,
  ): Promise<Result<PreparedActionRecord>> {
    return this.serialized(() => {
      const validated = parsePreparedActionRecord(record);
      if (!validated.ok) return validated;
      const id = String(record.preparedAction.id);
      const existing = this.records.get(id);
      if (existing) {
        const parsedExisting = parsePreparedActionRecord(existing);
        if (!parsedExisting.ok) return parsedExisting;
        if (
          existing.preparedAction.preparedActionHash !==
          record.preparedAction.preparedActionHash
        ) {
          return err(
            ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
            "PreparedAction id already exists with a divergent hash",
            { preparedActionId: id },
          );
        }
        return ok(parsedExisting.value);
      }
      this.records.set(id, record);
      return ok(record);
    });
  }

  async transition(input: {
    readonly id: PreparedActionId | string;
    readonly from: PreparedActionLifecycle;
    readonly to: PreparedActionLifecycle;
    readonly expectedVersion: number;
    readonly patch?: Partial<
      Pick<PreparedActionRecord, "grantId" | "commitTokenId">
    >;
    readonly now: string;
  }): Promise<Result<PreparedActionRecord>> {
    return this.serialized(() => {
      const existing = this.records.get(String(input.id));
      if (!existing) {
        return err(ErrorCode.PREPARED_ACTION_REQUIRED, "Unknown preparedActionId", {
          preparedActionId: input.id,
        });
      }
      const parsedExisting = parsePreparedActionRecord(existing);
      if (!parsedExisting.ok) return parsedExisting;
      const trusted = parsedExisting.value;
      if (trusted.lifecycle !== input.from) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "PreparedAction lifecycle mismatch",
          {
            preparedActionId: input.id,
            expected: input.from,
            actual: trusted.lifecycle,
          },
        );
      }
      if (trusted.version !== input.expectedVersion) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "PreparedAction version mismatch",
          {
            preparedActionId: input.id,
            expectedVersion: input.expectedVersion,
            actualVersion: trusted.version,
          },
        );
      }
      const next: PreparedActionRecord = {
        ...trusted,
        ...input.patch,
        lifecycle: input.to,
        version: trusted.version + 1,
        updatedAt: input.now,
      };
      const parsedNext = parsePreparedActionRecord(next);
      if (!parsedNext.ok) return parsedNext;
      this.records.set(String(input.id), parsedNext.value);
      return ok(parsedNext.value);
    });
  }
}
