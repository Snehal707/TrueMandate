import {
  WorkflowRuleStatus,
  type WorkflowRule,
} from "@truemandate/protocol";

/**
 * Deterministic supersession / versioning for WorkflowRule confirmations.
 *
 * Every WorkflowRule comes from the same confirmed-evidence path, so there is
 * no dual-origin branching (unlike preferences). Newer confirmed rule always
 * activates and supersedes the previous active tip; version increments by 1.
 */

export interface RuleSupersessionDecision {
  /** Whether the tip should point at the incoming record. */
  readonly activate: boolean;
  /** Incoming record with final status / version / lineage. */
  readonly incoming: WorkflowRule;
  /** Previous active record marked SUPERSEDED when activate=true and existed. */
  readonly previous?: WorkflowRule;
}

export function resolveRuleSupersession(
  existingActive: WorkflowRule | undefined,
  incoming: WorkflowRule,
): RuleSupersessionDecision {
  if (!existingActive) {
    return {
      activate: true,
      incoming: {
        ...incoming,
        version: 1,
        status: WorkflowRuleStatus.ACTIVE,
        supersedesId: undefined,
        supersededById: undefined,
      },
    };
  }

  const activated: WorkflowRule = {
    ...incoming,
    version: existingActive.version + 1,
    status: WorkflowRuleStatus.ACTIVE,
    supersedesId: existingActive.id,
    supersededById: undefined,
  };
  const previous: WorkflowRule = {
    ...existingActive,
    status: WorkflowRuleStatus.SUPERSEDED,
    supersededById: activated.id,
  };
  return { activate: true, incoming: activated, previous };
}
