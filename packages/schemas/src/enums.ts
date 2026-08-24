import { z } from "zod";

export const ConstraintKindSchema = z.enum([
  "HARD",
  "SOFT",
  "SAFETY_CRITICAL",
  "LEGAL",
  "FINANCIAL",
  "TEMPORAL",
  "PREFERENCE",
  "NEGATIVE_PREFERENCE",
  "METHOD_CONSTRAINT",
  "ORGANIZATIONAL_POLICY",
  "LEARNED_PREFERENCE",
]);

export const MeaningClassSchema = z.enum([
  "EXPLICIT",
  "IMPLIED",
  "INFERRED",
  "UNKNOWN",
]);

export const ConstraintMutabilitySchema = z.enum([
  "IMMUTABLE",
  "HUMAN_REVISABLE",
  "SYSTEM_DERIVED",
]);

export const ConstraintOperatorSchema = z.enum([
  "REQUIRE",
  "FORBID",
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "IN",
  "NOT_IN",
  "BETWEEN",
]);

export const SourceTypeSchema = z.enum([
  "HUMAN",
  "SYSTEM",
  "AGENT",
  "EXTERNAL",
  "LEARNED",
]);

export const SemanticRelationSchema = z.enum([
  "DERIVED_FROM",
  "PRESERVES",
  "WEAKENS",
  "STRENGTHENS",
  "CONTRADICTS",
  "SUPPORTS",
  "PARTIALLY_SUPPORTS",
  "DOES_NOT_SUPPORT",
  "ASSUMES",
  "INTRODUCED_BY",
  "INFLUENCED_BY",
  "AUTHORIZES",
  "RESULTED_IN",
  "CORRECTED_BY",
  "SUMMARIZES",
  "DELEGATES_TO",
]);

export const ProvenanceNodeKindSchema = z.enum([
  "INTENT",
  "CONSTRAINT",
  "ASSUMPTION",
  "CLAIM",
  "EVIDENCE",
  "PLAN",
  "DECISION",
  "ACTION",
  "AUTHORITY",
  "OUTCOME",
  "CORRECTION",
  "PRINCIPAL",
  "EXTERNAL",
  "FINDING",
  "EXECUTION",
  "SIDE_EFFECT",
]);

export const AuthorityDecisionSchema = z.enum([
  "ALLOW",
  "ALLOW_WITH_MONITORING",
  "REQUIRE_APPROVAL",
  "BLOCK",
]);

export const MonitoringContractStateSchema = z.enum([
  "ACTIVE",
  "ESCALATED",
  "FROZEN",
  "RESOLUTION_OPENED",
  "CLOSED",
]);

export const MonitoringRiskStateSchema = z.enum([
  "HEALTHY",
  "ELEVATED",
  "UNACCEPTABLE",
]);

export const MonitoringSignalSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

export const ExecutionStateSchema = z.enum([
  "PENDING",
  "SUCCESS",
  "FAILED",
  "UNKNOWN",
]);

export const ToolPrivilegeClassSchema = z.enum([
  "T0_READ",
  "T1_REVERSIBLE_WRITE",
  "T2_ECONOMIC_WRITE",
  "T3_HIGH_CONSEQUENCE",
]);

export const ApprovalDecisionSchema = z.enum(["APPROVE", "DENY"]);

export const ApprovalRequestStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const ApprovalEventTypeSchema = z.enum([
  "APPROVAL_REQUESTED",
  "APPROVED",
  "REJECTED",
  "APPROVAL_EXPIRED",
  "APPROVAL_SUPERSEDED",
]);

export const ReconciliationStateSchema = z.enum([
  "NOT_REQUIRED",
  "REQUIRED",
  "IN_PROGRESS",
  "RESOLVED",
]);

export const OutcomeRequirementCriticalitySchema = z.enum([
  "OPTIONAL",
  "SOFT",
  "HARD",
  "SAFETY_CRITICAL",
]);

