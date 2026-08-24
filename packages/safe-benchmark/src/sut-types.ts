export enum SystemVariant {
  BASELINE_SINGLE_AGENT = "BASELINE_SINGLE_AGENT",
  BASELINE_MULTI_AGENT = "BASELINE_MULTI_AGENT",
  GUARDIAN_ONLY = "GUARDIAN_ONLY",
  DETERMINISTIC_CORE = "DETERMINISTIC_CORE",
  TRUEMANDATE_FULL = "TRUEMANDATE_FULL",
}

export type AuthorityDecisionResult = "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL";
export type ExecutionResultKind = "SUCCESS" | "BLOCKED" | "UNKNOWN" | "NONE";
export type OutcomeStateResult =
  | "SATISFIED"
  | "PARTIAL"
  | "BREACHED"
  | "AT_RISK"
  | "NONE"
  | "AWAITING_OUTCOME";
export type ResolutionStateResult =
  | "OPEN"
  | "NONE"
  | "ESCALATED"
  | "GATHERING_EVIDENCE"
  | "ANALYZING"
  | "REMEDY_PROPOSED"
  | "AWAITING_AUTHORITY"
  | "REMEDIATING"
  | "VERIFYING_REMEDY"
  | "RESOLVED"
  | "CLOSED";

export interface SutSideEffect {
  readonly kind: string;
  readonly privilegeClass?: "T0_READ" | "T1_REVERSIBLE_WRITE" | "T2_ECONOMIC_WRITE" | "T3_HIGH_CONSEQUENCE";
  readonly detail?: string;
}

export interface ObservedConstraint {
  readonly concept: string;
  readonly satisfied: boolean;
  readonly negated?: boolean;
}

export interface SutResult {
  readonly variant: SystemVariant;
  readonly authorityDecision: AuthorityDecisionResult;
  readonly executionResult: ExecutionResultKind;
  readonly outcomeState: OutcomeStateResult;
  readonly resolutionState: ResolutionStateResult;
  readonly responsibilityState: string;
  readonly sideEffects: readonly SutSideEffect[];
  readonly interrupted: boolean;
  readonly approved: boolean;
  readonly modelCalls: number;
  readonly latencyMs?: number;
  readonly findings?: readonly string[];
  readonly paymentStatus?: "SUCCESS" | "FAILED" | "UNKNOWN" | "NONE";
  /** True if SUT treated payment SUCCESS as outcome SATISFIED (fault). */
  readonly paymentAsOutcomeSatisfied?: boolean;
  readonly falseBlameEstablished?: boolean;
  /** Constraints the SUT reports as extracted/satisfied (for recall/precision). */
  readonly observedConstraints?: readonly ObservedConstraint[];
  /** SUT-reported first divergence node/label (compared to groundTruthFirstDivergence). */
  readonly reportedFirstDivergence?: string;
  /** True when the SUT claims original human intent was restored via remedy. */
  readonly restoredIntent?: boolean;
  /** True when the SUT correctly blocked a critical adversarial attack. */
  readonly criticalAttackBlocked?: boolean;
}
