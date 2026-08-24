import { AnalyticsTable } from "@truemandate/analytics-bigquery";
import { ok, type Result } from "@truemandate/protocol";
import {
  AnalyticsEventType,
  AnalyticsPayloadField,
  AnalyticsTopic,
  parsePayload,
  payloadString,
} from "../field-contract.js";
import {
  isMemoryQueryPort,
  type AnalyticsQuerySeed,
  type BigQueryQueryPort,
} from "../query-port.js";
import {
  clampLimit,
  inWindow,
  roundRate,
  sortRanked,
  type AnalyticsQueryWindow,
} from "../window.js";

export interface CounterpartyOutcomeRow {
  readonly merchant: string;
  readonly totalOutcomes: number;
  readonly partialOrBreached: number;
  readonly failureRate: number;
}

const OUTCOME_TYPES = new Set<string>([
  AnalyticsEventType.OUTCOME_PARTIAL,
  AnalyticsEventType.OUTCOME_BREACHED,
  AnalyticsEventType.OUTCOME_SATISFIED,
]);

const FAILURE_TYPES = new Set<string>([
  AnalyticsEventType.OUTCOME_PARTIAL,
  AnalyticsEventType.OUTCOME_BREACHED,
]);

export const COUNTERPARTY_OUTCOME_SQL = `
SELECT
  JSON_VALUE(payload, '$.${AnalyticsPayloadField.MERCHANT}') AS merchant,
  COUNT(*) AS totalOutcomes,
  COUNTIF(event_type IN ('${AnalyticsEventType.OUTCOME_PARTIAL}', '${AnalyticsEventType.OUTCOME_BREACHED}')) AS partialOrBreached,
  SAFE_DIVIDE(
    COUNTIF(event_type IN ('${AnalyticsEventType.OUTCOME_PARTIAL}', '${AnalyticsEventType.OUTCOME_BREACHED}')),
    COUNT(*)
  ) AS failureRate
FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
WHERE topic = '${AnalyticsTopic.OUTCOME}'
  AND event_type IN (
    '${AnalyticsEventType.OUTCOME_PARTIAL}',
    '${AnalyticsEventType.OUTCOME_BREACHED}',
    '${AnalyticsEventType.OUTCOME_SATISFIED}'
  )
  AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.MERCHANT}') IS NOT NULL
  AND (@since IS NULL OR occurred_at >= @since)
  AND (@until IS NULL OR occurred_at < @until)
GROUP BY merchant
ORDER BY failureRate DESC, partialOrBreached DESC, merchant ASC
LIMIT @limit
`;

export function aggregateCounterpartyOutcomeCorrelation(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly CounterpartyOutcomeRow[] {
  const limit = clampLimit(window.limit);
  const byMerchant = new Map<
    string,
    { total: number; failed: number }
  >();

  for (const row of seed.governanceEvents) {
    if (row.topic !== AnalyticsTopic.OUTCOME) continue;
    if (!OUTCOME_TYPES.has(row.event_type)) continue;
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    const merchant = payloadString(payload, AnalyticsPayloadField.MERCHANT);
    if (!merchant) continue;
    const entry = byMerchant.get(merchant) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (FAILURE_TYPES.has(row.event_type)) entry.failed += 1;
    byMerchant.set(merchant, entry);
  }

  const rows: CounterpartyOutcomeRow[] = [...byMerchant.entries()].map(
    ([merchant, v]) => ({
      merchant,
      totalOutcomes: v.total,
      partialOrBreached: v.failed,
      failureRate: roundRate(v.failed, v.total),
    }),
  );
  return sortRanked(
    rows,
    (r) => r.failureRate * 1_000_000 + r.partialOrBreached,
    (r) => r.merchant,
  ).slice(0, limit);
}

export async function runCounterpartyOutcomeCorrelation(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly CounterpartyOutcomeRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateCounterpartyOutcomeCorrelation(port.getSeed(), window));
  }
  const sql = COUNTERPARTY_OUTCOME_SQL.replace("${dataset}", dataset);
  const result = await port.run<CounterpartyOutcomeRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
  if (!result.ok) return result;
  return ok(
    result.value.map((r) => ({
      ...r,
      failureRate: roundRate(Number(r.partialOrBreached), Number(r.totalOutcomes)),
    })),
  );
}
