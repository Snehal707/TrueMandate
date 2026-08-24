import {
  ErrorCode,
  err,
  ok,
  type Result,
  type SideEffectRecord,
} from "@truemandate/protocol";
import { SideEffectRecordSchema, parseWithSchema } from "@truemandate/schemas";
import type { SideEffectLedger } from "@truemandate/side-effect-ledger";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

interface KeyIndex {
  readonly executionIds: string[];
}

function idemIndexPath(key: string): string {
  return docPath(`${COLLECTIONS.sideEffects}/_byIdem`, key);
}

function allPath(): string {
  return docPath(`${COLLECTIONS.sideEffects}/_meta`, "all");
}

export class FirestoreSideEffectLedger implements SideEffectLedger {
  constructor(private readonly store: DocumentStore) {}

  async append(raw: unknown): Promise<Result<SideEffectRecord>> {
    return this.store.runTransaction(async (tx) => {
      const parsed = parseWithSchema(
        SideEffectRecordSchema,
        raw,
        "SideEffectRecord",
      );
      if (!parsed.ok) {
        return err(
          ErrorCode.SIDE_EFFECT_LEDGER_APPEND_FAILED,
          parsed.message,
          parsed.details,
        );
      }
      const record = parsed.value as unknown as SideEffectRecord;
      const path = docPath(COLLECTIONS.sideEffects, record.executionId);
      const iPath = idemIndexPath(record.idempotencyKey);
      const existing = await tx.get(path);
      const iIdx = (await tx.get<KeyIndex>(iPath)) ?? { executionIds: [] };
      const aIdx = (await tx.get<KeyIndex>(allPath())) ?? { executionIds: [] };
      if (existing) {
        return err(
          ErrorCode.SIDE_EFFECT_LEDGER_APPEND_FAILED,
          "executionId already recorded",
          { executionId: record.executionId },
        );
      }
      await tx.set(path, Object.freeze({ ...record }));
      await tx.set(iPath, {
        executionIds: [...iIdx.executionIds, record.executionId],
      });
      await tx.set(allPath(), {
        executionIds: [...aIdx.executionIds, record.executionId],
      });
      return ok(record);
    });
  }

  async get(executionId: string): Promise<SideEffectRecord | undefined> {
    return this.store.get(docPath(COLLECTIONS.sideEffects, executionId));
  }

  async listByIdempotencyKey(key: string): Promise<readonly SideEffectRecord[]> {
    const idx = await this.store.get<KeyIndex>(idemIndexPath(key));
    if (!idx) return [];
    const rows = await Promise.all(idx.executionIds.map((id) => this.get(id)));
    return rows.filter((r): r is SideEffectRecord => r !== undefined);
  }

  async listAll(): Promise<readonly SideEffectRecord[]> {
    const idx = await this.store.get<KeyIndex>(allPath());
    if (!idx) return [];
    const rows = await Promise.all(idx.executionIds.map((id) => this.get(id)));
    return rows.filter((r): r is SideEffectRecord => r !== undefined);
  }
}
