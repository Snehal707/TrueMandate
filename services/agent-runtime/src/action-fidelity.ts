import type { ActionProposal, Constraint, IntentState } from "@truemandate/protocol";
import {
  ConstraintOperator,
} from "@truemandate/protocol";
import {
  compareTermMonths,
  evaluateApprovalFactSatisfaction,
  evaluateForbidSatisfaction,
  isApprovalFactConcept,
  isRefundabilityFactConcept,
  isTermFactConcept,
  normalizeRefundabilityFactValue,
  resolveCanonicalConcept,
  resolveCanonicalSemanticFact,
} from "@truemandate/semantic-readiness";
import type {
  ActionFidelityEvaluation,
  ActionFidelityRow,
  DomainPlanningDescriptor,
} from "./domain-pack.js";

export interface ActionFidelityCheck {
  readonly canonicalConcept: string;
  readonly factType?: string;
  readonly field: string;
  readonly actualValue: unknown;
}

function comparableScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const date = Date.parse(trimmed);
    return Number.isNaN(date) ? trimmed.toLowerCase() : date;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function constraintStatus(
  constraint: Constraint,
  actualValue: unknown,
  semanticFactKey?: string,
): Pick<ActionFidelityRow, "status" | "reason"> {
  if (isTermFactConcept(constraint.concept)) {
    if (actualValue === undefined || actualValue === null) {
      return {
        status: "UNKNOWN",
        reason: "Action is missing a deterministic value for this execution-critical constraint",
      };
    }
    const termStatus = compareTermMonths(constraint.value, actualValue);
    if (termStatus === "UNKNOWN") {
      return {
        status: "UNKNOWN",
        reason: "Action term duration could not be compared deterministically",
      };
    }
    return termStatus === "SATISFIED"
      ? { status: "MATCH", reason: "Action preserves the required term duration" }
      : { status: "MISMATCH", reason: "Action changes the required term duration" };
  }
  if (constraint.operator === ConstraintOperator.FORBID) {
    if (actualValue === undefined || actualValue === null) {
      return {
        status: "UNKNOWN",
        reason: "Action is missing a deterministic value for this execution-critical constraint",
      };
    }
    const forbidStatus = evaluateForbidSatisfaction(constraint.value, actualValue);
    if (forbidStatus === "UNKNOWN") {
      return {
        status: "UNKNOWN",
        reason: "Action value could not be compared deterministically against the forbidden value",
      };
    }
    return forbidStatus === "SATISFIED"
      ? { status: "MATCH", reason: "Action avoids the forbidden constraint value" }
      : { status: "MISMATCH", reason: "Action matches a forbidden constraint value" };
  }
  if (
    semanticFactKey?.endsWith(".approval") ||
    isApprovalFactConcept(constraint.concept)
  ) {
    if (actualValue === undefined || actualValue === null) {
      return {
        status: "UNKNOWN",
        reason: "Action is missing a deterministic value for this execution-critical constraint",
      };
    }
    const approvalStatus = evaluateApprovalFactSatisfaction(constraint.value, actualValue);
    if (approvalStatus === "SATISFIED") {
      return { status: "MATCH", reason: "Action preserves the required approval constraint" };
    }
    if (approvalStatus === "UNSATISFIED") {
      return { status: "MISMATCH", reason: "Action contradicts the required approval constraint" };
    }
    return {
      status: "UNKNOWN",
      reason: "Action approval value could not be compared deterministically",
    };
  }
  if (
    semanticFactKey?.startsWith("refundability.") ||
    isRefundabilityFactConcept(constraint.concept)
  ) {
    const expectedRefundability = normalizeRefundabilityFactValue(constraint.value);
    const actualRefundability = normalizeRefundabilityFactValue(actualValue);
    if (actualValue === undefined || actualValue === null) {
      return {
        status: "UNKNOWN",
        reason: "Action is missing a deterministic value for this execution-critical constraint",
      };
    }
    if (expectedRefundability !== undefined && actualRefundability !== undefined) {
      return actualRefundability === expectedRefundability
        ? { status: "MATCH", reason: "Action preserves the required refundability constraint" }
        : { status: "MISMATCH", reason: "Action contradicts the required refundability constraint" };
    }
    return {
      status: actualRefundability === undefined ? "UNKNOWN" : "MISMATCH",
      reason: actualRefundability === undefined
        ? "Action refundability value could not be compared deterministically"
        : "Action contradicts the required refundability constraint",
    };
  }
  const actualComparable = comparableScalar(actualValue);
  const expectedComparable = comparableScalar(constraint.value);
  if (actualValue === undefined || actualValue === null) {
    return {
      status: "UNKNOWN",
      reason: "Action is missing a deterministic value for this execution-critical constraint",
    };
  }
  if (constraint.operator === ConstraintOperator.REQUIRE) {
    if (typeof constraint.value === "boolean" && typeof actualComparable === "boolean") {
      return actualComparable === constraint.value
        ? { status: "MATCH", reason: "Action preserves the required boolean constraint" }
        : { status: "MISMATCH", reason: "Action contradicts the required boolean constraint" };
    }
    if (expectedComparable === undefined || actualComparable === undefined) {
      return {
        status: "UNKNOWN",
        reason: "Action value could not be compared deterministically",
      };
    }
    return actualComparable === expectedComparable
      ? { status: "MATCH", reason: "Action preserves the required constraint" }
      : { status: "MISMATCH", reason: "Action contradicts the required constraint" };
  }
  if (expectedComparable === undefined || actualComparable === undefined) {
    return {
      status: "UNKNOWN",
      reason: "Action value could not be compared deterministically",
    };
  }
  switch (constraint.operator) {
    case ConstraintOperator.EQ:
      return actualComparable === expectedComparable
        ? { status: "MATCH", reason: "Action preserves the exact constraint value" }
        : { status: "MISMATCH", reason: "Action changes an exact user constraint" };
    case ConstraintOperator.NEQ:
      return actualComparable !== expectedComparable
        ? { status: "MATCH", reason: "Action preserves the inequality constraint" }
        : { status: "MISMATCH", reason: "Action violates the inequality constraint" };
    case ConstraintOperator.LT:
      return actualComparable < expectedComparable
        ? { status: "MATCH", reason: "Action stays below the required bound" }
        : { status: "MISMATCH", reason: "Action exceeds the strict upper bound" };
    case ConstraintOperator.LTE:
      return actualComparable <= expectedComparable
        ? { status: "MATCH", reason: "Action stays within the required bound" }
        : { status: "MISMATCH", reason: "Action exceeds the allowed bound" };
    case ConstraintOperator.GT:
      return actualComparable > expectedComparable
        ? { status: "MATCH", reason: "Action stays above the required bound" }
        : { status: "MISMATCH", reason: "Action falls below the strict lower bound" };
    case ConstraintOperator.GTE:
      return actualComparable >= expectedComparable
        ? { status: "MATCH", reason: "Action stays within the required lower bound" }
        : { status: "MISMATCH", reason: "Action falls below the allowed lower bound" };
    case ConstraintOperator.IN:
      if (!Array.isArray(constraint.value)) {
        return {
          status: "UNKNOWN",
          reason: "Constraint IN value is not comparable",
        };
      }
      return constraint.value
        .map(comparableScalar)
        .some((value) => value === actualComparable)
        ? { status: "MATCH", reason: "Action stays within the allowed set" }
        : { status: "MISMATCH", reason: "Action falls outside the allowed set" };
    case ConstraintOperator.NOT_IN:
      if (!Array.isArray(constraint.value)) {
        return {
          status: "UNKNOWN",
          reason: "Constraint NOT_IN value is not comparable",
        };
      }
      return constraint.value
        .map(comparableScalar)
        .every((value) => value !== actualComparable)
        ? { status: "MATCH", reason: "Action stays outside the forbidden set" }
        : { status: "MISMATCH", reason: "Action enters a forbidden set" };
    default:
      return {
        status: "UNKNOWN",
        reason: `Unsupported deterministic operator '${constraint.operator}' for action fidelity`,
      };
  }
}