export const OutcomeRequirementStateSchema = z.enum([
  "PENDING",
  "SATISFIED",
  "PARTIAL",
  "BREACHED",
  "UNKNOWN",
  "CONFLICTED",
  "AT_RISK",
]);

export const OutcomeRequirementTypeSchema = z.enum([
  "BOOLEAN",
  "NUMERIC",
  "TEMPORAL",
  "SEMANTIC",
  "COMPOSITE",
]);

export const OutcomeEventTypeSchema = z.enum([
  "payment_settled",
  "shipment_delayed",
  "quantity_received",
  "certificate_observed",
  "merchant_observed",
  "product_observed",
  "price_observed",
  "delivery_eta",
  "OUTCOME_AT_RISK",
  "OUTCOME_PARTIAL",
  "OUTCOME_BREACHED",
  "EVIDENCE_CONFLICT",
  "custom",
]);

export const OutcomeContractStateSchema = z.enum([
  "CREATED",
  "AWAITING_EXECUTION",
  "AWAITING_OUTCOME",
  "IN_PROGRESS",
  "AT_RISK",
  "PARTIAL",
  "SATISFIED",
  "BREACHED",
  "CONFLICTED",
  "AWAITING_EVIDENCE",
  "RESOLUTION_ACTIVE",
  "RESOLVED",
  "MONITORING",
  "CLOSED",
  "CANCELLED",
]);

export const LearningStatusSchema = z.enum([
  "PROPOSED",
  "CONFIRMED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const LearningProposalEventTypeSchema = z.enum([
  "PROPOSED",
  "CONFIRMED",
  "REJECTED",
  "EXPIRED",
]);

export const LearningProposalTypeSchema = z.enum([
  "USER_PREFERENCE",
  "AGENT_RELIABILITY",
  "COUNTERPARTY_TRUST",
  "WORKFLOW_RULE",
]);

export const PreferenceOriginSchema = z.enum([
  "EXPLICIT_USER_INPUT",
  "CONFIRMED_LEARNING",
]);

export const PreferenceRecordStatusSchema = z.enum(["ACTIVE", "SUPERSEDED"]);

export const WorkflowRuleStatusSchema = z.enum(["ACTIVE", "SUPERSEDED"]);

export const ResponsibilityStateSchema = z.enum([
  "UNKNOWN",
  "POSSIBLE",
  "LIKELY",
  "SHARED",
  "ESTABLISHED",
  "UNRESOLVABLE",
]);

export const ResolutionCaseStateSchema = z.enum([
  "OPEN",
  "GATHERING_EVIDENCE",
  "ANALYZING",
  "REMEDY_PROPOSED",
  "AWAITING_AUTHORITY",
  "REMEDIATING",
  "VERIFYING_REMEDY",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
]);

export const RootCauseCodeSchema = z.enum([
  "USER_AMBIGUITY",
  "INTENT_COMPILATION_ERROR",
  "PLANNING_ERROR",
  "DELEGATION_DRIFT",
  "MODEL_REASONING_ERROR",
  "POLICY_ERROR",
  "STALE_DATA",
  "MALICIOUS_EXTERNAL_CONTENT",
  "TOOL_FAILURE",
  "MERCHANT_FAILURE",
  "LOGISTICS_FAILURE",
  "PAYMENT_FAILURE",
  "EVIDENCE_ERROR",
  "UNKNOWN",
]);

export const EstablishmentStateSchema = z.enum([
  "OBSERVED_ARTIFACT",
  "CLAIM",
  "ESTABLISHED_FACT",
]);

export const ResolutionEventTypeSchema = z.enum([
  "CASE_OPENED",
  "EVIDENCE_REQUESTED",
  "EVIDENCE_RECEIVED",
  "HYPOTHESIS_PROPOSED",
  "HYPOTHESIS_UPDATED",
  "DIVERGENCE_IDENTIFIED",
  "REMEDY_PROPOSED",
  "AUTHORITY_REQUESTED",
  "MANDATE_ISSUED",
  "MANDATE_CONSUMED",
  "REMEDY_EXECUTED",
  "REMEDY_OUTCOME_OBSERVED",
  "CASE_RESOLVED",
  "CASE_ESCALATED",
  "VARIANCE_ACCEPTED",
]);

