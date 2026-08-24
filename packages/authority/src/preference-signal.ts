import {
  ErrorCode,
  err,
  ok,
  type Result,
} from "@truemandate/protocol";

/**
 * INV_027: Learned preferences / USER_PREFERENCE proposals must never target
 * concepts that would silently modify budget, quantity, merchant, deadline,
 * capability, or authority — even when currently unspecified.
 *
 * Duplicated denylist (not imported from preference-core) so Authority's
 * create-time guard stays independent of the preference retrieval package.
 */
export const AUTHORITY_PROTECTED_PREFERENCE_CONCEPTS: ReadonlySet<string> =
  new Set([
    "budget",
    "quantity",
    "merchant",
    "deadline",
    "capability",
    "authority",
  ]);

export function assertPreferenceCannotTargetProtectedConcept(
  concept: unknown,
): Result<void> {
  if (typeof concept !== "string" || concept.trim() === "") {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "USER_PREFERENCE content.concept is required",
    );
  }
  const normalized = concept.trim().toLowerCase();
  if (AUTHORITY_PROTECTED_PREFERENCE_CONCEPTS.has(normalized)) {
    return err(
      ErrorCode.PREFERENCE_PROTECTED_CONCEPT,
      "Preference cannot target protected concepts (budget/quantity/merchant/deadline/capability/authority)",
      { concept: normalized },
    );
  }
  return ok();
}

/**
 * INV_027 create-time validation for USER_PREFERENCE content shape.
 * Does not write PreferenceRecords — that happens only on confirm.
 */
export function assertUserPreferenceContent(
  content: Readonly<Record<string, unknown>>,
): Result<void> {
  if (typeof content.subjectId !== "string" || content.subjectId.trim() === "") {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "USER_PREFERENCE content.subjectId is required",
    );
  }
  const conceptCheck = assertPreferenceCannotTargetProtectedConcept(
    content.concept,
  );
  if (!conceptCheck.ok) return conceptCheck;

  if (!("value" in content)) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "USER_PREFERENCE content.value is required",
    );
  }

  const origin = content.origin;
  if (
    origin !== "EXPLICIT_USER_INPUT" &&
    origin !== "CONFIRMED_LEARNING"
  ) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "USER_PREFERENCE content.origin must be EXPLICIT_USER_INPUT or CONFIRMED_LEARNING",
    );
  }

  return ok();
}
