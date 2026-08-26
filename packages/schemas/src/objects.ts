import { z } from "zod";
import {
  ApprovalDecisionSchema,
  ApprovalEventTypeSchema,
  ApprovalRequestStatusSchema,
  AuthorityDecisionSchema,
  ConsequenceLevelSchema,
  ConstraintApplicabilitySchema,
  ConstraintKindSchema,
  ConstraintMutabilitySchema,
  ConstraintOperatorSchema,
  ExecutionStateSchema,
  GrantConsumptionStateSchema,
  PreparedActionLifecycleSchema,
  GuardianConstraintClassificationSchema,
  GuardianSemanticStatusSchema,
  JudgeIdSchema,
  JudgeInvocationStatusSchema,
  LearningStatusSchema,
  LearningProposalEventTypeSchema,
  LearningProposalTypeSchema,
  MeaningClassSchema,
  ModelCallStatusSchema,
  MonitoringContractStateSchema,
  MonitoringRiskStateSchema,
  MonitoringSignalSeveritySchema,
  OutcomeContractStateSchema,
  OutcomeEventTypeSchema,
  OutcomeRequirementCriticalitySchema,
  OutcomeRequirementStateSchema,
  OutcomeRequirementTypeSchema,
  PaymentStatusSchema,
  PreferenceOriginSchema,
  PreferenceRecordStatusSchema,
  WorkflowRuleStatusSchema,
  ProvenanceNodeKindSchema,
  ReconciliationStateSchema,
  EstablishmentStateSchema,
  ResolutionCaseStateSchema,
  ResolutionEventTypeSchema,
  ResponsibilityStateSchema,
  RootCauseCodeSchema,
  RemediationMandateStatusSchema,
  RemedyTypeSchema,
  SemanticRelationSchema,
  SourceTypeSchema,
  TaintClassSchema,
  ToolPrivilegeClassSchema,
  TrustClassSchema,
  WorkflowStageSchema,
  WorkflowStageEventStatusSchema,
} from "./enums.js";

const IsoDateTimeSchema = z.string().min(1);
const IdSchema = z.string().min(1);
const HashSchema = z.string().min(1);
const NonceSchema = z.string().min(1);

export const SourceSpanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();

export const ProofObligationSchema = z
  .object({
    verificationStep: z.string().min(1),
    requiredEvidence: z.string().min(1),
    enforcingService: z.string().min(1),
    constraintId: IdSchema.optional(),
    planStepId: IdSchema.optional(),
    evidenceKinds: z.array(z.string()).optional(),
  })
  .strict();

export const ConstraintSchema = z
  .object({
    id: IdSchema,
    concept: z.string().min(1),
    operator: ConstraintOperatorSchema,
    value: z.unknown(),
    kind: ConstraintKindSchema,
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    sourceType: SourceTypeSchema,
    sourceText: z.string().optional(),
    sourceSpan: SourceSpanSchema.optional(),
    mutability: ConstraintMutabilitySchema,
    meaningClass: MeaningClassSchema,
    proofObligation: ProofObligationSchema.optional(),
  })
  .strict();

export const IntentSchema = z
  .object({
    id: IdSchema,
    principalId: IdSchema,
    rawText: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    contentHash: HashSchema,
  })
  .strict();

export const AssumptionSchema = z
  .object({
    id: IdSchema,
    statement: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceType: SourceTypeSchema,
    meaningClass: MeaningClassSchema,
  })
  .strict();

export const IntentStateSchema = z
  .object({
    id: IdSchema,
    intentId: IdSchema,
    rawIntentHash: HashSchema,
    version: z.number().int().positive(),
    constraints: z.array(ConstraintSchema),
    assumptions: z.array(AssumptionSchema),
    createdAt: IsoDateTimeSchema,
    createdBy: IdSchema,
    previousStateId: IdSchema.optional(),
    capabilities: z.record(AuthorityDecisionSchema).optional(),
    temporalAuthority: z.object({ executionNotAfter: z.string().datetime({ offset: true }), executionNotBefore: z.string().datetime({ offset: true }).optional(), source: z.enum(["EXPLICIT_HUMAN", "ENTERPRISE_POLICY"]), sourceRef: IdSchema, provenanceNodeId: IdSchema.optional() }).strict().superRefine((value, ctx) => { if (value.executionNotBefore && Date.parse(value.executionNotBefore) > Date.parse(value.executionNotAfter)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "executionNotBefore must not exceed executionNotAfter" }); }).optional(),
    stateHash: HashSchema,
  })
  .strict();

