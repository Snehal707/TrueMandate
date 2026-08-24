import { hashCanonical } from "@truemandate/crypto";
import { SemanticLifecycle, type CandidateInterpretation, type SemanticVerificationResult } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { candidateConstraintProvenanceNodeId } from "@truemandate/provenance";
import { describe, expect, it } from "vitest";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";
import { IntentService } from "./service.js";

const NOW = "2026-08-22T06:55:43.387Z";

function fixtureCandidate(rawIntentHash: string): CandidateInterpretation {
  return {
    id: "candidate-travel-finalize",
    intentId: "intent-travel-finalize",
    rawIntentHash,
    goal: "Book 2 refundable hotel stays",
    constraints: [
      {
        id: "c4",
        concept: "stay_date",
        operator: "EQ",
        value: "2026-12-20",
        kind: "TEMPORAL",
        importance: 1,
        confidence: 1,
        sourceType: "HUMAN",
        mutability: "IMMUTABLE",
        meaningClass: "EXPLICIT",
        grounding: {
          sourceText: "December 20, 2026",
          sourceSpan: { start: 97, end: 114 },
          quoteExact: true,
        },
        temporalResolution: {
          originalExpression: "December 20, 2026",
          resolvedValue: "2026-12-20",
          resolutionTimestamp: "2026-08-22T00:00:00Z",
          timezone: "UTC",
        },
      },
      {
        id: "c5",
        concept: "completion_deadline",
        operator: "LT",
        value: "2026-12-31",
        kind: "TEMPORAL",
        importance: 1,
        confidence: 1,
        sourceType: "HUMAN",
        mutability: "IMMUTABLE",
        meaningClass: "EXPLICIT",
        grounding: {
          sourceText: "complete the booking before December 31, 2026",
          sourceSpan: { start: 133, end: 178 },
          quoteExact: true,
        },
        temporalResolution: {
          originalExpression: "complete the booking before December 31, 2026",
          resolvedValue: "2026-12-31T00:00:00Z",
          resolutionTimestamp: "2026-08-22T00:00:00Z",
          timezone: "UTC",
        },
      },
    ],
    preferences: [],
    assumptions: [],
    ambiguities: [],
    readiness: "ACTIONABLE",
    lifecycle: SemanticLifecycle.COMPILED,
    compiledAt: NOW,
    modelMeta: {
      modelId: "intent-compiler",
      modelVersion: "gemini-3.7-flash",
      promptVersion: "v1",
      schemaId: "compiler.candidate.v1",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "compile-intent-travel-finalize",
      timestamp: NOW,
    },
    candidateHash: "a".repeat(64),
  };
}

function fixtureVerification(candidate: CandidateInterpretation): SemanticVerificationResult {
  return {
    id: "verdict-travel-finalize",
    intentId: candidate.intentId,
    candidateId: candidate.id,
    candidateHash: candidate.candidateHash,
    lifecycle: SemanticLifecycle.VERIFIED,
    findings: [],
    transformations: [],
    criticalFailure: false,
    readiness: "PLANNABLE",
    ambiguityClass: "A1",
    modelMeta: {
      modelId: "intent-verifier",
      modelVersion: "gemini-3.7-flash",
      promptVersion: "v1",
      schemaId: "verifier.result.v1",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "verify-intent-travel-finalize",
      timestamp: NOW,
    },
    verifiedAt: NOW,
    modelProposedReadiness: "PLANNABLE",
    modelProposedAmbiguityClass: "A1",
  };
}

