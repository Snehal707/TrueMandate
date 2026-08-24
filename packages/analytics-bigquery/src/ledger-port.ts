/**
 * Export ledger — Firestore-backed "already exported" bookkeeping.
 * BigQuery is never read to decide idempotency.
 */

export interface AnalyticsLedgerEntry {
  readonly exportId: string;
  readonly table: string;
  readonly exportedAt: string;
}

export interface AnalyticsLedgerPort {
  hasExported(exportId: string): Promise<boolean>;
  markExported(entry: AnalyticsLedgerEntry): Promise<void>;
}

export class MemoryAnalyticsLedgerPort implements AnalyticsLedgerPort {
  private readonly entries = new Map<string, AnalyticsLedgerEntry>();

  async hasExported(exportId: string): Promise<boolean> {
    return this.entries.has(exportId);
  }

  async markExported(entry: AnalyticsLedgerEntry): Promise<void> {
    this.entries.set(entry.exportId, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Adapter over a KeyValue-style get/put store (Firestore analyticsExportLedger).
 */
export function createDocumentAnalyticsLedger(store: {
  get(id: string): Promise<AnalyticsLedgerEntry | undefined>;
  put(id: string, value: AnalyticsLedgerEntry): Promise<void>;
}): AnalyticsLedgerPort {
  return {
    async hasExported(exportId: string): Promise<boolean> {
      return (await store.get(exportId)) !== undefined;
    },
    async markExported(entry: AnalyticsLedgerEntry): Promise<void> {
      await store.put(entry.exportId, entry);
    },
  };
}
