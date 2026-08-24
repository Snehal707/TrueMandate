import { hashCanonical } from "@truemandate/crypto";
import {
  AuthorityDecision,
  ConstraintApplicability,
  ErrorCode,
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  PROTOCOL_VERSION,
  STICKY_CONSTRAINT_KINDS,
  err,
  ok,
  type ActionProposal,
  type Constraint,
  type ConstraintClaim,
  type GuardianVerdict,
  type IntentState,
  type JudgeFinding,
  type JudgeResult,
  type PlanId,
  type Result,
} from "@truemandate/protocol";
import { hashActionProposal, hashEvidenceSnapshot } from "./binding.js";
import type { EvidenceClaim, EvidenceEnvelope } from "@truemandate/protocol";

export interface AggregateGuardianInput {
  readonly action: ActionProposal;
  readonly intentState: IntentState;
  readonly tipIntentStateId: string;
  readonly expectedActionHash?: string;
  readonly evidenceEnvelopes: readonly EvidenceEnvelope[];
  readonly evidenceClaims: readonly EvidenceClaim[];
  readonly judgeResults: readonly JudgeResult[];
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}

const REQUIRED_HIGH_CONSEQUENCE: ReadonlySet<JudgeId> = new Set([
  JudgeId.FIDELITY,
  JudgeId.CONTRADICTION,
  JudgeId.EVIDENCE,
]);

function isHighConsequence(action: ActionProposal): boolean {
  return (
    action.consequenceLevel === "HIGH" ||
    action.consequenceLevel === "IRREVERSIBLE" ||
    action.capability === "execute_payment" ||
    action.capability === "non_refundable_purchase"
  );
}

function classificationRank(c: GuardianConstraintClassification): number {
  switch (c) {
    case GuardianConstraintClassification.SUPPORTED:
      return 1;
    case GuardianConstraintClassification.PARTIALLY_SUPPORTED:
      return 0.7;
    case GuardianConstraintClassification.UNCERTAIN:
      return 0.4;
    case GuardianConstraintClassification.NOT_EVALUABLE:
      return 0.2;
    case GuardianConstraintClassification.CONTRADICTED:
      return 0;
    default:
      return 0.4;
  }
}

