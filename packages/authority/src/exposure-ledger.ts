import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";
import {
  evaluateCumulativeExposure,
  type ExposureEntry,
} from "./exposure.js";

/**
 * Persistence port for cumulative related exposure.
 * In-memory impl is NOT multi-instance safe.
 */
export interface ExposureLedger {
  list(relatedGroupId: string): Promise<readonly ExposureEntry[]>;
  listAll(): Promise<readonly ExposureEntry[]>;
  add(entry: ExposureEntry): Promise<Result<ExposureEntry>>;
  updateStatus(
    id: string,
    status: ExposureEntry["status"] | "RELEASED",
  ): Promise<Result<ExposureEntry>>;
  evaluate(input: {
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<{ readonly projected: number }>>;
  reserveIfUnderThreshold(input: {
    readonly entry: ExposureEntry;
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<ExposureEntry>>;
}

export class InMemoryExposureLedger implements ExposureLedger {
  private readonly entries: ExposureEntry[] = [];
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

  async list(relatedGroupId: string): Promise<readonly ExposureEntry[]> {
    return this.entries.filter((e) => e.relatedGroupId === relatedGroupId);
  }

  async listAll(): Promise<readonly ExposureEntry[]> {
    return [...this.entries];
  }

  async add(entry: ExposureEntry): Promise<Result<ExposureEntry>> {
    if (this.entries.some((e) => e.id === entry.id)) {
      return err(ErrorCode.VALIDATION_FAILED, "Exposure entry already exists", {
        id: entry.id,
      });
    }
    this.entries.push(entry);
    return ok(entry);
  }

  async updateStatus(
    id: string,
    status: ExposureEntry["status"] | "RELEASED",
  ): Promise<Result<ExposureEntry>> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown exposure entry", { id });
    }
    if (status === "RELEASED") {
      const [removed] = this.entries.splice(idx, 1);
      return ok(removed!);
    }
    const updated: ExposureEntry = { ...this.entries[idx]!, status };
    this.entries[idx] = updated;
    return ok(updated);
  }

  async evaluate(input: {
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<{ readonly projected: number }>> {
    return evaluateCumulativeExposure({
      ...input,
      entries: await this.list(input.relatedGroupId),
    });
  }

  async reserveIfUnderThreshold(input: {
    readonly entry: ExposureEntry;
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<ExposureEntry>> {
    return this.serialized(async () => {
      const evaluated = await this.evaluate({
        threshold: input.threshold,
        currency: input.currency,
        proposedAmount: input.proposedAmount,
        relatedGroupId: input.relatedGroupId,
      });
      if (!evaluated.ok) return evaluated;
      return this.add(input.entry);
    });
  }

  clear(): void {
    this.entries.length = 0;
  }
}
