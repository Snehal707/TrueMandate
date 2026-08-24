import { z } from "zod";
import {
  ConstraintKindSchema,
  ConstraintMutabilitySchema,
  ConstraintOperatorSchema,
  MeaningClassSchema,
  SourceTypeSchema,
  TrustClassSchema,
} from "./enums.js";
import { AssumptionSchema, SourceSpanSchema } from "./objects.js";

export const AmbiguityClassSchema = z.enum(["A0", "A1", "A2", "A3", "A4"]);
export const IntentReadinessSchema = z.enum([
  "SEARCHABLE",
  "PLANNABLE",
  "ACTIONABLE",
  "EXECUTABLE",
]);
export const SemanticLifecycleSchema = z.enum([
  "RAW",
  "COMPILED",
  "VERIFIED",
  "AMBIGUOUS",
  "REJECTED",
]);
export const TransformationClassSchema = z.enum([
  "PRESERVED",
  "WEAKENED",
  "STRENGTHENED",
  "REINTERPRETED",
  "DROPPED",
  "CONTRADICTED",
]);
export const FindingSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const TemporalResolutionSchema = z
  .object({
    originalExpression: z.string().min(1),
    resolvedValue: z.string().min(1),
    resolutionTimestamp: z.string().min(1),
    timezone: z.string().min(1),
  })
  .strict();

export const ConstraintGroundingSchema = z
  .object({
    sourceText: z.string().min(1),
    sourceSpan: SourceSpanSchema.optional(),
    quoteExact: z.boolean(),
  })
  .strict();

export const ModelInvocationMetaSchema = z
  .object({
    modelId: z.string().min(1),
    modelVersion: z.string().optional(),
    promptVersion: z.string().min(1),
    schemaId: z.string().min(1),
    schemaVersion: z.string().min(1),
    protocolVersion: z.string().min(1),
    requestId: z.string().min(1),
    timestamp: z.string().min(1),
    latencyMs: z.number().optional(),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
      })
      .strict()
      .optional(),
    providerMetadata: z.record(z.unknown()).optional(),
  })
  .strict();

/** Model-facing JSON values Vertex can express; replaces empty `{}` from z.unknown(). */
export const ModelConstraintValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