function mergeConstraintClaims(
  constraints: readonly Constraint[],
  judgeResults: readonly JudgeResult[],
): { claims: ConstraintClaim[]; evaluated: ReadonlySet<string> } {
  const byId = new Map<string, ConstraintClaim>();
  const touched = new Set<string>();

  for (const c of constraints) {
    byId.set(c.id, {
      constraintId: c.id,
      classification: GuardianConstraintClassification.NOT_EVALUABLE,
      applicability: ConstraintApplicability.APPLICABLE,
      confidence: 0,
      criticality: c.kind,
      judgeFindings: [],
    });
  }

  const rankWorse = (
    a: GuardianConstraintClassification,
    b: GuardianConstraintClassification,
  ): GuardianConstraintClassification =>
    classificationRank(a) <= classificationRank(b) ? a : b;

  const applyClassification = (
    constraintId: string,
    incoming: GuardianConstraintClassification,
    confidence: number,
    rationale?: string,
  ): void => {
    const claim = byId.get(constraintId);
    if (!claim) return;
    const next = touched.has(constraintId)
      ? rankWorse(claim.classification, incoming)
      : incoming;
    touched.add(constraintId);
    byId.set(constraintId, {
      ...claim,
      classification: next,
      confidence: Math.max(claim.confidence, confidence),
      rationale: rationale ?? claim.rationale,
    });
  };

  for (const jr of judgeResults) {
    if (jr.status !== JudgeInvocationStatus.OK) continue;
    for (const cc of jr.constraintClassifications ?? []) {
      applyClassification(
        cc.constraintId,
        cc.classification,
        cc.confidence,
        cc.rationale,
      );
    }
    for (const f of jr.findings) {
      for (const ref of f.sourceRefs) {
        const claim = byId.get(ref);
        if (!claim) continue;
        const findings = [...(claim.judgeFindings ?? []), f];
        byId.set(ref, { ...claim, judgeFindings: findings });

        if (
          f.code === ErrorCode.UNTRUSTED_INFLUENCE ||
          f.code.includes("CONTRADICT") ||
          f.code === "FOOD_GRADE_CONTRADICTED" ||
          f.code === "NEGATIVE_PREFERENCE_VIOLATED" ||
          f.code === "QUIET_CONTRADICTED"
        ) {
          applyClassification(
            ref,
            GuardianConstraintClassification.CONTRADICTED,
            f.confidence,
          );
        } else if (f.code === ErrorCode.UNSUPPORTED_ASSUMPTION) {
          applyClassification(
            ref,
            GuardianConstraintClassification.UNCERTAIN,
            f.confidence,
          );
        } else if (f.code === ErrorCode.EVIDENCE_INSUFFICIENT) {
          applyClassification(
            ref,
            GuardianConstraintClassification.NOT_EVALUABLE,
            f.confidence,
          );
        } else if (f.code === "SUPPORTED" || f.code === "CONSTRAINT_SUPPORTED") {
          applyClassification(
            ref,
            GuardianConstraintClassification.SUPPORTED,
            f.confidence,
          );
        } else if (
          f.code === "STRENGTHENED" ||
          f.code === "SEMANTIC_STRENGTHENING" ||
          f.code === "PARTIALLY_SUPPORTED"
        ) {
          applyClassification(
            ref,
            GuardianConstraintClassification.PARTIALLY_SUPPORTED,
            f.confidence,
          );
        }
      }
    }
  }

  // Soft preferences with no findings stay UNCERTAIN not critical
  for (const c of constraints) {
    const claim = byId.get(c.id)!;
    if (
      claim.judgeFindings?.length === 0 &&
      (c.kind === "SOFT" || c.kind === "PREFERENCE")
    ) {
      byId.set(c.id, {
        ...claim,
        classification: GuardianConstraintClassification.UNCERTAIN,
        applicability: ConstraintApplicability.APPLICABLE,
      });
    }
  }

  // Judges must never rewrite canonical constraint criticality from IntentState.
  for (const c of constraints) {
    const claim = byId.get(c.id)!;
    if (claim.criticality !== c.kind) {
      byId.set(c.id, { ...claim, criticality: c.kind });
    }
  }

  return { claims: [...byId.values()], evaluated: touched };
}

/** Fail closed if any claim criticality diverges from IntentState (defense in depth). */
export function assertCriticalityIntegrity(
  constraints: readonly Constraint[],
  claims: readonly ConstraintClaim[],
): Result<void> {
  const byId = new Map(constraints.map((c) => [c.id, c.kind]));
  for (const claim of claims) {
    const kind = byId.get(claim.constraintId);
    if (kind === undefined) continue;
    if (claim.criticality !== kind) {
      return err(
        ErrorCode.GUARDIAN_CRITICAL_FAILURE,
        "Judge output attempted to rewrite constraint criticality",
        {
          constraintId: claim.constraintId,
          expected: kind,
          actual: claim.criticality,
        },
      );
    }
  }
  return ok();
}

