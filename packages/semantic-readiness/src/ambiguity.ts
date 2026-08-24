import {
  AmbiguityClass,
  IntentReadiness,
  type AmbiguityRecord,
  type Constraint,
  type EvidenceEnvelope,
} from "@truemandate/protocol";

export interface AmbiguityProofRow {
  readonly constraintId?: string;
  readonly obligationId: string;
  readonly evidenceId?: string;
  readonly evidenceTrustClass?: EvidenceEnvelope["trustClass"];
  readonly status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
}

export interface AmbiguityResolutionRow {
  readonly ambiguityId: string;
  readonly originalClass: AmbiguityClass;
  readonly relatedConcepts: readonly string[];
  readonly matchedConstraintIds: readonly string[];
  readonly matchedObligationIds: readonly string[];
  readonly resolved: boolean;
  readonly reason: string;
}

export interface AmbiguityReconciliation {
  readonly ambiguityClass: AmbiguityClass;
  readonly resolvedAmbiguityIds: readonly string[];
  readonly unresolvedAmbiguityIds: readonly string[];
  readonly rows: readonly AmbiguityResolutionRow[];
}

const AMBIGUITY_RANK: Readonly<Record<AmbiguityClass, number>> = {
  [AmbiguityClass.A0]: 0,
  [AmbiguityClass.A1]: 1,
  [AmbiguityClass.A2]: 2,
  [AmbiguityClass.A3]: 3,
  [AmbiguityClass.A4]: 4,
};

const BLOCKING_AMBIGUITY = new Set<AmbiguityClass>([
  AmbiguityClass.A2,
  AmbiguityClass.A3,
  AmbiguityClass.A4,
]);

function normalizeConcept(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function conceptsRelated(left: string, right: string): boolean {
  const normalizedLeft = normalizeConcept(left);
  const normalizedRight = normalizeConcept(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function highestAmbiguityClass(
  ambiguities: readonly AmbiguityRecord[],
): AmbiguityClass {
  return ambiguities.reduce<AmbiguityClass>(
    (highest, ambiguity) =>
      AMBIGUITY_RANK[ambiguity.ambiguityClass] > AMBIGUITY_RANK[highest]
        ? ambiguity.ambiguityClass
        : highest,
    AmbiguityClass.A0,
  );
}

/**
 * Reconciles structured compiler ambiguities against verified deterministic
 * proof rows. External evidence may resolve bounded A1/A2 uncertainty, but it
 * cannot reinterpret A3/A4 ambiguity or clarify unrelated human meaning.
 */
export function reconcileAmbiguitiesWithProofs(input: {
  readonly ambiguities: readonly AmbiguityRecord[];
  readonly requiredConstraints: readonly Constraint[];
  readonly proofRows: readonly AmbiguityProofRow[];
}): AmbiguityReconciliation {
  const rows = input.ambiguities.map<AmbiguityResolutionRow>((ambiguity) => {
    const matchedConstraints = input.requiredConstraints.filter((constraint) =>
      ambiguity.relatedConcepts.some((concept) =>
        conceptsRelated(concept, constraint.concept),
      ),
    );
    const matchedProofs = matchedConstraints.flatMap((constraint) =>
      input.proofRows.filter((row) => row.constraintId === constraint.id),
    );

    if (
      ambiguity.ambiguityClass === AmbiguityClass.A3 ||
      ambiguity.ambiguityClass === AmbiguityClass.A4
    ) {
      return {
        ambiguityId: ambiguity.id,
        originalClass: ambiguity.ambiguityClass,
        relatedConcepts: ambiguity.relatedConcepts,
        matchedConstraintIds: matchedConstraints.map((item) => item.id).sort(),
        matchedObligationIds: matchedProofs.map((item) => item.obligationId).sort(),
        resolved: false,
        reason: `${ambiguity.ambiguityClass} ambiguity requires semantic re-verification or human correction`,
      };
    }

    if (matchedConstraints.length === 0) {
      return {
        ambiguityId: ambiguity.id,
        originalClass: ambiguity.ambiguityClass,
        relatedConcepts: ambiguity.relatedConcepts,
        matchedConstraintIds: [],
        matchedObligationIds: [],
        resolved: false,
        reason: "Ambiguity does not map to an authoritative required constraint",
      };
    }

    const resolved = matchedConstraints.every((constraint) => {
      const proof = input.proofRows.find((row) => row.constraintId === constraint.id);
      return (
        proof?.status === "SATISFIED" &&
        typeof proof.evidenceId === "string" &&
        proof.evidenceTrustClass !== undefined &&
        proof.evidenceTrustClass !== "UNTRUSTED_EXTERNAL"
      );
    });

    return {
      ambiguityId: ambiguity.id,
      originalClass: ambiguity.ambiguityClass,
      relatedConcepts: ambiguity.relatedConcepts,
      matchedConstraintIds: matchedConstraints.map((item) => item.id).sort(),
      matchedObligationIds: matchedProofs.map((item) => item.obligationId).sort(),
      resolved,
      reason: resolved
        ? "All related authoritative constraints have verified satisfied proofs"
        : "Related authoritative constraints are not fully proven by verified evidence",
    };
  });
  const unresolved = input.ambiguities.filter(
    (ambiguity) => !rows.find((row) => row.ambiguityId === ambiguity.id)?.resolved,
  );

  return {
    ambiguityClass: highestAmbiguityClass(unresolved),
    resolvedAmbiguityIds: rows.filter((row) => row.resolved).map((row) => row.ambiguityId),
    unresolvedAmbiguityIds: rows.filter((row) => !row.resolved).map((row) => row.ambiguityId),
    rows,
  };
}

export function isPrivilegedSemanticStateConsistent(input: {
  readonly readiness: IntentReadiness;
  readonly ambiguityClass: AmbiguityClass;
}): boolean {
  const privileged =
    input.readiness === IntentReadiness.ACTIONABLE ||
    input.readiness === IntentReadiness.EXECUTABLE;
  return !privileged || !BLOCKING_AMBIGUITY.has(input.ambiguityClass);
}
