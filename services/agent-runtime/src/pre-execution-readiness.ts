import { hashCanonical, proofObligationId } from "@truemandate/crypto";
import {
  classifyRequiredProofCoverage,
  compareTermMonths,
  evaluateApprovalFactSatisfaction,
  evaluateForbidSatisfaction,
  deriveRequiredProofObligations,
  isApprovalFactConcept,
  isRefundabilityFactConcept,
  isPrivilegedSemanticStateConsistent,
  isTermFactConcept,
  normalizeRefundabilityFactValue,
  reconcileAmbiguitiesWithProofs,
  resolveCanonicalConcept,
  resolveCanonicalSemanticFact,
  normalizeConceptName,
  type ConceptContract,
  type RequiredProofCoverageExpectation,
} from "@truemandate/semantic-readiness";
import { AmbiguityClass, ErrorCode, IntentReadiness, SemanticLifecycle, err, ok, type EvidenceClaim, type EvidenceEnvelope, type IntentReadiness as IntentReadinessType, type ProofObligation, type Result, type SemanticVerificationResult } from "@truemandate/protocol";
import { CandidateInterpretationSchema, SemanticVerificationResultSchema, parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";
import type { EvidenceS2SClient } from "@truemandate/cloud-runtime";
import type { AuthoritativeIntentService } from "./authoritative-intent-service.js";
import { createWave45DomainPackRegistry, type DomainPackRegistry } from "./workflow-registry.js";
import type { DomainPack, WorkflowRequestBase } from "./domain-pack.js";

const PreExecutionReadinessRequestSchema = z
  .object({
    packId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    expectedIntentStateHash: z.string().min(1).optional(),
    verifiedEvidenceIds: z.array(z.string().min(1)).default([]),
    verifiedClaimIds: z.array(z.string().min(1)).default([]),
    /**
     * Server-owned inputs for the calling pack's DETERMINISTIC_RULE-mechanism
     * constraints, keyed by ruleId (see DomainPack.buildDeterministicRuleInputs
     * / evaluateDeterministicRule). This request is invoked both in-process by
     * GenericWorkflowEngine (which builds this field itself, from
     * already-schema-validated workflow input) and by the standalone
     * verifier-identity-gated route -- in neither case is it a browser-facing
     * "satisfied" claim; the pack's own evaluator independently re-derives and
     * checks the claimed binding below. Absent when the calling pack has no
     * DETERMINISTIC_RULE constraints.
     */
    deterministicRuleInputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

type EvidenceMatch = {
  readonly envelope: EvidenceEnvelope;
  readonly claim?: EvidenceClaim;
  readonly reason: string;
  readonly contradictory?: boolean;
};

type ConstraintRef = {
  readonly kind: string;
  readonly concept: string;
  readonly operator: string;
  readonly value: unknown;
};

type ProofRow = {
  readonly obligationId: string;
  readonly constraintId: string | undefined;
  readonly concept: string | undefined;
  readonly evidenceId: string | undefined;
  readonly claimId: string | undefined;
  readonly evidenceTrustClass: EvidenceEnvelope["trustClass"] | undefined;
  readonly status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
  readonly reason: string;
  readonly proofMechanism: "EVIDENCE_OBLIGATION" | "DETERMINISTIC_RULE";
  readonly deterministicRuleId?: string;
};

type ProofCoverage = {
  readonly requiredConstraintIds: readonly string[];
  readonly derivedObligationConstraintIds: readonly string[];
  readonly evaluatedConstraintIds: readonly string[];
  readonly missingObligationConstraintIds: readonly string[];
  readonly missingEvaluationConstraintIds: readonly string[];
  readonly incompleteDeterministicRuleIds: readonly string[];
  readonly allRequiredCovered: boolean;
};

type SemanticSupersessionOwner = {
  getSemanticArtifact(id: string): Promise<Result<unknown>>;
  supersedeSemanticVerification(
    stateId: string,
    raw: unknown,
  ): Promise<
    Result<{
      readonly state: { readonly id: string };
      readonly semanticArtifactId: string;
      readonly semanticArtifactHash: string;
    }>
  >;
};

type SemanticArtifact = {
  readonly id: string;
  readonly intentId: string;
  readonly kind: string;
  readonly contentHash: string;
  readonly payload: Record<string, unknown>;
};

function parseSemanticArtifact(raw: unknown): Result<SemanticArtifact> {
  if (!raw || typeof raw !== "object") {
    return err(ErrorCode.VALIDATION_FAILED, "Malformed owner semantic artifact");
  }
  const artifact = raw as Record<string, unknown>;
  if (
    typeof artifact.id !== "string" ||
    typeof artifact.intentId !== "string" ||
    typeof artifact.kind !== "string" ||
    typeof artifact.contentHash !== "string" ||
    !artifact.payload ||
    typeof artifact.payload !== "object"
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Malformed owner semantic artifact");
  }
  return ok({
    id: artifact.id,
    intentId: artifact.intentId,
    kind: artifact.kind,
    contentHash: artifact.contentHash,
    payload: artifact.payload as Record<string, unknown>,
  });
}

function normalizeConcept(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function conceptsRelated(a: string, b: string): boolean {
  const left = normalizeConcept(a);
  const right = normalizeConcept(b);
  return left === right || left.includes(right) || right.includes(left);
}

function comparableScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    const date = Date.parse(value);
    return Number.isNaN(date) ? value.toLowerCase() : date;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function compareConstraint(
  constraint: ConstraintRef,
  actualValue: unknown,
  semanticFactKey?: string,
): "SATISFIED" | "UNSATISFIED" | "UNKNOWN" {
  const expected = constraint.value;
  if (isTermFactConcept(constraint.concept)) {
    return compareTermMonths(expected, actualValue);
  }
  if (constraint.operator === "FORBID") {
    return evaluateForbidSatisfaction(expected, actualValue);
  }
  if (
    semanticFactKey?.endsWith(".approval") ||
    isApprovalFactConcept(constraint.concept)
  ) {
    return evaluateApprovalFactSatisfaction(expected, actualValue);
  }
  if (
    semanticFactKey?.startsWith("refundability.") ||
    isRefundabilityFactConcept(constraint.concept)
  ) {
    const expectedRefundability = normalizeRefundabilityFactValue(expected);
    const actualRefundability = normalizeRefundabilityFactValue(actualValue);
    if (expectedRefundability !== undefined && actualRefundability !== undefined) {
      return actualRefundability === expectedRefundability ? "SATISFIED" : "UNSATISFIED";
    }
    return actualRefundability === undefined ? "UNKNOWN" : "UNSATISFIED";
  }
  const actualComparable =
    typeof actualValue === "object" && actualValue !== null
      ? comparableScalar((actualValue as Record<string, unknown>).approved ?? actualValue)
      : comparableScalar(actualValue);
  const expectedComparable = comparableScalar(expected);
  if (
    typeof expected === "boolean" &&
    typeof actualValue === "object" &&
    actualValue !== null &&
    typeof (actualValue as Record<string, unknown>).approved === "boolean"
  ) {
    return (actualValue as Record<string, unknown>).approved === expected
      ? "SATISFIED"
      : "UNSATISFIED";
  }
  if (constraint.operator === "REQUIRE") {
    if (typeof expected === "boolean" && typeof actualComparable === "boolean") {
      return actualComparable === expected ? "SATISFIED" : "UNSATISFIED";
    }
    if (expectedComparable !== undefined && actualComparable !== undefined) {
      return actualComparable === expectedComparable ? "SATISFIED" : "UNSATISFIED";
    }
    return actualValue ? "SATISFIED" : "UNKNOWN";
  }
  if (expectedComparable === undefined || actualComparable === undefined) {
    return "UNKNOWN";
  }
  switch (constraint.operator) {
    case "EQ":
      return actualComparable === expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "NEQ":
      return actualComparable !== expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "LT":
      return actualComparable < expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "LTE":
      return actualComparable <= expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "GT":
      return actualComparable > expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "GTE":
      return actualComparable >= expectedComparable ? "SATISFIED" : "UNSATISFIED";
    case "IN":
      return Array.isArray(expected) && expected.some((value) => comparableScalar(value) === actualComparable)
        ? "SATISFIED"
        : "UNSATISFIED";
    case "NOT_IN":
      return Array.isArray(expected) && expected.every((value) => comparableScalar(value) !== actualComparable)
        ? "SATISFIED"
        : "UNSATISFIED";
    case "BETWEEN":
      if (Array.isArray(expected) && expected.length === 2) {
        const lower = comparableScalar(expected[0]);
        const upper = comparableScalar(expected[1]);
        if (lower === undefined || upper === undefined) return "UNKNOWN";
        return actualComparable >= lower && actualComparable <= upper
          ? "SATISFIED"
          : "UNSATISFIED";
      }
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

function findEvidenceMatch(
  constraint: ConstraintRef | undefined,
  envelopes: readonly EvidenceEnvelope[],
  claims: readonly EvidenceClaim[],
  contract: Pick<ConceptContract, "conceptFamilies">,
): EvidenceMatch | undefined {
  if (!constraint) return undefined;
  const constraintSemanticFact = resolveCanonicalSemanticFact(
    constraint.concept,
    contract.conceptFamilies,
    { value: constraint.value },
  );
  const constraintCanonical = constraintSemanticFact?.canonicalConcept ??
    resolveCanonicalConcept(constraint.concept, contract.conceptFamilies);
  const matchingClaims = claims.filter((item) => {
    const claimSemanticFact = resolveCanonicalSemanticFact(
      item.concept,
      contract.conceptFamilies,
      { value: item.value },
    );
    return constraintSemanticFact && claimSemanticFact
      ? constraintSemanticFact.factKey === claimSemanticFact.factKey
      : constraintCanonical && claimSemanticFact?.canonicalConcept
        ? constraintCanonical === claimSemanticFact.canonicalConcept
      : normalizeConceptName(item.concept) === normalizeConceptName(constraint.concept);
  });
  const claim = matchingClaims[0];
  if (claim) {
    const envelope = envelopes.find((item) => item.id === claim.evidenceId);
    if (envelope) {
      const contradictory = new Set(matchingClaims.map((item) => hashCanonical(item.value))).size > 1;
      return {
        envelope,
        claim,
        contradictory,
        reason: contradictory
          ? `contradictory verified claims for semantic fact ${constraintSemanticFact?.factKey ?? constraintCanonical ?? constraint.concept}`
          : `matched claim concept ${claim.concept}`,
      };
    }
  }
  const envelope = envelopes.find(
    (item) =>
      conceptsRelated(item.source, constraint.concept) ||
      (item.originId ? conceptsRelated(item.originId, constraint.concept) : false) ||
      (item.lineageGroupId ? conceptsRelated(item.lineageGroupId, constraint.concept) : false),
  );
  return envelope ? { envelope, reason: "matched envelope metadata" } : undefined;
}

function nextReadiness(current: IntentReadinessType): IntentReadinessType {
  return current === IntentReadiness.EXECUTABLE || current === IntentReadiness.ACTIONABLE
    ? current
    : IntentReadiness.ACTIONABLE;
}

export function assessProofCoverage(
  requirements: readonly RequiredProofCoverageExpectation[],
  obligations: readonly ProofObligation[],
  proofRows: readonly ProofRow[],
): ProofCoverage {
  const requiredConstraintIds = requirements.map((row) => row.constraintId).sort();
  const derivedObligationConstraintIds = obligations
    .flatMap((row) => row.constraintId ? [String(row.constraintId)] : [])
    .sort();
  const obligationSet = new Set(derivedObligationConstraintIds);
  const evaluatedConstraintIds = proofRows
    .map((row) => row.constraintId)
    .filter((value): value is string => typeof value === "string")
    .sort();
  const evaluatedSet = new Set(evaluatedConstraintIds);
  const missingObligationConstraintIds = requirements
    .filter((row) => row.proofMechanism.kind === "EVIDENCE_OBLIGATION")
    .map((row) => row.constraintId)
    .filter((constraintId) => !obligationSet.has(constraintId))
    .sort();
  const missingEvaluationConstraintIds = requiredConstraintIds
    .filter((constraintId) => !evaluatedSet.has(constraintId))
    .sort();
  const incompleteDeterministicRuleIds = requirements
    .filter((row) => row.proofMechanism.kind === "DETERMINISTIC_RULE")
    .filter((requirement) => !proofRows.some((row) =>
      row.constraintId === requirement.constraintId &&
      row.proofMechanism === "DETERMINISTIC_RULE" &&
      row.deterministicRuleId === (requirement.proofMechanism.kind === "DETERMINISTIC_RULE" ? requirement.proofMechanism.ruleId : undefined) &&
      row.status === "SATISFIED"))
    .map((row) => row.proofMechanism.kind === "DETERMINISTIC_RULE" ? row.proofMechanism.ruleId : "")
    .sort();
  return {
    requiredConstraintIds,
    derivedObligationConstraintIds,
    evaluatedConstraintIds,
    missingObligationConstraintIds,
    missingEvaluationConstraintIds,
    incompleteDeterministicRuleIds,
    allRequiredCovered:
      missingObligationConstraintIds.length === 0 &&
      missingEvaluationConstraintIds.length === 0 &&
      incompleteDeterministicRuleIds.length === 0,
  };
}

export class PreExecutionReadinessService {
  constructor(
    private readonly deps: {
      intents: AuthoritativeIntentService;
      owner: SemanticSupersessionOwner;
      evidence: Pick<EvidenceS2SClient, "getEnvelope" | "getClaim">;
      registry?: DomainPackRegistry;
      now?: () => string;
    },
  ) {}

  private registry(): DomainPackRegistry {
    return this.deps.registry ?? createWave45DomainPackRegistry();
  }

  async evaluate(raw: unknown): Promise<Result<unknown>> {
    const parsed = parseWithSchema(
      PreExecutionReadinessRequestSchema,
      raw,
      "PreExecutionReadinessRequest",
    );
    if (!parsed.ok) return parsed;
    const verifiedEvidenceIds = parsed.value.verifiedEvidenceIds ?? [];
    const verifiedClaimIds = parsed.value.verifiedClaimIds ?? [];

    const state = await this.deps.intents.getCurrentStateForIntent(
      parsed.value.intentId,
      parsed.value.intentStateId,
    );
    if (!state.ok) return state;
    if (state.value.id !== parsed.value.intentStateId) {
      return err(ErrorCode.VALIDATION_FAILED, "Current tip does not match supplied intentStateId", {
        currentIntentStateId: state.value.id,
        suppliedIntentStateId: parsed.value.intentStateId,
      });
    }
    if (
      parsed.value.expectedIntentStateHash &&
      parsed.value.expectedIntentStateHash !== state.value.stateHash
    ) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Expected IntentState hash is stale");
    }
    const verification = await this.deps.intents.getVerificationForState(state.value);
    if (!verification.ok) return verification;
    const currentArtifact = await this.deps.owner.getSemanticArtifact(
      `semantic-verification-${state.value.id}`,
    );
    if (!currentArtifact.ok) return currentArtifact as Result<unknown>;
    const artifactRow = parseSemanticArtifact(currentArtifact.value);
    if (!artifactRow.ok || artifactRow.value.kind !== "SEMANTIC_VERIFICATION") {
      return artifactRow.ok
        ? err(ErrorCode.VALIDATION_FAILED, "Owner artifact is not a semantic verification")
        : artifactRow;
    }
    const sourceCompilationId =
      typeof artifactRow.value.payload.sourceCompilationId === "string"
        ? artifactRow.value.payload.sourceCompilationId
        : typeof artifactRow.value.payload.compilationId === "string"
          ? artifactRow.value.payload.compilationId
          : undefined;
    if (!sourceCompilationId) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Semantic verification lacks immutable compilation lineage",
      );
    }
    const compilationArtifact = await this.deps.owner.getSemanticArtifact(sourceCompilationId);
    if (!compilationArtifact.ok) return compilationArtifact as Result<unknown>;
    const compilationRow = parseSemanticArtifact(compilationArtifact.value);
    if (
      !compilationRow.ok ||
      compilationRow.value.kind !== "COMPILATION" ||
      compilationRow.value.intentId !== state.value.intentId
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Compilation ambiguity lineage invalid");
    }
    const candidate = parseWithSchema(
      CandidateInterpretationSchema,
      compilationRow.value.payload.candidate,
      "AuthoritativeCompilationCandidate",
    );
    if (
      !candidate.ok ||
      candidate.value.intentId !== state.value.intentId ||
      candidate.value.id !== verification.value.candidateId ||
      candidate.value.candidateHash !== verification.value.candidateHash
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Compilation candidate does not bind current verification");
    }

    const adapter = await this.registry().get(parsed.value.packId);
    if (!adapter.ok) return adapter as Result<unknown>;
    const pack = adapter.value.pack as DomainPack<WorkflowRequestBase>;

    const envelopes: EvidenceEnvelope[] = [];
    for (const evidenceId of verifiedEvidenceIds) {
      const envelope = await this.deps.evidence.getEnvelope(evidenceId);
      if (!envelope.ok) return envelope as Result<unknown>;
      if (envelope.value.trustClass === "UNTRUSTED_EXTERNAL") {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Pre-execution readiness requires verified/trusted evidence",
          { evidenceId },
        );
      }
      envelopes.push(envelope.value);
    }
    const claims: EvidenceClaim[] = [];
    for (const claimId of verifiedClaimIds) {
      const claim = await this.deps.evidence.getClaim(claimId);
      if (!claim.ok) return claim as Result<unknown>;
      claims.push(claim.value);
    }

    const obligations = deriveRequiredProofObligations(state.value.constraints, {
      temporalAuthority: state.value.temporalAuthority,
      conceptContract: pack.planning,
    });
    const requiredCoverage = classifyRequiredProofCoverage(state.value.constraints, {
      temporalAuthority: state.value.temporalAuthority,
      conceptContract: pack.planning,
    });
    const evidenceObligationRows: ProofRow[] = obligations.map((obligation) => {
      const constraint = obligation.constraintId
        ? state.value.constraints.find((item) => item.id === obligation.constraintId)
        : undefined;
      const constraintRef: ConstraintRef | undefined = constraint
        ? {
            kind: constraint.kind,
            concept: constraint.concept,
            operator: constraint.operator,
            value: constraint.value,
          }
        : undefined;
      const match = findEvidenceMatch(constraintRef, envelopes, claims, pack.planning);
      const status =
        match?.contradictory
          ? "UNSATISFIED"
          : constraintRef && match?.claim
          ? compareConstraint(
              constraintRef,
              match.claim.value,
              resolveCanonicalSemanticFact(
                constraintRef.concept,
                pack.planning.conceptFamilies,
                { value: constraintRef.value },
              )?.factKey,
            )
          : "UNKNOWN";
      return {
        obligationId: proofObligationId(obligation),
        constraintId: obligation.constraintId,
        concept: constraintRef?.concept,
        evidenceId: match?.envelope.id,
        claimId: match?.claim?.id,
        evidenceTrustClass: match?.envelope.trustClass,
        status,
        reason:
          match === undefined
            ? "No verified evidence matched the authoritative constraint"
            : status === "UNKNOWN"
              ? `Matched evidence but could not deterministically compare value (${match.reason})`
              : match.reason,
        proofMechanism: "EVIDENCE_OBLIGATION",
      };
    });
    // DETERMINISTIC_RULE constraints never enter `obligations` above
    // (deriveRequiredProofObligations excludes them deliberately -- there is
    // no evidence obligation to derive), so they need their own row-
    // production path here. No EvidenceEnvelope/EvidenceClaim is fabricated
    // for these; evaluation is delegated entirely to the OWNING pack's own
    // server-side evaluator, using ONLY the server-computed
    // deterministicRuleInputs this request carries -- never a caller-supplied
    // "satisfied" claim (see DomainPack.evaluateDeterministicRule's
    // docstring). A pack that declares a DETERMINISTIC_RULE requirement but
    // implements no evaluator fails closed to UNKNOWN, never silently drops
    // the requirement or marks it SATISFIED.
    const deterministicRuleRows: ProofRow[] = requiredCoverage
      .filter((requirement) => requirement.proofMechanism.kind === "DETERMINISTIC_RULE")
      .map((requirement) => {
        const ruleId =
          requirement.proofMechanism.kind === "DETERMINISTIC_RULE" ? requirement.proofMechanism.ruleId : "";
        const inputs = parsed.value.deterministicRuleInputs?.[ruleId];
        const evaluated = pack.evaluateDeterministicRule?.(ruleId, inputs);
        const status = evaluated?.status ?? "UNKNOWN";
        const reason =
          evaluated?.reason ??
          `Domain pack '${pack.id}' declares deterministic rule '${ruleId}' but implements no evaluator for it`;
        return {
          obligationId: proofObligationId({ deterministicRuleId: ruleId, constraintId: requirement.constraintId }),
          constraintId: requirement.constraintId,
          concept: requirement.originalConcept,
          evidenceId: undefined,
          claimId: undefined,
          evidenceTrustClass: undefined,
          status,
          reason,
          proofMechanism: "DETERMINISTIC_RULE",
          deterministicRuleId: ruleId,
        };
      });
    const proofRows: ProofRow[] = [...evidenceObligationRows, ...deterministicRuleRows];
    const coverage = assessProofCoverage(requiredCoverage, obligations, proofRows);
    const requiredConstraints = state.value.constraints.filter((constraint) =>
      coverage.requiredConstraintIds.includes(constraint.id),
    );
    const ambiguityResolution = reconcileAmbiguitiesWithProofs({
      ambiguities: candidate.value.ambiguities,
      requiredConstraints,
      proofRows,
    });

    const allSatisfied =
      proofRows.length > 0 && proofRows.every((row) => row.status === "SATISFIED");
    const targetReadiness = nextReadiness(verification.value.readiness);
    const semanticStateConsistent = isPrivilegedSemanticStateConsistent({
      readiness: targetReadiness,
      ambiguityClass: ambiguityResolution.ambiguityClass,
    });
    // Attaching a proof summary completes the semantic state once; it is not a
    // repeatable step. SEARCHABLE and PLANNABLE self-disarm because the tier moves
    // to ACTIONABLE and no longer matches. ACTIONABLE keeps its tier, so the guard
    // against minting successor after successor has to be explicit.
    const proofSummaryAlreadyBound = artifactRow.value.payload.proofSummary !== undefined;
    const supersessionEligible =
      !verification.value.criticalFailure &&
      verification.value.lifecycle !== SemanticLifecycle.REJECTED &&
      coverage.allRequiredCovered &&
      allSatisfied &&
      semanticStateConsistent &&
      !proofSummaryAlreadyBound &&
      (verification.value.readiness === IntentReadiness.SEARCHABLE ||
        verification.value.readiness === IntentReadiness.PLANNABLE ||
        // ACTIONABLE is eligible for evidence-backed proof attachment, never for
        // promotion: nextReadiness returns ACTIONABLE unchanged for an ACTIONABLE
        // input, so the tier this path writes is the tier it read. Without this,
        // a state the lexical heuristic promoted early could never acquire a proof
        // summary at all — supersession is its only producer — and so could never
        // satisfy completeProofs however much verified evidence it carried.
        verification.value.readiness === IntentReadiness.ACTIONABLE);

    if (!supersessionEligible) {
      return ok({
        intentId: parsed.value.intentId,
        intentStateId: state.value.id,
        readiness: verification.value.readiness,
        superseded: false,
        proofRows,
        coverage,
        ambiguityResolution,
        semanticStateConsistent,
      });
    }

    const now = this.deps.now?.() ?? new Date().toISOString();
    const successorLifecycle =
      ambiguityResolution.ambiguityClass === AmbiguityClass.A0 ||
      ambiguityResolution.ambiguityClass === AmbiguityClass.A1
        ? SemanticLifecycle.VERIFIED
        : SemanticLifecycle.AMBIGUOUS;
    const successorVerificationId = `semantic-verdict-${hashCanonical({
      previousVerificationId: verification.value.id,
      currentSemanticArtifactHash: artifactRow.value.contentHash,
      sourceCompilationId,
      readiness: targetReadiness,
      lifecycle: successorLifecycle,
      ambiguityClass: ambiguityResolution.ambiguityClass,
      proofRows,
      verifiedEvidenceRefs: envelopes.map((item) => ({ id: item.id, hash: item.contentHash })),
      verifiedAt: now,
    }).slice(0, 16)}`;
    const updatedVerification = parseWithSchema(
      SemanticVerificationResultSchema,
      {
        ...verification.value,
        id: successorVerificationId,
        readiness: targetReadiness,
        lifecycle: successorLifecycle,
        ambiguityClass: ambiguityResolution.ambiguityClass,
        verifiedAt: now,
      } satisfies SemanticVerificationResult,
      "SupersededSemanticVerification",
    );
    if (!updatedVerification.ok) return updatedVerification;

    const superseded = await this.deps.owner.supersedeSemanticVerification(
      state.value.id,
      {
        expectedIntentStateHash: state.value.stateHash,
        currentSemanticArtifactHash: artifactRow.value.contentHash,
        sourceCompilationId,
        verification: updatedVerification.value,
        proofSummary: {
          version: 1,
          intentId: parsed.value.intentId,
          intentStateId: state.value.id,
          intentStateHash: state.value.stateHash,
          generatedAt: now,
          packId: parsed.value.packId,
          requiredProofObligationIds: obligations.map((item) => proofObligationId(item)).sort(),
          proofRows,
          coverage,
          verifiedEvidenceRefs: envelopes.map((item) => ({
            id: item.id,
            hash: item.contentHash,
            trustClass: item.trustClass,
            claimIds: claims
              .filter((claim) => claim.evidenceId === item.id)
              .map((claim) => claim.id),
          })),
          ambiguityResolution,
        },
        verifiedEvidenceRefs: envelopes.map((item) => ({
          id: item.id,
          hash: item.contentHash,
        })),
      },
    );
    if (!superseded.ok) return superseded;

    return ok({
      intentId: parsed.value.intentId,
      intentStateId: state.value.id,
      readiness: verification.value.readiness,
      superseded: true,
      proofRows,
      coverage,
      ambiguityResolution,
      semanticStateConsistent,
      successor: superseded.value,
    });
  }
}
