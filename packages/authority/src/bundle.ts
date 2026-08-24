import {
  ErrorCode,
  err,
  ok,
  type PreparedAction,
  type PreparedActionId,
  type Result,
} from "@truemandate/protocol";

/**
 * INV_024: Bundle constraints must be evaluated before dependent commits.
 */
export function assertBundleReadyForCommit(
  prepared: PreparedAction,
  committedIds: ReadonlySet<PreparedActionId> | ReadonlySet<string>,
  bundleConstraintSatisfied: boolean,
): Result<void> {
  if (!bundleConstraintSatisfied) {
    return err(
      ErrorCode.BUNDLE_CONSTRAINTS_UNMET,
      "Bundle constraints must be evaluated before dependent commits",
      { preparedActionId: prepared.id, bundleId: prepared.bundleId },
    );
  }
  const deps = prepared.dependsOnPreparedActionIds ?? [];
  for (const dep of deps) {
    if (!committedIds.has(dep)) {
      return err(
        ErrorCode.BUNDLE_CONSTRAINTS_UNMET,
        "Dependent prepared action cannot commit before its dependencies",
        { preparedActionId: prepared.id, missingDependency: dep },
      );
    }
  }
  return ok();
}
