/** Branded string IDs for protocol object references. */
export type IntentId = string & { readonly __brand: "IntentId" };
export type IntentStateId = string & { readonly __brand: "IntentStateId" };
export type ConstraintId = string & { readonly __brand: "ConstraintId" };
export type AssumptionId = string & { readonly __brand: "AssumptionId" };
export type ProvenanceNodeId = string & { readonly __brand: "ProvenanceNodeId" };
export type ProvenanceEdgeId = string & { readonly __brand: "ProvenanceEdgeId" };
export type EvidenceId = string & { readonly __brand: "EvidenceId" };
export type ClaimId = string & { readonly __brand: "ClaimId" };
export type ActionId = string & { readonly __brand: "ActionId" };
export type PreparedActionId = string & { readonly __brand: "PreparedActionId" };
export type AuthorityRequestId = string & { readonly __brand: "AuthorityRequestId" };
export type AuthorityGrantId = string & { readonly __brand: "AuthorityGrantId" };
export type CommitTokenId = string & { readonly __brand: "CommitTokenId" };
export type OutcomeContractId = string & { readonly __brand: "OutcomeContractId" };
export type OutcomeRequirementId = string & {
  readonly __brand: "OutcomeRequirementId";
};
export type ResolutionCaseId = string & { readonly __brand: "ResolutionCaseId" };
export type RemedyProposalId = string & { readonly __brand: "RemedyProposalId" };
export type RemediationMandateId = string & {
  readonly __brand: "RemediationMandateId";
};
export type ApprovalRequestId = string & {
  readonly __brand: "ApprovalRequestId";
};
export type LearningProposalId = string & { readonly __brand: "LearningProposalId" };
export type LearnedContextRecordId = string & {
  readonly __brand: "LearnedContextRecordId";
};
export type PreferenceRecordId = string & {
  readonly __brand: "PreferenceRecordId";
};
export type WorkflowRuleId = string & {
  readonly __brand: "WorkflowRuleId";
};
export type PlanId = string & { readonly __brand: "PlanId" };
export type PlanStepId = string & { readonly __brand: "PlanStepId" };
export type DriftEventId = string & { readonly __brand: "DriftEventId" };
export type DelegationId = string & { readonly __brand: "DelegationId" };
export type PrincipalId = string & { readonly __brand: "PrincipalId" };
export type AgentId = string & { readonly __brand: "AgentId" };
export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };
export type Nonce = string & { readonly __brand: "Nonce" };
export type HashDigest = string & { readonly __brand: "HashDigest" };

export function asIntentId(value: string): IntentId {
  return value as IntentId;
}
export function asIntentStateId(value: string): IntentStateId {
  return value as IntentStateId;
}
export function asConstraintId(value: string): ConstraintId {
  return value as ConstraintId;
}
export function asAssumptionId(value: string): AssumptionId {
  return value as AssumptionId;
}
export function asProvenanceNodeId(value: string): ProvenanceNodeId {
  return value as ProvenanceNodeId;
}
export function asProvenanceEdgeId(value: string): ProvenanceEdgeId {
  return value as ProvenanceEdgeId;
}
export function asEvidenceId(value: string): EvidenceId {
  return value as EvidenceId;
}
export function asClaimId(value: string): ClaimId {
  return value as ClaimId;
}
export function asActionId(value: string): ActionId {
  return value as ActionId;
}
export function asPreparedActionId(value: string): PreparedActionId {
  return value as PreparedActionId;
}
export function asAuthorityRequestId(value: string): AuthorityRequestId {
  return value as AuthorityRequestId;
}
export function asAuthorityGrantId(value: string): AuthorityGrantId {
  return value as AuthorityGrantId;
}
export function asCommitTokenId(value: string): CommitTokenId {
  return value as CommitTokenId;
}
export function asOutcomeContractId(value: string): OutcomeContractId {
  return value as OutcomeContractId;
}
export function asOutcomeRequirementId(value: string): OutcomeRequirementId {
  return value as OutcomeRequirementId;
}
export function asResolutionCaseId(value: string): ResolutionCaseId {
  return value as ResolutionCaseId;
}
export function asRemedyProposalId(value: string): RemedyProposalId {
  return value as RemedyProposalId;
}
export function asApprovalRequestId(value: string): ApprovalRequestId {
  return value as ApprovalRequestId;
}

export function asRemediationMandateId(value: string): RemediationMandateId {
  return value as RemediationMandateId;
}
export function asLearningProposalId(value: string): LearningProposalId {
  return value as LearningProposalId;
}
export function asLearnedContextRecordId(value: string): LearnedContextRecordId {
  return value as LearnedContextRecordId;
}
export function asPreferenceRecordId(value: string): PreferenceRecordId {
  return value as PreferenceRecordId;
}
export function asWorkflowRuleId(value: string): WorkflowRuleId {
  return value as WorkflowRuleId;
}
export function asPlanId(value: string): PlanId {
  return value as PlanId;
}
export function asPlanStepId(value: string): PlanStepId {
  return value as PlanStepId;
}
export function asDriftEventId(value: string): DriftEventId {
  return value as DriftEventId;
}
export function asDelegationId(value: string): DelegationId {
  return value as DelegationId;
}
export function asPrincipalId(value: string): PrincipalId {
  return value as PrincipalId;
}
export function asAgentId(value: string): AgentId {
  return value as AgentId;
}
export function asIdempotencyKey(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}
export function asNonce(value: string): Nonce {
  return value as Nonce;
}
export function asHashDigest(value: string): HashDigest {
  return value as HashDigest;
}
