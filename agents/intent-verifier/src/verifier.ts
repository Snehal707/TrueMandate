import { hashCanonical } from "@truemandate/crypto";
import type { ModelPort } from "@truemandate/model";
import { PROTOCOL_VERSION } from "@truemandate/model";
import {
  FindingSeverity,
  ProvenanceNodeKind,
  SemanticLifecycle,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  ok,
  type CandidateInterpretation,
  type Intent,
  type Result,
  type SemanticVerificationResult,
  type TaintMetadata,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { VerifierModelOutputSchema } from "@truemandate/schemas";
import {
  deterministicFindings,
  mergeAmbiguityClass,
  normalizeApprovalSourceAmbiguities,
  readinessAfterVerification,
} from "./deterministic.js";
import {
  VERIFIER_PROMPT_VERSION,
  VERIFIER_SCHEMA_ID,
  VERIFIER_SCHEMA_VERSION,
  VERIFIER_SYSTEM_INSTRUCTION,
} from "./prompts/v1.js";

export interface VerifyOptions {
  readonly model: ModelPort;
  readonly modelId?: string;
  readonly provenance?: ProvenanceService;
  readonly intentNodeId?: string;
  readonly requestId?: string;
  readonly inputTaint?: TaintMetadata;
}

export async function verifyCandidate(
  intent: Intent,
  candidate: CandidateInterpretation,
  options: VerifyOptions,
): Promise<Result<SemanticVerificationResult>> {
  const requestId = options.requestId ?? `verify-${candidate.id}`;
  const generated = await options.model.generateStructured({
    modelId: options.modelId ?? "intent-verifier",
    promptVersion: VERIFIER_PROMPT_VERSION,
    schemaId: VERIFIER_SCHEMA_ID,
    schemaVersion: VERIFIER_SCHEMA_VERSION,
    schema: VerifierModelOutputSchema,
    systemInstruction: VERIFIER_SYSTEM_INSTRUCTION,
    userPayload: {
      rawText: intent.rawText,
      candidate: {
        goal: candidate.goal,
        constraints: candidate.constraints,
        preferences: candidate.preferences,
        assumptions: candidate.assumptions,
        ambiguities: candidate.ambiguities,
        readiness: candidate.readiness,
      },
    },
    requestId,
  });

  if (!generated.ok) {
    // Fail closed for authoritative verification when model unavailable/malformed
    return generated;
  }

  const modelOut = generated.value.value;
  const det = deterministicFindings(intent, candidate);
  const findings = [...modelOut.findings, ...det];
  const transformations = [
    ...modelOut.transformations,
    ...det.flatMap((f) => (f.transformation ? [f.transformation] : [])),
  ];
  const criticalFailure =
    modelOut.criticalFailure ||
    findings.some(
      (f) =>
        f.severity === FindingSeverity.CRITICAL ||
        f.severity === FindingSeverity.HIGH,
    );
  const normalized = normalizeApprovalSourceAmbiguities(candidate);
  const ambiguityClass = mergeAmbiguityClass(normalized, findings);
  const readiness = readinessAfterVerification(
    intent,
    normalized,
    criticalFailure,
    ambiguityClass,
  );

  let lifecycle: SemanticVerificationResult["lifecycle"];
  if (criticalFailure) {
    lifecycle = SemanticLifecycle.REJECTED;
  } else if (
    ambiguityClass === "A2" ||
    ambiguityClass === "A3" ||
    ambiguityClass === "A4"
  ) {
    lifecycle = SemanticLifecycle.AMBIGUOUS;
  } else {
    lifecycle = SemanticLifecycle.VERIFIED;
  }

  const verifiedAt = generated.value.timestamp;
  const result: SemanticVerificationResult = {
    // Occurrence-scoped identity: the verdict binds the candidate occurrence
    // (candidateHash) plus the full verification content including verifiedAt,
    // so distinct verification invocations never collide on immutable verdict
    // provenance or COMPILATION_VERIFICATION artifacts across redelivery.
    id: `verdict-${hashCanonical({ candidateId: candidate.id, candidateHash: candidate.candidateHash, findings, transformations, lifecycle, readiness, verifiedAt }).slice(0, 12)}`,
    intentId: intent.id,
    candidateId: candidate.id,
    candidateHash: candidate.candidateHash,
    lifecycle,
    findings,
    transformations,
    criticalFailure,
    readiness,
    ambiguityClass,
    modelProposedReadiness: modelOut.readiness,
    modelProposedAmbiguityClass: modelOut.ambiguityClass,
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
    verifiedAt,
  };

  if (options.provenance && options.intentNodeId) {
    const verdictNodeId = asProvenanceNodeId(`verdict-${result.id}`);
    const inputTaint: TaintMetadata = options.inputTaint ?? {
      classes: ["NONE"],
      origins: [],
    };
    const nodeResult = await options.provenance.recordNode({
      id: verdictNodeId,
      kind: ProvenanceNodeKind.DECISION,
      label: `verification:${result.lifecycle}`,
      createdAt: verifiedAt,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: inputTaint,
      metadata: {
        criticalFailure: result.criticalFailure,
        lifecycle: result.lifecycle,
      },
    });
    if (!nodeResult.ok) return nodeResult;
    const edgeResult = await options.provenance.recordEdge({
      id: asProvenanceEdgeId(`e-verdict-${options.intentNodeId}-${verdictNodeId}`),
      from: asProvenanceNodeId(options.intentNodeId),
      to: verdictNodeId,
      relation: SemanticRelation.SUPPORTS,
      createdAt: verifiedAt,
    });
    if (!edgeResult.ok) return edgeResult;

    if (result.lifecycle === SemanticLifecycle.REJECTED) {
      for (const f of findings.filter((x) => x.code === "INVENTED_CONSTRAINT" || x.severity === FindingSeverity.CRITICAL)) {
        void f;
      }
    }
  }

  return ok(result);
}
