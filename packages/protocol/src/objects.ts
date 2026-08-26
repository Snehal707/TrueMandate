import type {
  ApprovalDecision,
  ApprovalEventType,
  ApprovalRequestStatus,
  AuthorityDecision,
  CapabilityName,
  ConsequenceLevel,
  ConstraintApplicability,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ExecutionState,
  GrantConsumptionState,
  PreparedActionLifecycle,
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  LearningProposalEventType,
  LearningStatus,
  MeaningClass,
  ModelCallStatus,
  MonitoringContractState,
  MonitoringRiskState,
  MonitoringSignalSeverity,
  EstablishmentState,
  OutcomeContractState,
  OutcomeEventType,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  OutcomeRequirementType,
  PaymentStatus,
  PreferenceOrigin,
  PreferenceRecordStatus,
  WorkflowRuleStatus,
  RemediationMandateStatus,
  RemedyType,
  ResolutionCaseState,
  ResolutionEventType,
  RootCauseCode,
  ProvenanceNodeKind,
  ReconciliationState,
  ResponsibilityState,
  SemanticRelation,
  SourceType,
  TaintClass,
  ToolPrivilegeClass,
  TrustClass,
  WorkflowStage,
  WorkflowStageEventStatus,
} from "./enums.js";
import type {
  ActionId,
  AgentId,
  ApprovalRequestId,
  AssumptionId,
  AuthorityGrantId,
  AuthorityRequestId,
  ClaimId,
  CommitTokenId,
  ConstraintId,
  DelegationId,
  DriftEventId,
  EvidenceId,
  HashDigest,
  IdempotencyKey,
  IntentId,
  IntentStateId,
  LearningProposalId,
  LearnedContextRecordId,
  PreferenceRecordId,
  WorkflowRuleId,
  Nonce,
  OutcomeContractId,
  OutcomeRequirementId,
  PlanId,
  PlanStepId,
  PreparedActionId,
  PrincipalId,
  ProvenanceEdgeId,
  ProvenanceNodeId,
  RemedyProposalId,
  RemediationMandateId,
  ResolutionCaseId,
} from "./ids.js";

/**
 * UTF-16 code unit offsets matching `String.prototype.slice`.
 * Invariant: `raw.slice(start, end) === sourceText` (exact; no NFC normalize).
 */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface Constraint {
  readonly id: ConstraintId;
  readonly concept: string;
  readonly operator: ConstraintOperator;
  readonly value: unknown;
  readonly kind: ConstraintKind;
  readonly importance: number;
  readonly confidence: number;
  readonly sourceType: SourceType;
  readonly sourceText?: string;
  readonly sourceSpan?: SourceSpan;
  readonly mutability: ConstraintMutability;
  readonly meaningClass: MeaningClass;
  readonly proofObligation?: ProofObligation;
}

export interface ProofObligation {
  readonly verificationStep: string;
  readonly requiredEvidence: string;
  readonly enforcingService: string;
  readonly constraintId?: ConstraintId;
  readonly planStepId?: PlanStepId;
  readonly evidenceKinds?: readonly string[];
}

/**
 * Immutable raw human intent. There is no protocol API to edit `rawText`.
 * Human changes create a new IntentState referencing a new or same Intent.
 */
export interface Intent {
  readonly id: IntentId;
  readonly principalId: PrincipalId;
  readonly rawText: string;
  readonly createdAt: string;
  readonly contentHash: HashDigest;
}

export interface IntentState {
  readonly id: IntentStateId;
  readonly intentId: IntentId;
  /** Hash of the immutable Intent.rawText / content — never mutated in place. */
  readonly rawIntentHash: HashDigest;
  readonly version: number;
  readonly constraints: readonly Constraint[];
  readonly assumptions: readonly Assumption[];
  readonly createdAt: string;
  readonly createdBy: PrincipalId | AgentId;
  readonly previousStateId?: IntentStateId;
  /**
   * Authoritative capability permissions (human/enterprise policy). Absent
   * means unspecified; the executing coordinator frames the bounded ALLOW
   * scope. `REQUIRE_APPROVAL` here routes execution through the durable
   * human-approval lifecycle.
   */
  readonly capabilities?: Readonly<Partial<Record<CapabilityName | string, CapabilityPermission>>>;
  readonly temporalAuthority?: {
    readonly executionNotAfter: string;
    readonly executionNotBefore?: string;
    readonly source: "EXPLICIT_HUMAN" | "ENTERPRISE_POLICY";
    readonly sourceRef: string;
    readonly provenanceNodeId?: ProvenanceNodeId;
  };
  readonly stateHash: HashDigest;
}

