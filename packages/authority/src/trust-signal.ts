import {
  ErrorCode,
  STICKY_CONSTRAINT_KINDS,
  err,
  ok,
  type AuthorityDecision,
  type CapabilityScope,
  type Constraint,
  type Result,
  type TrustSignal,
} from "@truemandate/protocol";
import { TrustSignalSchema, parseWithSchema } from "@truemandate/schemas";
import { DECISION_RANK, isCapabilityScopeSubset } from "./capability-subset.js";

/**
 * INV_026: Reputation/trust signals can reduce uncertainty but must never
 * override explicit intent, hard constraints, policy, capability bounds, or
 * existing Authority restrictions.
 */

export function parseTrustSignal(value: unknown): Result<TrustSignal> {
  const parsed = parseWithSchema(TrustSignalSchema, value, "TrustSignal");
  if (!parsed.ok) return parsed as Result<TrustSignal>;
  return ok(parsed.value as unknown as TrustSignal);
}

/**
 * Reputation cannot weaken or drop sticky policy constraints
 * (HARD / SAFETY_CRITICAL / LEGAL / ORGANIZATIONAL_POLICY).
 */
export function assertTrustSignalCannotWeakenConstraint(
  constraint: Constraint,
  attemptedOverride: boolean,
): Result<void> {
  if (!attemptedOverride) return ok();
  if (STICKY_CONSTRAINT_KINDS.has(constraint.kind)) {
    return err(
      ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY,
      "Reputation/trust cannot override hard constraints or policy",
      { constraintId: constraint.id, kind: constraint.kind },
    );
  }
  return ok();
}

/**
 * Reputation cannot move an AuthorityDecision to a more permissive rank.
 * Equal or more restrictive (lower rank) is allowed.
 */
export function assertTrustSignalCannotOverrideAuthorityDecision(
  baseline: AuthorityDecision,
  proposed: AuthorityDecision,
): Result<void> {
  if (DECISION_RANK[proposed] > DECISION_RANK[baseline]) {
    return err(
      ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY,
      "Reputation/trust cannot override existing Authority restrictions",
      { baseline, proposed },
    );
  }
  return ok();
}

/**
 * Canonical INV_026 gate. Combines sticky-constraint and AuthorityDecision
 * checks with capability-scope subset (INV_015-equivalent bound). Explicit
 * intent (INV_011) remains in applyLearningProposal — not duplicated here.
 */
export function assertReputationCannotOverridePolicy(input: {
  readonly constraint?: {
    readonly constraint: Constraint;
    readonly attemptedOverride: boolean;
  };
  readonly decision?: {
    readonly baseline: AuthorityDecision;
    readonly proposed: AuthorityDecision;
  };
  readonly currentScope?: CapabilityScope;
  readonly proposedScope?: CapabilityScope;
}): Result<void> {
  if (input.constraint) {
    const c = assertTrustSignalCannotWeakenConstraint(
      input.constraint.constraint,
      input.constraint.attemptedOverride,
    );
    if (!c.ok) return c;
  }
  if (input.decision) {
    const d = assertTrustSignalCannotOverrideAuthorityDecision(
      input.decision.baseline,
      input.decision.proposed,
    );
    if (!d.ok) return d;
  }
  if (input.currentScope && input.proposedScope) {
    const subset = isCapabilityScopeSubset(
      input.proposedScope,
      input.currentScope,
    );
    if (!subset.ok) {
      return err(
        ErrorCode.REPUTATION_CANNOT_OVERRIDE_POLICY,
        "Reputation/trust cannot expand capability bounds",
        subset.details,
      );
    }
  } else if (input.proposedScope && !input.currentScope) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "proposedScope requires currentScope for INV_026 capability-bound check",
    );
  }
  return ok();
}
