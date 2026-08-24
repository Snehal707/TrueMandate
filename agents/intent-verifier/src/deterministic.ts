import {
  AmbiguityClass,
  FindingSeverity,
  IntentReadiness,
  TransformationClass,
  type CandidateInterpretation,
  type Intent,
  type VerificationFinding,
} from "@truemandate/protocol";
import {
  candidatePreservesNegation,
  detectNegationMarkers,
  normalizeCurrencyAmount,
} from "@truemandate/semantic-grounding";

/**
 * Deterministic cross-checks that do not rely on the model.
 */
export function deterministicFindings(
  intent: Intent,
  candidate: CandidateInterpretation,
): VerificationFinding[] {
  const findings: VerificationFinding[] = [];

  const neg = candidatePreservesNegation(intent.rawText, [
    ...candidate.constraints,
    ...candidate.preferences,
  ]);
  if (!neg.ok) {
    findings.push({
      code: "NEGATION_LOSS",
      severity: FindingSeverity.CRITICAL,
      message: neg.message,
      confidence: 1,
      sourceRefs: detectNegationMarkers(intent.rawText),
      transformation: {
        fromConcept: "negation",
        toConcept: "missing_negation",
        class: TransformationClass.DROPPED,
        severity: FindingSeverity.CRITICAL,
        evidenceSpans: [],
        message: neg.message,
      },
    });
  }

  const budgetRaw = normalizeCurrencyAmount(intent.rawText);
  if (budgetRaw.ok && budgetRaw.value.comparison === "UNDER") {
    const budgetConstraint = candidate.constraints.find(
      (c) =>
        c.concept.includes("budget") ||
        c.concept.includes("cost") ||
        c.concept.includes("price") ||
        c.concept.includes("max_amount"),
    );
    if (budgetConstraint) {
      const val = Number(budgetConstraint.value);
      if (
        Number.isFinite(val) &&
        val > budgetRaw.value.amount
      ) {
        findings.push({
          code: "BUDGET_WEAKENED",
          severity: FindingSeverity.CRITICAL,
          message: "Hard budget constraint was weakened",
          confidence: 1,
          sourceRefs: [budgetConstraint.grounding.sourceText],
          transformation: {
            fromConcept: `budget<=${budgetRaw.value.amount}`,
            toConcept: `budget=${val}`,
            class: TransformationClass.WEAKENED,
            severity: FindingSeverity.CRITICAL,
            evidenceSpans: [],
          },
        });
      }
    }
  }

  // near → inside strengthening heuristic
  if (/\bnear\b/i.test(intent.rawText)) {
    const inside = candidate.constraints.some(
      (c) =>
        /inside|within\s+the\s+airport/i.test(String(c.value)) ||
        /inside_airport|in_airport/.test(c.concept),
    );
    if (inside) {
      findings.push({
        code: "LOCATION_STRENGTHENED",
        severity: FindingSeverity.HIGH,
        message: "near the airport silently became inside the airport",
        confidence: 0.95,
        sourceRefs: ["near"],
        transformation: {
          fromConcept: "near_airport",
          toConcept: "inside_airport",
          class: TransformationClass.STRENGTHENED,
          severity: FindingSeverity.HIGH,
          evidenceSpans: [],
        },
      });
    }
  }

  // food_grade → industrial_grade (concept/value drift even if grounding quote preserved)
  if (/food[\s-]?grade/i.test(intent.rawText)) {
    const industrial = candidate.constraints.some(
      (c) =>
        /industrial/.test(c.concept) || /industrial/.test(String(c.value)),
    );
    const foodConcept = candidate.constraints.some((c) =>
      /food_grade|food[\s-]?grade/i.test(c.concept),
    );
    if (industrial && !foodConcept) {
      findings.push({
        code: "FOOD_GRADE_WEAKENED",
        severity: FindingSeverity.CRITICAL,
        message: "food grade weakened or replaced by industrial grade",
        confidence: 1,
        sourceRefs: ["food grade"],
        transformation: {
          fromConcept: "food_grade",
          toConcept: "industrial_grade",
          class: TransformationClass.WEAKENED,
          severity: FindingSeverity.CRITICAL,
          evidenceSpans: [],
        },
      });
    }
  }

  // arrive before Friday ≠ ship before Friday
  if (/\barrive\b/i.test(intent.rawText) && /\bbefore\b/i.test(intent.rawText)) {
    const ship = candidate.constraints.some(
      (c) => /ship/.test(c.concept) || /ship/.test(String(c.value)),
    );
    const arrive = candidate.constraints.some(
      (c) => /arrive|arrival/.test(c.concept),
    );
    if (ship && !arrive) {
      findings.push({
        code: "TEMPORAL_REINTERPRETED",
        severity: FindingSeverity.HIGH,
        message: "arrive before Friday must not become ship before Friday",
        confidence: 0.9,
        sourceRefs: ["arrive before"],
        transformation: {
          fromConcept: "arrive_before",
          toConcept: "ship_before",
          class: TransformationClass.REINTERPRETED,
          severity: FindingSeverity.HIGH,
          evidenceSpans: [],
        },
      });
    }
  }

  return findings;
}

