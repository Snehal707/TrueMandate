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

export interface AmbiguityBlockedRow {
  readonly ambiguityClass: string;
  readonly planCount: number;
  readonly blockedCount: number;
  readonly blockRate: number;
}

export const AMBIGUITY_BLOCKED_SQL = `
WITH plans AS (
  SELECT
    aggregate_id,
    JSON_VALUE(payload, '$.${AnalyticsPayloadField.AMBIGUITY_CLASS}') AS ambiguityClass
  FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
  WHERE topic = '${AnalyticsTopic.PLAN}'
    AND event_type = '${AnalyticsEventType.PLAN_CREATED}'
    AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.AMBIGUITY_CLASS}') IS NOT NULL
    AND (@since IS NULL OR occurred_at >= @since)
    AND (@until IS NULL OR occurred_at < @until)
),
blocks AS (
  SELECT DISTINCT aggregate_id
  FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
  WHERE topic = '${AnalyticsTopic.AUTHORITY}'
    AND event_type = '${AnalyticsEventType.AUTHORITY_DECISION}'
    AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.DECISION}') = 'BLOCK'
    AND (@since IS NULL OR occurred_at >= @since)
    AND (@until IS NULL OR occurred_at < @until)
)
SELECT
  p.ambiguityClass AS ambiguityClass,
  COUNT(*) AS planCount,
  COUNTIF(b.aggregate_id IS NOT NULL) AS blockedCount,
  SAFE_DIVIDE(COUNTIF(b.aggregate_id IS NOT NULL), COUNT(*)) AS blockRate
FROM plans p
LEFT JOIN blocks b USING (aggregate_id)
GROUP BY ambiguityClass
ORDER BY blockRate DESC, blockedCount DESC, ambiguityClass ASC
LIMIT @limit
`;

export function aggregateAmbiguityBlockedCorrelation(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly AmbiguityBlockedRow[] {
  const limit = clampLimit(window.limit);
  const planClass = new Map<string, string>();
  const blocked = new Set<string>();

  for (const row of seed.governanceEvents) {
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    if (
      row.topic === AnalyticsTopic.PLAN &&
      row.event_type === AnalyticsEventType.PLAN_CREATED
    ) {
      const cls = payloadString(
        payload,
        AnalyticsPayloadField.AMBIGUITY_CLASS,
      );
      if (cls) planClass.set(row.aggregate_id, cls);
    }
    if (
      row.topic === AnalyticsTopic.AUTHORITY &&
      row.event_type === AnalyticsEventType.AUTHORITY_DECISION
    ) {
      const decision = payloadString(payload, AnalyticsPayloadField.DECISION);
      if (decision === "BLOCK") blocked.add(row.aggregate_id);
    }
  }

  const byClass = new Map<string, { plans: number; blocks: number }>();
  for (const [agg, cls] of planClass) {
    const entry = byClass.get(cls) ?? { plans: 0, blocks: 0 };
    entry.plans += 1;
    if (blocked.has(agg)) entry.blocks += 1;
    byClass.set(cls, entry);
  }

  const rows: AmbiguityBlockedRow[] = [...byClass.entries()].map(
    ([ambiguityClass, v]) => ({
      ambiguityClass,
      planCount: v.plans,
      blockedCount: v.blocks,
      blockRate: roundRate(v.blocks, v.plans),
    }),
  );
  return sortRanked(
    rows,
    (r) => r.blockRate * 1_000_000 + r.blockedCount,
    (r) => r.ambiguityClass,
  ).slice(0, limit);
}

export async function runAmbiguityBlockedCorrelation(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly AmbiguityBlockedRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateAmbiguityBlockedCorrelation(port.getSeed(), window));
  }
  const sql = AMBIGUITY_BLOCKED_SQL.replace("${dataset}", dataset);
  const result = await port.run<AmbiguityBlockedRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
  if (!result.ok) return result;
  return ok(
    result.value.map((r) => ({
      ...r,
      blockRate: roundRate(Number(r.blockedCount), Number(r.planCount)),
    })),
  );
}
