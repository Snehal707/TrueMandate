import {
  ErrorCode,
  err,
  ok,
  type Result,
  type SideEffectRecord,
} from "@truemandate/protocol";
import { SideEffectRecordSchema, parseWithSchema } from "@truemandate/schemas";

/**
 * Append-only privileged side-effect ledger.
 * Not ordinary application logs. In-memory impl is single-process only.
 */
export interface SideEffectLedger {
  append(raw: unknown): Promise<Result<SideEffectRecord>>;
  get(executionId: string): Promise<SideEffectRecord | undefined>;
  listByIdempotencyKey(key: string): Promise<readonly SideEffectRecord[]>;
  listAll(): Promise<readonly SideEffectRecord[]>;
}

export class InMemorySideEffectLedger implements SideEffectLedger {
  private readonly records: SideEffectRecord[] = [];

  async append(raw: unknown): Promise<Result<SideEffectRecord>> {
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
    if (this.records.some((r) => r.executionId === record.executionId)) {
      return err(
        ErrorCode.SIDE_EFFECT_LEDGER_APPEND_FAILED,
        "executionId already recorded",
        { executionId: record.executionId },
      );
    }
    this.records.push(Object.freeze({ ...record }));
    return ok(record);
  }

  async get(executionId: string): Promise<SideEffectRecord | undefined> {
    return this.records.find((r) => r.executionId === executionId);
  }

  async listByIdempotencyKey(key: string): Promise<readonly SideEffectRecord[]> {
    return this.records.filter((r) => r.idempotencyKey === key);
  }

  async listAll(): Promise<readonly SideEffectRecord[]> {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }
}
