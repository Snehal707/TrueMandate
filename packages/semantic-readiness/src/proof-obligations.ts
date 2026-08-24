import {
  ConstraintKind,
  type Constraint,
  type ProofObligation,
} from "@truemandate/protocol";
import {
  executionCriticalRuleForConcept,
  type ConceptContract,
} from "./concepts.js";

/**
 * Constraint kinds that deterministically require a proof obligation for
 * privileged (economic / high-consequence) plans. Mirrors the enforced
 * sticky+financial policy: SOFT / PREFERENCE / NEGATIVE_PREFERENCE /
 * METHOD_CONSTRAINT / TEMPORAL / LEARNED_PREFERENCE constraints never gain
 * equivalent hard authorization power through obligations.
 */
const OBLIGATION_KINDS: ReadonlySet<string> = new Set<ConstraintKind>([
  ConstraintKind.HARD,
  ConstraintKind.SAFETY_CRITICAL,
  ConstraintKind.LEGAL,
  ConstraintKind.ORGANIZATIONAL_POLICY,
  ConstraintKind.FINANCIAL,
]);

function evidenceForConstraint(constraint: Constraint): string {
  const concept = constraint.concept.toLowerCase();
  if (/quantity|qty|units|count/.test(concept)) return "quantity evidence";
  if (/supplier|approved|vendor|merchant|counterparty/.test(concept)) return "supplier approval evidence";
  if (/food[_-]?grade|material|grade|spec|item/.test(concept)) return "product specification evidence";
  if (/budget|cost|amount|price|fee|spend/.test(concept)) return "price evidence";
  if (/deadline|deliver|arrive|ship|time|date|temporal/.test(concept)) return "delivery deadline evidence";
  return `${constraint.concept} evidence`;
}

/**
 * A TEMPORAL constraint is a required obligation only when it is the
 * authoritative temporal execution authority source — i.e. the finalized
 * IntentState.temporalAuthority (derived solely from an explicit, quoted,
 * resolved human temporal constraint) references it. Informational or
 * monitoring-only temporal conditions never acquire obligation power.
 */
function isMandatoryTemporal(
  constraint: Constraint,
  temporalAuthority: { readonly source?: string; readonly sourceRef?: string } | undefined,
): boolean {
  return (
    constraint.kind === ConstraintKind.TEMPORAL &&
    temporalAuthority !== undefined &&
    temporalAuthority.source === "EXPLICIT_HUMAN" &&
    temporalAuthority.sourceRef === constraint.id
  );
}

export function constraintRequiresProofObligation(
  constraint: Constraint,
  options?: {
    readonly temporalAuthority?: { readonly source?: string; readonly sourceRef?: string };
    readonly conceptContract?: Pick<ConceptContract, "conceptFamilies" | "executionCriticalConceptRules">;
  },
): boolean {
  const executionRule = options?.conceptContract
    ? executionCriticalRuleForConcept(constraint.concept, options.conceptContract)
    : undefined;
  if (executionRule?.proofMechanism.kind === "DETERMINISTIC_RULE") return false;
  return (
    OBLIGATION_KINDS.has(constraint.kind) ||
    isMandatoryTemporal(constraint, options?.temporalAuthority) ||
    executionRule?.proofMechanism.kind === "EVIDENCE_OBLIGATION"
  );
}

/**
 * Derives the required proof obligations for privileged plans directly from
 * the authoritative IntentState. Obligation existence is deterministic and
 * cannot be omitted, renamed, downgraded, or deleted by any LLM output —
 * the planner may only bind how the plan satisfies each obligation. The
 * canonical identity of each obligation is `proofObligationId(obligation)`
 * over this exact object shape, so plans must carry byte-equivalent fields.
 */
export function deriveRequiredProofObligations(
  constraints: readonly Constraint[],
  options?: {
    readonly temporalAuthority?: { readonly source?: string; readonly sourceRef?: string };
    readonly conceptContract?: Pick<ConceptContract, "conceptFamilies" | "executionCriticalConceptRules">;
  },
): ProofObligation[] {
  const obligations: ProofObligation[] = [];
  for (const constraint of constraints) {
    if (constraintRequiresProofObligation(constraint, options)) {
      obligations.push({
        verificationStep: `verify-${constraint.concept}`,
        requiredEvidence: evidenceForConstraint(constraint),
        enforcingService: "Guardian",
        constraintId: constraint.id,
        evidenceKinds: [evidenceForConstraint(constraint)],
      });
    }
  }
  return obligations;
}

/** Constraint lookup helper for verifier-side satisfaction evaluation. */
export function requiredObligationForConstraint(
  obligations: readonly ProofObligation[],
  constraintId: string,
): ProofObligation | undefined {
  return obligations.find((o) => o.constraintId === constraintId);
}