/** Deterministic remedy taxonomy (Wave 3.6). Mirrors protocol RemedyType. */
export const RemedyTypeSchema = z.enum([
  "REFUND",
  "REPLACEMENT",
  "EVIDENCE",
  "CANCEL",
  "ESCALATE",
]);

export const RemediationMandateStatusSchema = z.enum([
  "ACTIVE",
  "CONSUMED",
  "EXPIRED",
  "REVOKED",
]);

export const GuardianConstraintClassificationSchema = z.enum([
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNCERTAIN",
  "CONTRADICTED",
  "NOT_EVALUABLE",
]);

export const GuardianSemanticStatusSchema = z.enum([
  "CLEAR",
  "UNCERTAIN",
  "CONFLICTED",
  "CRITICAL_FAILURE",
]);

export const JudgeIdSchema = z.enum([
  "FIDELITY",
  "CONTRADICTION",
  "DEVILS_ADVOCATE",
  "PROVENANCE",
  "EVIDENCE",
]);

export const JudgeInvocationStatusSchema = z.enum([
  "OK",
  "UNAVAILABLE",
  "SCHEMA_PARSE_FAILED",
  "TIMEOUT",
  "PROVIDER_FAILURE",
]);

export const ConstraintApplicabilitySchema = z.enum([
  "APPLICABLE",
  "IRRELEVANT",
  "DEFERRED",
]);

export const TrustClassSchema = z.enum([
  "TRUSTED_HUMAN",
  "TRUSTED_SYSTEM",
  "UNTRUSTED_EXTERNAL",
  "ELEVATED_EXTERNAL",
]);

export const TaintClassSchema = z.enum([
  "NONE",
  "EXTERNAL_CONTENT",
  "PROMPT_INJECTION_SUSPECTED",
  "UNVERIFIED_CLAIM",
]);

export const ConsequenceLevelSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "IRREVERSIBLE",
]);

export const PlanStatusSchema = z.enum([
  "DRAFT",
  "UNDER_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "STALE",
]);

export const CommitmentLevelSchema = z.enum([
  "READ_ONLY",
  "REVERSIBLE_WRITE",
  "ECONOMIC",
  "HIGH_CONSEQUENCE",
]);

export const ConstraintCoverageStatusSchema = z.enum([
  "ENFORCED",
  "VERIFIED",
  "PROPAGATED",
  "OPERATIONALIZED",
  "DEFERRED",
  "IRRELEVANT",
  "MISSING",
]);

export const GrantConsumptionStateSchema = z.enum([
  "ACTIVE",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
  "PENDING_RECONCILIATION",
]);

export const PreparedActionLifecycleSchema = z.enum([
  "PREPARED",
  "AUTHORIZED",
  "COMMITTING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
]);

export const PaymentStatusSchema = z.enum([
  "PENDING",
  "SUCCESS",
  "FAILED",
  "UNKNOWN",
]);

export const ModelCallStatusSchema = z.enum([
  "SUCCESS",
  "MODEL_UNAVAILABLE",
  "OUTPUT_INVALID",
  "SCHEMA_PARSE_FAILED",
  "RATE_LIMITED",
  "OTHER_ERROR",
]);

export const WorkflowStageSchema = z.enum([
  "INTENT_RECEIVED",
  "COMPILATION",
  "VERIFICATION",
  "GUARDIAN",
  "AUTHORITY",
  "APPROVAL",
  "PREPARE",
  "AUTHORIZE",
  "COMMIT",
  "OUTCOME_VERIFICATION",
  "RESOLUTION",
  "REMEDY",
  "CLOSURE",
]);

export const WorkflowStageEventStatusSchema = z.enum([
  "STARTED",
  "COMPLETED",
  "FAILED",
]);
