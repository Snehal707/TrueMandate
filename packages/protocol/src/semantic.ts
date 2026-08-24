import type {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
} from "./enums.js";
import type { ConstraintId, HashDigest, IntentId } from "./ids.js";
import type { Assumption, SourceSpan } from "./objects.js";

export const PROTOCOL_VERSION = "0.1.0" as const;

export const AmbiguityClass = {
  A0: "A0",
  A1: "A1",
  A2: "A2",
  A3: "A3",
  A4: "A4",
} as const;
export type AmbiguityClass = (typeof AmbiguityClass)[keyof typeof AmbiguityClass];

export const IntentReadiness = {
  SEARCHABLE: "SEARCHABLE",
  PLANNABLE: "PLANNABLE",
  ACTIONABLE: "ACTIONABLE",
  EXECUTABLE: "EXECUTABLE",
} as const;
export type IntentReadiness =
  (typeof IntentReadiness)[keyof typeof IntentReadiness];

export const SemanticLifecycle = {
  RAW: "RAW",
  COMPILED: "COMPILED",
  VERIFIED: "VERIFIED",
  AMBIGUOUS: "AMBIGUOUS",
  REJECTED: "REJECTED",
} as const;
export type SemanticLifecycle =
  (typeof SemanticLifecycle)[keyof typeof SemanticLifecycle];

export const TransformationClass = {
  PRESERVED: "PRESERVED",
  WEAKENED: "WEAKENED",
  STRENGTHENED: "STRENGTHENED",
  REINTERPRETED: "REINTERPRETED",
  DROPPED: "DROPPED",
  CONTRADICTED: "CONTRADICTED",
} as const;
export type TransformationClass =
  (typeof TransformationClass)[keyof typeof TransformationClass];

export const FindingSeverity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type FindingSeverity =
  (typeof FindingSeverity)[keyof typeof FindingSeverity];

export interface TemporalResolution {
  readonly originalExpression: string;
  readonly resolvedValue: string;
  readonly resolutionTimestamp: string;
  readonly timezone: string;
}

export interface ConstraintGrounding {
  readonly sourceText: string;
  readonly sourceSpan?: SourceSpan;
  readonly quoteExact: boolean;
}

export interface ModelInvocationMeta {
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly promptVersion: string;
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly protocolVersion: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly latencyMs?: number;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
}

export interface CandidateConstraint {
  readonly id: ConstraintId;
  readonly concept: string;
  readonly operator: ConstraintOperator;
  readonly value: unknown;
  readonly kind: ConstraintKind;
  readonly importance: number;
  readonly confidence: number;
  readonly sourceType: SourceType;
  readonly mutability: ConstraintMutability;
  readonly meaningClass: MeaningClass;
  readonly grounding: ConstraintGrounding;
  readonly temporalResolution?: TemporalResolution;
  readonly proofObligation?: {
    readonly verificationStep: string;
    readonly requiredEvidence: string;
    readonly enforcingService: string;
  };
}

export interface AmbiguityRecord {
  readonly id: string;
  readonly description: string;
  readonly ambiguityClass: AmbiguityClass;
  readonly relatedConcepts: readonly string[];
  readonly sourceText?: string;
}

export interface CandidateInterpretation {
  readonly id: string;
  readonly intentId: IntentId;
  readonly rawIntentHash: HashDigest;
  readonly goal: string;
  readonly constraints: readonly CandidateConstraint[];
  readonly preferences: readonly CandidateConstraint[];
  readonly assumptions: readonly Assumption[];
  readonly ambiguities: readonly AmbiguityRecord[];
  readonly readiness: IntentReadiness;
  readonly lifecycle: typeof SemanticLifecycle.COMPILED;
  readonly compiledAt: string;
  readonly modelMeta: ModelInvocationMeta;
  readonly candidateHash: HashDigest;
}

export interface SemanticTransformation {
  readonly fromConcept: string;
  readonly toConcept: string;
  readonly class: TransformationClass;
  readonly severity: FindingSeverity;
  readonly evidenceSpans: readonly SourceSpan[];
  readonly message?: string;
}

export interface VerificationFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly confidence: number;
  readonly sourceRefs: readonly string[];
  readonly transformation?: SemanticTransformation;
}

export interface SemanticVerificationResult {
  readonly id: string;
  readonly intentId: IntentId;
  readonly candidateId: string;
  readonly candidateHash: HashDigest;
  readonly lifecycle:
    | typeof SemanticLifecycle.VERIFIED
    | typeof SemanticLifecycle.AMBIGUOUS
    | typeof SemanticLifecycle.REJECTED;
  readonly findings: readonly VerificationFinding[];
  readonly transformations: readonly SemanticTransformation[];
  readonly criticalFailure: boolean;
  readonly readiness: IntentReadiness;
  readonly ambiguityClass: AmbiguityClass;
  /** Advisory model-proposed tier/labels — audit only; authorization-readiness
   * is derived deterministically and may differ. */
  readonly modelProposedReadiness?: IntentReadiness;
  readonly modelProposedAmbiguityClass?: AmbiguityClass;
  readonly modelMeta: ModelInvocationMeta;
  readonly verifiedAt: string;
}
