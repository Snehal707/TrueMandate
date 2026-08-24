/** Constraint kinds from PROJECT_SPEC Critical Constraint Types. */
export const ConstraintKind = {
  HARD: "HARD",
  SOFT: "SOFT",
  SAFETY_CRITICAL: "SAFETY_CRITICAL",
  LEGAL: "LEGAL",
  FINANCIAL: "FINANCIAL",
  TEMPORAL: "TEMPORAL",
  PREFERENCE: "PREFERENCE",
  NEGATIVE_PREFERENCE: "NEGATIVE_PREFERENCE",
  METHOD_CONSTRAINT: "METHOD_CONSTRAINT",
  ORGANIZATIONAL_POLICY: "ORGANIZATIONAL_POLICY",
  LEARNED_PREFERENCE: "LEARNED_PREFERENCE",
} as const;
export type ConstraintKind = (typeof ConstraintKind)[keyof typeof ConstraintKind];

/** Sticky constraint kinds that must propagate automatically. */
export const STICKY_CONSTRAINT_KINDS: ReadonlySet<ConstraintKind> = new Set([
  ConstraintKind.HARD,
  ConstraintKind.SAFETY_CRITICAL,
  ConstraintKind.LEGAL,
  ConstraintKind.ORGANIZATIONAL_POLICY,
]);

export const MeaningClass = {
  EXPLICIT: "EXPLICIT",
  IMPLIED: "IMPLIED",
  INFERRED: "INFERRED",
  UNKNOWN: "UNKNOWN",
} as const;
export type MeaningClass = (typeof MeaningClass)[keyof typeof MeaningClass];

export const ConstraintMutability = {
  IMMUTABLE: "IMMUTABLE",
  HUMAN_REVISABLE: "HUMAN_REVISABLE",
  SYSTEM_DERIVED: "SYSTEM_DERIVED",
} as const;
export type ConstraintMutability =
  (typeof ConstraintMutability)[keyof typeof ConstraintMutability];

export const ConstraintOperator = {
  REQUIRE: "REQUIRE",
  FORBID: "FORBID",
  EQ: "EQ",
  NEQ: "NEQ",
  LT: "LT",
  LTE: "LTE",
  GT: "GT",
  GTE: "GTE",
  IN: "IN",
  NOT_IN: "NOT_IN",
  BETWEEN: "BETWEEN",
} as const;
export type ConstraintOperator =
  (typeof ConstraintOperator)[keyof typeof ConstraintOperator];

