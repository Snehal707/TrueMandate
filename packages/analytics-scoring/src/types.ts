import type { LearningProposalType, TrustSignal } from "@truemandate/protocol";

/**
 * Minimal analytics row shapes accepted by scorers.
 * Structurally compatible with analytics-query query rows — scoring does not
 * import analytics-query (avoids circular deps; query → scoring only).
 */
export interface AgentInterventionStats {
  readonly agentKey: string;
  readonly interventionCount: number;
  readonly workflowCount: number;
}

export interface CounterpartyOutcomeStats {
  readonly merchant: string;
  readonly totalOutcomes: number;
  readonly partialOrBreached: number;
  readonly failureRate: number;
}

/**
 * Draft shape compatible with authority LearningProposalDraft.
 * Scoring never calls createLearningProposal itself — callers POST drafts.
 */
export interface ScoringProposalDraft {
  readonly id: string;
  readonly principalId: string;
  readonly domain: string;
  readonly proposalType: Extract<
    LearningProposalType,
    "AGENT_RELIABILITY" | "COUNTERPARTY_TRUST"
  >;
  readonly content: Readonly<{
    readonly trustSignal: TrustSignal;
  }>;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface ScoringProposalOpts {
  readonly id: string;
  readonly principalId: string;
  readonly domain?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
}
