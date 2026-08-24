import type { TrustSignal } from "@truemandate/protocol";
import {
  clampScore,
  hasMinimumEvidence,
  MIN_AGENT_WORKFLOWS,
  NEUTRAL_SCORE,
} from "./thresholds.js";
import type {
  AgentInterventionStats,
  ScoringProposalDraft,
  ScoringProposalOpts,
} from "./types.js";

/**
 * Deterministic agent reliability from Guardian intervention history.
 *
 * formula:
 *   interventionRate = interventionCount / max(workflowCount, 1)
 *   reliability = max(0, 1.0 - interventionRate)
 *
 * Insufficient history (workflowCount < MIN_AGENT_WORKFLOWS) → neutral 0.5.
 * Never model-generated; explainable from measured events only.
 */
export function computeAgentReliabilityScore(
  data: AgentInterventionStats,
  computedAt: string,
  domain = "procurement",
): TrustSignal {
  const workflowCount = Math.max(0, Math.floor(data.workflowCount));
  const interventionCount = Math.max(0, Math.floor(data.interventionCount));
  const sampleSize = workflowCount;

  const confident = hasMinimumEvidence(sampleSize, MIN_AGENT_WORKFLOWS);
  const interventionRate =
    workflowCount === 0 ? 0 : interventionCount / workflowCount;
  const value = confident
    ? clampScore(1.0 - interventionRate)
    : NEUTRAL_SCORE;

  return {
    subjectType: "AGENT",
    subjectId: data.agentKey,
    domain,
    value,
    sampleSize,
    basis: [
      `guardian_interventions:${interventionCount}`,
      `workflows_observed:${workflowCount}`,
      ...(confident
        ? []
        : [`insufficient_evidence:need_${MIN_AGENT_WORKFLOWS}`]),
    ],
    computedAt,
  };
}

export function createAgentReliabilityProposal(
  signal: TrustSignal,
  opts: ScoringProposalOpts,
): ScoringProposalDraft {
  if (signal.subjectType !== "AGENT") {
    throw new Error(
      "createAgentReliabilityProposal requires TrustSignal.subjectType AGENT",
    );
  }
  return {
    id: opts.id,
    principalId: opts.principalId,
    domain: opts.domain ?? signal.domain,
    proposalType: "AGENT_RELIABILITY",
    content: { trustSignal: signal },
    createdAt: opts.createdAt ?? signal.computedAt,
    expiresAt: opts.expiresAt,
  };
}
