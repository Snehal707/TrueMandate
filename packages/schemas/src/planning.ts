import { z } from "zod";
import {
  CommitmentLevelSchema,
  ConsequenceLevelSchema,
  ConstraintCoverageStatusSchema,
  PlanStatusSchema,
} from "./enums.js";
import { ProofObligationSchema } from "./objects.js";
import {
  AmbiguityClassSchema,
  IntentReadinessSchema,
  ModelInvocationMetaSchema,
  TransformationClassSchema,
} from "./semantic.js";

const IdSchema = z.string().min(1);
const HashSchema = z.string().min(1);
const IsoDateTimeSchema = z.string().min(1);

export const ConstraintCoverageEntrySchema = z
  .object({
    constraintId: IdSchema,
    status: ConstraintCoverageStatusSchema,
    planStepIds: z.array(IdSchema),
    notes: z.string().optional(),
  })
  .strict();

export const PlanOperationalizationSchema = z
  .object({
    sourceConstraintId: IdSchema,
    derivedRepresentation: z.string().min(1),
    transformationClass: TransformationClassSchema,
    confidence: z.number().min(0).max(1),
    provenanceNodeId: IdSchema.optional(),
  })
  .strict();

export const PlanInvalidationDepsSchema = z
  .object({
    stepIds: z.array(IdSchema),
    proofConstraintIds: z.array(IdSchema),
    relatedPlanIds: z.array(IdSchema),
  })
  .strict();

export const PlanStepSchema = z
  .object({
    id: IdSchema,
    objective: z.string().min(1),
    assignedAgent: IdSchema,
    requiredConstraintIds: z.array(IdSchema),
    requestedCapabilities: z.array(z.string()),
    requiredFutureCapabilities: z.array(z.string()),
    inputs: z.array(z.string()),
    expectedOutput: z.string().min(1),
    assumptionIds: z.array(IdSchema),
    consequenceLevel: ConsequenceLevelSchema,
    commitmentLevel: CommitmentLevelSchema,
    privileged: z.boolean(),
    dependsOn: z.array(IdSchema),
    applicableConstraintIds: z.array(IdSchema),
    inheritedConstraintIds: z.array(IdSchema),
    irrelevantConstraintIds: z.array(IdSchema),
  })
  .strict();

export const PlanGraphSchema = z
  .object({
    id: IdSchema,
    intentId: IdSchema,
    intentStateId: IdSchema,
    semanticVerificationId: z.string().min(1),
    semanticVerificationHash: HashSchema,
    readinessAtPlan: IntentReadinessSchema,
    ambiguityClassAtPlan: AmbiguityClassSchema,
    status: PlanStatusSchema,
    version: z.number().int().positive(),
    previousPlanId: IdSchema.optional(),
    planHash: HashSchema,
    plannerMeta: ModelInvocationMetaSchema,
    createdAt: IsoDateTimeSchema,
    steps: z.array(PlanStepSchema),
    coverage: z.array(ConstraintCoverageEntrySchema),
    proofObligations: z.array(ProofObligationSchema),
    operationalizations: z.array(PlanOperationalizationSchema),
    assumptionIds: z.array(IdSchema),
    invalidationDeps: PlanInvalidationDepsSchema,
    semanticDelta: z
      .object({
        stepsAdded: z.array(IdSchema),
        stepsRemoved: z.array(IdSchema),
        assumptionsAdded: z.array(IdSchema),
        constraintsAffected: z.array(IdSchema),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PlannerModelOutputSchema = z
  .object({
    steps: z.array(PlanStepSchema),
    coverage: z.array(ConstraintCoverageEntrySchema),
    proofObligations: z.array(ProofObligationSchema),
    operationalizations: z.array(PlanOperationalizationSchema),
    assumptionIds: z.array(IdSchema),
  })
  .strict();

export const PlanVerificationFindingSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    message: z.string().min(1),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(z.string()),
  })
  .strict();

export const PlanVerifierModelOutputSchema = z
  .object({
    findings: z.array(PlanVerificationFindingSchema),
    criticalFailure: z.boolean(),
  })
  .strict();

export const PlanVerificationResultSchema = z
  .object({
    id: z.string().min(1),
    planId: IdSchema,
    planHash: HashSchema,
    status: z.enum(["VERIFIED", "REJECTED"]),
    findings: z.array(PlanVerificationFindingSchema),
    coverage: z.array(ConstraintCoverageEntrySchema),
    criticalFailure: z.boolean(),
    modelMeta: ModelInvocationMetaSchema,
    verifiedAt: IsoDateTimeSchema,
  })
  .strict();
