import {
  CommitmentLevel,
  ConstraintCoverageStatus,
  ErrorCode,
  STICKY_CONSTRAINT_KINDS,
  type Intent,
  type IntentState,
  type PlanGraph,
  type PlanVerificationFinding,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { hashCanonical } from "@truemandate/crypto";
import {
  assertCommitmentAllowedForPlan,
  deriveRequiredProofObligations,
  executionCriticalRuleForConcept,
  type ConceptFamily,
  type ExecutionCriticalConceptRule,
} from "@truemandate/semantic-readiness";

export function deterministicPlanFindings(
  intent: Intent,
  intentState: IntentState,
  plan: PlanGraph,
  verification: SemanticVerificationResult,
  planningContext?: {
    readonly executionCapability: string;
    readonly conceptFamilies: readonly ConceptFamily[];
    readonly executionCriticalConceptRules: readonly ExecutionCriticalConceptRule[];
  },
): PlanVerificationFinding[] {
  const findings: PlanVerificationFinding[] = [];

  if (
    plan.intentId !== intent.id ||
    plan.intentStateId !== intentState.id ||
    plan.semanticVerificationId !== verification.id ||
    plan.semanticVerificationHash !== hashCanonical(verification) ||
    plan.readinessAtPlan !== verification.readiness ||
    plan.ambiguityClassAtPlan !== verification.ambiguityClass
  ) {
    findings.push({
      code: ErrorCode.PLAN_STALE,
      severity: "CRITICAL",
      message: "Plan semantic snapshot does not match the authoritative IntentState verification",
      confidence: 1,
      sourceRefs: [plan.id, intentState.id, verification.id],
    });
  }

  const coveredIds = new Set(
    plan.coverage
      .filter((c) => c.status !== ConstraintCoverageStatus.MISSING)
      .map((c) => c.constraintId),
  );
  const stepConstraintIds = new Set(
    plan.steps.flatMap((s) => [
      ...s.requiredConstraintIds,
      ...s.applicableConstraintIds,
      ...s.inheritedConstraintIds,
    ]),
  );
  const irrelevant = new Set(plan.steps.flatMap((s) => s.irrelevantConstraintIds));

  const hasEconomic = plan.steps.some(
    (s) =>
      s.commitmentLevel === CommitmentLevel.ECONOMIC ||
      s.commitmentLevel === CommitmentLevel.HIGH_CONSEQUENCE ||
      s.privileged,
  );

  for (const c of intentState.constraints) {
    const sticky = STICKY_CONSTRAINT_KINDS.has(c.kind);
    const financial =
      c.kind === "FINANCIAL" ||
      c.concept.includes("budget") ||
      c.concept.includes("food_grade") ||
      c.concept.includes("approved_supplier");

    if (sticky || (hasEconomic && financial)) {
      if (
        !coveredIds.has(c.id) &&
        !stepConstraintIds.has(c.id) &&
        !irrelevant.has(c.id)
      ) {
        findings.push({
          code: ErrorCode.CONSTRAINT_DROPPED,
          severity: "CRITICAL",
          message: `Constraint '${c.concept}' disappeared from plan`,
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
      const coverage = plan.coverage.find((x) => x.constraintId === c.id);
      if (coverage?.status === ConstraintCoverageStatus.MISSING) {
        findings.push({
          code: ErrorCode.PLAN_COVERAGE_GAP,
          severity: "CRITICAL",
          message: `Coverage MISSING for '${c.concept}'`,
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
      // Economic plans cannot leave sticky/financial constraints as DEFERRED or pretend IRRELEVANT
      if (
        hasEconomic &&
        coverage &&
        (coverage.status === ConstraintCoverageStatus.DEFERRED ||
          coverage.status === ConstraintCoverageStatus.IRRELEVANT)
      ) {
        findings.push({
          code: ErrorCode.PLAN_COVERAGE_GAP,
          severity: "CRITICAL",
          message: `Economic plan leaves '${c.concept}' as ${coverage.status}; must be enforced/verified`,
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
    }

    // industrial_grade drift
    if (/food_grade|food[\s-]?grade/i.test(c.concept) || /food[\s-]?grade/i.test(intent.rawText)) {
      const industrial = plan.steps.some(
        (s) =>
          /industrial/i.test(s.objective) ||
          s.expectedOutput.toLowerCase().includes("industrial"),
      );
      if (industrial) {
        findings.push({
          code: ErrorCode.SEMANTIC_WEAKENING,
          severity: "CRITICAL",
          message: "food_grade weakened to industrial_grade in plan",
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
    }

    if (c.concept.includes("budget") || c.kind === "FINANCIAL") {
      const approx = plan.steps.some(
        (s) => /around|approximately/i.test(s.objective) || /around|approximately/i.test(s.expectedOutput),
      );
      if (approx && /under|below|at most/i.test(intent.rawText)) {
        findings.push({
          code: ErrorCode.SEMANTIC_WEAKENING,
          severity: "CRITICAL",
          message: "under budget became around/approximately in plan",
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
    }
  }

  // Approval / budget / food_grade verification steps for economic plans
  if (hasEconomic || verification.readiness !== "PLANNABLE") {
    const concepts = intentState.constraints.map((c) => c.concept);
    if (concepts.some((x) => x.includes("approved_supplier"))) {
      const hasApproval = plan.steps.some(
        (s) =>
          /approv/i.test(s.objective) ||
          /approv/i.test(s.expectedOutput) ||
          s.applicableConstraintIds.some((id) =>
            intentState.constraints.some(
              (c) => c.id === id && c.concept.includes("approved"),
            ),
          ),
      );
      if (!hasApproval) {
        findings.push({
          code: ErrorCode.PLAN_COVERAGE_GAP,
          severity: "CRITICAL",
          message: "supplier approval verification missing from plan",
          confidence: 1,
          sourceRefs: ["approved_supplier"],
        });
      }
    }
    if (concepts.some((x) => x.includes("budget") || x.includes("food_grade"))) {
      for (const needed of ["budget", "food_grade"] as const) {
        if (!concepts.some((x) => x.includes(needed))) continue;
        const has = plan.steps.some(
          (s) =>
            s.objective.toLowerCase().includes(needed.replace("_", " ")) ||
            s.objective.toLowerCase().includes(needed) ||
            s.applicableConstraintIds.some((id) =>
              intentState.constraints.some((c) => c.id === id && c.concept.includes(needed)),
            ),
        );
        if (!has && needed === "budget") {
          findings.push({
            code: ErrorCode.PLAN_COVERAGE_GAP,
            severity: "CRITICAL",
            message: "budget verification missing from plan",
            confidence: 1,
            sourceRefs: ["budget"],
          });
        }
        if (!has && needed === "food_grade") {
          findings.push({
            code: ErrorCode.CONSTRAINT_DROPPED,
            severity: "CRITICAL",
            message: "food_grade omitted from plan steps",
            confidence: 1,
            sourceRefs: ["food_grade"],
          });
        }
      }
    }
  }

  // Proof obligations for hard constraints affecting economic steps are
  // derived deterministically from the authoritative IntentState. The planner
  // cannot create or destroy their existence; it may only bind how the plan
  // satisfies each required obligation.
  if (hasEconomic) {
    const requiredObligations = deriveRequiredProofObligations(intentState.constraints, {
      temporalAuthority: intentState.temporalAuthority,
      conceptContract: planningContext,
    });
    for (const obligation of requiredObligations) {
      const c = intentState.constraints.find((x) => x.id === obligation.constraintId);
      if (!c) continue;
      // The plan must carry the derived obligation with its canonical fields
      // preserved; only planStepId (the satisfaction binding) may be added.
      // Renaming, downgrading, or re-inventing required obligation fields is
      // treated as omission.
      const planMatch = plan.proofObligations.find(
        (p) =>
          p.constraintId === obligation.constraintId &&
          p.verificationStep === obligation.verificationStep &&
          p.requiredEvidence === obligation.requiredEvidence &&
          p.enforcingService === obligation.enforcingService &&
          JSON.stringify(p.evidenceKinds ?? null) === JSON.stringify(obligation.evidenceKinds ?? null),
      );
      if (!planMatch && !irrelevant.has(c.id)) {
        findings.push({
          code: ErrorCode.PROOF_OBLIGATION_MISSING,
          severity: "CRITICAL",
          message: `No proof obligation for hard constraint '${c.concept}'`,
          confidence: 1,
          sourceRefs: [c.id],
        });
        continue;
      }

      // Deterministic satisfaction binding: quantity equality constraints must
      // be bound to their authoritative value and must not be re-bound to a
      // conflicting quantity anywhere in the plan.
      const numericValue = Number(c.value);
      if (
        c.operator === "EQ" &&
        Number.isFinite(numericValue) &&
        /quantity|qty|units?|count/.test(c.concept)
      ) {
        const quantityPattern = /(?:quantity|qty|units?|count)\s*(?:of|=|:)?\s*([0-9]+)/i;
        const texts = [
          ...plan.steps.map((s) => `${s.objective} ${s.expectedOutput}`),
          ...plan.operationalizations.map((o) => o.derivedRepresentation),
        ];
        const conflicting = texts
          .map((t) => quantityPattern.exec(t))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => Number(m[1]))
          .filter((n) => n !== numericValue);
        const bound = plan.steps.some(
          (s) =>
            s.applicableConstraintIds.includes(c.id) ||
            s.requiredConstraintIds.includes(c.id),
        ) || plan.operationalizations.some((o) => o.sourceConstraintId === c.id);
        if (conflicting.length > 0) {
          findings.push({
            code: ErrorCode.SEMANTIC_WEAKENING,
            severity: "CRITICAL",
            message: `Plan binds conflicting quantity ${[...new Set(conflicting)].join(", ")} for hard constraint '${c.concept}' requiring ${numericValue}`,
            confidence: 1,
            sourceRefs: [c.id],
          });
        }
        if (!bound) {
          findings.push({
            code: ErrorCode.PLAN_COVERAGE_GAP,
            severity: "CRITICAL",
            message: `Hard constraint '${c.concept}' has a proof obligation but no step/operationalization binding`,
            confidence: 1,
            sourceRefs: [c.id],
          });
        }
      }

      // Supplier/counterparty approval constraints must be bound to an
      // approval-verification step in the plan.
      if (/supplier|approved|vendor|merchant|counterparty/.test(c.concept)) {
        const hasApprovalBinding = plan.steps.some(
          (s) =>
            /approv/i.test(s.objective) ||
            /approv/i.test(s.expectedOutput) ||
            s.applicableConstraintIds.includes(c.id) ||
            s.requiredConstraintIds.includes(c.id),
        );
      if (!hasApprovalBinding) {
        findings.push({
          code: ErrorCode.PLAN_COVERAGE_GAP,
          severity: "CRITICAL",
          message: `Approved-supplier constraint '${c.concept}' has no approval verification binding`,
          confidence: 1,
          sourceRefs: [c.id],
        });
      }
    }

      if (
        c.kind === "TEMPORAL" &&
        planningContext !== undefined &&
        executionCriticalRuleForConcept(c.concept, planningContext) !== undefined
      ) {
        const hasTemporalBinding = plan.steps.some(
          (s) =>
            s.applicableConstraintIds.includes(c.id) ||
            s.requiredConstraintIds.includes(c.id),
        );
        if (!hasTemporalBinding) {
          findings.push({
            code: ErrorCode.PLAN_COVERAGE_GAP,
            severity: "CRITICAL",
            message: `Execution-critical temporal constraint '${c.concept}' has no execution binding`,
            confidence: 1,
            sourceRefs: [c.id],
          });
        }
      }
    }
  }

  for (const step of plan.steps) {
    const commitment = assertCommitmentAllowedForPlan(
      { intentStateId: plan.intentStateId, verification },
      step.commitmentLevel,
    );
    if (!commitment.ok) {
      findings.push({
        code: ErrorCode.INAPPROPRIATE_COMMITMENT,
        severity: "CRITICAL",
        message: commitment.message,
        confidence: 1,
        sourceRefs: [step.id],
      });
    }
  }

  return findings;
}
