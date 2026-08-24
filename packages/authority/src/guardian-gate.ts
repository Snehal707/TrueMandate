import {
  AuthorityDecision,
  ErrorCode,
  GuardianSemanticStatus,
  err,
  ok,
  type GuardianVerdict,
  type HashDigest,
  type IntentState,
  type Result,
} from "@truemandate/protocol";

export interface GuardianGateInput {
  readonly verdict: GuardianVerdict;
  readonly actionContentHash: HashDigest | string;
  readonly tipIntentState: IntentState;
  readonly highConsequence: boolean;
  readonly expectedEvidenceSnapshotHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
}

/**
 * Deterministic semantic gate before economic authority.
 * Guardian ALLOW never forces Authority ALLOW.
 */
export function applyGuardianSemanticGate(
  input: GuardianGateInput,
): Result<{
  readonly decision: AuthorityDecision;
  readonly reasons: readonly string[];
}> {
  const v = input.verdict;
  if (v.stale) {
    return err(ErrorCode.GUARDIAN_VERDICT_STALE, "GuardianVerdict is stale");
  }
  if (v.intentStateId !== input.tipIntentState.id) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "GuardianVerdict IntentState is not tip",
    );
  }
  if (v.intentStateHash !== input.tipIntentState.stateHash) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "GuardianVerdict IntentState hash mismatch",
    );
  }
  if (v.actionContentHash !== input.actionContentHash) {
    return err(
      ErrorCode.ACTION_PROPOSAL_MISMATCH,
      "GuardianVerdict ActionProposal binding mismatch",
    );
  }
  if (
    input.expectedEvidenceSnapshotHash !== undefined &&
    v.evidenceSnapshotHash !== input.expectedEvidenceSnapshotHash
  ) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "GuardianVerdict evidence snapshot stale",
    );
  }
  if (input.planId !== undefined && v.planId !== input.planId) {
    return err(ErrorCode.PLAN_STALE, "GuardianVerdict planId mismatch");
  }
  if (
    input.planVersion !== undefined &&
    v.planVersion !== input.planVersion
  ) {
    return err(ErrorCode.PLAN_STALE, "GuardianVerdict planVersion mismatch");
  }

  if (
    v.criticalFailure ||
    v.semanticStatus === GuardianSemanticStatus.CRITICAL_FAILURE ||
    v.decision === AuthorityDecision.BLOCK
  ) {
    return ok({
      decision: AuthorityDecision.BLOCK,
      reasons: ["guardian critical failure or BLOCK recommendation"],
    });
  }

  if (v.semanticStatus === GuardianSemanticStatus.CONFLICTED) {
    if (input.highConsequence) {
      return ok({
        decision: AuthorityDecision.BLOCK,
        reasons: ["guardian CONFLICTED on high-consequence action"],
      });
    }
    return ok({
      decision: AuthorityDecision.REQUIRE_APPROVAL,
      reasons: ["guardian CONFLICTED"],
    });
  }

  if (v.semanticStatus === GuardianSemanticStatus.UNCERTAIN) {
    // Cannot silently become unrestricted economic autonomy
    return ok({
      decision: input.highConsequence
        ? AuthorityDecision.REQUIRE_APPROVAL
        : AuthorityDecision.ALLOW_WITH_MONITORING,
      reasons: ["guardian UNCERTAIN — no unrestricted economic autonomy"],
    });
  }

  if (v.semanticStatus === GuardianSemanticStatus.CLEAR) {
    return ok({
      decision: AuthorityDecision.ALLOW,
      reasons: ["guardian CLEAR — eligible for further deterministic checks"],
    });
  }

  return err(
    ErrorCode.SEMANTIC_GATE_BLOCKED,
    "Unrecognized guardian semantic status",
    { semanticStatus: v.semanticStatus },
  );
}

/** Combine guardian gate decision with scope decision (never upgrade from guardian BLOCK). */
export function combineAuthorityDecisions(
  guardian: AuthorityDecision,
  scope: AuthorityDecision,
): AuthorityDecision {
  const rank = (d: AuthorityDecision): number => {
    switch (d) {
      case AuthorityDecision.BLOCK:
        return 3;
      case AuthorityDecision.REQUIRE_APPROVAL:
        return 2;
      case AuthorityDecision.ALLOW_WITH_MONITORING:
        return 1;
      case AuthorityDecision.ALLOW:
        return 0;
      default:
        return 3;
    }
  };
  return rank(guardian) >= rank(scope) ? guardian : scope;
}