const VENDOR_CONCEPT = /supplier|vendor|merchant/;
/** Exact ambiguity source span for the "approved supplier/vendor" phrase only. */
const EXACT_APPROVED_SUPPLIER_SOURCE = /^approved\s+(supplier|vendor)$/i;

function hasExplicitNamedVendor(candidate: CandidateInterpretation): boolean {
  return candidate.constraints.some((c) => {
    if (c.sourceType !== "HUMAN" || c.meaningClass !== "EXPLICIT") return false;
    if (c.grounding.quoteExact !== true) return false;
    if (typeof c.value !== "string" || c.value.trim().length === 0) return false;
    return VENDOR_CONCEPT.test(c.concept);
  });
}

function isExactApprovedSupplierSourceAmbiguity(ambiguity: {
  readonly sourceText?: string;
}): boolean {
  const source = (ambiguity.sourceText ?? "").trim();
  return EXACT_APPROVED_SUPPLIER_SOURCE.test(source);
}

/**
 * When an EXPLICIT named vendor/supplier is already constrained, Gemini often
 * invents A2/A3 ambiguities whose sourceText is exactly "approved supplier"
 * (or "approved vendor"). Cap those to A1 for merge/readiness only — approval
 * status remains enforced by Guardian + supplier_approved evidence.
 * A4 is never normalized. Description/concept keyword matching is not used.
 */
export function normalizeApprovalSourceAmbiguities(
  candidate: CandidateInterpretation,
): CandidateInterpretation {
  if (!hasExplicitNamedVendor(candidate) || candidate.ambiguities.length === 0) {
    return candidate;
  }
  let changed = false;
  const ambiguities = candidate.ambiguities.map((ambiguity) => {
    if (!isExactApprovedSupplierSourceAmbiguity(ambiguity)) return ambiguity;
    if (
      ambiguity.ambiguityClass !== AmbiguityClass.A2 &&
      ambiguity.ambiguityClass !== AmbiguityClass.A3
    ) {
      return ambiguity;
    }
    changed = true;
    return { ...ambiguity, ambiguityClass: AmbiguityClass.A1 };
  });
  return changed ? { ...candidate, ambiguities } : candidate;
}

export function mergeAmbiguityClass(
  candidate: CandidateInterpretation,
  findings: readonly VerificationFinding[],
): AmbiguityClass {
  if (candidate.ambiguities.some((a) => a.ambiguityClass === AmbiguityClass.A4)) {
    return AmbiguityClass.A4;
  }
  if (candidate.ambiguities.some((a) => a.ambiguityClass === AmbiguityClass.A3)) {
    return AmbiguityClass.A3;
  }
  if (
    findings.some((f) => f.severity === FindingSeverity.CRITICAL) ||
    candidate.ambiguities.some((a) => a.ambiguityClass === AmbiguityClass.A2)
  ) {
    return candidate.ambiguities[0]?.ambiguityClass ?? AmbiguityClass.A2;
  }
  if (candidate.ambiguities.length > 0) {
    return candidate.ambiguities[0]!.ambiguityClass;
  }
  return AmbiguityClass.A0;
}

