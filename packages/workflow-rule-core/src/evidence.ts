import type { PreferenceRecord } from "@truemandate/protocol";

/**
 * Minimum distinct confirmed evidence refs required to propose a reusable
 * WORKFLOW_RULE. A single model inference or single confirmation is never enough.
 */
export const MIN_WORKFLOW_RULE_EVIDENCE = 3;

export function countDistinctEvidence(
  refs: readonly string[],
): number {
  const seen = new Set<string>();
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return seen.size;
}

export function hasSufficientEvidence(refs: readonly string[]): boolean {
  return countDistinctEvidence(refs) >= MIN_WORKFLOW_RULE_EVIDENCE;
}

export interface DerivedWorkflowRuleEvidence {
  readonly evidenceRefs: readonly string[];
  readonly basis: readonly string[];
  readonly sufficient: boolean;
}

/**
 * Derive evidenceRefs + basis from PreferenceRecord history for a
 * (subjectId, domain, concept) triple. Dedupes by sourceLearningProposalId
 * so repeated writes of the same confirmation never inflate the count.
 */
export function deriveEvidenceFromPreferenceHistory(
  records: readonly PreferenceRecord[],
  subjectId: string,
  domain: string,
  concept: string,
): DerivedWorkflowRuleEvidence {
  const matching = records
    .filter(
      (r) =>
        r.subjectId === subjectId &&
        r.domain === domain &&
        r.concept === concept,
    )
    .slice()
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));

  const seenProposal = new Set<string>();
  const evidenceRefs: string[] = [];
  const basis: string[] = [];

  for (const record of matching) {
    const proposalId = String(record.sourceLearningProposalId);
    if (seenProposal.has(proposalId)) continue;
    seenProposal.add(proposalId);
    evidenceRefs.push(proposalId);
    basis.push(`confirmed_preference:${record.id}@${record.confirmedAt}`);
  }

  return {
    evidenceRefs,
    basis,
    sufficient: hasSufficientEvidence(evidenceRefs),
  };
}
