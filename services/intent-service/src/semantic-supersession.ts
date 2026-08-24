import { hashCanonical } from "@truemandate/crypto";
import { ErrorCode, asIntentStateId, err, ok, type IntentState, type Result } from "@truemandate/protocol";
import {
  AuthoritativeProofSummarySchema,
  SemanticVerificationEvidenceRefSchema,
  SemanticVerificationResultSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { isPrivilegedSemanticStateConsistent } from "@truemandate/semantic-readiness";
import { z } from "zod";
import type { IntentService, SemanticArtifactStore } from "./service.js";

export const SemanticSupersessionRequestSchema = z
  .object({
    expectedIntentStateHash: z.string().min(1),
    currentSemanticArtifactHash: z.string().min(1),
    sourceCompilationId: z.string().min(1),
    verification: SemanticVerificationResultSchema,
    proofSummary: AuthoritativeProofSummarySchema.partial({
      intentId: true,
      intentStateId: true,
      intentStateHash: true,
      sourceIntentStateId: true,
      sourceIntentStateHash: true,
      generatedAt: true,
    }).optional(),
    verifiedEvidenceRefs: z.array(SemanticVerificationEvidenceRefSchema).default([]),
  })
  .strict();

type ArtifactRow = {
  readonly id: string;
  readonly intentId: string;
  readonly workflowId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly predecessors: readonly {
    readonly id: string;
    readonly kind: string;
    readonly contentHash: string;
  }[];
  readonly contentHash: string;
  readonly createdAt: string;
};

const EXECUTION_BOUND_OPERATORS = new Set(["LT", "LTE", "REQUIRE"]);

function validateInheritedTemporalAuthority(state: IntentState): Result<void> {
  const authority = state.temporalAuthority;
  if (!authority) return ok(undefined);
  const source = state.constraints.find((constraint) => constraint.id === authority.sourceRef);
  if (
    !source ||
    source.kind !== "TEMPORAL" ||
    !EXECUTION_BOUND_OPERATORS.has(source.operator) ||
    (authority.source === "EXPLICIT_HUMAN" &&
      (source.sourceType !== "HUMAN" || source.meaningClass !== "EXPLICIT")) ||
    Number.isNaN(Date.parse(authority.executionNotAfter)) ||
    (authority.executionNotBefore !== undefined &&
      (Number.isNaN(Date.parse(authority.executionNotBefore)) ||
        Date.parse(authority.executionNotBefore) > Date.parse(authority.executionNotAfter)))
  ) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Semantic supersession temporal authority source is not valid in the current IntentState",
      { sourceRef: authority.sourceRef },
    );
  }
  if (typeof source.value === "string") {
    const sourceValue = Date.parse(source.value);
    if (
      !Number.isNaN(sourceValue) &&
      new Date(sourceValue).toISOString() !==
        new Date(authority.executionNotAfter).toISOString()
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Semantic supersession temporal authority disagrees with its source constraint",
        { sourceRef: authority.sourceRef },
      );
    }
  }
  return ok(undefined);
}

export async function supersedeSemanticVerification(
  intents: IntentService,
  artifacts: SemanticArtifactStore | undefined,
  currentStateId: string,
  raw: unknown,
): Promise<
  Result<{
    readonly state: IntentState;
    readonly semanticArtifactId: string;
    readonly semanticArtifactHash: string;
  }>
