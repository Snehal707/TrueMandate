import { hashCanonical } from "@truemandate/crypto";
import {
  WorkflowRuleStatus,
  asHashDigest,
  asWorkflowRuleId,
  type LearningProposalId,
  type PrincipalId,
  type WorkflowRule,
} from "@truemandate/protocol";

/**
 * Tip key for workflowRuleTips collection: subjectId::domain::concept.
 * Exact-match only — no cross-domain or cross-subject fallback.
 */
export function workflowRuleTipKey(
  subjectId: string,
  domain: string,
  concept: string,
): string {
  return `${subjectId}::${domain}::${concept}`;
}

export interface BuildWorkflowRuleInput {
  readonly id: string;
  readonly subjectId: string;
  readonly domain: string;
  readonly concept: string;
  readonly action: unknown;
  readonly evidenceRefs: readonly string[];
  readonly basis: readonly string[];
  readonly sourceLearningProposalId: LearningProposalId | string;
  readonly createdAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: PrincipalId | string;
  /** Optional seed version; supersession rewrites before persist. */
  readonly version?: number;
}

export function workflowRuleHash(
  value: Omit<WorkflowRule, "contentHash">,
): string {
  return hashCanonical(value);
}

/**
 * Build a WorkflowRule candidate (status ACTIVE, version 1 by default;
 * supersession may rewrite status / version / lineage before persist).
 */
export function buildWorkflowRule(input: BuildWorkflowRuleInput): WorkflowRule {
  const base: Omit<WorkflowRule, "contentHash"> = {
    id: asWorkflowRuleId(input.id),
    subjectId: input.subjectId,
    domain: input.domain,
    concept: input.concept,
    action: input.action,
    version: input.version ?? 1,
    status: WorkflowRuleStatus.ACTIVE,
    evidenceRefs: [...input.evidenceRefs],
    basis: [...input.basis],
    sourceLearningProposalId:
      input.sourceLearningProposalId as LearningProposalId,
    createdAt: input.createdAt,
    confirmedAt: input.confirmedAt,
    confirmedBy: input.confirmedBy as PrincipalId,
  };
  return {
    ...base,
    contentHash: asHashDigest(workflowRuleHash(base)),
  };
}

/**
 * Recompute contentHash after supersession mutates status / version / lineage.
 */
export function withWorkflowRuleHash(
  value: Omit<WorkflowRule, "contentHash"> & {
    readonly contentHash?: string;
  },
): WorkflowRule {
  const { contentHash: _drop, ...canonical } = value;
  return {
    ...canonical,
    contentHash: asHashDigest(workflowRuleHash(canonical)),
  };
}
