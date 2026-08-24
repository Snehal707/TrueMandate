import { AnalyticsTable } from "@truemandate/analytics-bigquery";
import { ok, type Result } from "@truemandate/protocol";
import {
  AnalyticsEventType,
  AnalyticsPayloadField,
  AnalyticsTopic,
  parsePayload,
  payloadBool,
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

export interface RemedyRestorationRow {
  readonly remedyType: string;
  readonly totalRemedies: number;
  readonly restoredCount: number;
  readonly restorationRate: number;
}

export const REMEDY_RESTORATION_SQL = `
SELECT
  JSON_VALUE(payload, '$.${AnalyticsPayloadField.REMEDY_TYPE}') AS remedyType,
  COUNT(*) AS totalRemedies,
  COUNTIF(LOWER(CAST(JSON_VALUE(payload, '$.${AnalyticsPayloadField.RESTORED}') AS STRING)) = 'true') AS restoredCount,
  SAFE_DIVIDE(
    COUNTIF(LOWER(CAST(JSON_VALUE(payload, '$.${AnalyticsPayloadField.RESTORED}') AS STRING)) = 'true'),
    COUNT(*)
  ) AS restorationRate
FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
WHERE topic = '${AnalyticsTopic.RESOLUTION}'
  AND event_type = '${AnalyticsEventType.REMEDY_COMPLETED}'
  AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.REMEDY_TYPE}') IS NOT NULL
  AND (@since IS NULL OR occurred_at >= @since)
  AND (@until IS NULL OR occurred_at < @until)
GROUP BY remedyType
ORDER BY restorationRate DESC, restoredCount DESC, remedyType ASC
LIMIT @limit
`;

export function aggregateRemedyRestorationRate(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly RemedyRestorationRow[] {
  const limit = clampLimit(window.limit);
  const byType = new Map<string, { total: number; restored: number }>();

  for (const row of seed.governanceEvents) {
    if (row.topic !== AnalyticsTopic.RESOLUTION) continue;
    if (row.event_type !== AnalyticsEventType.REMEDY_COMPLETED) continue;
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    const remedyType = payloadString(
      payload,
      AnalyticsPayloadField.REMEDY_TYPE,
    );
    if (!remedyType) continue;
    const entry = byType.get(remedyType) ?? { total: 0, restored: 0 };
    entry.total += 1;
    if (payloadBool(payload, AnalyticsPayloadField.RESTORED) === true) {
      entry.restored += 1;
    }
    byType.set(remedyType, entry);
  }

  const rows: RemedyRestorationRow[] = [...byType.entries()].map(
    ([remedyType, v]) => ({
      remedyType,
      totalRemedies: v.total,
      restoredCount: v.restored,
      restorationRate: roundRate(v.restored, v.total),
    }),
  );
  return sortRanked(
    rows,
    (r) => r.restorationRate * 1_000_000 + r.restoredCount,
    (r) => r.remedyType,
  ).slice(0, limit);
}

export async function runRemedyRestorationRate(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly RemedyRestorationRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateRemedyRestorationRate(port.getSeed(), window));
  }
  const sql = REMEDY_RESTORATION_SQL.replace("${dataset}", dataset);
  const result = await port.run<RemedyRestorationRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
  if (!result.ok) return result;
  return ok(
    result.value.map((r) => ({
      ...r,
      restorationRate: roundRate(
        Number(r.restoredCount),
        Number(r.totalRemedies),
      ),
    })),
  );
}
