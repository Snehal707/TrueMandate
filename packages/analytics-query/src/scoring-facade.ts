import {
  computeAgentReliabilityScore,
  computeCounterpartyTrustScore,
  createAgentReliabilityProposal,
  createCounterpartyTrustProposal,
  type ScoringProposalDraft,
} from "@truemandate/analytics-scoring";
import { ok, type Result } from "@truemandate/protocol";
import { runAgentReliabilityStats } from "./queries/agent-reliability-stats.js";
import { runCounterpartyOutcomeCorrelation } from "./queries/counterparty-outcome-correlation.js";
import type { BigQueryQueryPort } from "./query-port.js";
import type { AnalyticsQueryWindow } from "./window.js";

/**
 * Wave 3.7 scoring facade — analytics → TrustSignal → LearningProposal drafts.
 *
 * Pure orchestration over governance_events aggregates. Never writes Firestore,
 * never mints privilege. Callers POST drafts to learning-service.
 */

export interface ScoringGenerationOpts {
  readonly principalId: string;
  readonly domain?: string;
  readonly computedAt?: string;
  /** Optional id prefix; default `score`. */
  readonly idPrefix?: string;
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function draftId(
  prefix: string,
  proposalType: string,
  subjectId: string,
): string {
  return `${prefix}-${proposalType.toLowerCase()}-${sanitizeIdPart(subjectId)}`;
}

export async function generateAgentReliabilityProposals(
  port: BigQueryQueryPort,
  opts: ScoringGenerationOpts,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly ScoringProposalDraft[]>> {
  const rows = await runAgentReliabilityStats(port, window, dataset);
  if (!rows.ok) return rows;

  const computedAt = opts.computedAt ?? new Date().toISOString();
  const domain = opts.domain ?? "procurement";
  const idPrefix = opts.idPrefix ?? "score";

  const drafts = rows.value.map((row) => {
    const signal = computeAgentReliabilityScore(row, computedAt, domain);
    return createAgentReliabilityProposal(signal, {
      id: draftId(idPrefix, "AGENT_RELIABILITY", row.agentKey),
      principalId: opts.principalId,
      domain,
      createdAt: computedAt,
    });
  });

  return ok(drafts);
}

export async function generateCounterpartyTrustProposals(
  port: BigQueryQueryPort,
  opts: ScoringGenerationOpts,
  window: AnalyticsQueryWindow = {},
  dataset = "tm_analytics",
): Promise<Result<readonly ScoringProposalDraft[]>> {
  const rows = await runCounterpartyOutcomeCorrelation(port, window, dataset);
  if (!rows.ok) return rows;

  const computedAt = opts.computedAt ?? new Date().toISOString();
  const domain = opts.domain ?? "procurement";
  const idPrefix = opts.idPrefix ?? "score";

  const drafts = rows.value.map((row) => {
    const signal = computeCounterpartyTrustScore(row, computedAt, domain);
    return createCounterpartyTrustProposal(signal, {
      id: draftId(idPrefix, "COUNTERPARTY_TRUST", row.merchant),
      principalId: opts.principalId,
      domain,
      createdAt: computedAt,
    });
  });

  return ok(drafts);
}
