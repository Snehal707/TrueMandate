/**
 * Read-model view DTOs — projections only. Never mutate canonical state.
 */

export interface IntentSummaryView {
  readonly intentId: string;
  readonly rawIntent: string;
  readonly principalId: string;
  readonly createdAt: string;
  readonly intentStateId?: string;
  readonly intentStateVersion?: number;
  readonly stateHash?: string;
  readonly readiness?: string;
  readonly ambiguityClass?: string;
  readonly historicalStateIds: readonly string[];
}

export interface ConstraintView {
  readonly id: string;
  readonly concept: string;
  readonly operator: string;
  readonly expectedValue: unknown;
  readonly criticality: string;
  readonly meaningClass: string;
  readonly sourceText?: string;
  readonly sourceSpan?: { readonly start: number; readonly end: number };
  readonly status?: string;
  readonly transformation?:
    | "PRESERVED"
    | "WEAKENED"
    | "STRENGTHENED"
    | "REINTERPRETED"
    | "DROPPED"
    | "CONTRADICTED";
  readonly criticalFailure: boolean;
  readonly modelName?: string;
  readonly promptVersion?: string;
  readonly groundingStatus?: string;
}

export interface SemanticStateView {
  readonly intentId: string;
  readonly constraints: readonly ConstraintView[];
  readonly rawIntent: string;
}

export interface PlanStepView {
  readonly id: string;
  readonly objective: string;
  readonly agent?: string;
  readonly commitmentLevel?: string;
  readonly status?: string;
  readonly coverage?: string;
  readonly deferred: boolean;
  readonly irrelevant: boolean;
  readonly requiredConstraints: readonly string[];
  readonly proofObligations: readonly string[];
  readonly delegatedCapabilities: readonly string[];
}

export interface PlanView {
  readonly planId?: string;
  readonly steps: readonly PlanStepView[];
}

export interface JudgeView {
  readonly judgeId: string;
  readonly status: string;
  readonly findings: readonly string[];
  readonly affectedConstraints: readonly string[];
  readonly confidence?: number;
  readonly modelName?: string;
  readonly promptVersion?: string;
  readonly schemaVersion?: string;
}

export interface GuardianView {
  readonly judges: readonly JudgeView[];
  /** Deterministic aggregator — not a majority vote. */
  readonly aggregator: {
    readonly decision: string;
    readonly semanticStatus: string;
    readonly criticalFailure: boolean;
    readonly overallFidelity?: number;
  };
}

export interface AuthorityView {
  readonly guardianRecommendation?: string;
  readonly semanticGate?: string;
  readonly decision?: string;
  readonly capability?: string;
  readonly principalId?: string;
  readonly agentId?: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly expiresAt?: string;
  readonly cumulativeExposure?: number;
  readonly approvalState?: string;
  readonly grantState?: string;
  readonly revocationState?: string;
  readonly explanation: string;
}

export interface ExecutionView {
  readonly phase:
    | "PROPOSE"
    | "PREPARE"
    | "AUTHORIZE"
    | "COMMIT"
    | "EXECUTE"
    | "BLOCKED";
  readonly stopReason?: string;
  readonly preparedAction?: {
    readonly id: string;
    readonly merchant?: string;
    readonly product?: string;
    readonly quantity?: number;
    readonly amount?: number;
    readonly currency?: string;
    readonly capability?: string;
    readonly parameterHash?: string;
    readonly outcomeContractId?: string;
    readonly outcomeContractHash?: string;
    readonly expiresAt?: string;
  };
  readonly sideEffects: readonly {
    readonly id: string;
    readonly tool?: string;
    readonly agent?: string;
    readonly amount?: number;
    readonly result?: string;
    readonly reconciliationState?: string;
    readonly at?: string;
  }[];
  readonly unknownPending: boolean;
  readonly reservedExposure?: number;
  readonly blockedRetry: boolean;
}

export interface OutcomeRequirementView {
  readonly concept: string;
  readonly criticality: string;
  readonly state: string;
  readonly observed?: unknown;
  readonly expected?: unknown;
  readonly display: string;
}

export interface OutcomeView {
  readonly contractId: string;
  readonly contractState: string;
  readonly paymentStatus: string;
  readonly requirements: readonly OutcomeRequirementView[];
  readonly atRisk?: {
    readonly deadline?: string;
    readonly eta?: string;
    readonly basis?: string;
    readonly confidence?: number;
  };
  readonly missingEvidence: readonly string[];
  readonly conflicts: readonly string[];
}

export interface RemedyOptionView {
  readonly id: string;
  readonly description: string;
  readonly restorationValue?: number;
  readonly financialCost?: number;
  readonly timeCost?: string;
  readonly criticalConstraintsPreserved: boolean;
  readonly reversibility?: string;
  readonly authorityRequired: boolean;
  readonly risks: readonly string[];
}

export interface ResolutionView {
  readonly caseId: string;
  readonly state: string;
  readonly triggerIdentity?: string;
  readonly firstDivergence?: string;
  readonly responsibilityState: string;
  readonly hypotheses: readonly {
    readonly id: string;
    readonly cause: string;
    readonly status: string;
    readonly confidence: number;
    readonly supporting: readonly string[];
    readonly contradictory: readonly string[];
    readonly missing: readonly string[];
  }[];
  readonly evidenceRequests: readonly string[];
  readonly remedies: readonly RemedyOptionView[];
  readonly blameHonest: boolean;
}

export interface ProvenanceNodeView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly trustClass?: string;
  readonly tainted: boolean;
  readonly taintClasses: readonly string[];
}

export interface ProvenanceEdgeView {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}

export type GraphFilter =
  | "semantic"
  | "authority"
  | "external"
  | "tainted"
  | "execution"
  | "outcome"
  | "resolution"
  | "critical";

export interface ProvenanceGraphView {
  readonly nodes: readonly ProvenanceNodeView[];
  readonly edges: readonly ProvenanceEdgeView[];
  readonly activeFilter?: GraphFilter;
  readonly traceToHuman?: readonly string[];
}

export interface TimelineEventView {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly actor?: string;
  readonly summary: string;
  readonly relatedObjectIds: readonly string[];
  readonly reasonCode?: string;
  readonly hashes?: Readonly<Record<string, string>>;
  readonly dedupeKey?: string;
}

export interface TimelineView {
  readonly events: readonly TimelineEventView[];
}

export interface IntentWorkspaceView {
  readonly summary: IntentSummaryView;
  readonly semantic: SemanticStateView;
  readonly plan: PlanView;
  readonly guardian: GuardianView;
  readonly authority: AuthorityView;
  readonly execution: ExecutionView;
  readonly outcome?: OutcomeView;
  readonly resolution?: ResolutionView;
  readonly graph: ProvenanceGraphView;
  readonly timeline: TimelineView;
}