export function aggregateGuardianVerdict(
  input: AggregateGuardianInput,
): Result<GuardianVerdict> {
  if (input.intentState.id !== input.tipIntentStateId) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "IntentState tip mismatch; cannot approve semantically",
      {
        tip: input.tipIntentStateId,
        proposalState: input.intentState.id,
      },
    );
  }

  const actionContentHash = hashActionProposal(input.action);
  if (
    input.expectedActionHash !== undefined &&
    input.expectedActionHash !== actionContentHash
  ) {
    return err(
      ErrorCode.ACTION_PROPOSAL_MISMATCH,
      "ActionProposal content hash mismatch; prior verdict invalid",
      { expected: input.expectedActionHash, actual: actionContentHash },
    );
  }

  if (input.action.intentStateId !== input.intentState.id) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "ActionProposal bound to different IntentState",
    );
  }

  const high = isHighConsequence(input.action);
  const findings: JudgeFinding[] = input.judgeResults.flatMap((j) => j.findings);

  // Required judge failure for high consequence
  for (const jr of input.judgeResults) {
    if (
      high &&
      REQUIRED_HIGH_CONSEQUENCE.has(jr.judgeId) &&
      jr.status !== JudgeInvocationStatus.OK
    ) {
      return err(
        ErrorCode.GUARDIAN_JUDGE_UNAVAILABLE,
        `Required judge ${jr.judgeId} unavailable for high-consequence action`,
        { status: jr.status },
      );
    }
  }

  const { claims: constraintClaims, evaluated } = mergeConstraintClaims(
    input.intentState.constraints,
    input.judgeResults,
  );

  const criticalityCheck = assertCriticalityIntegrity(
    input.intentState.constraints,
    constraintClaims,
  );
  if (!criticalityCheck.ok) return criticalityCheck;

  const contradictions = findings
    .filter(
      (f) =>
        f.code.includes("CONTRADICT") ||
        f.severity === "CRITICAL" ||
        f.code === ErrorCode.UNTRUSTED_INFLUENCE,
    )
    .map((f) => f.message);

  let criticalFailure = false;
  let semanticStatus: GuardianSemanticStatus = GuardianSemanticStatus.CLEAR;
  let decision: AuthorityDecision = AuthorityDecision.ALLOW;
  let uncertainty = 0.1;

  // Deterministic critical: sticky contradicted, or judge-marked NOT_EVALUABLE
  for (const claim of constraintClaims) {
    const sticky = STICKY_CONSTRAINT_KINDS.has(claim.criticality);
    const hardFinancial =
      claim.criticality === "FINANCIAL" || claim.criticality === "HARD";
    if (!(sticky || hardFinancial)) continue;
    if (
      claim.classification === GuardianConstraintClassification.CONTRADICTED
    ) {
      criticalFailure = true;
      continue;
    }
    if (
      high &&
      claim.classification === GuardianConstraintClassification.NOT_EVALUABLE &&
      evaluated.has(claim.constraintId)
    ) {
      criticalFailure = true;
    }
  }

  if (findings.some((f) => f.code === ErrorCode.UNTRUSTED_INFLUENCE)) {
    criticalFailure = true;
  }

  if (
    findings.some(
      (f) =>
        f.code === ErrorCode.UNSUPPORTED_ASSUMPTION && f.severity === "CRITICAL",
    )
  ) {
    semanticStatus = GuardianSemanticStatus.CONFLICTED;
    decision = AuthorityDecision.REQUIRE_APPROVAL;
    uncertainty = Math.max(uncertainty, 0.6);
  }

  const devil = input.judgeResults.find((j) => j.judgeId === JudgeId.DEVILS_ADVOCATE);
  if (
    devil?.status === JudgeInvocationStatus.OK &&
    devil.findings.some((f) => f.severity === "CRITICAL" || f.severity === "HIGH")
  ) {
    if (!criticalFailure) {
      semanticStatus = GuardianSemanticStatus.CONFLICTED;
      decision = AuthorityDecision.REQUIRE_APPROVAL;
      uncertainty = Math.max(uncertainty, 0.55);
    }
  }

  // Soft preference misses do not force BLOCK
  const stickyOkOrPartial = constraintClaims.every(
    (c) =>
      !STICKY_CONSTRAINT_KINDS.has(c.criticality) ||
      c.classification === GuardianConstraintClassification.SUPPORTED ||
      c.classification === GuardianConstraintClassification.PARTIALLY_SUPPORTED,
  );
  const stickyPartial = constraintClaims.some(
    (c) =>
      STICKY_CONSTRAINT_KINDS.has(c.criticality) &&
      c.classification === GuardianConstraintClassification.PARTIALLY_SUPPORTED,
  );
  const stickyUncertain = constraintClaims.some(
    (c) =>
      STICKY_CONSTRAINT_KINDS.has(c.criticality) &&
      c.classification === GuardianConstraintClassification.UNCERTAIN,
  );

  const unevaluatedSticky = constraintClaims.some(
    (c) =>
      (STICKY_CONSTRAINT_KINDS.has(c.criticality) ||
        c.criticality === "FINANCIAL" ||
        c.criticality === "HARD") &&
      !evaluated.has(c.constraintId),
  );

  if (criticalFailure) {
    semanticStatus = GuardianSemanticStatus.CRITICAL_FAILURE;
    decision = AuthorityDecision.BLOCK;
    uncertainty = 1;
  } else if (semanticStatus === GuardianSemanticStatus.CLEAR) {
    if (stickyPartial || stickyUncertain) {
      semanticStatus = GuardianSemanticStatus.UNCERTAIN;
      decision = AuthorityDecision.ALLOW_WITH_MONITORING;
      uncertainty = Math.max(uncertainty, stickyPartial ? 0.45 : 0.35);
    } else if (high && unevaluatedSticky) {
      // Fail closed for CLEAR, but do not invent a critical contradiction
      semanticStatus = GuardianSemanticStatus.UNCERTAIN;
      decision = AuthorityDecision.REQUIRE_APPROVAL;
      uncertainty = Math.max(uncertainty, 0.5);
    } else if (!stickyOkOrPartial) {
      semanticStatus = GuardianSemanticStatus.UNCERTAIN;
      decision = AuthorityDecision.ALLOW_WITH_MONITORING;
      uncertainty = Math.max(uncertainty, 0.35);
    } else if (
      input.judgeResults.some((j) => j.status !== JudgeInvocationStatus.OK)
    ) {
      semanticStatus = GuardianSemanticStatus.UNCERTAIN;
      decision = AuthorityDecision.ALLOW_WITH_MONITORING;
      uncertainty = Math.max(uncertainty, 0.4);
    }
  }

  const scores = constraintClaims.map((c) => classificationRank(c.classification));
  const overallFidelity =
    scores.length === 0
      ? 1
      : scores.reduce((a, b) => a + b, 0) / scores.length;

  // Critical always wins even if fidelity high
  if (criticalFailure && overallFidelity > 0.9) {
    decision = AuthorityDecision.BLOCK;
  }

  const promptVersions: Record<string, string> = {};
  const schemaVersions: Record<string, string> = {};
  for (const jr of input.judgeResults) {
    if (jr.promptVersion) promptVersions[jr.judgeId] = jr.promptVersion;
    if (jr.schemaVersion) schemaVersions[jr.judgeId] = jr.schemaVersion;
  }

  const evidenceSnapshotHash = hashEvidenceSnapshot(
    input.evidenceEnvelopes,
    input.evidenceClaims,
  );

  const withoutHash = {
    id: `gv-${hashCanonical({ action: input.action.id, at: input.createdAt }).slice(0, 12)}`,
    actionId: input.action.id,
    intentId: input.action.intentId,
    intentStateId: input.intentState.id,
    intentStateHash: input.intentState.stateHash,
    planId: (input.planId ?? input.action.planId) as PlanId | undefined,
    planVersion: input.planVersion,
    actionContentHash,
    evidenceSnapshotHash,
    decision,
    semanticStatus,
    overallFidelity,
    constraintClaims,
    contradictions,
    uncertainty,
    criticalFailure,
    judgeResults: input.judgeResults,
    protocolVersion: PROTOCOL_VERSION,
    promptVersions,
    schemaVersions,
    stale: false,
    modelName: "guardian-orchestrator",
    promptVersion: "aggregate-v1",
    createdAt: input.createdAt,
  };

  const verdict: GuardianVerdict = {
    ...withoutHash,
    verdictHash: hashCanonical(withoutHash),
  };

  return ok(verdict);
}
