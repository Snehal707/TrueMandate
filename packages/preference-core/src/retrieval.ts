import {
  STICKY_CONSTRAINT_KINDS,
  type Constraint,
  type PreferenceRecord,
} from "@truemandate/protocol";
import { isProtectedPreferenceConcept } from "./protected-concepts.js";

/**
 * Deterministic retrieval / precedence for preference memory.
 *
 * Ranking (approximate):
 *   hard/legal sticky > current explicit intent > confirmed preference >
 *   (other learned soft context — out of scope) > model inference (caller)
 *
 * Preferences may only fill unspecified soft choices. They never mutate
 * IntentState and never apply to protected concepts.
 */

export const EffectiveConstraintSourceKind = {
  EXPLICIT_CURRENT: "EXPLICIT_CURRENT",
  PREFERENCE: "PREFERENCE",
  NONE: "NONE",
} as const;
export type EffectiveConstraintSourceKind =
  (typeof EffectiveConstraintSourceKind)[keyof typeof EffectiveConstraintSourceKind];

export interface EffectiveConstraintSource {
  readonly kind: EffectiveConstraintSourceKind;
  readonly preference?: PreferenceRecord;
  readonly reason: string;
}

export function resolveEffectiveConstraintSource(
  currentConstraints: readonly Constraint[],
  concept: string,
  activePreference?: PreferenceRecord,
): EffectiveConstraintSource {
  const normalized = concept.trim();
  const matching = currentConstraints.filter((c) => c.concept === normalized);

  const sticky = matching.find((c) => STICKY_CONSTRAINT_KINDS.has(c.kind));
  if (sticky) {
    return {
      kind: EffectiveConstraintSourceKind.EXPLICIT_CURRENT,
      reason: `sticky constraint ${sticky.kind} already present for concept`,
    };
  }

  if (matching.length > 0) {
    return {
      kind: EffectiveConstraintSourceKind.EXPLICIT_CURRENT,
      reason: "explicit current IntentState already specifies concept",
    };
  }

  if (isProtectedPreferenceConcept(normalized)) {
    return {
      kind: EffectiveConstraintSourceKind.NONE,
      reason: "protected concept cannot be filled by preference",
    };
  }

  if (activePreference && activePreference.concept === normalized) {
    return {
      kind: EffectiveConstraintSourceKind.PREFERENCE,
      preference: activePreference,
      reason: "active confirmed preference fills unspecified soft concept",
    };
  }

  return {
    kind: EffectiveConstraintSourceKind.NONE,
    reason: "no preference; caller may fall through to model inference",
  };
}
