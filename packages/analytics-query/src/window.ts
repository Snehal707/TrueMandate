export interface AnalyticsQueryWindow {
  readonly limit?: number;
  /** Inclusive lower bound ISO timestamp (optional). */
  readonly since?: string;
  /** Exclusive upper bound ISO timestamp (optional). */
  readonly until?: string;
}

export function clampLimit(limit: number | undefined, fallback = 50): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

export function inWindow(
  occurredAt: string,
  window: AnalyticsQueryWindow,
): boolean {
  if (window.since && occurredAt < window.since) return false;
  if (window.until && occurredAt >= window.until) return false;
  return true;
}

/** Stable sort: primary desc numeric, secondary asc string key. */
export function sortRanked<T>(
  rows: readonly T[],
  score: (row: T) => number,
  tieKey: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return tieKey(a).localeCompare(tieKey(b));
  });
}

export function roundRate(n: number, d: number): number {
  if (d <= 0) return 0;
  return Math.round((n / d) * 10000) / 10000;
}