export const SourceType = {
  HUMAN: "HUMAN",
  SYSTEM: "SYSTEM",
  AGENT: "AGENT",
  EXTERNAL: "EXTERNAL",
  LEARNED: "LEARNED",
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const SemanticRelation = {
  DERIVED_FROM: "DERIVED_FROM",
  PRESERVES: "PRESERVES",
  WEAKENS: "WEAKENS",
  STRENGTHENS: "STRENGTHENS",
  CONTRADICTS: "CONTRADICTS",
  SUPPORTS: "SUPPORTS",
  PARTIALLY_SUPPORTS: "PARTIALLY_SUPPORTS",
  DOES_NOT_SUPPORT: "DOES_NOT_SUPPORT",
  ASSUMES: "ASSUMES",
  INTRODUCED_BY: "INTRODUCED_BY",
  INFLUENCED_BY: "INFLUENCED_BY",
  AUTHORIZES: "AUTHORIZES",
  RESULTED_IN: "RESULTED_IN",
  CORRECTED_BY: "CORRECTED_BY",
  SUMMARIZES: "SUMMARIZES",
  DELEGATES_TO: "DELEGATES_TO",
} as const;
export type SemanticRelation =
  (typeof SemanticRelation)[keyof typeof SemanticRelation];

export const ProvenanceNodeKind = {
  INTENT: "INTENT",
  CONSTRAINT: "CONSTRAINT",
  ASSUMPTION: "ASSUMPTION",
  CLAIM: "CLAIM",
  EVIDENCE: "EVIDENCE",
  PLAN: "PLAN",
  DECISION: "DECISION",
  ACTION: "ACTION",
  AUTHORITY: "AUTHORITY",
  OUTCOME: "OUTCOME",
  CORRECTION: "CORRECTION",
  PRINCIPAL: "PRINCIPAL",
  EXTERNAL: "EXTERNAL",
  /** Phase 6 Guardian committee finding (recommendation evidence, not authority). */
  FINDING: "FINDING",
  /** Phase 7 privileged tool execution attempt (not real-world outcome). */
  EXECUTION: "EXECUTION",
  /** Phase 7 recorded external side effect (not OutcomeContract state). */
  SIDE_EFFECT: "SIDE_EFFECT",
} as const;
export type ProvenanceNodeKind =
  (typeof ProvenanceNodeKind)[keyof typeof ProvenanceNodeKind];

export const AuthorityDecision = {
  ALLOW: "ALLOW",
  ALLOW_WITH_MONITORING: "ALLOW_WITH_MONITORING",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  BLOCK: "BLOCK",
} as const;
export type AuthorityDecision =
  (typeof AuthorityDecision)[keyof typeof AuthorityDecision];

/** Wave 4.3: durable MonitoringContract lifecycle (ALLOW_WITH_MONITORING). */
export const MonitoringContractState = {
  ACTIVE: "ACTIVE",
  ESCALATED: "ESCALATED",
  FROZEN: "FROZEN",
  RESOLUTION_OPENED: "RESOLUTION_OPENED",
  CLOSED: "CLOSED",
} as const;
export type MonitoringContractState =
  (typeof MonitoringContractState)[keyof typeof MonitoringContractState];

/** Wave 4.3: aggregated risk posture derived from MonitoringRiskSignal thresholds. */
export const MonitoringRiskState = {
  HEALTHY: "HEALTHY",
  ELEVATED: "ELEVATED",
  UNACCEPTABLE: "UNACCEPTABLE",
} as const;
export type MonitoringRiskState =
  (typeof MonitoringRiskState)[keyof typeof MonitoringRiskState];

/** Wave 4.3: severity of an individual monitoring risk signal. */
export const MonitoringSignalSeverity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
} as const;
export type MonitoringSignalSeverity =
  (typeof MonitoringSignalSeverity)[keyof typeof MonitoringSignalSeverity];

export const CapabilityName = {
  search: "search",
  compare: "compare",
  reserve: "reserve",
  execute_payment: "execute_payment",
  non_refundable_purchase: "non_refundable_purchase",
  request_evidence: "request_evidence",
  propose_remedy: "propose_remedy",
  execute_remedy: "execute_remedy",
  compensate: "compensate",
} as const;
export type CapabilityName = (typeof CapabilityName)[keyof typeof CapabilityName];

export const ExecutionState = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const;
export type ExecutionState = (typeof ExecutionState)[keyof typeof ExecutionState];

/** Trusted Tool Registry privilege classes (INV_016). Agent metadata cannot override. */
export const ToolPrivilegeClass = {
  T0_READ: "T0_READ",
  T1_REVERSIBLE_WRITE: "T1_REVERSIBLE_WRITE",
  T2_ECONOMIC_WRITE: "T2_ECONOMIC_WRITE",
  T3_HIGH_CONSEQUENCE: "T3_HIGH_CONSEQUENCE",
} as const;
export type ToolPrivilegeClass =
  (typeof ToolPrivilegeClass)[keyof typeof ToolPrivilegeClass];