describe("owner compilation finalization route", () => {
  it.each([
    { withTemporalResolution: true, mismatchedValue: false, expectedSourceRef: "c5" },
    { withTemporalResolution: false, mismatchedValue: false, expectedSourceRef: "c5" },
    { withTemporalResolution: false, mismatchedValue: true, expectedSourceRef: undefined },
  ])(
    "derives only a grounded absolute execution deadline: %o",
    async ({ withTemporalResolution, mismatchedValue, expectedSourceRef }) => {
    const intents = new IntentService();
    const created = await intents.createIntent({
      id: "intent-travel-finalize",
      principalId: "wave4-proof-user",
      rawText: "Book exactly 2 refundable hotel stays at Seaside Lodge from approved provider Travel Provider on December 20, 2026 for USD 3200, and complete the booking before December 31, 2026.",
      createdAt: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const baseCandidate = fixtureCandidate(created.value.contentHash);
    const candidate: CandidateInterpretation = withTemporalResolution
      ? baseCandidate
      : {
          ...baseCandidate,
          constraints: baseCandidate.constraints.map((constraint) => {
            if (constraint.id !== "c5") return constraint;
            const { temporalResolution: _omitted, ...withoutResolution } = constraint;
            return {
              ...withoutResolution,
              value: mismatchedValue ? "2027-12-31" : withoutResolution.value,
            };
          }),
        };
    const verification = fixtureVerification(candidate);
    const compilationPayload = {
      schemaVersion: 1,
      rawIntentId: created.value.id,
      rawIntentHash: created.value.contentHash,
      intentRootNodeId: `intent-node-${created.value.id}`,
      candidate,
      candidateHash: candidate.candidateHash,
      provenanceNodeIds: candidate.constraints.map((constraint) =>
        candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id),
      ),
      createdAt: NOW,
    };
    const compilation = {
      id: `compilation-${created.value.id}-${candidate.candidateHash.slice(0, 16)}`,
      intentId: created.value.id,
      workflowId: `compilation-${created.value.id}`,
      kind: "COMPILATION" as const,
      payload: compilationPayload,
      predecessors: [],
      contentHash: hashCanonical(compilationPayload),
      createdAt: NOW,
    };
    const verificationPayload = {
      schemaVersion: 1,
      compilationId: compilation.id,
      compilationHash: compilation.contentHash,
      rawIntentId: created.value.id,
      rawIntentHash: created.value.contentHash,
      verification,
      groundedTemporalConstraintIds: ["c4", "c5"],
      provenanceNodeIds: candidate.constraints.map((constraint) =>
        candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id),
      ),
      createdAt: NOW,
    };
    const verificationArtifact = {
      id: `compilation-verification-${verification.id}`,
      intentId: created.value.id,
      workflowId: `compilation-${created.value.id}`,
      kind: "COMPILATION_VERIFICATION" as const,
      payload: verificationPayload,
      predecessors: [{ id: compilation.id, kind: "COMPILATION", contentHash: compilation.contentHash }],
      contentHash: hashCanonical(verificationPayload),
      createdAt: NOW,
    };
    const rows = new Map<string, typeof compilation | typeof verificationArtifact>();
    rows.set(compilation.id, compilation);
    rows.set(verificationArtifact.id, verificationArtifact);
    const durableProvenanceRows = new Map(
      candidate.constraints.map((constraint) => [
        candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id),
        {
          payload: {
            id: candidateConstraintProvenanceNodeId(candidate.candidateHash, constraint.id),
            taint: { classes: ["NONE"], origins: [] },
          },
        },
      ]),
    );
    const routes = createIntentProvenanceInternalRoutes({
      intents,
      provenance: new ProvenanceService(),
      semanticArtifacts: {
        putIfAbsent: async () => true,
        get: async (id) => rows.get(id),
        listWorkflow: async () => [],
      },
      durableProvenance: {
        getNode: async (id) => durableProvenanceRows.get(id),
        getEdge: async () => undefined,
      },
    });
    const finalize = routes.find((route) => route.pattern === "/internal/compilations/finalize");
    expect(finalize).toBeDefined();
    if (!finalize) return;

    const response = await finalize.handler({
      params: {},
      headers: {},
      body: {
        compilationId: compilation.id,
        compilationHash: compilation.contentHash,
        verificationId: verificationArtifact.id,
        verificationHash: verificationArtifact.contentHash,
      },
    });
    expect(response.status).toBe(200);
    const state = response.body as { temporalAuthority?: { sourceRef?: string; executionNotAfter?: string } };
    expect(state.temporalAuthority?.sourceRef).toBe(expectedSourceRef);
    expect(state.temporalAuthority?.executionNotAfter).toBe(
      expectedSourceRef ? "2026-12-31T00:00:00.000Z" : undefined,
    );
    },
  );
});
