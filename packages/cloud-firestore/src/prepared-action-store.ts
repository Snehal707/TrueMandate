import {
  ErrorCode,
  PreparedActionLifecycle,
  err,
  ok,
  type PreparedActionId,
  type PreparedActionRecord,
  type Result,
} from "@truemandate/protocol";
import type { PreparedActionStore } from "@truemandate/authority";
import { parsePreparedActionRecord } from "@truemandate/authority";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

export class FirestorePreparedActionStore implements PreparedActionStore {
  constructor(private readonly store: DocumentStore) {}

  async get(
    id: PreparedActionId | string,
  ): Promise<Result<PreparedActionRecord | undefined>> {
    const value = await this.store.get(docPath(COLLECTIONS.preparedActions, String(id)));
    return value === undefined ? ok(undefined) : parsePreparedActionRecord(value);
  }

  async putIfAbsent(
    record: PreparedActionRecord,
  ): Promise<Result<PreparedActionRecord>> {
    const parsed = parsePreparedActionRecord(record);
    if (!parsed.ok) return parsed;
    return this.store.runTransaction(async (tx) => {
      const path = docPath(
        COLLECTIONS.preparedActions,
        String(record.preparedAction.id),
      );
      const existing = await tx.get<PreparedActionRecord>(path);
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
            { preparedActionId: record.preparedAction.id },
          );
        }
        return ok(parsedExisting.value);
      }
      await tx.set(path, record);
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
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.preparedActions, String(input.id));
      const existing = await tx.get<PreparedActionRecord>(path);
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
      await tx.set(path, parsedNext.value);
      return ok(parsedNext.value);
    });
  }
}
