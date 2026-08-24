import {
  STICKY_CONSTRAINT_KINDS,
  type Constraint,
  type WorkflowRule,
} from "@truemandate/protocol";
import { isProtectedPreferenceConcept } from "@truemandate/preference-core";

/**
 * Deterministic applicability / precedence for workflow rules.
 *
 * Ranking:
 *   hard/legal sticky > current explicit intent > confirmed workflow rule >
 *   model inference (caller)
 *
 * Rules never override explicit current IntentState and never apply to
 * protected concepts (budget/quantity/merchant/deadline/capability/authority).
 */

export const ApplicableWorkflowRuleKind = {
  EXPLICIT_CURRENT: "EXPLICIT_CURRENT",
  RULE: "RULE",
  NONE: "NONE",
} as const;
export type ApplicableWorkflowRuleKind =
  (typeof ApplicableWorkflowRuleKind)[keyof typeof ApplicableWorkflowRuleKind];

export interface ApplicableWorkflowRuleResult {
  readonly kind: ApplicableWorkflowRuleKind;
  readonly rule?: WorkflowRule;
  readonly reason: string;
}

export function resolveApplicableWorkflowRule(
  currentConstraints: readonly Constraint[],
  concept: string,
  activeRule?: WorkflowRule,
): ApplicableWorkflowRuleResult {
  const normalized = concept.trim();
  const matching = currentConstraints.filter((c) => c.concept === normalized);

  const sticky = matching.find((c) => STICKY_CONSTRAINT_KINDS.has(c.kind));
  if (sticky) {
    return {
      kind: ApplicableWorkflowRuleKind.EXPLICIT_CURRENT,
      reason: `sticky constraint ${sticky.kind} already present for concept`,
    };
  }

  if (matching.length > 0) {
    return {
      kind: ApplicableWorkflowRuleKind.EXPLICIT_CURRENT,
      reason: "explicit current IntentState already specifies concept",
    };
  }

  if (isProtectedPreferenceConcept(normalized)) {
    return {
      kind: ApplicableWorkflowRuleKind.NONE,
      reason: "protected concept cannot be filled by workflow rule",
    };
  }

  if (activeRule && activeRule.concept === normalized) {
    return {
      kind: ApplicableWorkflowRuleKind.RULE,
      rule: activeRule,
      reason: "active confirmed workflow rule fills unspecified soft concept",
    };
  }

  return {
    kind: ApplicableWorkflowRuleKind.NONE,
    reason: "no applicable workflow rule; caller may fall through to model inference",
  };
}
