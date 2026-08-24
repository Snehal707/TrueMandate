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

/**
 * Wave 3.7 agent reliability stats.
 *
 * Unlike guardian-intervention-agents (interventions only), this counts ALL
 * GUARDIAN_VERDICT events so sampleSize = workflows observed, and
 * interventionCount = non-ALLOW verdicts. That makes
 * reliability = 1 - interventionCount/workflowCount explainable.
 */
export interface AgentReliabilityStatsRow {
  readonly agentKey: string;
  readonly interventionCount: number;
  readonly workflowCount: number;
  readonly totalVerdicts: number;
}

export const AGENT_RELIABILITY_STATS_SQL = `
SELECT
  COALESCE(
    JSON_VALUE(payload, '$.${AnalyticsPayloadField.AGENT_ID}'),
    actor_service
  ) AS agentKey,
  COUNTIF(
    JSON_VALUE(payload, '$.${AnalyticsPayloadField.DECISION}') IS NOT NULL
    AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.DECISION}') != 'ALLOW'
  ) AS interventionCount,
  COUNT(DISTINCT aggregate_id) AS workflowCount,
  COUNT(*) AS totalVerdicts
FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
WHERE topic = '${AnalyticsTopic.GUARDIAN}'
  AND event_type = '${AnalyticsEventType.GUARDIAN_VERDICT}'
  AND (@since IS NULL OR occurred_at >= @since)
  AND (@until IS NULL OR occurred_at < @until)
GROUP BY agentKey
ORDER BY workflowCount DESC, agentKey ASC
LIMIT @limit
`;

export function aggregateAgentReliabilityStats(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly AgentReliabilityStatsRow[] {
  const limit = clampLimit(window.limit);
  const byAgent = new Map<
    string,
    {
      interventions: number;
      workflows: Set<string>;
      totalVerdicts: number;
    }
  >();

  for (const row of seed.governanceEvents) {
    if (row.topic !== AnalyticsTopic.GUARDIAN) continue;
    if (row.event_type !== AnalyticsEventType.GUARDIAN_VERDICT) continue;
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    const decision = payloadString(payload, AnalyticsPayloadField.DECISION);
    const agentKey =
      payloadString(payload, AnalyticsPayloadField.AGENT_ID) ??
      row.actor_service;
    const entry = byAgent.get(agentKey) ?? {
      interventions: 0,
      workflows: new Set<string>(),
      totalVerdicts: 0,
    };
    entry.totalVerdicts += 1;
    entry.workflows.add(row.aggregate_id);
    if (decision && decision !== "ALLOW") {
      entry.interventions += 1;
    }
    byAgent.set(agentKey, entry);
  }

  const rows: AgentReliabilityStatsRow[] = [...byAgent.entries()].map(
    ([agentKey, v]) => ({
      agentKey,
      interventionCount: v.interventions,
      workflowCount: v.workflows.size,
      totalVerdicts: v.totalVerdicts,
    }),
  );
  return sortRanked(
    rows,
    (r) => r.workflowCount,
    (r) => r.agentKey,
  ).slice(0, limit);
}

export async function runAgentReliabilityStats(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly AgentReliabilityStatsRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateAgentReliabilityStats(port.getSeed(), window));
  }
  const sql = AGENT_RELIABILITY_STATS_SQL.replace("${dataset}", dataset);
  const result = await port.run<AgentReliabilityStatsRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
  if (!result.ok) return result;
  return ok(
    result.value.map((r) => ({
      agentKey: String(r.agentKey),
      interventionCount: Number(r.interventionCount),
      workflowCount: Number(r.workflowCount),
      totalVerdicts: Number(r.totalVerdicts),
    })),
  );
}
