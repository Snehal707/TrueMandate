import type {
  CapabilityName,
  CommitmentLevel,
  ConsequenceLevel,
  ConstraintCoverageStatus,
  PlanStatus as PlanStatusType,
} from "./enums.js";
import type {
  AgentId,
  AssumptionId,
  ConstraintId,
  HashDigest,
  IntentId,
  IntentStateId,
  PlanId,
  PlanStepId,
  ProvenanceNodeId,
} from "./ids.js";
import type { ProofObligation } from "./objects.js";
import type {
  AmbiguityClass,
  IntentReadiness,
  ModelInvocationMeta,
  TransformationClass,
} from "./semantic.js";

export interface ConstraintCoverageEntry {
  readonly constraintId: ConstraintId;
  readonly status: ConstraintCoverageStatus;
  readonly planStepIds: readonly PlanStepId[];
  readonly notes?: string;
}

export interface PlanOperationalization {
  readonly sourceConstraintId: ConstraintId;
  readonly derivedRepresentation: string;
  readonly transformationClass: TransformationClass;
  readonly confidence: number;
  readonly provenanceNodeId?: ProvenanceNodeId;
}

export interface PlanInvalidationDeps {
  readonly stepIds: readonly PlanStepId[];
  readonly proofConstraintIds: readonly ConstraintId[];
  readonly relatedPlanIds: readonly PlanId[];
}

export interface PlanStep {
  readonly id: PlanStepId;
  readonly objective: string;
  readonly assignedAgent: AgentId;
  readonly requiredConstraintIds: readonly ConstraintId[];
  /** Capabilities eligible for current delegation (least privilege). */
  readonly requestedCapabilities: readonly (CapabilityName | string)[];
  /** Future needs expressed by the plan; never auto-granted. */
  readonly requiredFutureCapabilities: readonly (CapabilityName | string)[];
  readonly inputs: readonly string[];
  readonly expectedOutput: string;
  readonly assumptionIds: readonly AssumptionId[];
  readonly consequenceLevel: ConsequenceLevel;
  readonly commitmentLevel: CommitmentLevel;
  readonly privileged: boolean;
  readonly dependsOn: readonly PlanStepId[];
  readonly applicableConstraintIds: readonly ConstraintId[];
  readonly inheritedConstraintIds: readonly ConstraintId[];
  readonly irrelevantConstraintIds: readonly ConstraintId[];
}

export interface PlanGraph {
  readonly id: PlanId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly semanticVerificationId: string;
  readonly semanticVerificationHash: HashDigest;
  readonly readinessAtPlan: IntentReadiness;
  readonly ambiguityClassAtPlan: AmbiguityClass;
  readonly status: PlanStatusType;
  readonly version: number;
  readonly previousPlanId?: PlanId;
  readonly planHash: HashDigest;
  readonly plannerMeta: ModelInvocationMeta;
  readonly createdAt: string;
  readonly steps: readonly PlanStep[];
  readonly coverage: readonly ConstraintCoverageEntry[];
  readonly proofObligations: readonly ProofObligation[];
  readonly operationalizations: readonly PlanOperationalization[];
  readonly assumptionIds: readonly AssumptionId[];
  readonly invalidationDeps: PlanInvalidationDeps;
  readonly semanticDelta?: {
    readonly stepsAdded: readonly PlanStepId[];
    readonly stepsRemoved: readonly PlanStepId[];
    readonly assumptionsAdded: readonly AssumptionId[];
    readonly constraintsAffected: readonly ConstraintId[];
  };
}

export interface PlanVerificationFinding {
  readonly code: string;
  readonly severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly message: string;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
}

export interface PlanVerificationResult {
  readonly id: string;
  readonly planId: PlanId;
  readonly planHash: HashDigest;
  readonly status: "VERIFIED" | "REJECTED";
  readonly findings: readonly PlanVerificationFinding[];
  readonly coverage: readonly ConstraintCoverageEntry[];
  readonly criticalFailure: boolean;
  readonly modelMeta: ModelInvocationMeta;
  readonly verifiedAt: string;
}
