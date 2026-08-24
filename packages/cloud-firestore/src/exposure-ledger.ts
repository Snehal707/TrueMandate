import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";
import type { ExposureLedger } from "@truemandate/authority";
import {
  evaluateCumulativeExposure,
  type ExposureEntry,
} from "@truemandate/authority";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

interface ExposureIndex {
  readonly ids: string[];
}

function indexPath(relatedGroupId: string): string {
  return docPath(`${COLLECTIONS.exposure}/_index`, relatedGroupId);
}

function allIndexPath(): string {
  return docPath(`${COLLECTIONS.exposure}/_meta`, "all");
}

/** Transactional exposure ledger — reserve cannot exceed threshold under race. */
export class FirestoreExposureLedger implements ExposureLedger {
  constructor(private readonly store: DocumentStore) {}

  async list(relatedGroupId: string): Promise<readonly ExposureEntry[]> {
    const idx = await this.store.get<ExposureIndex>(indexPath(relatedGroupId));
    if (!idx) return [];
    const entries = await Promise.all(
      idx.ids.map((id) =>
        this.store.get<ExposureEntry>(docPath(COLLECTIONS.exposure, id)),
      ),
    );
    return entries.filter((e): e is ExposureEntry => e !== undefined);
  }

  async listAll(): Promise<readonly ExposureEntry[]> {
    const idx = await this.store.get<ExposureIndex>(allIndexPath());
    if (!idx) return [];
    const entries = await Promise.all(
      idx.ids.map((id) =>
        this.store.get<ExposureEntry>(docPath(COLLECTIONS.exposure, id)),
      ),
    );
    return entries.filter((e): e is ExposureEntry => e !== undefined);
  }

  async add(entry: ExposureEntry): Promise<Result<ExposureEntry>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.exposure, entry.id);
      const gPath = indexPath(entry.relatedGroupId);
      const existing = await tx.get(path);
      const gIdx = (await tx.get<ExposureIndex>(gPath)) ?? { ids: [] };
      const aIdx = (await tx.get<ExposureIndex>(allIndexPath())) ?? { ids: [] };
      if (existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Exposure entry already exists", {
          id: entry.id,
        });
      }
      await tx.set(path, entry);
      await tx.set(gPath, { ids: [...gIdx.ids, entry.id] });
      await tx.set(allIndexPath(), { ids: [...aIdx.ids, entry.id] });
      return ok(entry);
    });
  }

  /**
   * Atomically evaluate + add IN_FLIGHT reservation (exposure cannot exceed).
   */
  async reserveIfUnderThreshold(input: {
    readonly entry: ExposureEntry;
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<ExposureEntry>> {
    return this.store.runTransaction(async (tx) => {
      const gPath = indexPath(input.relatedGroupId);
      const gIdx = (await tx.get<ExposureIndex>(gPath)) ?? { ids: [] };
      const entries: ExposureEntry[] = [];
      for (const id of gIdx.ids) {
        const e = await tx.get<ExposureEntry>(docPath(COLLECTIONS.exposure, id));
        if (e) entries.push(e);
      }
      const evalResult = evaluateCumulativeExposure({
        threshold: input.threshold,
        currency: input.currency,
        proposedAmount: input.proposedAmount,
        relatedGroupId: input.relatedGroupId,
        entries,
      });
      if (!evalResult.ok) return evalResult;
      const path = docPath(COLLECTIONS.exposure, input.entry.id);
      const existing = await tx.get(path);
      const aIdx = (await tx.get<ExposureIndex>(allIndexPath())) ?? { ids: [] };
      if (existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Exposure entry already exists", {
          id: input.entry.id,
        });
      }
      await tx.set(path, input.entry);
      await tx.set(gPath, { ids: [...gIdx.ids, input.entry.id] });
      await tx.set(allIndexPath(), { ids: [...aIdx.ids, input.entry.id] });
      return ok(input.entry);
    });
  }

  async updateStatus(
    id: string,
    status: ExposureEntry["status"] | "RELEASED",
  ): Promise<Result<ExposureEntry>> {
    return this.store.runTransaction(async (tx) => {
      const path = docPath(COLLECTIONS.exposure, id);
      const existing = await tx.get<ExposureEntry>(path);
      const gPath = indexPath(existing?.relatedGroupId ?? "");
      const gIdx = existing ? await tx.get<ExposureIndex>(gPath) : undefined;
      const aIdx = existing ? await tx.get<ExposureIndex>(allIndexPath()) : undefined;
      if (!existing) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown exposure entry", { id });
      }
      if (status === "RELEASED") {
        await tx.delete(path);
        if (gIdx) {
          await tx.set(gPath, { ids: gIdx.ids.filter((x) => x !== id) });
        }
        if (aIdx) {
          await tx.set(allIndexPath(), { ids: aIdx.ids.filter((x) => x !== id) });
        }
        return ok(existing);
      }
      const updated: ExposureEntry = { ...existing, status };
      await tx.set(path, updated);
      return ok(updated);
    });
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
}