export const CapabilityScopeSchema = z
  .object({
    capabilities: z.record(AuthorityDecisionSchema),
    maxAmount: z.number().nonnegative().optional(),
    currency: z.string().optional(),
    allowedMerchants: z.array(z.string()).optional(),
    deniedMerchants: z.array(z.string()).optional(),
    allowedCategories: z.array(z.string()).optional(),
    resourceScope: z.array(z.string()).optional(),
    expiresAt: IsoDateTimeSchema.optional(),
    maxDelegationDepth: z.number().int().nonnegative().optional(),
  })
  .strict();

export const DelegationEnvelopeSchema = z
  .object({
    id: IdSchema,
    parentAgentId: IdSchema,
    childAgentId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    parentScope: CapabilityScopeSchema,
    childScope: CapabilityScopeSchema,
    stickyConstraintIds: z.array(IdSchema),
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    delegationDepth: z.number().int().nonnegative(),
    planId: IdSchema.optional(),
    planStepId: IdSchema.optional(),
    permittedTransformations: z.array(z.string()).optional(),
    prohibitedTransformations: z.array(z.string()).optional(),
    requiredConstraintIds: z.array(IdSchema).optional(),
    envelopeHash: HashSchema.optional(),
    provenanceParentNodeId: IdSchema.optional(),
  })
  .strict();

export const TaintMetadataSchema = z
  .object({
    classes: z.array(TaintClassSchema),
    origins: z.array(IdSchema),
    reason: z.string().optional(),
  })
  .strict();