export interface Assumption {
  readonly id: AssumptionId;
  readonly statement: string;
  readonly confidence: number;
  readonly sourceType: SourceType;
  readonly meaningClass: MeaningClass;
}

export type CapabilityPermission = AuthorityDecision;

export interface CapabilityScope {
  readonly capabilities: Readonly<Partial<Record<CapabilityName | string, CapabilityPermission>>>;
  readonly maxAmount?: number;
  readonly currency?: string;
  readonly allowedMerchants?: readonly string[];
  readonly deniedMerchants?: readonly string[];
  readonly allowedCategories?: readonly string[];
  readonly resourceScope?: readonly string[];
  readonly expiresAt?: string;
  readonly maxDelegationDepth?: number;
}

export interface DelegationEnvelope {
  readonly id: DelegationId;
  readonly parentAgentId: AgentId;
  readonly childAgentId: AgentId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly parentScope: CapabilityScope;
  readonly childScope: CapabilityScope;
  readonly stickyConstraintIds: readonly ConstraintId[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly delegationDepth: number;
  readonly planId?: PlanId;
  readonly planStepId?: PlanStepId;
  readonly permittedTransformations?: readonly string[];
  readonly prohibitedTransformations?: readonly string[];
  readonly requiredConstraintIds?: readonly ConstraintId[];
  readonly envelopeHash?: HashDigest;
  readonly provenanceParentNodeId?: ProvenanceNodeId;
}

export interface TaintMetadata {
  readonly classes: readonly TaintClass[];
  readonly origins: readonly ProvenanceNodeId[];
  readonly reason?: string;
}

export interface ProvenanceNode {
  readonly id: ProvenanceNodeId;
  readonly kind: ProvenanceNodeKind;
  readonly label: string;
  readonly createdAt: string;
  readonly subjectRef?: string;
  readonly trustClass: TrustClass;
  readonly taint: TaintMetadata;
  readonly payloadHash?: HashDigest;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Influence / derivation edge polarity:
 * `from` = upstream source → `to` = downstream derivative.
 * Relation names label that arrow (DERIVED_FROM is source→derivative).
 */
export interface ProvenanceEdge {
  readonly id: ProvenanceEdgeId;
  readonly from: ProvenanceNodeId;
  readonly to: ProvenanceNodeId;
  readonly relation: SemanticRelation;
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EvidenceEnvelope {
  readonly id: EvidenceId;
  readonly source: string;
  readonly contentHash: HashDigest;
  readonly trustClass: TrustClass;
  readonly captureTime: string;
  readonly eventTime?: string;
  readonly freshnessDeadline?: string;
  readonly taint: TaintMetadata;
  readonly signature?: string;
  readonly mimeType?: string;
  /** Lineage/origin group — copies of the same source share this id. */
  readonly lineageGroupId?: string;
  readonly originId?: string;
}

export interface EvidenceClaim {
  readonly id: ClaimId;
  readonly evidenceId: EvidenceId;
  readonly concept: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly derivedBy: AgentId | string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  readonly taint: TaintMetadata;
  readonly invalidatedAt?: string;
  readonly correctedByClaimId?: ClaimId;
}

export interface ActionProposal {
  readonly id: ActionId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly agentId: AgentId;
  readonly capability: CapabilityName | string;
  readonly merchant?: string;
  readonly product?: string;
  readonly quantity?: number;
  readonly amount?: number;
  readonly currency?: string;
  readonly refundable?: boolean;
  readonly deliveryTerms?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly consequenceLevel: ConsequenceLevel;
  readonly createdAt: string;
  readonly planId?: PlanId;
  readonly planStepId?: PlanStepId;
}

export interface JudgeFinding {
  readonly judgeId: JudgeId;
  readonly code: string;
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly message: string;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
}

export interface ConstraintClaim {
  readonly constraintId: ConstraintId;
  readonly classification: GuardianConstraintClassification;
  readonly applicability: ConstraintApplicability;
  readonly confidence: number;
  readonly criticality: ConstraintKind;
  readonly rationale?: string;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly contradictoryEvidenceIds?: readonly EvidenceId[];
  readonly assumptionIds?: readonly AssumptionId[];
  readonly provenanceNodeIds?: readonly ProvenanceNodeId[];
  readonly transformationClasses?: readonly string[];
  readonly judgeFindings?: readonly JudgeFinding[];
}

export interface JudgeConstraintClassification {
  readonly constraintId: ConstraintId;
  readonly classification: GuardianConstraintClassification;
  readonly confidence: number;
  readonly rationale?: string;
}

export interface JudgeResult {
  readonly judgeId: JudgeId;
  readonly status: JudgeInvocationStatus;
  readonly findings: readonly JudgeFinding[];
  readonly constraintClassifications?: readonly JudgeConstraintClassification[];
  readonly modelId?: string;
  readonly promptVersion?: string;
  readonly schemaId?: string;
  readonly schemaVersion?: string;
  readonly message?: string;
}

export interface GuardianVerdict {
  readonly id: string;
  readonly actionId: ActionId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  /** Bound IntentState.stateHash at evaluation time — content drift invalidates the verdict. */
  readonly intentStateHash: HashDigest;
  readonly planId?: PlanId;
  readonly planVersion?: number;
  readonly actionContentHash: HashDigest;
  readonly evidenceSnapshotHash: HashDigest;
  readonly decision: AuthorityDecision;
  readonly semanticStatus: GuardianSemanticStatus;
  readonly overallFidelity?: number;
  readonly constraintClaims: readonly ConstraintClaim[];
  readonly contradictions: readonly string[];
  readonly uncertainty: number;
  readonly criticalFailure: boolean;
  readonly judgeResults: readonly JudgeResult[];
  readonly verdictHash: HashDigest;
  readonly protocolVersion: string;
  readonly promptVersions: Readonly<Record<string, string>>;
  readonly schemaVersions: Readonly<Record<string, string>>;
  readonly stale: boolean;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  readonly createdAt: string;
}

export interface DriftEvent {
  readonly id: DriftEventId;
  readonly intentStateId: IntentStateId;
  readonly relation: SemanticRelation;
  readonly fromConcept: string;
  readonly toConcept: string;
  readonly severity: ConsequenceLevel;
  readonly detectedAt: string;
  readonly provenanceEdgeId?: ProvenanceEdgeId;
}

export interface AuthorityRequest {
  readonly id: AuthorityRequestId;
  readonly principalId: PrincipalId;
  /** Canonical learning subject key used for user-scoped adaptive signals. */
  readonly adaptiveSubjectId?: string;
  readonly agentId: AgentId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly actionId: ActionId;
  readonly preparedActionId?: PreparedActionId;
  readonly capability: CapabilityName | string;
  readonly scope: CapabilityScope;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly createdAt: string;
}

export interface AuthorityGrant {
  readonly id: AuthorityGrantId;
  readonly requestId: AuthorityRequestId;
  readonly principalId: PrincipalId;
  readonly agentId: AgentId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly actionId: ActionId;
  readonly preparedActionId: PreparedActionId;
  readonly capability: CapabilityName | string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly scope: CapabilityScope;
  readonly decision: AuthorityDecision;
  readonly expiresAt: string;
  readonly nonce: Nonce;
  readonly stateHash: HashDigest;
  readonly preparedActionHash: HashDigest;
  readonly consumptionState: GrantConsumptionState;
  readonly revokedAt?: string;
  readonly consumedAt?: string;
  readonly createdAt: string;
  readonly transferable: false;
  readonly evaluationRecordId?: string;
  readonly evaluationRecordHash?: HashDigest;
  readonly outcomeContractId?: OutcomeContractId | string;
  readonly outcomeContractHash?: HashDigest;
  readonly workflowId?: string;
  readonly actionContentHash?: HashDigest;
  readonly evaluatedIntentStateVersion?: number;
}

export interface AuthorityExtensionRequest {
  readonly id: AuthorityRequestId;
  readonly grantId: AuthorityGrantId;
  readonly requestedBy: AgentId | PrincipalId;
  readonly reason: string;
  readonly requestedScope: CapabilityScope;
  readonly createdAt: string;
}

export interface PreparedActionParameters {
  readonly merchant?: string;
  readonly product?: string;
  readonly quantity?: number;
  readonly amount?: number;
  readonly currency?: string;
  readonly refundability?: boolean;
  readonly deliveryTerms?: string;
  /** Food-grade / cert refs, approval status, SKU, etc. */
  readonly toolParameters: Readonly<Record<string, unknown>>;
}

/** Material commercial/external fields for TOCTOU (view counts are non-material). */
export interface MaterialExternalSnapshot {
  readonly merchant?: string;
  readonly product?: string;
  readonly quantity?: number;
  readonly amount?: number;
  readonly currency?: string;
  readonly refundability?: boolean;
  readonly deliveryTerms?: string;
  readonly certificationRef?: string;
  readonly counterparty?: string;
  readonly sku?: string;
}

export interface PreparedAction {
  readonly id: PreparedActionId;
  readonly actionId: ActionId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly agentId: AgentId;
  readonly capability: CapabilityName | string;
  /** Gateway-owned copy of the evaluated capability scope; part of the full hash. */
  readonly authorityScope?: CapabilityScope;
  readonly parameters: PreparedActionParameters;
  readonly parameterHash: HashDigest;
  /** INV_018: hash of every authorization-relevant field except this digest. */
  readonly preparedActionHash: HashDigest;
  readonly createdAt: string;
  readonly bundleId?: string;
  readonly dependsOnPreparedActionIds?: readonly PreparedActionId[];
  /** Phase 7 binding fields (optional for legacy Phase 3 fixtures). */
  readonly intentStateHash?: HashDigest;
  readonly planId?: PlanId;
  readonly planVersion?: number;
  readonly actionProposalId?: ActionId;
  readonly actionContentHash?: HashDigest;
  readonly guardianVerdictId?: string;
  readonly guardianVerdictHash?: HashDigest;
  readonly principalId?: PrincipalId;
  readonly toolId?: string;
  readonly idempotencyKey?: IdempotencyKey | string;
  readonly expiresAt?: string;
  readonly externalStateSnapshot?: MaterialExternalSnapshot;
  readonly externalStateHash?: HashDigest;
  /** Phase 8: bound OutcomeContract required for T2/T3 commit. */
  readonly outcomeContractId?: OutcomeContractId | string;
  readonly outcomeContractHash?: HashDigest;
  /** Pre-commit materialization lineage. All fields participate in the full
   * PreparedAction hash and are set by the Gateway owner only. */
  readonly evaluationRecordId?: string;
  readonly evaluationRecordHash?: HashDigest;
  readonly workflowId?: string;
  readonly workflowHash?: HashDigest;
  readonly evaluatedIntentStateVersion?: number;
}

export interface PreparedActionRecord {
  readonly preparedAction: PreparedAction;
  readonly action: ActionProposal;
  readonly verdict: GuardianVerdict;
  readonly externalStateSnapshot: MaterialExternalSnapshot;
  readonly lifecycle: PreparedActionLifecycle;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly grantId?: AuthorityGrantId;
  readonly commitTokenId?: CommitTokenId;
}

export interface CommitToken {
  readonly id: CommitTokenId;
  readonly grantId: AuthorityGrantId;
  readonly preparedActionId: PreparedActionId;
  readonly preparedActionHash: HashDigest;
  readonly nonce: Nonce;
  readonly expiresAt: string;
  readonly consumed: boolean;
  readonly createdAt: string;
  readonly intentStateHash?: HashDigest;
  readonly agentId?: AgentId;
  readonly capability?: CapabilityName | string;
  /** Canonical hash of immutable issuance and binding fields. */
  readonly tokenHash: HashDigest;
}

export interface ApprovalArtifact {
  readonly id: string;
  readonly principalId: PrincipalId;
  readonly preparedActionHash: HashDigest;
  readonly decision: ApprovalDecision;
  readonly createdAt: string;
  readonly artifactHash: HashDigest;
  readonly amount?: number;
  readonly currency?: string;
  readonly merchant?: string;
}

/**
 * Durable human-approval lifecycle (PROJECT_SPEC Wave 1).
 *
 * A human approval authorizes ONLY the already-evaluated bounded request:
 * it cannot increase amount, broaden merchant scope, add capability, change
 * PreparedAction params, or apply to another IntentState. It never creates
 * new authority and never calls the Gateway.
 */
export interface ApprovalRequest {
  readonly id: ApprovalRequestId;
  readonly workflowId: string;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  /** Hash of the IntentState this approval is bound to (revalidated at decide time). */
  readonly intentStateHash: HashDigest;
  readonly authorityEvaluationId: AuthorityRequestId;
  readonly actionId?: ActionId;
  readonly preparedActionHash?: HashDigest;
  readonly requestedCapability: string;
  readonly requestedScope: {
    readonly amount: number;
    readonly currency: string;
    readonly merchant: string;
    readonly quantity?: number;
  };
  readonly status: ApprovalRequestStatus;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  /** Verified caller identity — never supplied in request JSON. */
  readonly decidedBy?: PrincipalId;
  readonly decision?: ApprovalDecision;
  readonly reason?: string;
  readonly contentHash: HashDigest;
  /** Superseding request id, set when a newer request replaces this one. */
  readonly supersededBy?: ApprovalRequestId;
}

export interface ApprovalEvent {
  readonly id: string;
  readonly approvalRequestId: ApprovalRequestId;
  readonly workflowId: string;
  readonly type: ApprovalEventType;
  readonly at: string;
  readonly actor?: PrincipalId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey?: string;
}

export interface ToolDescriptor {
  readonly toolId: string;
  readonly adapter: string;
  readonly requiredCapability: CapabilityName | string;
  readonly privilegeClass: ToolPrivilegeClass;
  readonly sideEffecting: boolean;
  readonly economic: boolean;
  readonly supportsIdempotency: boolean;
  readonly reversible: boolean;
  readonly materialParameterKeys: readonly string[];
  readonly revalidateExternalState: boolean;
}

export interface SideEffectRecord {
  readonly executionId: string;
  readonly preparedActionId: PreparedActionId;
  readonly preparedActionHash: HashDigest;
  readonly commitTokenId: CommitTokenId;
  readonly grantId: AuthorityGrantId;
  readonly toolId: string;
  readonly counterparty?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly idempotencyKey: string;
  readonly requestTimestamp: string;
  readonly resultState: ExecutionState;
  readonly externalReference?: string;
  readonly reconciliationState: ReconciliationState;
}

export interface OutcomeRequirement {
  readonly id: OutcomeRequirementId;
  readonly concept: string;
  readonly operator: ConstraintOperator;
  readonly value: unknown;
  readonly criticality: OutcomeRequirementCriticality;
  readonly state: OutcomeRequirementState;
  readonly type?: OutcomeRequirementType;
  readonly sourceConstraintId?: ConstraintId;
  readonly predicate?: string;
  readonly evidencePolicy?: Readonly<Record<string, unknown>>;
  readonly evaluationMethod?: "DETERMINISTIC" | "SEMANTIC" | "HYBRID";
  readonly deadline?: string;
  readonly observationWindow?: Readonly<{ readonly start?: string; readonly end?: string }>;
  readonly dependencies?: readonly OutcomeRequirementId[];
}

export interface OutcomeContract {
  readonly id: OutcomeContractId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly actionId?: ActionId;
  readonly preparedActionId?: PreparedActionId;
  readonly requirements: readonly OutcomeRequirement[];
  readonly state: OutcomeContractState;
  readonly paymentStatus: PaymentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly principalId?: PrincipalId;
  /**
   * Counterparty / merchant identity carried from contract creation input
   * (Wave 3.5 analytics). Optional for backward compatibility with older
   * documents that predate this field.
   */
  readonly merchant?: string;
  readonly intentStateHash?: HashDigest;
  readonly planId?: PlanId;
  readonly planVersion?: number;
  readonly actionProposalId?: ActionId;
  readonly actionContentHash?: HashDigest;
  readonly preparedActionHash?: HashDigest;
  /** Immutable owner-derived binding for a contract created before execution. */
  readonly preExecutionBinding?: Readonly<{
    readonly workflowId: string;
    readonly workflowHash: HashDigest;
    readonly actionId: string;
    readonly actionHash: HashDigest;
    readonly evaluationId: string;
    readonly evaluationHash: HashDigest;
    readonly evaluatedIntentStateId: string;
    readonly evaluatedIntentStateHash: HashDigest;
    readonly evaluatedIntentStateVersion: number;
  }>;
  /** Immutable success-criteria digest (OutcomeContractDefinition). Bound by PreparedAction. */
  readonly definitionHash?: HashDigest;
  /** Alias of definitionHash at creation for binding; never rewritten to include PA hash. */
  readonly contractHash?: HashDigest;
  readonly version?: number;
  readonly finalityPolicy?: Readonly<Record<string, unknown>>;
  readonly evidencePolicy?: Readonly<Record<string, unknown>>;
  /** Immutable after execution begins; human goal change creates a new version. */
  readonly executionBegunAt?: string;
  /**
   * Wave 4.3: optional link to a MonitoringContract opened for
   * ALLOW_WITH_MONITORING. Backward compatible — absent on older contracts.
   */
  readonly monitoringContractId?: string;
}

/**
 * Wave 4.3: a single observed risk signal against a MonitoringContract.
 * Signals never mint privilege and never widen authority.
 */
export interface MonitoringRiskSignal {
  readonly id: string;
  readonly severity: MonitoringSignalSeverity;
  readonly source: string;
  readonly reason: string;
  readonly observedAt: string;
}

/**
 * Wave 4.3: durable monitoring opened when Authority = ALLOW_WITH_MONITORING.
 * Execution is allowed under this contract; deterioration escalates
 * (continue → REQUIRE_APPROVAL → freeze → ResolutionCase). Monitoring cannot
 * widen authority, mint grants, or issue CommitTokens.
 */
export interface MonitoringContract {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly evaluationId: string;
  readonly evaluationHash: HashDigest;
  readonly grantId?: AuthorityGrantId;
  readonly outcomeContractId?: OutcomeContractId;
  readonly capability: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly state: MonitoringContractState;
  readonly riskState: MonitoringRiskState;
  readonly signals: readonly MonitoringRiskSignal[];
  readonly resolutionCaseHint?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutcomeEvent {
  readonly id?: string;
  readonly contractId: OutcomeContractId;
  readonly type: OutcomeEventType | string;
  readonly observedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidenceIds?: readonly EvidenceId[];
  readonly dedupeKey?: string;
  readonly causalRefs?: readonly string[];
  /** Phase 9: stable identity for idempotent ResolutionCase opening. */
  readonly triggerIdentity?: HashDigest | string;
  readonly conditionKey?: string;
}

export interface OutcomeStateTransition {
  readonly id: string;
  readonly contractId: OutcomeContractId;
  readonly fromState: OutcomeContractState;
  readonly toState: OutcomeContractState;
  readonly reason: string;
  readonly at: string;
  readonly triggerEventId?: string;
  readonly verificationId?: string;
}

export interface OutcomeRiskSignal {
  readonly contractId: OutcomeContractId;
  readonly requirementId?: OutcomeRequirementId;
  readonly basis: string;
  readonly confidence: number;
  readonly horizon?: string;
  readonly emittedAt: string;
}

export interface OutcomeVerification {
  readonly contractId: OutcomeContractId;
  readonly requirementResults: readonly OutcomeRequirement[];
  readonly overallState: OutcomeContractState;
  readonly criticalFailure: boolean;
  readonly verifiedAt: string;
}

export interface ResolutionCase {
  readonly id: ResolutionCaseId;
  readonly contractId: OutcomeContractId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly openedAt: string;
  readonly firstDivergenceNodeId?: ProvenanceNodeId;
  readonly responsibilityState: ResponsibilityState;
  readonly missingEvidence: readonly string[];
  /** @deprecated use state */
  readonly status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  readonly state: ResolutionCaseState;
  readonly principalId?: PrincipalId;
  readonly outcomeContractHash?: HashDigest;
  readonly triggerState?: OutcomeContractState | string;
  readonly triggerEventId?: string;
  readonly triggerIdentity?: HashDigest | string;
  readonly actionProposalId?: ActionId;
  readonly preparedActionId?: PreparedActionId;
  readonly sideEffectExecutionId?: string;
  readonly evidenceSnapshotHash?: HashDigest;
  readonly provenanceRootId?: ProvenanceNodeId;
  readonly caseVersion?: number;
  readonly parentCaseId?: ResolutionCaseId;
  readonly recursionDepth?: number;
  readonly updatedAt?: string;
}

export interface CausalTimelineEvent {
  readonly id: string;
  readonly type: string;
  readonly eventTime: string;
  readonly ingestionTime: string;
  readonly actor?: string;
  readonly causalParentId?: string;
  readonly evidenceRefs?: readonly string[];
  readonly provenanceRefs?: readonly string[];
  readonly establishmentState: EstablishmentState;
  readonly confidence?: number;
}

export interface ResponsibilityHypothesis {
  readonly id: string;
  readonly assertedCause: RootCauseCode;
  readonly involvedActor?: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictoryEvidenceIds: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly confidence: number;
  readonly status: ResponsibilityState;
  readonly provenanceRefs?: readonly string[];
  readonly modelName?: string;
  readonly promptVersion?: string;
  readonly createdAt: string;
}

export interface EvidenceRequest {
  readonly id: string;
  readonly resolutionCaseId: ResolutionCaseId;
  readonly evidenceSought: string;
  readonly targetSource: string;
  readonly questionResolved: string;
  readonly hypothesesDistinguished: readonly string[];
  readonly expectedInformationValue: number;
  readonly urgency: "LOW" | "MEDIUM" | "HIGH";
  readonly estimatedCost?: number;
  readonly currency?: string;
  readonly deadline?: string;
  readonly requiresAuthority: boolean;
  readonly createdAt: string;
}

export interface RemedyProposal {
  readonly id: RemedyProposalId;
  readonly resolutionCaseId: ResolutionCaseId;
  readonly description: string;
  readonly requiresFinancialAction: boolean;
  readonly estimatedAmount?: number;
  readonly currency?: string;
  /**
   * Prerequisite RemediationMandate (scope authorization) — NOT an execution AuthorityGrant.
   * Exact economic execution still requires a PreparedAction-bound AuthorityGrant from Gateway.
   */
  readonly requiredRemediationMandateId?: RemediationMandateId;
  readonly createdAt: string;
  readonly unmetRequirementIds?: readonly OutcomeRequirementId[];
  readonly proposedActions?: readonly string[];
  readonly intendedRestoredState?: string;
  readonly expectedRecoveryValue?: number;
  readonly financialCost?: number;
  readonly timeCost?: string;
  /** Deterministic remedy taxonomy (Wave 3.6). Optional for backward compatibility. */
  readonly remedyType?: RemedyType;
  readonly reversibility?: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  readonly risks?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
  readonly evidenceDependencies?: readonly string[];
  readonly newOutcomeContractId?: OutcomeContractId;
}

/**
 * Scope authorization to pursue a remedy within bounds.
 * Cannot execute privileged actions — has no preparedActionHash.
 * Distinct from AuthorityGrant minted at AUTHORIZE for exact PreparedAction.
 */
export interface RemediationMandate {
  readonly id: RemediationMandateId;
  readonly resolutionCaseId: ResolutionCaseId;
  readonly remedyProposalId: RemedyProposalId;
  readonly principalId: PrincipalId;
  readonly maxAmount: number;
  readonly currency: string;
  readonly allowedCapabilities: readonly string[];
  readonly allowedMerchants: readonly string[];
  readonly expiresAt: string;
  readonly status: RemediationMandateStatus;
  readonly createdAt: string;
  readonly consumedAt?: string;
  /** Explicit non-link: mandates never bind PreparedAction hashes. */
  readonly preparedActionHash?: never;
}

export interface ResolutionEvent {
  readonly id: string;
  readonly resolutionCaseId: ResolutionCaseId;
  readonly type: ResolutionEventType;
  readonly at: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey?: string;
}

export type LearningProposalType =
  | "USER_PREFERENCE"
  | "AGENT_RELIABILITY"
  | "COUNTERPARTY_TRUST"
  | "WORKFLOW_RULE";

/**
 * Governed learning proposal (Wave 3.1). Learning may propose; it must never
 * grant privilege, mint grants/CommitTokens, or rewrite historical intent.
 * Confirmation is always human-gated in Wave 3.1 (`requiresConfirmation`).
 */
export interface LearningProposal {
  readonly id: LearningProposalId;
  readonly principalId: PrincipalId;
  readonly domain: string;
  readonly proposalType: LearningProposalType;
  readonly content: Readonly<Record<string, unknown>>;
  readonly status: LearningStatus;
  readonly createdAt: string;
  readonly expiresAt?: string;
  /** Learning may propose; it must never mutate historical intent. */
  readonly targetIntentId?: IntentId;
  /** Always true in Wave 3.1; stored explicitly so future waves can refine. */
  readonly requiresConfirmation: boolean;
  readonly contentHash: HashDigest;
  readonly decidedAt?: string;
  /** Verified caller identity — never supplied in request JSON. */
  readonly decidedBy?: PrincipalId;
  readonly reason?: string;
}

export interface LearningProposalEvent {
  readonly id: string;
  readonly learningProposalId: LearningProposalId;
  readonly type: LearningProposalEventType;
  readonly at: string;
  readonly actor?: PrincipalId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey?: string;
}

/**
 * Durable learned context written only when a LearningProposal is CONFIRMED.
 * Inert in Wave 3.1 — no privileged path may consume this to mint or widen authority.
 */
export interface LearnedContextRecord {
  readonly id: LearnedContextRecordId;
  readonly learningProposalId: LearningProposalId;
  readonly principalId: PrincipalId;
  readonly domain: string;
  readonly proposalType: LearningProposalType;
  readonly content: Readonly<Record<string, unknown>>;
  readonly confirmedAt: string;
  readonly confirmedBy: PrincipalId;
  readonly contentHash: HashDigest;
}

export interface TrustSignalTip {
  readonly learnedContextId: LearnedContextRecordId;
}

/**
 * Wave 3.8: durable preference memory written only when a USER_PREFERENCE
 * LearningProposal is CONFIRMED. Scoped by (subjectId, domain, concept).
 * Never creates authority or overrides explicit current IntentState.
 */
export interface PreferenceRecord {
  readonly id: PreferenceRecordId;
  readonly subjectId: string;
  readonly domain: string;
  readonly concept: string;
  readonly value: unknown;
  readonly origin: PreferenceOrigin;
  readonly status: PreferenceRecordStatus;
  readonly sourceLearningProposalId: LearningProposalId;
  readonly supersedesId?: PreferenceRecordId;
  readonly supersededById?: PreferenceRecordId;
  readonly createdAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: PrincipalId;
  readonly contentHash: HashDigest;
}

/**
 * Wave 3.9: durable reusable workflow rule written only when a WORKFLOW_RULE
 * LearningProposal is CONFIRMED. Scoped by (subjectId, domain, concept).
 * Requires repeated confirmed evidence; never creates authority.
 */
export interface WorkflowRule {
  readonly id: WorkflowRuleId;
  readonly subjectId: string;
  readonly domain: string;
  readonly concept: string;
  readonly action: unknown;
  readonly version: number;
  readonly status: WorkflowRuleStatus;
  readonly evidenceRefs: readonly string[];
  readonly basis: readonly string[];
  readonly sourceLearningProposalId: LearningProposalId;
  readonly supersedesId?: WorkflowRuleId;
  readonly supersededById?: WorkflowRuleId;
  readonly createdAt: string;
  readonly confirmedAt: string;
  readonly confirmedBy: PrincipalId;
  readonly contentHash: HashDigest;
}

/**
 * Smallest reusable trust/reputation signal contract (Wave 3.2).
 * Validated content payload for AGENT_RELIABILITY / COUNTERPARTY_TRUST
 * LearningProposals. Callers supply `value`; no score computation in this phase.
 * INV_026: signals may reduce uncertainty but must never override explicit
 * intent, hard constraints, policy, capability bounds, or Authority restrictions.
 */
export interface TrustSignal {
  readonly subjectType: "AGENT" | "COUNTERPARTY";
  readonly subjectId: string;
  readonly domain: string;
  /** Bounded 0..1. No computation logic in Wave 3.2 — callers supply it. */
  readonly value: number;
  readonly sampleSize: number;
  readonly basis: readonly string[];
  readonly computedAt: string;
}

/**
 * Wave 2 observability: durable record of a single model call (success or
 * failure). Recorded best-effort by a ModelTelemetryPort implementation
 * (packages/observability). Never used to authorize or gate privileged
 * actions — telemetry only.
 */
export interface ModelCallTelemetryEvent {
  readonly id: string;
  readonly service: string;
  readonly operation: string;
  readonly schemaId?: string;
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  readonly workflowId?: string;
  readonly intentId?: IntentId;
  readonly status: ModelCallStatus;
  readonly httpStatus?: number;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Number of 429 retries attempted before this terminal status (0 = no retry). */
  readonly retryCount?: number;
  readonly providerError?: Readonly<{
    status?: string;
    reason?: string;
    domain?: string;
    metadata?: Readonly<Record<string, string>>;
    quotaViolations?: readonly Readonly<{ subject?: string; description?: string }>[];
    retryDelayMs?: number;
    retryAfterMs?: number;
    providerRequestId?: string;
  }>;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly requestId: string;
  readonly timestamp: string;
}

/**
 * Wave 2 observability: STARTED/COMPLETED/FAILED marker for a named
 * workflow stage, used to compute stage-timing telemetry. Not a protocol
 * gate — a workflow's actual state is governed by its own protocol objects
 * (PreparedAction, CommitToken, OutcomeContract, etc.), not by this event.
 */
export interface WorkflowStageEvent {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId?: IntentId;
  readonly stage: WorkflowStage;
  readonly status: WorkflowStageEventStatus;
  readonly occurredAt: string;
  readonly durationMs?: number;
  readonly traceId?: string;
  readonly spanId?: string;
}