export function evaluateActionChecks(
  state: IntentState,
  planning: DomainPlanningDescriptor,
  checks: readonly ActionFidelityCheck[],
): ActionFidelityEvaluation {
  const rows: ActionFidelityRow[] = [];
  const resolvedConstraintIds = new Set<string>();
  for (const check of checks) {
    const canonicalConcept = check.canonicalConcept.trim().toLowerCase();
    const expectedFactKey = check.factType?.trim()
      ? `${canonicalConcept}.${check.factType.trim().toLowerCase()}`
      : undefined;
    const matchingConstraints = state.constraints.filter((constraint) => {
      if (expectedFactKey) {
        const fact = resolveCanonicalSemanticFact(
          constraint.concept,
          planning.conceptFamilies,
          { value: constraint.value },
        );
        return fact?.factKey === expectedFactKey;
      }
      const resolved = resolveCanonicalConcept(
        constraint.concept,
        planning.conceptFamilies,
      );
      return resolved === canonicalConcept;
    });
    for (const constraint of matchingConstraints) {
      resolvedConstraintIds.add(constraint.id);
      const factKey = expectedFactKey ?? resolveCanonicalSemanticFact(
        constraint.concept,
        planning.conceptFamilies,
        { value: constraint.value },
      )?.factKey;
      const status = constraintStatus(constraint, check.actualValue, factKey);
      rows.push({
        constraintId: constraint.id,
        canonicalConcept,
        field: check.field,
        expectedValue: constraint.value,
        actualValue: check.actualValue,
        status: status.status,
        reason: status.reason,
      });
    }
    // A compiled state legitimately omits many canonical concepts a domain
    // pack's check list enumerates (not every intent asserts every possible
    // dimension) — that alone is not suspicious and must not fail closed.
  }
  // Fail-closed, not silent: separately from per-check coverage above, any
  // compiled constraint that resolves to NO canonical concept in this
  // domain's ontology at all — not merely "this one check had no hit" — is
  // the actual silent-drop danger (a real, execution-relevant requirement
  // that vanished from fidelity evaluation because its concept string never
  // matched anything). state.constraints never contains PREFERENCE-kind
  // items (those live in CandidateInterpretation.preferences and are never
  // copied onto IntentState.constraints — see finalizeVerifiedCompilation),
  // so nothing here needs excluding by kind. The comparator in
  // constraintStatus() above is unchanged either way.
  for (const constraint of state.constraints) {
    if (resolvedConstraintIds.has(constraint.id)) continue;
    if (resolveCanonicalConcept(constraint.concept, planning.conceptFamilies) !== undefined) continue;
    rows.push({
      constraintId: constraint.id,
      canonicalConcept: constraint.concept,
      field: "(unresolved)",
      expectedValue: constraint.value,
      actualValue: undefined,
      status: "UNKNOWN",
      reason: "Constraint concept does not resolve to any canonical concept in this domain's ontology",
    });
  }
  return {
    rows,
    preservesIntent: rows.every((row) => row.status === "MATCH"),
  };
}

export function actionField<T>(
  action: ActionProposal,
  key: string,
): T | undefined {
  const parameters = action.parameters as Record<string, unknown>;
  return parameters[key] as T | undefined;
}
