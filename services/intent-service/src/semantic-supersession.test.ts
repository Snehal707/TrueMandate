import { describe, expect, it } from "vitest";
import { SemanticLifecycle, asIntentId, type CandidateInterpretation, type SemanticVerificationResult } from "@truemandate/protocol";
import { hashCanonical } from "@truemandate/crypto";
import { IntentService } from "./service.js";
import { supersedeSemanticVerification } from "./semantic-supersession.js";

const now = "2026-08-22T12:00:00.000Z";

function proofSummaryFor(state: { id: string; intentId: string; stateHash: string }) {
  return {
    version: 1 as const,
    intentId: state.intentId,
    intentStateId: state.id,
    intentStateHash: state.stateHash,
    packId: "travel",
    generatedAt: "2026-08-22T12:10:00.000Z",
    requiredProofObligationIds: ["proof-1"],
    proofRows: [{
      obligationId: "proof-1",
      constraintId: "c1",
      concept: "booking_provider",
      evidenceId: "ev-1-verified",
      claimId: "claim-1-verified",
      evidenceTrustClass: "ELEVATED_EXTERNAL",
      status: "SATISFIED" as const,
      reason: "matched claim concept booking_provider",
      proofMechanism: "EVIDENCE_OBLIGATION" as const,
    }],
    coverage: {
      requiredConstraintIds: ["c1"],
      derivedObligationConstraintIds: ["c1"],
      evaluatedConstraintIds: ["c1"],
      missingObligationConstraintIds: [],
      missingEvaluationConstraintIds: [],
      incompleteDeterministicRuleIds: [],
      allRequiredCovered: true,
    },
    verifiedEvidenceRefs: [{
      id: "ev-1-verified",
      hash: "c".repeat(64),
      claimIds: ["claim-1-verified"],
      trustClass: "ELEVATED_EXTERNAL" as const,
    }],
  };
}

async function setup(options: { temporalAuthority?: boolean; invalidTemporalSource?: boolean } = {}) {
  const rows = new Map<string, unknown>();
  const artifacts = {
    putIfAbsent: async (row: { id: string }) =>
      rows.has(row.id) ? false : (rows.set(row.id, row), true),
    get: async (id: string) => rows.get(id) as {
      id: string;
      intentId: string;
      workflowId: string;
      kind: string;
      payload: unknown;
      predecessors: readonly { id: string; kind: string; contentHash: string }[];
      contentHash: string;
      createdAt: string;
    } | undefined,
  };
  const intents = new IntentService(undefined, artifacts);
  const created = await intents.createIntent({
    id: asIntentId("intent-1"),
    principalId: "principal-1",
    rawText: "book travel",
    createdAt: now,
  });
  if (!created.ok) throw new Error(created.message);
  const candidate: CandidateInterpretation = {
    id: "candidate-1",
    intentId: created.value.id,
    rawIntentHash: created.value.contentHash,
    goal: "book travel",
    constraints: options.temporalAuthority
      ? [{
          id: "deadline",
          concept: "completion_deadline",
          operator: "LTE",
          value: "2026-12-31",
          kind: "TEMPORAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
          grounding: {
            sourceText: "book travel",
            sourceSpan: { start: 0, end: 11 },
            quoteExact: true,
          },
        }]
      : [],
    preferences: [],
    assumptions: [],
    ambiguities: [],
    readiness: "PLANNABLE",
    lifecycle: SemanticLifecycle.COMPILED,
    compiledAt: now,
    modelMeta: {
      modelId: "gemini-test",
      promptVersion: "test",
      schemaId: "candidate",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "req-1",
      timestamp: now,
    },
    candidateHash: "a".repeat(64),
  };
  const verification: SemanticVerificationResult = {
    id: "verification-1",
    intentId: created.value.id,
    candidateId: candidate.id,
    candidateHash: candidate.candidateHash,
    lifecycle: SemanticLifecycle.VERIFIED,
    findings: [],
    transformations: [],
    criticalFailure: false,
    readiness: "PLANNABLE",
    ambiguityClass: "A1",
    modelMeta: candidate.modelMeta,
    verifiedAt: now,
  };
  const state = await intents.finalizeVerifiedCompilation({
    intentId: created.value.id,
    candidate,
    verification,
    compilationHash: "b".repeat(64),
    ...(options.temporalAuthority
      ? {
          temporalAuthority: {
            executionNotAfter: "2026-12-31T00:00:00.000Z",
            source: "EXPLICIT_HUMAN" as const,
            sourceRef: options.invalidTemporalSource ? "missing-deadline" : "deadline",
          },
        }
      : {}),
    artifactLineage: {
      compilationId: "compilation-1",
      verificationId: verification.id,
      verificationHash: hashCanonical(verification),
      workflowId: "wf-compile",
    },
  });
  if (!state.ok) throw new Error(state.message);
  return { intents, artifacts, state: state.value };
}

