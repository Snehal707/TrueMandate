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

export interface GuardianInterventionAgentRow {
  readonly agentKey: string;
  readonly interventionCount: number;
  readonly workflowCount: number;
}

export const GUARDIAN_INTERVENTION_SQL = `
SELECT
  COALESCE(
    JSON_VALUE(payload, '$.${AnalyticsPayloadField.AGENT_ID}'),
    actor_service
  ) AS agentKey,
  COUNT(*) AS interventionCount,
  COUNT(DISTINCT aggregate_id) AS workflowCount
FROM \`\${dataset}.${AnalyticsTable.GOVERNANCE_EVENTS}\`
WHERE topic = '${AnalyticsTopic.GUARDIAN}'
  AND event_type = '${AnalyticsEventType.GUARDIAN_VERDICT}'
  AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.DECISION}') IS NOT NULL
  AND JSON_VALUE(payload, '$.${AnalyticsPayloadField.DECISION}') != 'ALLOW'
  AND (@since IS NULL OR occurred_at >= @since)
  AND (@until IS NULL OR occurred_at < @until)
GROUP BY agentKey
ORDER BY interventionCount DESC, agentKey ASC
LIMIT @limit
`;

export function aggregateGuardianInterventionAgents(
  seed: AnalyticsQuerySeed,
  window: AnalyticsQueryWindow = {},
): readonly GuardianInterventionAgentRow[] {
  const limit = clampLimit(window.limit);
  const byAgent = new Map<
    string,
    { count: number; workflows: Set<string> }
  >();

  for (const row of seed.governanceEvents) {
    if (row.topic !== AnalyticsTopic.GUARDIAN) continue;
    if (row.event_type !== AnalyticsEventType.GUARDIAN_VERDICT) continue;
    if (!inWindow(row.occurred_at, window)) continue;
    const payload = parsePayload(row.payload);
    const decision = payloadString(payload, AnalyticsPayloadField.DECISION);
    if (!decision || decision === "ALLOW") continue;
    const agentKey =
      payloadString(payload, AnalyticsPayloadField.AGENT_ID) ??
      row.actor_service;
    const entry = byAgent.get(agentKey) ?? {
      count: 0,
      workflows: new Set<string>(),
    };
    entry.count += 1;
    entry.workflows.add(row.aggregate_id);
    byAgent.set(agentKey, entry);
  }

  const rows: GuardianInterventionAgentRow[] = [...byAgent.entries()].map(
    ([agentKey, v]) => ({
      agentKey,
      interventionCount: v.count,
      workflowCount: v.workflows.size,
    }),
  );
  return sortRanked(
    rows,
    (r) => r.interventionCount,
    (r) => r.agentKey,
  ).slice(0, limit);
}

export async function runGuardianInterventionAgents(
  port: BigQueryQueryPort,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly GuardianInterventionAgentRow[]>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateGuardianInterventionAgents(port.getSeed(), window));
  }
  const sql = GUARDIAN_INTERVENTION_SQL.replace("${dataset}", dataset);
  return port.run<GuardianInterventionAgentRow>(sql, {
    limit: clampLimit(window.limit),
    since: window.since ?? null,
    until: window.until ?? null,
  });
}
