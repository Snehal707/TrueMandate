/**
 * Concepts that preferences must never fill — even when unspecified on the
 * current IntentState. Preferences may only fill unspecified soft choices.
 */
export const PROTECTED_PREFERENCE_CONCEPTS: ReadonlySet<string> = new Set([
  "budget",
  "quantity",
  "merchant",
  "deadline",
  "capability",
  "authority",
]);

export function isProtectedPreferenceConcept(concept: string): boolean {
  return PROTECTED_PREFERENCE_CONCEPTS.has(concept.trim().toLowerCase());
}
