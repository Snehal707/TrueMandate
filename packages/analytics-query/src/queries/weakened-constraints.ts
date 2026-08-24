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
  sortRanked,
  type AnalyticsQueryWindow,
} from "../window.js";

export interface WeakenedConstraintRow {
  readonly concept: string;
  readonly weakenCount: number;
  readonly workflowCount: number;
}

const WEAKEN_TYPES = new Set<string>([
  AnalyticsEventType.DRIFT_DETECTED,
  AnalyticsEventType.CONSTRAINT_WEAKENED,
]);

const WEAKEN_TOPICS = new Set<string>([
  AnalyticsTopic.INTENT,
  AnalyticsTopic.SEMANTIC,
]);

export const WEAKENED_CONSTRAINTS_SQL = `
SELECT
  JSON_VALUE(payload, '$.${AnalyticsPayloadField.CONCEPT}') AS concept,
  COUNT(*) AS weakenCount,
  COUNT(DISTINCT aggregate_id) AS workflowCount
FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
WHERE topic IN ('${AnalyticsTopic.INTENT}', '${AnalyticsTopic.SEMANTIC}')
  AND event_type IN ('${AnalyticsEventType.DRIFT_DETECTED}', '${AnalyticsEventType.CONSTRAINT_WEAKENED}')
  AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.CONCEPT}') IS NOT NULL
  AND (@since IS NULL OR occurred_at >= @since)
  AND (@until IS NULL OR occurred_at < @until)
GROUP BY concept
ORDER BY weakenCount DESC, concept ASC
LIMIT @limit
`;

export function aggregateWeakenedConstraints(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly WeakenedConstraintRow[] {
  const limit = clampLimit(window.limit);
  const byConcept = new Map<
    string,
    { count: number; workflows: Set<string> }
  >();

  for (const row of seed.governanceEvents) {
    if (!WEAKEN_TOPICS.has(row.topic)) continue;
    if (!WEAKEN_TYPES.has(row.event_type)) continue;
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    const concept = payloadString(payload, AnalyticsPayloadField.CONCEPT);
    if (!concept) continue;
    const entry = byConcept.get(concept) ?? {
      count: 0,
      workflows: new Set<string>(),
    };
    entry.count += 1;
    entry.workflows.add(row.aggregate_id);
    byConcept.set(concept, entry);
  }

  const rows: WeakenedConstraintRow[] = [...byConcept.entries()].map(
    ([concept, v]) => ({
      concept,
      weakenCount: v.count,
      workflowCount: v.workflows.size,
    }),
  );
  return sortRanked(rows, (r) => r.weakenCount, (r) => r.concept).slice(
    0,
    limit,
  );
}

export async function runWeakenedConstraints(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly WeakenedConstraintRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateWeakenedConstraints(port.getSeed(), window));
  }
  const sql = WEAKENED_CONSTRAINTS_SQL.replace("${dataset}", dataset);
  return port.run<WeakenedConstraintRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
}