/**
 * Deterministic authorization-readiness policy. The model may propose a
 * readiness tier and ambiguity labels, but the tier consumed by privileged
 * planning/commitment/Authority gates is derived here from the authoritative
 * verified state — the model can neither promote itself into privileged
 * readiness by claiming EXECUTABLE, nor demote a fully specified executable
 * purchase by emitting an evidence-free PLANNABLE/A1 label.
 *
 * Genuine structured ambiguity (candidate ambiguity entries of class A2+,
 * bound to related concepts) still reduces readiness fail-closed.
 */
export function readinessAfterVerification(
  intent: Intent,
  candidate: CandidateInterpretation,
  criticalFailure: boolean,
  ambiguityClass: AmbiguityClass,
): IntentReadiness {
  if (criticalFailure) {
    return IntentReadiness.SEARCHABLE;
  }
  if (
    ambiguityClass === AmbiguityClass.A3 ||
    ambiguityClass === AmbiguityClass.A4
  ) {
    return IntentReadiness.SEARCHABLE;
  }
  if (ambiguityClass === AmbiguityClass.A2) {
    return IntentReadiness.PLANNABLE;
  }

  // Deterministic privileged-planning conditions for purchase intents.
  // Nothing here fabricates supplier/price/quantity/deadline/evidence — the
  // policy only verifies the authoritative candidate already carries them.
  const purchaseIntent = /buy|purchase|procure|order|acquire|book|pay\b/i.test(intent.rawText);
  const constraints = candidate.constraints;
  const hasEconomic = constraints.some(
    (c) => c.kind === "FINANCIAL" || /budget|cost|amount|price/.test(c.concept),
  );
  const hasQuantity = constraints.some(
    (c) => /quantity|qty|units?|count/.test(c.concept) && Number.isFinite(Number(c.value)),
  );
  const hasItem = constraints.some((c) => /item|product|spec|material|grade/.test(c.concept));
  const hasSupplier = constraints.some((c) => /supplier|vendor|merchant|counterparty/.test(c.concept));
  const hasTemporalLanguage = /\b(before|by|prior to|deadline|due)\b/i.test(intent.rawText);
  const hasGroundedTemporal = constraints.some(
    (c) =>
      c.kind === "TEMPORAL" &&
      c.sourceType === "HUMAN" &&
      c.meaningClass === "EXPLICIT" &&
      c.grounding.quoteExact === true &&
      c.temporalResolution !== undefined &&
      Number.isFinite(Date.parse(c.temporalResolution.resolvedValue)),
  );

  if (
    purchaseIntent &&
    hasEconomic &&
    hasQuantity &&
    hasItem &&
    hasSupplier &&
    (!hasTemporalLanguage || hasGroundedTemporal)
  ) {
    return IntentReadiness.ACTIONABLE;
  }

  // Domain-neutral planning floor. This does not grant privileged readiness:
  // it only prevents model tier variance from demoting the same grounded facts
  // below PLANNABLE. Financial and temporal language must have corresponding
  // structured constraints, otherwise the state remains fail-closed.
  const hasGroundedExplicitConstraints =
    constraints.length > 0 &&
    constraints.every(
      (c) =>
        c.sourceType === "HUMAN" &&
        c.meaningClass === "EXPLICIT" &&
        c.grounding.quoteExact === true &&
        c.grounding.sourceText.trim().length > 0,
    );
  const hasFinancialLanguage =
    normalizeCurrencyAmount(intent.rawText).ok ||
    /\b(budget|cost|price|amount|under|less than|up to)\b/i.test(intent.rawText);
  const hasGroundedFinancial = constraints.some(
    (c) => c.kind === "FINANCIAL" && Number.isFinite(Number(c.value)),
  );
  const planningComplete =
    hasGroundedExplicitConstraints &&
    (!hasFinancialLanguage || hasGroundedFinancial) &&
    (!hasTemporalLanguage || hasGroundedTemporal);

  return planningComplete
    ? IntentReadiness.PLANNABLE
    : IntentReadiness.SEARCHABLE;
}
