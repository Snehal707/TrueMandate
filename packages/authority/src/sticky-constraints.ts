import {
  ErrorCode,
  STICKY_CONSTRAINT_KINDS,
  err,
  ok,
  type Constraint,
  type ConstraintId,
  type Result,
} from "@truemandate/protocol";

/**
 * INV_005: Critical/sticky constraints cannot disappear without explicit authorized change.
 */
export function assertStickyConstraintsPreserved(
  parentConstraints: readonly Constraint[],
  childConstraints: readonly Constraint[],
  options?: {
    readonly authorizedRemovedIds?: ReadonlySet<ConstraintId> | readonly ConstraintId[];
  },
): Result<void> {
  const authorized = new Set(
    options?.authorizedRemovedIds === undefined
      ? []
      : [...options.authorizedRemovedIds],
  );
  const childById = new Map(childConstraints.map((c) => [c.id, c]));

  for (const parent of parentConstraints) {
    if (!STICKY_CONSTRAINT_KINDS.has(parent.kind)) {
      continue;
    }
    if (authorized.has(parent.id)) {
      continue;
    }
    const child = childById.get(parent.id);
    if (!child) {
      return err(
        ErrorCode.CRITICAL_CONSTRAINT_MISSING,
        `Sticky constraint '${parent.concept}' (${parent.id}) disappeared without authorized change`,
        { constraintId: parent.id, kind: parent.kind },
      );
    }
    if (child.kind !== parent.kind || child.concept !== parent.concept) {
      return err(
        ErrorCode.CRITICAL_CONSTRAINT_MISSING,
        `Sticky constraint '${parent.concept}' was altered without authorized change`,
        { constraintId: parent.id },
      );
    }
  }
  return ok();
}

export function listStickyConstraints(
  constraints: readonly Constraint[],
): readonly Constraint[] {
  return constraints.filter((c) => STICKY_CONSTRAINT_KINDS.has(c.kind));
}
