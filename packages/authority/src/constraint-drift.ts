import { ConstraintOperator, type Constraint } from "@truemandate/protocol";

/**
 * Wave 3.6: real, deterministic constraint-weakening detector.
 *
 * Compares two versions of the same constraint (matched by id, which
 * identifies the same tracked requirement across IntentState transitions)
 * and structurally classifies whether the newer version is strictly weaker
 * than the older one. This is a pure, non-LLM comparison over `operator` /
 * `value` — it never infers intent and never fabricates a verdict when the
 * comparison is ambiguous (e.g. operator changed to an unrelated family).
 *
 * A removed constraint (present in `previous`, absent in `next`) is also
 * weakening: an enforced requirement became unenforced. This function does
 * not decide whether that removal is *authorized* — INV_005
 * (`assertStickyConstraintsPreserved`) remains the fail-closed gate for
 * sticky kinds at delegation boundaries. This module only *detects and
 * reports* drift for analytics; it never blocks or authorizes anything.
 */
export interface WeakenedConstraint {
  readonly constraintId: string;
  readonly concept: string;
  readonly reason:
    | "REMOVED"
    | "BOUND_LOOSENED"
    | "RANGE_WIDENED"
    | "SET_WIDENED"
    | "REQUIREMENT_DROPPED";
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isProperSuperset(next: readonly unknown[], previous: readonly unknown[]): boolean {
  const prevSet = new Set(previous.map((v) => JSON.stringify(v)));
  const nextSet = new Set(next.map((v) => JSON.stringify(v)));
  if (nextSet.size <= prevSet.size) return false;
  for (const v of prevSet) {
    if (!nextSet.has(v)) return false;
  }
  return true;
}

function isProperSubset(next: readonly unknown[], previous: readonly unknown[]): boolean {
  const prevSet = new Set(previous.map((v) => JSON.stringify(v)));
  const nextSet = new Set(next.map((v) => JSON.stringify(v)));
  if (nextSet.size >= prevSet.size) return false;
  for (const v of nextSet) {
    if (!prevSet.has(v)) return false;
  }
  return true;
}

/**
 * Deterministic pairwise classification. Returns undefined when the pair is
 * not comparable (different operator family) rather than guessing.
 */
function classifyPair(
  previous: Constraint,
  next: Constraint,
): WeakenedConstraint["reason"] | undefined {
  if (previous.operator !== next.operator) {
    // REQUIRE -> dropped is handled via removal; unrelated operator swaps
    // (e.g. LT -> IN) are not structurally comparable without inference.
    return undefined;
  }

  switch (previous.operator) {
    case ConstraintOperator.LT:
    case ConstraintOperator.LTE: {
      const prevV = asFiniteNumber(previous.value);
      const nextV = asFiniteNumber(next.value);
      if (prevV === undefined || nextV === undefined) return undefined;
      return nextV > prevV ? "BOUND_LOOSENED" : undefined;
    }
    case ConstraintOperator.GT:
    case ConstraintOperator.GTE: {
      const prevV = asFiniteNumber(previous.value);
      const nextV = asFiniteNumber(next.value);
      if (prevV === undefined || nextV === undefined) return undefined;
      return nextV < prevV ? "BOUND_LOOSENED" : undefined;
    }
    case ConstraintOperator.BETWEEN: {
      const prevRange = asArray(previous.value);
      const nextRange = asArray(next.value);
      if (!prevRange || !nextRange || prevRange.length !== 2 || nextRange.length !== 2) {
        return undefined;
      }
      const [prevMin, prevMax] = prevRange.map(asFiniteNumber);
      const [nextMin, nextMax] = nextRange.map(asFiniteNumber);
      if (
        prevMin === undefined ||
        prevMax === undefined ||
        nextMin === undefined ||
        nextMax === undefined
      ) {
        return undefined;
      }
      const widened = nextMin <= prevMin && nextMax >= prevMax && (nextMin < prevMin || nextMax > prevMax);
      return widened ? "RANGE_WIDENED" : undefined;
    }
    case ConstraintOperator.IN: {
      const prevSet = asArray(previous.value);
      const nextSet = asArray(next.value);
      if (!prevSet || !nextSet) return undefined;
      return isProperSuperset(nextSet, prevSet) ? "SET_WIDENED" : undefined;
    }
    case ConstraintOperator.NOT_IN: {
      const prevSet = asArray(previous.value);
      const nextSet = asArray(next.value);
      if (!prevSet || !nextSet) return undefined;
      // Fewer excluded values = a wider allowed set = weaker constraint.
      return isProperSubset(nextSet, prevSet) ? "SET_WIDENED" : undefined;
    }
    case ConstraintOperator.REQUIRE: {
      if (previous.value === next.value) return undefined;
      const prevRequired = previous.value !== false;
      const nextRequired = next.value !== false;
      return prevRequired && !nextRequired ? "REQUIREMENT_DROPPED" : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Deterministically detect weakened constraints between two IntentState
 * constraint sets belonging to the same Intent lineage. Pure function — no
 * side effects, no network, no model calls.
 */
export function detectWeakenedConstraints(
  previous: readonly Constraint[],
  next: readonly Constraint[],
): readonly WeakenedConstraint[] {
  const nextById = new Map(next.map((c) => [c.id, c]));
  const results: WeakenedConstraint[] = [];

  for (const prev of previous) {
    const cur = nextById.get(prev.id);
    if (!cur) {
      results.push({
        constraintId: String(prev.id),
        concept: prev.concept,
        reason: "REMOVED",
      });
      continue;
    }
    const reason = classifyPair(prev, cur);
    if (reason) {
      results.push({
        constraintId: String(prev.id),
        concept: cur.concept,
        reason,
      });
    }
  }

  return results;
}