export const ApprovalDecision = {
  APPROVE: "APPROVE",
  DENY: "DENY",
} as const;
export type ApprovalDecision =
  (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

/**
 * Durable human-approval lifecycle statuses (PROJECT_SPEC Wave 1).
 * A decided request can never return to PENDING; supersession and expiry
 * are terminal for the affected request.
 */
export const ApprovalRequestStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type ApprovalRequestStatus =
  (typeof ApprovalRequestStatus)[keyof typeof ApprovalRequestStatus];

/** Append-only approval lifecycle events (spec family: action.*). */
export const ApprovalEventType = {
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  APPROVAL_SUPERSEDED: "APPROVAL_SUPERSEDED",
} as const;
export type ApprovalEventType =
  (typeof ApprovalEventType)[keyof typeof ApprovalEventType];

export const ReconciliationState = {
  NOT_REQUIRED: "NOT_REQUIRED",
  REQUIRED: "REQUIRED",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
} as const;
export type ReconciliationState =
  (typeof ReconciliationState)[keyof typeof ReconciliationState];

export const OutcomeRequirementCriticality = {
  OPTIONAL: "OPTIONAL",
  SOFT: "SOFT",
  HARD: "HARD",
  SAFETY_CRITICAL: "SAFETY_CRITICAL",
} as const;
export type OutcomeRequirementCriticality =
  (typeof OutcomeRequirementCriticality)[keyof typeof OutcomeRequirementCriticality];

export const OutcomeRequirementState = {
  PENDING: "PENDING",
  SATISFIED: "SATISFIED",
  PARTIAL: "PARTIAL",
  BREACHED: "BREACHED",
  UNKNOWN: "UNKNOWN",
  CONFLICTED: "CONFLICTED",
  AT_RISK: "AT_RISK",
} as const;
export type OutcomeRequirementState =
  (typeof OutcomeRequirementState)[keyof typeof OutcomeRequirementState];

export const OutcomeRequirementType = {
  BOOLEAN: "BOOLEAN",
  NUMERIC: "NUMERIC",
  TEMPORAL: "TEMPORAL",
  SEMANTIC: "SEMANTIC",
  COMPOSITE: "COMPOSITE",
} as const;
export type OutcomeRequirementType =
  (typeof OutcomeRequirementType)[keyof typeof OutcomeRequirementType];

export const OutcomeEventType = {
  PAYMENT_SETTLED: "payment_settled",
  SHIPMENT_DELAYED: "shipment_delayed",
  QUANTITY_RECEIVED: "quantity_received",
  CERTIFICATE_OBSERVED: "certificate_observed",
  MERCHANT_OBSERVED: "merchant_observed",
  PRODUCT_OBSERVED: "product_observed",
  PRICE_OBSERVED: "price_observed",
  DELIVERY_ETA: "delivery_eta",
  OUTCOME_AT_RISK: "OUTCOME_AT_RISK",
  OUTCOME_PARTIAL: "OUTCOME_PARTIAL",
  OUTCOME_BREACHED: "OUTCOME_BREACHED",
  EVIDENCE_CONFLICT: "EVIDENCE_CONFLICT",
  CUSTOM: "custom",
} as const;
export type OutcomeEventType =
  (typeof OutcomeEventType)[keyof typeof OutcomeEventType];

export const OutcomeContractState = {
  CREATED: "CREATED",
  AWAITING_EXECUTION: "AWAITING_EXECUTION",
  AWAITING_OUTCOME: "AWAITING_OUTCOME",
  IN_PROGRESS: "IN_PROGRESS",
  AT_RISK: "AT_RISK",
  PARTIAL: "PARTIAL",
  SATISFIED: "SATISFIED",
  BREACHED: "BREACHED",
  CONFLICTED: "CONFLICTED",
  AWAITING_EVIDENCE: "AWAITING_EVIDENCE",
  RESOLUTION_ACTIVE: "RESOLUTION_ACTIVE",
  RESOLVED: "RESOLVED",
  MONITORING: "MONITORING",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type OutcomeContractState =
  (typeof OutcomeContractState)[keyof typeof OutcomeContractState];

export const LearningStatus = {
  PROPOSED: "PROPOSED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type LearningStatus = (typeof LearningStatus)[keyof typeof LearningStatus];

/** Wave 3.8: how a PreferenceRecord was originated. */
export const PreferenceOrigin = {
  EXPLICIT_USER_INPUT: "EXPLICIT_USER_INPUT",
  CONFIRMED_LEARNING: "CONFIRMED_LEARNING",
} as const;
export type PreferenceOrigin =
  (typeof PreferenceOrigin)[keyof typeof PreferenceOrigin];

/** Wave 3.8: PreferenceRecord lifecycle status (tip pointer tracks ACTIVE). */
export const PreferenceRecordStatus = {
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type PreferenceRecordStatus =
  (typeof PreferenceRecordStatus)[keyof typeof PreferenceRecordStatus];

/** Wave 3.9: WorkflowRule lifecycle status (tip pointer tracks ACTIVE). */
export const WorkflowRuleStatus = {
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
} as const;
export type WorkflowRuleStatus =
  (typeof WorkflowRuleStatus)[keyof typeof WorkflowRuleStatus];

export const LearningProposalEventType = {
  PROPOSED: "PROPOSED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
} as const;
export type LearningProposalEventType =
  (typeof LearningProposalEventType)[keyof typeof LearningProposalEventType];

export const ResponsibilityState = {
  UNKNOWN: "UNKNOWN",
  POSSIBLE: "POSSIBLE",
  LIKELY: "LIKELY",
  SHARED: "SHARED",
  ESTABLISHED: "ESTABLISHED",
  UNRESOLVABLE: "UNRESOLVABLE",
} as const;
export type ResponsibilityState =
  (typeof ResponsibilityState)[keyof typeof ResponsibilityState];

export const ResolutionCaseState = {
  OPEN: "OPEN",
  GATHERING_EVIDENCE: "GATHERING_EVIDENCE",
  ANALYZING: "ANALYZING",
  REMEDY_PROPOSED: "REMEDY_PROPOSED",
  AWAITING_AUTHORITY: "AWAITING_AUTHORITY",
  REMEDIATING: "REMEDIATING",
  VERIFYING_REMEDY: "VERIFYING_REMEDY",
  RESOLVED: "RESOLVED",
  ESCALATED: "ESCALATED",
  CLOSED: "CLOSED",
} as const;
export type ResolutionCaseState =
  (typeof ResolutionCaseState)[keyof typeof ResolutionCaseState];

export const RootCauseCode = {
  USER_AMBIGUITY: "USER_AMBIGUITY",
  INTENT_COMPILATION_ERROR: "INTENT_COMPILATION_ERROR",
  PLANNING_ERROR: "PLANNING_ERROR",
  DELEGATION_DRIFT: "DELEGATION_DRIFT",
  MODEL_REASONING_ERROR: "MODEL_REASONING_ERROR",
  POLICY_ERROR: "POLICY_ERROR",
  STALE_DATA: "STALE_DATA",
  MALICIOUS_EXTERNAL_CONTENT: "MALICIOUS_EXTERNAL_CONTENT",
  TOOL_FAILURE: "TOOL_FAILURE",
  MERCHANT_FAILURE: "MERCHANT_FAILURE",
  LOGISTICS_FAILURE: "LOGISTICS_FAILURE",
  PAYMENT_FAILURE: "PAYMENT_FAILURE",
  EVIDENCE_ERROR: "EVIDENCE_ERROR",
  UNKNOWN: "UNKNOWN",
} as const;
export type RootCauseCode = (typeof RootCauseCode)[keyof typeof RootCauseCode];

export const EstablishmentState = {
  OBSERVED_ARTIFACT: "OBSERVED_ARTIFACT",
  CLAIM: "CLAIM",
  ESTABLISHED_FACT: "ESTABLISHED_FACT",
} as const;
export type EstablishmentState =
  (typeof EstablishmentState)[keyof typeof EstablishmentState];

export const RemediationMandateStatus = {
  ACTIVE: "ACTIVE",
  CONSUMED: "CONSUMED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;
export type RemediationMandateStatus =
  (typeof RemediationMandateStatus)[keyof typeof RemediationMandateStatus];

export const ResolutionEventType = {
  CASE_OPENED: "CASE_OPENED",
  EVIDENCE_REQUESTED: "EVIDENCE_REQUESTED",
  EVIDENCE_RECEIVED: "EVIDENCE_RECEIVED",
  HYPOTHESIS_PROPOSED: "HYPOTHESIS_PROPOSED",
  HYPOTHESIS_UPDATED: "HYPOTHESIS_UPDATED",
  DIVERGENCE_IDENTIFIED: "DIVERGENCE_IDENTIFIED",
  REMEDY_PROPOSED: "REMEDY_PROPOSED",
  AUTHORITY_REQUESTED: "AUTHORITY_REQUESTED",
  MANDATE_ISSUED: "MANDATE_ISSUED",
  MANDATE_CONSUMED: "MANDATE_CONSUMED",
  REMEDY_EXECUTED: "REMEDY_EXECUTED",
  REMEDY_OUTCOME_OBSERVED: "REMEDY_OUTCOME_OBSERVED",
  CASE_RESOLVED: "CASE_RESOLVED",
  CASE_ESCALATED: "CASE_ESCALATED",
  VARIANCE_ACCEPTED: "VARIANCE_ACCEPTED",
} as const;
export type ResolutionEventType =
  (typeof ResolutionEventType)[keyof typeof ResolutionEventType];

/**
 * Deterministic remedy taxonomy (Wave 3.6). Mirrors the RemedyOption.kind
 * values already computed by resolution-core's remedy planner — this is a
 * structural classification of the proposed remedy action, never inferred.
 */
export const RemedyType = {
  REFUND: "REFUND",
  REPLACEMENT: "REPLACEMENT",
  EVIDENCE: "EVIDENCE",
  CANCEL: "CANCEL",
  ESCALATE: "ESCALATE",
} as const;
export type RemedyType = (typeof RemedyType)[keyof typeof RemedyType];

export const GuardianConstraintClassification = {
  SUPPORTED: "SUPPORTED",
  PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
  UNCERTAIN: "UNCERTAIN",
  CONTRADICTED: "CONTRADICTED",
  NOT_EVALUABLE: "NOT_EVALUABLE",
} as const;
export type GuardianConstraintClassification =
  (typeof GuardianConstraintClassification)[keyof typeof GuardianConstraintClassification];

export const GuardianSemanticStatus = {
  CLEAR: "CLEAR",
  UNCERTAIN: "UNCERTAIN",
  CONFLICTED: "CONFLICTED",
  CRITICAL_FAILURE: "CRITICAL_FAILURE",
} as const;
export type GuardianSemanticStatus =
  (typeof GuardianSemanticStatus)[keyof typeof GuardianSemanticStatus];

export const JudgeId = {
  FIDELITY: "FIDELITY",
  CONTRADICTION: "CONTRADICTION",
  DEVILS_ADVOCATE: "DEVILS_ADVOCATE",
  PROVENANCE: "PROVENANCE",
  EVIDENCE: "EVIDENCE",
} as const;
export type JudgeId = (typeof JudgeId)[keyof typeof JudgeId];

export const JudgeInvocationStatus = {
  OK: "OK",
  UNAVAILABLE: "UNAVAILABLE",
  SCHEMA_PARSE_FAILED: "SCHEMA_PARSE_FAILED",
  TIMEOUT: "TIMEOUT",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
} as const;
export type JudgeInvocationStatus =
  (typeof JudgeInvocationStatus)[keyof typeof JudgeInvocationStatus];

export const ConstraintApplicability = {
  APPLICABLE: "APPLICABLE",
  IRRELEVANT: "IRRELEVANT",
  DEFERRED: "DEFERRED",
} as const;
export type ConstraintApplicability =
  (typeof ConstraintApplicability)[keyof typeof ConstraintApplicability];

export const TrustClass = {
  TRUSTED_HUMAN: "TRUSTED_HUMAN",
  TRUSTED_SYSTEM: "TRUSTED_SYSTEM",
  UNTRUSTED_EXTERNAL: "UNTRUSTED_EXTERNAL",
  ELEVATED_EXTERNAL: "ELEVATED_EXTERNAL",
} as const;
export type TrustClass = (typeof TrustClass)[keyof typeof TrustClass];

export const TaintClass = {
  NONE: "NONE",
  EXTERNAL_CONTENT: "EXTERNAL_CONTENT",
  PROMPT_INJECTION_SUSPECTED: "PROMPT_INJECTION_SUSPECTED",
  UNVERIFIED_CLAIM: "UNVERIFIED_CLAIM",
} as const;
export type TaintClass = (typeof TaintClass)[keyof typeof TaintClass];

export const ConsequenceLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  IRREVERSIBLE: "IRREVERSIBLE",
} as const;
export type ConsequenceLevel =
  (typeof ConsequenceLevel)[keyof typeof ConsequenceLevel];

export const PlanStatus = {
  DRAFT: "DRAFT",
  UNDER_VERIFICATION: "UNDER_VERIFICATION",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  STALE: "STALE",
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

export const CommitmentLevel = {
  READ_ONLY: "READ_ONLY",
  REVERSIBLE_WRITE: "REVERSIBLE_WRITE",
  ECONOMIC: "ECONOMIC",
  HIGH_CONSEQUENCE: "HIGH_CONSEQUENCE",
} as const;
export type CommitmentLevel =
  (typeof CommitmentLevel)[keyof typeof CommitmentLevel];

export const ConstraintCoverageStatus = {
  ENFORCED: "ENFORCED",
  VERIFIED: "VERIFIED",
  PROPAGATED: "PROPAGATED",
  OPERATIONALIZED: "OPERATIONALIZED",
  /** Relevant to the workflow but not yet proven/enforced at this stage. */
  DEFERRED: "DEFERRED",
  /** No semantic bearing on this plan/step (not merely "enforced later"). */
  IRRELEVANT: "IRRELEVANT",
  MISSING: "MISSING",
} as const;
export type ConstraintCoverageStatus =
  (typeof ConstraintCoverageStatus)[keyof typeof ConstraintCoverageStatus];

export const GrantConsumptionState = {
  ACTIVE: "ACTIVE",
  CONSUMED: "CONSUMED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  /** Economic side effect may have occurred; await reconciliation before reuse. */
  PENDING_RECONCILIATION: "PENDING_RECONCILIATION",
} as const;

/** Durable prepare→authorize→commit lifecycle (INV_016–INV_022). */
export const PreparedActionLifecycle = {
  PREPARED: "PREPARED",
  AUTHORIZED: "AUTHORIZED",
  COMMITTING: "COMMITTING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const;
export type PreparedActionLifecycle =
  (typeof PreparedActionLifecycle)[keyof typeof PreparedActionLifecycle];
export type GrantConsumptionState =
  (typeof GrantConsumptionState)[keyof typeof GrantConsumptionState];

export const PaymentStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/**
 * Wave 2 observability: outcome of a single model call, including the
 * documented VertexGeminiModel failure branches. Telemetry, not a security
 * invariant — recording it must always be fail-open (see packages/observability).
 */
export const ModelCallStatus = {
  SUCCESS: "SUCCESS",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  OUTPUT_INVALID: "OUTPUT_INVALID",
  SCHEMA_PARSE_FAILED: "SCHEMA_PARSE_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  OTHER_ERROR: "OTHER_ERROR",
} as const;
export type ModelCallStatus = (typeof ModelCallStatus)[keyof typeof ModelCallStatus];

/**
 * Wave 2 observability: named workflow stages tracked for stage-timing
 * telemetry. Not all stages are wired to a recorder in every pass — see
 * docs/architecture for current instrumentation coverage.
 */
export const WorkflowStage = {
  INTENT_RECEIVED: "INTENT_RECEIVED",
  COMPILATION: "COMPILATION",
  VERIFICATION: "VERIFICATION",
  GUARDIAN: "GUARDIAN",
  AUTHORITY: "AUTHORITY",
  APPROVAL: "APPROVAL",
  PREPARE: "PREPARE",
  AUTHORIZE: "AUTHORIZE",
  COMMIT: "COMMIT",
  OUTCOME_VERIFICATION: "OUTCOME_VERIFICATION",
  RESOLUTION: "RESOLUTION",
  REMEDY: "REMEDY",
  CLOSURE: "CLOSURE",
} as const;
export type WorkflowStage = (typeof WorkflowStage)[keyof typeof WorkflowStage];

export const WorkflowStageEventStatus = {
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type WorkflowStageEventStatus =
  (typeof WorkflowStageEventStatus)[keyof typeof WorkflowStageEventStatus];
