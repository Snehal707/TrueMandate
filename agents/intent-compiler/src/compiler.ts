import { hashCanonical } from "@truemandate/crypto";
import type { ModelPort } from "@truemandate/model";
import { PROTOCOL_VERSION } from "@truemandate/model";
import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticLifecycle,
  SemanticRelation,
  TrustClass,
  asAssumptionId,
  asConstraintId,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type CandidateInterpretation,
  type Intent,
  type Result,
  type TaintMetadata,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { candidateAssumptionProvenanceNodeId, candidateConstraintProvenanceNodeId } from "@truemandate/provenance";
import { CompilerModelOutputSchema } from "@truemandate/schemas";
import {
  reconcileUniqueExactSourceSpans,
  validateCandidateGrounding,
} from "@truemandate/semantic-grounding";
import {
  COMPILER_PROMPT_VERSION,
  COMPILER_SCHEMA_ID,
  COMPILER_SCHEMA_VERSION,
  COMPILER_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface CompileOptions {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly provenance?: ProvenanceService;
  readonly intentNodeId?: string;
  readonly now?: string;
  readonly timezone?: string;
  readonly requestId?: string;
  /** Survives CLEAN inspection. Defaults to NONE. */
  readonly inputTaint?: TaintMetadata;
}

const CANONICAL_NUMERIC_FINANCIAL_CONCEPTS = new Set([
  "amount",
  "budget",
  "cost",
  "fee",
  "limit",
  "price",
  "spend",
  "total_amount",
  "total_budget",
  "total_cost",
  "total_price",
]);

function requiresFiniteNumericFinancialValue(
  constraint: CandidateInterpretation["constraints"][number],
): boolean {
  const concept = constraint.concept.trim().toLowerCase();
  if (CANONICAL_NUMERIC_FINANCIAL_CONCEPTS.has(concept)) {
    return true;
  }

  // Keep amount-style financial ceilings/floors canonicalized without
  // catching categorical financial constraints like payment_frequency.
  return /(amount|budget|cost|fee|limit|price|spend)$/.test(concept);
}

export async function compileIntent(
  intent: Intent,
  options: CompileOptions,
): Promise<Result<CandidateInterpretation>> {
  const requestId = options.requestId ?? `compile-${intent.id}`;
  const inputTaint: TaintMetadata = options.inputTaint ?? {
    classes: ["NONE"],
    origins: [],
  };
  const generated = await options.model.generateStructured({
    modelId: options.modelId ?? "intent-compiler",
    promptVersion: COMPILER_PROMPT_VERSION,
    schemaId: COMPILER_SCHEMA_ID,
    schemaVersion: COMPILER_SCHEMA_VERSION,
    schema: CompilerModelOutputSchema,
    systemInstruction: COMPILER_SYSTEM_INSTRUCTION,
    userPayload: {
      rawText: intent.rawText,
      intentId: intent.id,
      principalId: intent.principalId,
      now: options.now,
      timezone: options.timezone,
    },
    requestId,
  });

  if (!generated.ok) {
    return generated;
  }

  const output = generated.value.value;
  const toCandidateConstraint = (
    c: (typeof output.constraints)[number],
  ): CandidateInterpretation["constraints"][number] => ({
    id: asConstraintId(c.id),
    concept: c.concept,
    operator: c.operator,
    value: c.value ?? null,
    kind: c.kind,
    importance: c.importance,
    confidence: c.confidence,
    sourceType: c.sourceType,
    mutability: c.mutability,
    meaningClass: c.meaningClass,
    grounding: c.grounding,
    temporalResolution: c.temporalResolution,
    proofObligation: c.proofObligation,
  });

  const rawConstraints = reconcileUniqueExactSourceSpans(
    intent.rawText,
    output.constraints.map(toCandidateConstraint),
  );
  const preferences = reconcileUniqueExactSourceSpans(
    intent.rawText,
    output.preferences.map(toCandidateConstraint),
  );

  // Deterministic financial-constraint structural gate. A budget/price
  // ceiling or floor must carry a finite numeric amount — canonical
  // representation for this system (currency is grounded in the raw span).
  // Numeric strings normalize; empty objects, arrays, null, NaN, non-finite
  // and non-numeric values fail the candidate before it can become
  // authoritative. Nothing is fabricated.
  type ConstraintRow = CandidateInterpretation["constraints"][number];
  const constraints: ConstraintRow[] = [];
  for (const constraint of rawConstraints) {
    if (!requiresFiniteNumericFinancialValue(constraint)) {
      constraints.push(constraint);
      continue;
    }
    const raw = constraint.value;
    const normalized =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))
          ? Number(raw)
          : undefined;
    if (normalized === undefined || !Number.isFinite(normalized)) {
      return err(
        ErrorCode.GROUNDING_FAILED,
        `Financial constraint '${constraint.concept}' must carry a finite numeric amount`,
        { constraintId: constraint.id },
      );
    }
    constraints.push({ ...constraint, value: normalized });
  }

  const grounding = validateCandidateGrounding(intent.rawText, [
    ...constraints,
    ...preferences,
  ]);
  if (!grounding.ok) {
    return grounding;
  }

  const compiledAt = generated.value.timestamp;
  const candidateWithoutHash = {
    id: `candidate-${intent.id}-${hashCanonical(output).slice(0, 10)}`,
    intentId: intent.id,
    rawIntentHash: intent.contentHash,
    goal: output.goal,
    constraints,
    preferences,
    assumptions: output.assumptions.map((a) => ({
      ...a,
      id: asAssumptionId(a.id),
    })),
    ambiguities: output.ambiguities,
    readiness: output.readiness,
    lifecycle: SemanticLifecycle.COMPILED,
    compiledAt,
    modelMeta: {
      modelId: generated.value.modelId,
      modelVersion: generated.value.modelVersion,
      promptVersion: generated.value.promptVersion,
      schemaId: generated.value.schemaId,
      schemaVersion: generated.value.schemaVersion,
      protocolVersion: PROTOCOL_VERSION,
      requestId: generated.value.requestId,
      timestamp: generated.value.timestamp,
      latencyMs: generated.value.latencyMs,
      usage: generated.value.usage,
      providerMetadata: generated.value.providerMetadata,
    },
  };

  const candidate: CandidateInterpretation = {
    ...candidateWithoutHash,
    candidateHash: hashCanonical(candidateWithoutHash),
  };

  if (options.provenance && options.intentNodeId) {
    const prov = options.provenance;
    for (const constraint of candidate.constraints) {
      const nodeId = asProvenanceNodeId(candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id));
      const nodeResult = await prov.recordNode({
        id: nodeId,
        kind: ProvenanceNodeKind.CONSTRAINT,
        label: constraint.concept,
        createdAt: compiledAt,
        trustClass: TrustClass.TRUSTED_SYSTEM,
        taint: inputTaint,
        subjectRef: constraint.id,
        metadata: { meaningClass: constraint.meaningClass, candidate: true },
      });
      if (!nodeResult.ok) {
        return err(ErrorCode.VALIDATION_FAILED, nodeResult.message, nodeResult.details);
      }
      const edgeResult = await prov.recordEdge({
        id: asProvenanceEdgeId(`e-${options.intentNodeId}-${nodeId}`),
        from: asProvenanceNodeId(options.intentNodeId),
        to: nodeId,
        relation: SemanticRelation.DERIVED_FROM,
        createdAt: compiledAt,
      });
      if (!edgeResult.ok) return edgeResult;
    }
    for (const assumption of candidate.assumptions) {
      const nodeId = asProvenanceNodeId(candidateAssumptionProvenanceNodeId(candidate.candidateHash, assumption.id));
      const nodeResult = await prov.recordNode({
        id: nodeId,
        kind: ProvenanceNodeKind.ASSUMPTION,
        label: assumption.statement,
        createdAt: compiledAt,
        trustClass: TrustClass.TRUSTED_SYSTEM,
        taint: inputTaint,
        subjectRef: assumption.id,
        metadata: { assumption: true },
      });
      if (!nodeResult.ok) {
        return err(ErrorCode.VALIDATION_FAILED, nodeResult.message, nodeResult.details);
      }
      const edgeResult = await prov.recordEdge({
        id: asProvenanceEdgeId(`e-assumes-${options.intentNodeId}-${nodeId}`),
        from: asProvenanceNodeId(options.intentNodeId),
        to: nodeId,
        relation: SemanticRelation.ASSUMES,
        createdAt: compiledAt,
      });
      if (!edgeResult.ok) return edgeResult;
    }
  }

  return ok(candidate);
}