export const CandidateConstraintSchema = z
  .object({
    id: z.string().min(1),
    concept: z.string().min(1),
    operator: ConstraintOperatorSchema,
    value: ModelConstraintValueSchema,
    kind: ConstraintKindSchema,
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    sourceType: SourceTypeSchema,
    mutability: ConstraintMutabilitySchema,
    meaningClass: MeaningClassSchema,
    grounding: ConstraintGroundingSchema,
    temporalResolution: TemporalResolutionSchema.optional(),
    proofObligation: z
      .object({
        verificationStep: z.string().min(1),
        requiredEvidence: z.string().min(1),
        enforcingService: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const AmbiguityRecordSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    ambiguityClass: AmbiguityClassSchema,
    relatedConcepts: z.array(z.string()),
    sourceText: z.string().optional(),
  })
  .strict();

/** Model-facing compiler output before hashing/lifecycle stamps. */
export const CompilerModelOutputSchema = z
  .object({
    goal: z.string().min(1),
    constraints: z.array(CandidateConstraintSchema),
    preferences: z.array(CandidateConstraintSchema),
    assumptions: z.array(AssumptionSchema),
    ambiguities: z.array(AmbiguityRecordSchema),
    readiness: IntentReadinessSchema,
  })
  .strict();

export const CandidateInterpretationSchema = z
  .object({
    id: z.string().min(1),
    intentId: z.string().min(1),
    rawIntentHash: z.string().min(1),
    goal: z.string().min(1),
    constraints: z.array(CandidateConstraintSchema),
    preferences: z.array(CandidateConstraintSchema),
    assumptions: z.array(AssumptionSchema),
    ambiguities: z.array(AmbiguityRecordSchema),
    readiness: IntentReadinessSchema,
    lifecycle: z.literal("COMPILED"),
    compiledAt: z.string().min(1),
    modelMeta: ModelInvocationMetaSchema,
    candidateHash: z.string().min(1),
  })
  .strict();

export const SemanticTransformationSchema = z
  .object({
    fromConcept: z.string().min(1),
    toConcept: z.string().min(1),
    class: TransformationClassSchema,
    severity: FindingSeveritySchema,
    evidenceSpans: z.array(SourceSpanSchema),
    message: z.string().optional(),
  })
  .strict();

export const VerificationFindingSchema = z
  .object({
    code: z.string().min(1),
    severity: FindingSeveritySchema,
    message: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(z.string()),
    transformation: SemanticTransformationSchema.optional(),
  })
  .strict();

/** Model-facing verifier output before lifecycle stamping. */
export const VerifierModelOutputSchema = z
  .object({
    findings: z.array(VerificationFindingSchema),
    transformations: z.array(SemanticTransformationSchema),
    criticalFailure: z.boolean(),
    readiness: IntentReadinessSchema,
    ambiguityClass: AmbiguityClassSchema,
  })
  .strict();

export const SemanticVerificationResultSchema = z
  .object({
    id: z.string().min(1),
    intentId: z.string().min(1),
    candidateId: z.string().min(1),
    candidateHash: z.string().min(1),
    lifecycle: z.enum(["VERIFIED", "AMBIGUOUS", "REJECTED"]),
    findings: z.array(VerificationFindingSchema),
    transformations: z.array(SemanticTransformationSchema),
    criticalFailure: z.boolean(),
    readiness: IntentReadinessSchema,
    ambiguityClass: AmbiguityClassSchema,
    modelProposedReadiness: IntentReadinessSchema.optional(),
    modelProposedAmbiguityClass: AmbiguityClassSchema.optional(),
    modelMeta: ModelInvocationMetaSchema,
    verifiedAt: z.string().min(1),
  })
  .strict();

export const AuthoritativeProofStatusSchema = z.enum([
  "SATISFIED",
  "UNSATISFIED",
  "UNKNOWN",
]);

export const AuthoritativeProofMechanismSchema = z.enum([
  "EVIDENCE_OBLIGATION",
  "DETERMINISTIC_RULE",
]);

export const SemanticVerificationEvidenceRefSchema = z
  .object({
    id: z.string().min(1),
    hash: z.string().min(1),
    claimIds: z.array(z.string().min(1)).optional(),
    trustClass: TrustClassSchema.optional(),
  })
  .strict();

export const AuthoritativeProofRowSchema = z
  .object({
    obligationId: z.string().min(1),
    constraintId: z.string().min(1).optional(),
    concept: z.string().min(1).optional(),
    evidenceId: z.string().min(1).optional(),
    claimId: z.string().min(1).optional(),
    evidenceTrustClass: TrustClassSchema.optional(),
    status: AuthoritativeProofStatusSchema,
    reason: z.string().min(1),
    proofMechanism: AuthoritativeProofMechanismSchema,
    deterministicRuleId: z.string().min(1).optional(),
  })
  .strict();

export const AuthoritativeProofCoverageSchema = z
  .object({
    requiredConstraintIds: z.array(z.string().min(1)),
    derivedObligationConstraintIds: z.array(z.string().min(1)),
    evaluatedConstraintIds: z.array(z.string().min(1)),
    missingObligationConstraintIds: z.array(z.string().min(1)),
    missingEvaluationConstraintIds: z.array(z.string().min(1)),
    incompleteDeterministicRuleIds: z.array(z.string().min(1)),
    allRequiredCovered: z.boolean(),
  })
  .strict();

export const AuthoritativeProofSummarySchema = z
  .object({
    version: z.literal(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    intentStateHash: z.string().min(1),
    sourceIntentStateId: z.string().min(1).optional(),
    sourceIntentStateHash: z.string().min(1).optional(),
    packId: z.string().min(1),
    generatedAt: z.string().min(1),
    requiredProofObligationIds: z.array(z.string().min(1)),
    proofRows: z.array(AuthoritativeProofRowSchema),
    coverage: AuthoritativeProofCoverageSchema,
    verifiedEvidenceRefs: z.array(SemanticVerificationEvidenceRefSchema).default([]),
    ambiguityResolution: z.record(z.unknown()).optional(),
  })
  .strict();

export const SemanticVerificationArtifactPayloadSchema = z
  .object({
    schemaVersion: z.number(),
    intentStateId: z.string().min(1),
    intentStateHash: z.string().min(1),
    intentStateVersion: z.number().optional(),
    previousIntentStateId: z.string().min(1).optional(),
    previousIntentStateHash: z.string().min(1).optional(),
    previousSemanticArtifactId: z.string().min(1).optional(),
    previousSemanticArtifactHash: z.string().min(1).optional(),
    sourceCompilationId: z.string().min(1).optional(),
    compilationId: z.string().min(1).optional(),
    compilationHash: z.string().min(1).optional(),
    verificationId: z.string().min(1).optional(),
    verificationHash: z.string().min(1).optional(),
    lifecycle: SemanticLifecycleSchema.optional(),
    verification: SemanticVerificationResultSchema,
    proofSummary: AuthoritativeProofSummarySchema.optional(),
    verifiedEvidenceRefs: z.array(SemanticVerificationEvidenceRefSchema).default([]),
    evaluatedAt: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();