> {
  const parsed = parseWithSchema(
    SemanticSupersessionRequestSchema,
    raw,
    "SemanticSupersessionRequest",
  );
  if (!parsed.ok) return parsed;
  if (!artifacts) {
    return err(ErrorCode.VALIDATION_FAILED, "Semantic supersession requires owner semantic artifact store");
  }

  const currentState = await intents.getIntentState(currentStateId);
  if (!currentState.ok) return currentState as Result<never>;
  if (currentState.value.stateHash !== parsed.value.expectedIntentStateHash) {
    return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Expected IntentState hash is stale");
  }
  const currentTip = await intents.getCurrentIntentState(currentState.value.intentId);
  if (!currentTip.ok) return currentTip as Result<never>;
  const currentArtifactId = `semantic-verification-${currentState.value.id}`;
  const currentArtifact = (await artifacts.get(currentArtifactId)) as ArtifactRow | undefined;
  if (
    !currentArtifact ||
    currentArtifact.kind !== "SEMANTIC_VERIFICATION" ||
    currentArtifact.contentHash !== parsed.value.currentSemanticArtifactHash
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Current semantic verification lineage invalid", {
      intentStateId: currentState.value.id,
      semanticArtifactId: currentArtifactId,
    });
  }
  const priorPayload = currentArtifact.payload as Record<string, unknown>;
  if (
    typeof priorPayload.intentStateHash !== "string" ||
    priorPayload.intentStateHash !== currentState.value.stateHash
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Current semantic verification does not bind the supplied IntentState");
  }
  if (parsed.value.verification.intentId !== currentState.value.intentId) {
    return err(ErrorCode.VALIDATION_FAILED, "Superseding semantic verification intent mismatch", {
      expectedIntentId: currentState.value.intentId,
      receivedIntentId: parsed.value.verification.intentId,
    });
  }
  const sourceCompilationId =
    typeof priorPayload.sourceCompilationId === "string"
      ? priorPayload.sourceCompilationId
      : typeof priorPayload.compilationId === "string"
        ? priorPayload.compilationId
        : undefined;
  if (
    !sourceCompilationId ||
    parsed.value.sourceCompilationId !== sourceCompilationId
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Semantic supersession compilation lineage mismatch", {
      expectedSourceCompilationId: sourceCompilationId,
      receivedSourceCompilationId: parsed.value.sourceCompilationId,
    });
  }
  if (
    !isPrivilegedSemanticStateConsistent({
      readiness: parsed.value.verification.readiness,
      ambiguityClass: parsed.value.verification.ambiguityClass,
    })
  ) {
    return err(
      ErrorCode.SEMANTIC_READINESS_INSUFFICIENT,
      "Semantic supersession cannot pair privileged readiness with blocking ambiguity",
      {
        readiness: parsed.value.verification.readiness,
        ambiguityClass: parsed.value.verification.ambiguityClass,
      },
    );
  }
  const inheritedTemporalAuthority = validateInheritedTemporalAuthority(currentState.value);
  if (!inheritedTemporalAuthority.ok) return inheritedTemporalAuthority;
  if (currentTip.value.id !== currentState.value.id) {
    if (currentTip.value.previousStateId === currentState.value.id) {
      const existingArtifact = (await artifacts.get(
        `semantic-verification-${currentTip.value.id}`,
      )) as ArtifactRow | undefined;
      if (existingArtifact) {
        const existingPayload = existingArtifact.payload as Record<string, unknown>;
        const existingVerification = parseWithSchema(
          SemanticVerificationResultSchema,
          existingPayload.verification,
          "ExistingSemanticVerification",
        );
        if (
          existingVerification.ok &&
          hashCanonical(existingVerification.value) ===
            hashCanonical(parsed.value.verification)
        ) {
          return ok({
            state: currentTip.value,
            semanticArtifactId: existingArtifact.id,
            semanticArtifactHash: existingArtifact.contentHash,
          });
        }
      }
    }
    return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Current IntentState is no longer the authoritative tip", {
      currentTipId: currentTip.value.id,
      suppliedIntentStateId: currentState.value.id,
    });
  }

  const successorId = asIntentStateId(
    `state-${currentState.value.intentId}-semantic-${hashCanonical({
      previousStateId: currentState.value.id,
      verification: parsed.value.verification,
    }).slice(0, 16)}`,
  );
  const createdAt = parsed.value.verification.verifiedAt;
  const successorState = await intents.createIntentState({
    intentId: currentState.value.intentId,
    id: successorId,
    constraints: currentState.value.constraints,
    assumptions: currentState.value.assumptions,
    ...(currentState.value.capabilities
      ? { capabilities: currentState.value.capabilities }
      : {}),
    createdBy: currentState.value.createdBy,
    createdAt,
    previousStateId: currentState.value.id,
  });
  if (!successorState.ok) return successorState as Result<never>;
  if (
    hashCanonical(successorState.value.temporalAuthority ?? null) !==
    hashCanonical(currentState.value.temporalAuthority ?? null)
  ) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Semantic supersession did not preserve validated temporal authority",
      { sourceRef: currentState.value.temporalAuthority?.sourceRef },
    );
  }

  const artifactId = `semantic-verification-${successorState.value.id}`;
  const proofSummary =
    parsed.value.proofSummary
      ? {
          ...parsed.value.proofSummary,
          version: 1 as const,
          intentId: currentState.value.intentId,
          intentStateId: successorState.value.id,
          intentStateHash: successorState.value.stateHash,
          sourceIntentStateId: currentState.value.id,
          sourceIntentStateHash: currentState.value.stateHash,
          generatedAt:
            parsed.value.proofSummary.generatedAt ??
            parsed.value.verification.verifiedAt,
          verifiedEvidenceRefs: parsed.value.proofSummary.verifiedEvidenceRefs ?? [],
        }
      : undefined;
  const payload = {
    schemaVersion: 1,
    intentStateId: successorState.value.id,
    intentStateHash: successorState.value.stateHash,
    intentStateVersion: successorState.value.version,
    previousIntentStateId: currentState.value.id,
    previousIntentStateHash: currentState.value.stateHash,
    previousSemanticArtifactId: currentArtifact.id,
    previousSemanticArtifactHash: currentArtifact.contentHash,
    sourceCompilationId,
    verification: parsed.value.verification,
    proofSummary,
    verifiedEvidenceRefs: parsed.value.verifiedEvidenceRefs,
    evaluatedAt: parsed.value.verification.verifiedAt,
    createdAt,
  };
  const artifactHash = hashCanonical(payload);
  const record = {
    id: artifactId,
    intentId: currentState.value.intentId,
    workflowId: currentArtifact.workflowId,
    kind: "SEMANTIC_VERIFICATION",
    payload,
    predecessors: [
      {
        id: currentArtifact.id,
        kind: currentArtifact.kind,
        contentHash: currentArtifact.contentHash,
      },
    ],
    contentHash: artifactHash,
    createdAt,
  } as const;
  const inserted = await artifacts.putIfAbsent(record);
  if (!inserted) {
    const durable = await artifacts.get(artifactId);
    if (
      !durable ||
      durable.kind !== record.kind ||
      durable.contentHash !== record.contentHash
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Semantic verification artifact replay conflict", {
        id: artifactId,
      });
    }
  }

  return ok({
    state: successorState.value,
    semanticArtifactId: artifactId,
    semanticArtifactHash: artifactHash,
  });
}