export const ProvenanceNodeSchema = z
  .object({
    id: IdSchema,
    kind: ProvenanceNodeKindSchema,
    label: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    subjectRef: z.string().optional(),
    trustClass: TrustClassSchema,
    taint: TaintMetadataSchema,
    payloadHash: HashSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const ProvenanceEdgeSchema = z
  .object({
    id: IdSchema,
    from: IdSchema,
    to: IdSchema,
    relation: SemanticRelationSchema,
    createdAt: IsoDateTimeSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const EvidenceEnvelopeSchema = z
  .object({
    id: IdSchema,
    source: z.string().min(1),
    contentHash: HashSchema,
    trustClass: TrustClassSchema,
    captureTime: IsoDateTimeSchema,
    eventTime: IsoDateTimeSchema.optional(),
    freshnessDeadline: IsoDateTimeSchema.optional(),
    taint: TaintMetadataSchema,
    signature: z.string().optional(),
    mimeType: z.string().optional(),
    lineageGroupId: z.string().optional(),
    originId: z.string().optional(),
  })
  .strict();

export const EvidenceClaimSchema = z
  .object({
    id: IdSchema,
    evidenceId: IdSchema,
    concept: z.string().min(1),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    derivedBy: z.string().min(1),
    modelName: z.string().optional(),
    modelVersion: z.string().optional(),
    promptVersion: z.string().optional(),
    taint: TaintMetadataSchema,
    invalidatedAt: IsoDateTimeSchema.optional(),
    correctedByClaimId: IdSchema.optional(),
  })
  .strict();

export const ActionProposalSchema = z
  .object({
    id: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    agentId: IdSchema,
    capability: z.string().min(1),
    merchant: z.string().optional(),
    product: z.string().optional(),
    quantity: z.number().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    refundable: z.boolean().optional(),
    deliveryTerms: z.string().optional(),
    parameters: z.record(z.unknown()),
    consequenceLevel: ConsequenceLevelSchema,
    createdAt: IsoDateTimeSchema,
    planId: IdSchema.optional(),
    planStepId: IdSchema.optional(),
  })
  .strict();

export const JudgeFindingSchema = z
  .object({
    judgeId: JudgeIdSchema,
    code: z.string().min(1),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    message: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(z.string()),
  })
  .strict();

export const ConstraintClaimSchema = z
  .object({
    constraintId: IdSchema,
    classification: GuardianConstraintClassificationSchema,
    applicability: ConstraintApplicabilitySchema,
    confidence: z.number().min(0).max(1),
    criticality: ConstraintKindSchema,
    rationale: z.string().optional(),
    evidenceIds: z.array(IdSchema).optional(),
    contradictoryEvidenceIds: z.array(IdSchema).optional(),
    assumptionIds: z.array(IdSchema).optional(),
    provenanceNodeIds: z.array(IdSchema).optional(),
    transformationClasses: z.array(z.string()).optional(),
    judgeFindings: z.array(JudgeFindingSchema).optional(),
  })
  .strict();

export const JudgeConstraintClassificationSchema = z
  .object({
    constraintId: IdSchema,
    classification: GuardianConstraintClassificationSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().optional(),
  })
  .strict();

export const JudgeResultSchema = z
  .object({
    judgeId: JudgeIdSchema,
    status: JudgeInvocationStatusSchema,
    findings: z.array(JudgeFindingSchema),
    constraintClassifications: z
      .array(JudgeConstraintClassificationSchema)
      .optional(),
    modelId: z.string().optional(),
    promptVersion: z.string().optional(),
    schemaId: z.string().optional(),
    schemaVersion: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();

export const GuardianVerdictSchema = z
  .object({
    id: IdSchema,
    actionId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    intentStateHash: HashSchema,
    planId: IdSchema.optional(),
    planVersion: z.number().int().positive().optional(),
    actionContentHash: HashSchema,
    evidenceSnapshotHash: HashSchema,
    decision: AuthorityDecisionSchema,
    semanticStatus: GuardianSemanticStatusSchema,
    overallFidelity: z.number().min(0).max(1).optional(),
    constraintClaims: z.array(ConstraintClaimSchema),
    contradictions: z.array(z.string()),
    uncertainty: z.number().min(0).max(1),
    criticalFailure: z.boolean(),
    judgeResults: z.array(JudgeResultSchema),
    verdictHash: HashSchema,
    protocolVersion: z.string().min(1),
    promptVersions: z.record(z.string()),
    schemaVersions: z.record(z.string()),
    stale: z.boolean(),
    modelName: z.string().optional(),
    modelVersion: z.string().optional(),
    promptVersion: z.string().optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

/** Model-emitted finding (judgeId stamped by the invoking judge package). */
export const JudgeModelFindingSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    message: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(z.string()),
  })
  .strict();

/** Shared model output shape for individual judges. */
export const JudgeModelOutputSchema = z
  .object({
    findings: z.array(JudgeModelFindingSchema),
    constraintClassifications: z
      .array(
        z
          .object({
            constraintId: IdSchema,
            classification: GuardianConstraintClassificationSchema,
            confidence: z.number().min(0).max(1),
            rationale: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const DriftEventSchema = z
  .object({
    id: IdSchema,
    intentStateId: IdSchema,
    relation: SemanticRelationSchema,
    fromConcept: z.string().min(1),
    toConcept: z.string().min(1),
    severity: ConsequenceLevelSchema,
    detectedAt: IsoDateTimeSchema,
    provenanceEdgeId: IdSchema.optional(),
  })
  .strict();

export const AuthorityRequestSchema = z
  .object({
    id: IdSchema,
    principalId: IdSchema,
    adaptiveSubjectId: z.string().min(1).optional(),
    agentId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    actionId: IdSchema,
    preparedActionId: IdSchema.optional(),
    capability: z.string().min(1),
    scope: CapabilityScopeSchema,
    merchant: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AuthorityGrantSchema = z
  .object({
    id: IdSchema,
    requestId: IdSchema,
    principalId: IdSchema,
    agentId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    actionId: IdSchema,
    preparedActionId: IdSchema,
    capability: z.string().min(1),
    merchant: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    scope: CapabilityScopeSchema,
    decision: AuthorityDecisionSchema,
    expiresAt: IsoDateTimeSchema,
    nonce: NonceSchema,
    stateHash: HashSchema,
    preparedActionHash: HashSchema,
    consumptionState: GrantConsumptionStateSchema,
    revokedAt: IsoDateTimeSchema.optional(),
    consumedAt: IsoDateTimeSchema.optional(),
    createdAt: IsoDateTimeSchema,
    transferable: z.literal(false),
    evaluationRecordId: IdSchema.optional(),
    evaluationRecordHash: HashSchema.optional(),
    outcomeContractId: IdSchema.optional(),
    outcomeContractHash: HashSchema.optional(),
    workflowId: IdSchema.optional(),
    actionContentHash: HashSchema.optional(),
    evaluatedIntentStateVersion: z.number().int().positive().optional(),
  })
  .strict();

export const AuthorityExtensionRequestSchema = z
  .object({
    id: IdSchema,
    grantId: IdSchema,
    requestedBy: IdSchema,
    reason: z.string().min(1),
    requestedScope: CapabilityScopeSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const PreparedActionParametersSchema = z
  .object({
    merchant: z.string().optional(),
    product: z.string().optional(),
    quantity: z.number().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    refundability: z.boolean().optional(),
    deliveryTerms: z.string().optional(),
    toolParameters: z.record(z.unknown()),
  })
  .strict();

export const MaterialExternalSnapshotSchema = z
  .object({
    merchant: z.string().optional(),
    product: z.string().optional(),
    quantity: z.number().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    refundability: z.boolean().optional(),
    deliveryTerms: z.string().optional(),
    certificationRef: z.string().optional(),
    counterparty: z.string().optional(),
    sku: z.string().optional(),
  })
  .strict();

export const PreparedActionSchema = z
  .object({
    id: IdSchema,
    actionId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    agentId: IdSchema,
    capability: z.string().min(1),
    authorityScope: CapabilityScopeSchema.optional(),
    parameters: PreparedActionParametersSchema,
    parameterHash: HashSchema,
    preparedActionHash: HashSchema,
    createdAt: IsoDateTimeSchema,
    bundleId: z.string().optional(),
    dependsOnPreparedActionIds: z.array(IdSchema).optional(),
    intentStateHash: HashSchema.optional(),
    planId: IdSchema.optional(),
    planVersion: z.number().int().positive().optional(),
    actionProposalId: IdSchema.optional(),
    actionContentHash: HashSchema.optional(),
    guardianVerdictId: z.string().optional(),
    guardianVerdictHash: HashSchema.optional(),
    principalId: IdSchema.optional(),
    toolId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    expiresAt: IsoDateTimeSchema.optional(),
    externalStateSnapshot: MaterialExternalSnapshotSchema.optional(),
    externalStateHash: HashSchema.optional(),
    outcomeContractId: IdSchema.optional(),
    outcomeContractHash: HashSchema.optional(),
    evaluationRecordId: IdSchema.optional(),
    evaluationRecordHash: HashSchema.optional(),
    workflowId: IdSchema.optional(),
    workflowHash: HashSchema.optional(),
    evaluatedIntentStateVersion: z.number().int().positive().optional(),
  })
  .strict();

export const PreparedActionRecordSchema = z
  .object({
    preparedAction: PreparedActionSchema,
    action: ActionProposalSchema,
    verdict: GuardianVerdictSchema,
    externalStateSnapshot: MaterialExternalSnapshotSchema,
    lifecycle: PreparedActionLifecycleSchema,
    version: z.number().int().positive(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    grantId: IdSchema.optional(),
    commitTokenId: IdSchema.optional(),
  })
  .strict();

export const CommitTokenSchema = z
  .object({
    id: IdSchema,
    grantId: IdSchema,
    preparedActionId: IdSchema,
    preparedActionHash: HashSchema,
    nonce: NonceSchema,
    expiresAt: IsoDateTimeSchema,
    consumed: z.boolean(),
    createdAt: IsoDateTimeSchema,
    intentStateHash: HashSchema.optional(),
    agentId: IdSchema.optional(),
    capability: z.string().optional(),
    tokenHash: HashSchema.optional(),
  })
  .strict();

export const ApprovalArtifactSchema = z
  .object({
    id: IdSchema,
    principalId: IdSchema,
    preparedActionHash: HashSchema,
    decision: ApprovalDecisionSchema,
    createdAt: IsoDateTimeSchema,
    artifactHash: HashSchema,
    amount: z.number().optional(),
    currency: z.string().optional(),
    merchant: z.string().optional(),
  })
  .strict();

export const ApprovalRequestSchema = z
  .object({
    id: IdSchema,
    workflowId: z.string().min(1),
    intentId: IdSchema,
    intentStateId: IdSchema,
    intentStateHash: HashSchema,
    authorityEvaluationId: IdSchema,
    actionId: IdSchema.optional(),
    preparedActionHash: HashSchema.optional(),
    requestedCapability: z.string().min(1),
    requestedScope: z
      .object({
        amount: z.number(),
        currency: z.string().min(1),
        merchant: z.string().min(1),
        quantity: z.number().optional(),
      })
      .strict(),
    status: ApprovalRequestStatusSchema,
    requestedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    decidedAt: IsoDateTimeSchema.optional(),
    decidedBy: IdSchema.optional(),
    decision: ApprovalDecisionSchema.optional(),
    reason: z.string().optional(),
    contentHash: HashSchema,
    supersededBy: IdSchema.optional(),
  })
  .strict();

export const ApprovalEventSchema = z
  .object({
    id: IdSchema,
    approvalRequestId: IdSchema,
    workflowId: z.string().min(1),
    type: ApprovalEventTypeSchema,
    at: IsoDateTimeSchema,
    actor: IdSchema.optional(),
    payload: z.record(z.unknown()),
    dedupeKey: z.string().optional(),
  })
  .strict();

export const ToolDescriptorSchema = z
  .object({
    toolId: z.string().min(1),
    adapter: z.string().min(1),
    requiredCapability: z.string().min(1),
    privilegeClass: ToolPrivilegeClassSchema,
    sideEffecting: z.boolean(),
    economic: z.boolean(),
    supportsIdempotency: z.boolean(),
    reversible: z.boolean(),
    materialParameterKeys: z.array(z.string()),
    revalidateExternalState: z.boolean(),
  })
  .strict();

export const SideEffectRecordSchema = z
  .object({
    executionId: IdSchema,
    preparedActionId: IdSchema,
    preparedActionHash: HashSchema,
    commitTokenId: IdSchema,
    grantId: IdSchema,
    toolId: z.string().min(1),
    counterparty: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    idempotencyKey: z.string().min(1),
    requestTimestamp: IsoDateTimeSchema,
    resultState: ExecutionStateSchema,
    externalReference: z.string().optional(),
    reconciliationState: ReconciliationStateSchema,
  })
  .strict();

export const OutcomeRequirementSchema = z
  .object({
    id: IdSchema,
    concept: z.string().min(1),
    operator: ConstraintOperatorSchema,
    value: z.unknown(),
    criticality: OutcomeRequirementCriticalitySchema,
    state: OutcomeRequirementStateSchema,
    type: OutcomeRequirementTypeSchema.optional(),
    sourceConstraintId: IdSchema.optional(),
    predicate: z.string().optional(),
    evidencePolicy: z.record(z.unknown()).optional(),
    evaluationMethod: z.enum(["DETERMINISTIC", "SEMANTIC", "HYBRID"]).optional(),
    deadline: IsoDateTimeSchema.optional(),
    observationWindow: z
      .object({
        start: IsoDateTimeSchema.optional(),
        end: IsoDateTimeSchema.optional(),
      })
      .strict()
      .optional(),
    dependencies: z.array(IdSchema).optional(),
  })
  .strict();

export const OutcomeContractSchema = z
  .object({
    id: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    actionId: IdSchema.optional(),
    preparedActionId: IdSchema.optional(),
    requirements: z.array(OutcomeRequirementSchema),
    state: OutcomeContractStateSchema,
    paymentStatus: PaymentStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    principalId: IdSchema.optional(),
    merchant: z.string().min(1).optional(),
    intentStateHash: HashSchema.optional(),
    planId: IdSchema.optional(),
    planVersion: z.number().int().positive().optional(),
    actionProposalId: IdSchema.optional(),
    actionContentHash: HashSchema.optional(),
    preparedActionHash: HashSchema.optional(),
    preExecutionBinding: z.object({
      workflowId: IdSchema,
      workflowHash: HashSchema,
      actionId: IdSchema,
      actionHash: HashSchema,
      evaluationId: IdSchema,
      evaluationHash: HashSchema,
      evaluatedIntentStateId: IdSchema,
      evaluatedIntentStateHash: HashSchema,
      evaluatedIntentStateVersion: z.number().int().positive(),
    }).strict().optional(),
    definitionHash: HashSchema.optional(),
    contractHash: HashSchema.optional(),
    version: z.number().int().positive().optional(),
    finalityPolicy: z.record(z.unknown()).optional(),
    evidencePolicy: z.record(z.unknown()).optional(),
    executionBegunAt: IsoDateTimeSchema.optional(),
    monitoringContractId: IdSchema.optional(),
  })
  .strict();

export const MonitoringRiskSignalSchema = z
  .object({
    id: IdSchema,
    severity: MonitoringSignalSeveritySchema,
    source: z.string().min(1),
    reason: z.string().min(1),
    observedAt: IsoDateTimeSchema,
  })
  .strict();

export const MonitoringContractSchema = z
  .object({
    id: IdSchema,
    workflowId: z.string().min(1),
    intentId: IdSchema,
    intentStateId: IdSchema,
    evaluationId: IdSchema,
    evaluationHash: HashSchema,
    grantId: IdSchema.optional(),
    outcomeContractId: IdSchema.optional(),
    capability: z.string().min(1),
    merchant: z.string().min(1).optional(),
    amount: z.number().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    state: MonitoringContractStateSchema,
    riskState: MonitoringRiskStateSchema,
    signals: z.array(MonitoringRiskSignalSchema),
    resolutionCaseHint: z.string().min(1).optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();

export const OutcomeEventSchema = z
  .object({
    id: IdSchema.optional(),
    contractId: IdSchema,
    type: z.union([OutcomeEventTypeSchema, z.string().min(1)]),
    observedAt: IsoDateTimeSchema,
    payload: z.record(z.unknown()),
    evidenceIds: z.array(IdSchema).optional(),
    dedupeKey: z.string().optional(),
    causalRefs: z.array(z.string()).optional(),
    triggerIdentity: HashSchema.optional(),
    conditionKey: z.string().optional(),
  })
  .strict();

export const OutcomeStateTransitionSchema = z
  .object({
    id: IdSchema,
    contractId: IdSchema,
    fromState: OutcomeContractStateSchema,
    toState: OutcomeContractStateSchema,
    reason: z.string().min(1),
    at: IsoDateTimeSchema,
    triggerEventId: z.string().optional(),
    verificationId: z.string().optional(),
  })
  .strict();

export const OutcomeRiskSignalSchema = z
  .object({
    contractId: IdSchema,
    requirementId: IdSchema.optional(),
    basis: z.string().min(1),
    confidence: z.number().min(0).max(1),
    horizon: z.string().optional(),
    emittedAt: IsoDateTimeSchema,
  })
  .strict();

export const OutcomeVerificationSchema = z
  .object({
    contractId: IdSchema,
    requirementResults: z.array(OutcomeRequirementSchema),
    overallState: OutcomeContractStateSchema,
    criticalFailure: z.boolean(),
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();

export const ResolutionCaseSchema = z
  .object({
    id: IdSchema,
    contractId: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    openedAt: IsoDateTimeSchema,
    firstDivergenceNodeId: IdSchema.optional(),
    responsibilityState: ResponsibilityStateSchema,
    missingEvidence: z.array(z.string()),
    status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    state: ResolutionCaseStateSchema,
    principalId: IdSchema.optional(),
    outcomeContractHash: HashSchema.optional(),
    triggerState: z.union([OutcomeContractStateSchema, z.string()]).optional(),
    triggerEventId: z.string().optional(),
    triggerIdentity: HashSchema.optional(),
    actionProposalId: IdSchema.optional(),
    preparedActionId: IdSchema.optional(),
    sideEffectExecutionId: z.string().optional(),
    evidenceSnapshotHash: HashSchema.optional(),
    provenanceRootId: IdSchema.optional(),
    caseVersion: z.number().int().positive().optional(),
    parentCaseId: IdSchema.optional(),
    recursionDepth: z.number().int().nonnegative().optional(),
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const CausalTimelineEventSchema = z
  .object({
    id: IdSchema,
    type: z.string().min(1),
    eventTime: IsoDateTimeSchema,
    ingestionTime: IsoDateTimeSchema,
    actor: z.string().optional(),
    causalParentId: z.string().optional(),
    evidenceRefs: z.array(z.string()).optional(),
    provenanceRefs: z.array(z.string()).optional(),
    establishmentState: EstablishmentStateSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const ResponsibilityHypothesisSchema = z
  .object({
    id: IdSchema,
    assertedCause: RootCauseCodeSchema,
    involvedActor: z.string().optional(),
    supportingEvidenceIds: z.array(z.string()),
    contradictoryEvidenceIds: z.array(z.string()),
    missingEvidence: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    status: ResponsibilityStateSchema,
    provenanceRefs: z.array(z.string()).optional(),
    modelName: z.string().optional(),
    promptVersion: z.string().optional(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const EvidenceRequestSchema = z
  .object({
    id: IdSchema,
    resolutionCaseId: IdSchema,
    evidenceSought: z.string().min(1),
    targetSource: z.string().min(1),
    questionResolved: z.string().min(1),
    hypothesesDistinguished: z.array(z.string()),
    expectedInformationValue: z.number(),
    urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
    estimatedCost: z.number().optional(),
    currency: z.string().optional(),
    deadline: IsoDateTimeSchema.optional(),
    requiresAuthority: z.boolean(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const RemedyProposalSchema = z
  .object({
    id: IdSchema,
    resolutionCaseId: IdSchema,
    description: z.string().min(1),
    requiresFinancialAction: z.boolean(),
    estimatedAmount: z.number().optional(),
    currency: z.string().optional(),
    requiredRemediationMandateId: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    unmetRequirementIds: z.array(IdSchema).optional(),
    proposedActions: z.array(z.string()).optional(),
    intendedRestoredState: z.string().optional(),
    expectedRecoveryValue: z.number().optional(),
    financialCost: z.number().optional(),
    timeCost: z.string().optional(),
    remedyType: RemedyTypeSchema.optional(),
    reversibility: z.enum(["HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
    risks: z.array(z.string()).optional(),
    requiredCapabilities: z.array(z.string()).optional(),
    evidenceDependencies: z.array(z.string()).optional(),
    newOutcomeContractId: IdSchema.optional(),
  })
  .strict();

export const RemediationMandateSchema = z
  .object({
    id: IdSchema,
    resolutionCaseId: IdSchema,
    remedyProposalId: IdSchema,
    principalId: IdSchema,
    maxAmount: z.number(),
    currency: z.string().min(1),
    allowedCapabilities: z.array(z.string()),
    allowedMerchants: z.array(z.string()),
    expiresAt: IsoDateTimeSchema,
    status: RemediationMandateStatusSchema,
    createdAt: IsoDateTimeSchema,
    consumedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const ResolutionEventSchema = z
  .object({
    id: IdSchema,
    resolutionCaseId: IdSchema,
    type: ResolutionEventTypeSchema,
    at: IsoDateTimeSchema,
    payload: z.record(z.unknown()),
    dedupeKey: z.string().optional(),
  })
  .strict();

export const LearningProposalSchema = z
  .object({
    id: IdSchema,
    principalId: IdSchema,
    domain: z.string().min(1),
    proposalType: LearningProposalTypeSchema,
    content: z.record(z.unknown()),
    status: LearningStatusSchema,
    createdAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema.optional(),
    targetIntentId: IdSchema.optional(),
    requiresConfirmation: z.boolean(),
    contentHash: HashSchema,
    decidedAt: IsoDateTimeSchema.optional(),
    decidedBy: IdSchema.optional(),
    reason: z.string().optional(),
  })
  .strict();

export const LearningProposalEventSchema = z
  .object({
    id: IdSchema,
    learningProposalId: IdSchema,
    type: LearningProposalEventTypeSchema,
    at: IsoDateTimeSchema,
    actor: IdSchema.optional(),
    payload: z.record(z.unknown()),
    dedupeKey: z.string().optional(),
  })
  .strict();

export const LearnedContextRecordSchema = z
  .object({
    id: IdSchema,
    learningProposalId: IdSchema,
    principalId: IdSchema,
    domain: z.string().min(1),
    proposalType: LearningProposalTypeSchema,
    content: z.record(z.unknown()),
    confirmedAt: IsoDateTimeSchema,
    confirmedBy: IdSchema,
    contentHash: HashSchema,
  })
  .strict();

/** Wave 3.8: durable preference memory for USER_PREFERENCE confirmations. */
export const PreferenceRecordSchema = z
  .object({
    id: IdSchema,
    subjectId: z.string().min(1),
    domain: z.string().min(1),
    concept: z.string().min(1),
    value: z.unknown(),
    origin: PreferenceOriginSchema,
    status: PreferenceRecordStatusSchema,
    sourceLearningProposalId: IdSchema,
    supersedesId: IdSchema.optional(),
    supersededById: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    confirmedAt: IsoDateTimeSchema,
    confirmedBy: IdSchema,
    contentHash: HashSchema,
  })
  .strict();

/** Wave 3.9: durable reusable workflow rule for WORKFLOW_RULE confirmations. */
export const WorkflowRuleSchema = z
  .object({
    id: IdSchema,
    subjectId: z.string().min(1),
    domain: z.string().min(1),
    concept: z.string().min(1),
    action: z.unknown(),
    version: z.number().int().positive(),
    status: WorkflowRuleStatusSchema,
    evidenceRefs: z.array(z.string().min(1)),
    basis: z.array(z.string().min(1)),
    sourceLearningProposalId: IdSchema,
    supersedesId: IdSchema.optional(),
    supersededById: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    confirmedAt: IsoDateTimeSchema,
    confirmedBy: IdSchema,
    contentHash: HashSchema,
  })
  .strict();

/** Wave 3.2: trust/reputation signal content for AGENT_RELIABILITY / COUNTERPARTY_TRUST. */
export const TrustSignalSchema = z
  .object({
    subjectType: z.enum(["AGENT", "COUNTERPARTY"]),
    subjectId: z.string().min(1),
    domain: z.string().min(1),
    value: z.number().min(0).max(1),
    sampleSize: z.number().int().nonnegative(),
    basis: z.array(z.string()),
    computedAt: IsoDateTimeSchema,
  })
  .strict();

export const ModelCallTelemetryEventSchema = z
  .object({
    id: IdSchema,
    service: z.string().min(1),
    operation: z.string().min(1),
    schemaId: z.string().optional(),
    modelId: z.string().min(1),
    modelVersion: z.string().optional(),
    promptVersion: z.string().optional(),
    workflowId: IdSchema.optional(),
    intentId: IdSchema.optional(),
    status: ModelCallStatusSchema,
    httpStatus: z.number().optional(),
    latencyMs: z.number().nonnegative(),
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    providerError: z.object({
      status: z.string().max(240).optional(),
      reason: z.string().max(240).optional(),
      domain: z.string().max(240).optional(),
      metadata: z.record(z.string().max(240)).optional(),
      quotaViolations: z.array(z.object({
        subject: z.string().max(240).optional(),
        description: z.string().max(240).optional(),
      }).strict()).max(8).optional(),
      retryDelayMs: z.number().nonnegative().optional(),
      retryAfterMs: z.number().nonnegative().optional(),
      providerRequestId: z.string().max(240).optional(),
    }).strict().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    requestId: z.string().min(1),
    timestamp: IsoDateTimeSchema,
  })
  .strict();

export const WorkflowStageEventSchema = z
  .object({
    id: IdSchema,
    workflowId: IdSchema,
    intentId: IdSchema.optional(),
    stage: WorkflowStageSchema,
    status: WorkflowStageEventStatusSchema,
    occurredAt: IsoDateTimeSchema,
    durationMs: z.number().nonnegative().optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
  })
  .strict();

/** Core protocol object schemas (planning schemas registered in registry). */
export const CoreProtocolSchemas = {
  Intent: IntentSchema,
  Constraint: ConstraintSchema,
  IntentState: IntentStateSchema,
  DelegationEnvelope: DelegationEnvelopeSchema,
  CapabilityScope: CapabilityScopeSchema,
  ProvenanceNode: ProvenanceNodeSchema,
  ProvenanceEdge: ProvenanceEdgeSchema,
  Assumption: AssumptionSchema,
  EvidenceEnvelope: EvidenceEnvelopeSchema,
  EvidenceClaim: EvidenceClaimSchema,
  ActionProposal: ActionProposalSchema,
  ConstraintClaim: ConstraintClaimSchema,
  GuardianVerdict: GuardianVerdictSchema,
  DriftEvent: DriftEventSchema,
  AuthorityRequest: AuthorityRequestSchema,
  AuthorityGrant: AuthorityGrantSchema,
  AuthorityExtensionRequest: AuthorityExtensionRequestSchema,
  PreparedAction: PreparedActionSchema,
  PreparedActionRecord: PreparedActionRecordSchema,
  CommitToken: CommitTokenSchema,
  ApprovalArtifact: ApprovalArtifactSchema,
  ApprovalRequest: ApprovalRequestSchema,
  ApprovalEvent: ApprovalEventSchema,
  ToolDescriptor: ToolDescriptorSchema,
  SideEffectRecord: SideEffectRecordSchema,
  OutcomeContract: OutcomeContractSchema,
  OutcomeRequirement: OutcomeRequirementSchema,
  OutcomeEvent: OutcomeEventSchema,
  OutcomeStateTransition: OutcomeStateTransitionSchema,
  OutcomeRiskSignal: OutcomeRiskSignalSchema,
  OutcomeVerification: OutcomeVerificationSchema,
  MonitoringContract: MonitoringContractSchema,
  MonitoringRiskSignal: MonitoringRiskSignalSchema,
  ResolutionCase: ResolutionCaseSchema,
  CausalTimelineEvent: CausalTimelineEventSchema,
  ResponsibilityHypothesis: ResponsibilityHypothesisSchema,
  EvidenceRequest: EvidenceRequestSchema,
  RemedyProposal: RemedyProposalSchema,
  RemediationMandate: RemediationMandateSchema,
  ResolutionEvent: ResolutionEventSchema,
  LearningProposal: LearningProposalSchema,
  LearningProposalEvent: LearningProposalEventSchema,
  LearnedContextRecord: LearnedContextRecordSchema,
  PreferenceRecord: PreferenceRecordSchema,
  WorkflowRule: WorkflowRuleSchema,
  TrustSignal: TrustSignalSchema,
  ModelCallTelemetryEvent: ModelCallTelemetryEventSchema,
  WorkflowStageEvent: WorkflowStageEventSchema,
} as const;
