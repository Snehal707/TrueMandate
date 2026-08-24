import type { TrustSignal } from "@truemandate/protocol";
import {
  clampScore,
  hasMinimumEvidence,
  MIN_COUNTERPARTY_OUTCOMES,
  NEUTRAL_SCORE,
} from "./thresholds.js";
import type {
  CounterpartyOutcomeStats,
  ScoringProposalDraft,
  ScoringProposalOpts,
} from "./types.js";

/**
 * Deterministic counterparty trust from outcome history.
 *
 * formula:
 *   breachRate = partialOrBreached / max(totalOutcomes, 1)
 *   trustScore = max(0, 1.0 - breachRate)
 *
 * Insufficient history (totalOutcomes < MIN_COUNTERPARTY_OUTCOMES) → neutral 0.5.
 * Never model-generated; explainable from measured events only.
 */
export function computeCounterpartyTrustScore(
  data: CounterpartyOutcomeStats,
  computedAt: string,
  domain = "procurement",
): TrustSignal {
  const totalOutcomes = Math.max(0, Math.floor(data.totalOutcomes));
  const partialOrBreached = Math.max(0, Math.floor(data.partialOrBreached));
  const sampleSize = totalOutcomes;

  const confident = hasMinimumEvidence(sampleSize, MIN_COUNTERPARTY_OUTCOMES);
  const breachRate =
    totalOutcomes === 0 ? 0 : partialOrBreached / totalOutcomes;
  const value = confident ? clampScore(1.0 - breachRate) : NEUTRAL_SCORE;

  return {
    subjectType: "COUNTERPARTY",
    subjectId: data.merchant,
    domain,
    value,
    sampleSize,
    basis: [
      `outcome_breaches:${partialOrBreached}`,
      `total_outcomes:${totalOutcomes}`,
      ...(confident
        ? []
        : [`insufficient_evidence:need_${MIN_COUNTERPARTY_OUTCOMES}`]),
    ],
    computedAt,
  };
}

export function createCounterpartyTrustProposal(
  signal: TrustSignal,
  opts: ScoringProposalOpts,
): ScoringProposalDraft {
  if (signal.subjectType !== "COUNTERPARTY") {
    throw new Error(
      "createCounterpartyTrustProposal requires TrustSignal.subjectType COUNTERPARTY",
    );
  }
  return {
    id: opts.id,
    principalId: opts.principalId,
    domain: opts.domain ?? signal.domain,
    proposalType: "COUNTERPARTY_TRUST",
    content: { trustSignal: signal },
    createdAt: opts.createdAt ?? signal.computedAt,
    expiresAt: opts.expiresAt,
  };
}