describe("semantic supersession", () => {
  it("creates a successor IntentState and a new immutable semantic verification artifact", async () => {
    const { intents, artifacts, state } = await setup();
    const currentArtifact = await artifacts.get(`semantic-verification-${state.id}`);
    const result = await supersedeSemanticVerification(
      intents,
      artifacts,
      state.id,
      {
        expectedIntentStateHash: state.stateHash,
        currentSemanticArtifactHash: currentArtifact?.contentHash,
        sourceCompilationId: "compilation-1",
        verification: {
          ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
          id: "verification-2",
          verifiedAt: "2026-08-22T12:10:00.000Z",
          readiness: "ACTIONABLE",
        },
        proofSummary: proofSummaryFor(state),
        verifiedEvidenceRefs: [{ id: "ev-1-verified", hash: "c".repeat(64) }],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.previousStateId).toBe(state.id);
    expect(result.value.state.version).toBe(state.version + 1);
    const successorArtifact = await artifacts.get(result.value.semanticArtifactId);
    expect(successorArtifact?.contentHash).toBe(result.value.semanticArtifactHash);
    expect((successorArtifact?.payload as Record<string, unknown>).previousIntentStateId).toBe(state.id);
    expect((successorArtifact?.payload as Record<string, unknown>).sourceCompilationId).toBe("compilation-1");
    const proofSummary = (successorArtifact?.payload as {
      proofSummary?: {
        intentId?: string;
        intentStateId?: string;
        intentStateHash?: string;
        sourceIntentStateId?: string;
        sourceIntentStateHash?: string;
      };
    }).proofSummary;
    expect(proofSummary).toMatchObject({
      intentId: state.intentId,
      intentStateId: result.value.state.id,
      intentStateHash: result.value.state.stateHash,
      sourceIntentStateId: state.id,
      sourceIntentStateHash: state.stateHash,
    });
  });

  it("fails closed for divergent replay on the same immutable successor artifact id", async () => {
    const { intents, artifacts, state } = await setup();
    const currentArtifact = await artifacts.get(`semantic-verification-${state.id}`);
    const first = await supersedeSemanticVerification(
      intents,
      artifacts,
      state.id,
      {
        expectedIntentStateHash: state.stateHash,
        currentSemanticArtifactHash: currentArtifact?.contentHash,
        sourceCompilationId: "compilation-1",
        verification: {
          ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
          id: "verification-2",
          verifiedAt: "2026-08-22T12:10:00.000Z",
          readiness: "ACTIONABLE",
        },
      },
    );
    expect(first.ok).toBe(true);

    const second = await supersedeSemanticVerification(
      intents,
      artifacts,
      state.id,
      {
        expectedIntentStateHash: state.stateHash,
        currentSemanticArtifactHash: currentArtifact?.contentHash,
        sourceCompilationId: "compilation-1",
        verification: {
          ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
          id: "verification-3",
          verifiedAt: "2026-08-22T12:11:00.000Z",
          readiness: "EXECUTABLE",
        },
      },
    );
    expect(second.ok).toBe(false);
  });

  it("fails closed on an inconsistent privileged-ready blocking ambiguity", async () => {
    const { intents, artifacts, state } = await setup();
    const currentArtifact = await artifacts.get(`semantic-verification-${state.id}`);
    const result = await supersedeSemanticVerification(intents, artifacts, state.id, {
      expectedIntentStateHash: state.stateHash,
      currentSemanticArtifactHash: currentArtifact?.contentHash,
      sourceCompilationId: "compilation-1",
      verification: {
        ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
        id: "verification-inconsistent",
        verifiedAt: "2026-08-22T12:10:00.000Z",
        readiness: "ACTIONABLE",
        lifecycle: "AMBIGUOUS",
        ambiguityClass: "A2",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SEMANTIC_READINESS_INSUFFICIENT");
  });

  it("preserves a valid temporal authority and its current sourceRef", async () => {
    const { intents, artifacts, state } = await setup({ temporalAuthority: true });
    const currentArtifact = await artifacts.get(`semantic-verification-${state.id}`);
    const result = await supersedeSemanticVerification(intents, artifacts, state.id, {
      expectedIntentStateHash: state.stateHash,
      currentSemanticArtifactHash: currentArtifact?.contentHash,
      sourceCompilationId: "compilation-1",
      verification: {
        ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
        id: "verification-temporal-successor",
        verifiedAt: "2026-08-22T12:10:00.000Z",
        readiness: "ACTIONABLE",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.temporalAuthority).toEqual(state.temporalAuthority);
    expect(result.value.state.constraints.some(
      (constraint) => constraint.id === result.value.state.temporalAuthority?.sourceRef,
    )).toBe(true);
  });

  it("fails closed when inherited temporal authority has no current source constraint", async () => {
    const { intents, artifacts, state } = await setup({
      temporalAuthority: true,
      invalidTemporalSource: true,
    });
    const currentArtifact = await artifacts.get(`semantic-verification-${state.id}`);
    const result = await supersedeSemanticVerification(intents, artifacts, state.id, {
      expectedIntentStateHash: state.stateHash,
      currentSemanticArtifactHash: currentArtifact?.contentHash,
      sourceCompilationId: "compilation-1",
      verification: {
        ...(currentArtifact?.payload as { verification: SemanticVerificationResult }).verification,
        id: "verification-invalid-temporal-source",
        verifiedAt: "2026-08-22T12:10:00.000Z",
        readiness: "ACTIONABLE",
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("temporal authority source");
  });
});
