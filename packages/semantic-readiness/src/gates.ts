import {
  AmbiguityClass,
  CommitmentLevel,
  ErrorCode,
  IntentReadiness,
  SemanticLifecycle,
  err,
  ok,
  type Result,
  type SemanticVerificationResult,
} from "@truemandate/protocol";

export interface SemanticGateContext {
  readonly intentStateId: string;
  readonly verification: SemanticVerificationResult;
}

const PLANNING_READY: ReadonlySet<IntentReadiness> = new Set([
  IntentReadiness.PLANNABLE,
  IntentReadiness.ACTIONABLE,
  IntentReadiness.EXECUTABLE,
]);

const PRIVILEGED_READY: ReadonlySet<IntentReadiness> = new Set([
  IntentReadiness.ACTIONABLE,
  IntentReadiness.EXECUTABLE,
]);

const AMBIGUOUS_BLOCK_ECONOMIC: ReadonlySet<AmbiguityClass> = new Set([
  AmbiguityClass.A2,
  AmbiguityClass.A3,
  AmbiguityClass.A4,
]);

/**
 * IntentState existence never implies privilege. Gate on verification result.
 */
export function assertPlanningAllowed(ctx: SemanticGateContext): Result<void> {
  const v = ctx.verification;
  if (v.criticalFailure || v.lifecycle === SemanticLifecycle.REJECTED) {
    return err(
      ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
      "Rejected or critical semantic state cannot be planned",
      { lifecycle: v.lifecycle, criticalFailure: v.criticalFailure },
    );
  }
  if (!PLANNING_READY.has(v.readiness)) {
    return err(
      ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
      "Readiness below PLANNABLE",
      { readiness: v.readiness, intentStateId: ctx.intentStateId },
    );
  }
  return ok();
}

export function assertPrivilegedPlanningAllowed(
  ctx: SemanticGateContext,
): Result<void> {
  const base = assertPlanningAllowed(ctx);
  if (!base.ok) return base;
  const v = ctx.verification;
  if (!PRIVILEGED_READY.has(v.readiness)) {
    return err(
      ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
      "Privileged planning requires ACTIONABLE or EXECUTABLE readiness",
      { readiness: v.readiness },
    );
  }
  return ok();
}

export function assertEconomicDelegationAllowed(
  ctx: SemanticGateContext,
  commitmentLevel: CommitmentLevel,
): Result<void> {
  if (
    commitmentLevel !== CommitmentLevel.ECONOMIC &&
    commitmentLevel !== CommitmentLevel.HIGH_CONSEQUENCE
  ) {
    return assertPlanningAllowed(ctx);
  }
  const privileged = assertPrivilegedPlanningAllowed(ctx);
  if (!privileged.ok) return privileged;
  const v = ctx.verification;
  if (AMBIGUOUS_BLOCK_ECONOMIC.has(v.ambiguityClass)) {
    return err(
      ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
      "Ambiguous intent cannot receive economic / high-consequence commitment",
      { ambiguityClass: v.ambiguityClass, commitmentLevel },
    );
  }
  return ok();
}

export function assertCommitmentAllowedForPlan(
  ctx: SemanticGateContext,
  commitmentLevel: CommitmentLevel,
): Result<void> {
  if (
    commitmentLevel === CommitmentLevel.ECONOMIC ||
    commitmentLevel === CommitmentLevel.HIGH_CONSEQUENCE
  ) {
    return assertEconomicDelegationAllowed(ctx, commitmentLevel);
  }
  return assertPlanningAllowed(ctx);
}
