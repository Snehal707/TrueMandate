import { describe, expect, it } from "vitest";
import {
  assessProofCoverage,
  PreExecutionReadinessService,
} from "./pre-execution-readiness.js";
import { TravelDomainPack } from "./travel-domain-pack.js";
import { SemanticLifecycle, type CandidateInterpretation, type IntentState, type SemanticVerificationResult } from "@truemandate/protocol";
import {
  classifyRequiredProofCoverage,
  deriveRequiredProofObligations,
} from "@truemandate/semantic-readiness";

const state: IntentState = {
  id: "state-1" as IntentState["id"],
  intentId: "intent-1" as IntentState["intentId"],
  rawIntentHash: "a".repeat(64) as IntentState["rawIntentHash"],
  version: 1,
  constraints: [
    {
      id: "c-provider" as never,
      concept: "approved_provider",
      operator: "REQUIRE",
      value: true,
      kind: "HARD",
      importance: 1,
      confidence: 1,
      sourceType: "HUMAN",
      sourceText: "approved provider",
      mutability: "IMMUTABLE",
      meaningClass: "EXPLICIT",
    },
    {
      id: "c-stay-count" as never,
      concept: "hotel_stay_count",
      operator: "EQ",
      value: 2,
      kind: "HARD",
      importance: 1,
      confidence: 1,
      sourceType: "HUMAN",
      sourceText: "2 guests",
      mutability: "IMMUTABLE",
      meaningClass: "EXPLICIT",
    },
    {
      id: "c-stay-date" as never,
      concept: "stay_start_date",
      operator: "EQ",
      value: "2026-12-20T00:00:00.000Z",
      kind: "TEMPORAL",
      importance: 1,
      confidence: 1,
      sourceType: "HUMAN",
      sourceText: "Dec 20",
      mutability: "IMMUTABLE",
      meaningClass: "EXPLICIT",
    },
    {
      id: "c-deadline" as never,
      concept: "completion_deadline",
      operator: "LTE",
      value: "2026-12-31T00:00:00.000Z",
      kind: "TEMPORAL",
      importance: 1,
      confidence: 1,
      sourceType: "HUMAN",
      sourceText: "before Dec 31",
      mutability: "IMMUTABLE",
      meaningClass: "EXPLICIT",
    },
  ],
  assumptions: [],
  createdAt: "2026-08-22T12:00:00.000Z",
  createdBy: "principal-1" as IntentState["createdBy"],
  stateHash: "b".repeat(64) as IntentState["stateHash"],
  temporalAuthority: {
    executionNotAfter: "2026-12-31T00:00:00.000Z",
    source: "EXPLICIT_HUMAN",
    sourceRef: "c-deadline" as never,
  },
};

const verification: SemanticVerificationResult = {
  id: "verification-1",
  intentId: state.intentId,
  candidateId: "candidate-1",
  candidateHash: "c".repeat(64) as never,
  lifecycle: "AMBIGUOUS",
  findings: [],
  transformations: [],
  criticalFailure: false,
  readiness: "PLANNABLE",
  ambiguityClass: "A2",
  modelProposedAmbiguityClass: "A2",
  modelMeta: {
    modelId: "gemini-test",
    promptVersion: "test",
    schemaId: "semantic-verification",
    schemaVersion: "1",
    protocolVersion: "0.1.0",
    requestId: "req-1",
    timestamp: "2026-08-22T12:00:00.000Z",
  },
  verifiedAt: "2026-08-22T12:00:00.000Z",
};

const candidate: CandidateInterpretation = {
  id: verification.candidateId,
  intentId: state.intentId,
  rawIntentHash: state.rawIntentHash,
  goal: "Book verified travel",
  constraints: state.constraints.map((constraint) => ({
    id: constraint.id,
    concept: constraint.concept,
    operator: constraint.operator,
    value: constraint.value as string | number | boolean,
    kind: constraint.kind,
    importance: constraint.importance,
    confidence: constraint.confidence,
    sourceType: constraint.sourceType,
    mutability: constraint.mutability,
    meaningClass: constraint.meaningClass,
    grounding: {
      sourceText: constraint.sourceText,
      quoteExact: true,
    },
  })),
  preferences: [],
  assumptions: [],
  ambiguities: [
    {
      id: "amb-approved-provider",
      description: "Specific list or registry of approved providers is not defined",
      ambiguityClass: "A2",
      relatedConcepts: ["provider_approval_status", "approved_provider"],
      sourceText: "approved provider",
    },
  ],
  readiness: "PLANNABLE",
  lifecycle: SemanticLifecycle.COMPILED,
  compiledAt: "2026-08-22T12:00:00.000Z",
  modelMeta: verification.modelMeta,
  candidateHash: verification.candidateHash,
};

function service(overrides?: {
  getEnvelope?: (id: string) => Promise<unknown>;
  getClaim?: (id: string) => Promise<unknown>;
  supersede?: (stateId: string, body: unknown) => Promise<unknown>;
  candidate?: CandidateInterpretation;
}) {
  return new PreExecutionReadinessService({
    intents: {
      getCurrentStateForIntent: async () => ({ ok: true, value: state }),
      getVerificationForState: async () => ({ ok: true, value: verification }),
    } as never,
    owner: {
      getSemanticArtifact: async (id: string) =>
        id === "compilation-1"
          ? ({
              ok: true,
              value: {
                id,
                intentId: state.intentId,
                kind: "COMPILATION",
                contentHash: "e".repeat(64),
                payload: { candidate: overrides?.candidate ?? candidate },
              },
            })
          : ({
              ok: true,
              value: {
                id: `semantic-verification-${state.id}`,
                intentId: state.intentId,
                kind: "SEMANTIC_VERIFICATION",
                contentHash: "d".repeat(64),
                payload: { verification, compilationId: "compilation-1" },
              },
            }),
      supersedeSemanticVerification: async (stateId: string, body: unknown) =>
        ({ ok: true, value: { stateId, body } }),
      ...(
        overrides?.supersede
          ? {
              supersedeSemanticVerification: async (
                stateId: string,
                body: unknown,
              ) => overrides.supersede!(stateId, body) as never,
            }
          : {}
      ),
    } as never,
    evidence: {
      getEnvelope: async (id: string) =>
        ({
          ok: true,
          value: {
            id,
            source: "verified-evidence",
            contentHash: `${id}-hash`.padEnd(64, "e").slice(0, 64),
            trustClass: "ELEVATED_EXTERNAL",
            captureTime: "2026-08-22T12:00:00.000Z",
            taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
          },
        }),
      getClaim: async (id: string) =>
        ({
          ok: true,
          value:
            id === "claim-provider"
              ? {
                  id,
                  evidenceId: "ev-provider",
                  concept: "approved_provider",
                  value: { approved: true, provider: "Taj Hotels" },
                  confidence: 1,
                  derivedBy: "verified-evidence:verify-1",
                  taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                }
              : id === "claim-stay-count"
                ? {
                    id,
                    evidenceId: "ev-count",
                    concept: "hotel_stay_count",
                    value: 2,
                    confidence: 1,
                    derivedBy: "verified-evidence:verify-1",
                    taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                  }
                : id === "claim-deadline"
                  ? {
                      id,
                      evidenceId: "ev-deadline",
                      concept: "completion_deadline",
                      value: "2026-12-30T00:00:00.000Z",
                      confidence: 1,
                      derivedBy: "verified-evidence:verify-1",
                      taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                    }
                : {
                    id,
                    evidenceId: "ev-date",
                    concept: "stay_start_date",
                    value: "2026-12-20T00:00:00.000Z",
                    confidence: 1,
                    derivedBy: "verified-evidence:verify-1",
                    taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                  },
        }),
      ...(overrides?.getEnvelope ? { getEnvelope: overrides.getEnvelope } : {}),
      ...(overrides?.getClaim ? { getClaim: overrides.getClaim } : {}),
    } as never,
    registry: {
      get: async () => ({
        ok: true,
        value: {
          packId: "travel",
          pack: TravelDomainPack,
          toEngineInput: () => ({ ok: false, code: "VALIDATION_FAILED", message: "unused" }),
        },
      }),
    } as never,
    now: () => "2026-08-22T12:05:00.000Z",
  });
}

describe("PreExecutionReadinessService", () => {
  it("normalizes booking_provider_approval phrases against verified approval facts", async () => {
    const liveShapeState: IntentState = {
      ...state,
      constraints: state.constraints.map((constraint) =>
        constraint.id === "c-provider" as never
          ? {
              ...constraint,
              concept: "booking_provider_approval",
              value: "approved provider",
            }
          : constraint,
      ),
    };
    const liveShapeCandidate: CandidateInterpretation = {
      ...candidate,
      constraints: candidate.constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "booking_provider_approval",
              value: "approved provider",
            }
          : constraint,
      ),
      ambiguities: [
        {
          id: "amb-booking-provider-approval",
          description: "Specific list or registry of approved providers is not defined",
          ambiguityClass: "A2",
          relatedConcepts: ["booking_provider_approval", "provider_approval_status"],
          sourceText: "approved provider",
        },
      ],
    };
    const result = await new PreExecutionReadinessService({
      intents: {
        getCurrentStateForIntent: async () => ({ ok: true, value: liveShapeState }),
        getVerificationForState: async () => ({ ok: true, value: verification }),
      } as never,
      owner: {
        getSemanticArtifact: async (id: string) =>
          id === "compilation-1"
            ? ({
                ok: true,
                value: {
                  id,
                  intentId: liveShapeState.intentId,
                  kind: "COMPILATION",
                  contentHash: "e".repeat(64),
                  payload: { candidate: liveShapeCandidate },
                },
              })
            : ({
                ok: true,
                value: {
                  id: `semantic-verification-${liveShapeState.id}`,
                  intentId: liveShapeState.intentId,
                  kind: "SEMANTIC_VERIFICATION",
                  contentHash: "d".repeat(64),
                  payload: { verification, compilationId: "compilation-1" },
                },
              }),
        supersedeSemanticVerification: async (stateId: string) =>
          ({ ok: true, value: { stateId, successor: "state-2" } }),
      } as never,
      evidence: {
        getEnvelope: async (id: string) =>
          ({
            ok: true,
            value: {
              id,
              source: "verified-evidence",
              contentHash: `${id}-hash`.padEnd(64, "e").slice(0, 64),
              trustClass: "ELEVATED_EXTERNAL",
              captureTime: "2026-08-22T12:00:00.000Z",
              taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
            },
          }),
        getClaim: async (id: string) =>
          ({
            ok: true,
            value:
              id === "claim-provider"
                ? {
                    id,
                    evidenceId: "ev-provider",
                    concept: "booking_provider_approval",
                    value: { approved: true, provider: "Taj Hotels" },
                    confidence: 1,
                    derivedBy: "verified-evidence:verify-1",
                    taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                  }
                : id === "claim-stay-count"
                  ? {
                      id,
                      evidenceId: "ev-count",
                      concept: "hotel_stay_count",
                      value: 2,
                      confidence: 1,
                      derivedBy: "verified-evidence:verify-1",
                      taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                    }
                  : id === "claim-deadline"
                    ? {
                        id,
                        evidenceId: "ev-deadline",
                        concept: "completion_deadline",
                        value: "2026-12-30T00:00:00.000Z",
                        confidence: 1,
                        derivedBy: "verified-evidence:verify-1",
                        taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                      }
                    : {
                        id,
                        evidenceId: "ev-date",
                        concept: "stay_start_date",
                        value: "2026-12-20T00:00:00.000Z",
                        confidence: 1,
                        derivedBy: "verified-evidence:verify-1",
                        taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                      },
          }),
      } as never,
      registry: {
        get: async () => ({
          ok: true,
          value: {
            packId: "travel",
            pack: TravelDomainPack,
            toEngineInput: () => ({ ok: false, code: "VALIDATION_FAILED", message: "unused" }),
          },
        }),
      } as never,
      now: () => "2026-08-22T12:05:00.000Z",
    }).evaluate({
      packId: "travel",
      intentId: liveShapeState.intentId,
      intentStateId: liveShapeState.id,
      expectedIntentStateHash: liveShapeState.stateHash,
      verifiedEvidenceIds: ["ev-provider", "ev-count", "ev-date", "ev-deadline"],
      verifiedClaimIds: ["claim-provider", "claim-stay-count", "claim-stay-date", "claim-deadline"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value as {
        proofRows: Array<{ constraintId?: string; status: string }>;
      }).proofRows,
    ).toContainEqual(expect.objectContaining({ constraintId: "c-provider", status: "SATISFIED" }));
  });

  it("satisfies a named approved_provider constraint only when verified approval and provider identity both match", async () => {
    const liveShapeState: IntentState = {
      ...state,
      constraints: state.constraints.map((constraint) =>
        constraint.id === "c-provider" as never
          ? {
              ...constraint,
              concept: "approved_provider",
              operator: "EQ",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const result = await service({
      getCurrentStateForIntent: async () => ({ ok: true, value: liveShapeState }),
      getCurrentStateById: async () => ({ ok: true, value: liveShapeState }),
      getVerificationForState: async () => ({ ok: true, value: verification }),
    } as never, {
      getSemanticArtifact: async () => ({
        ok: true,
        value: {
          id: `semantic-verification-${liveShapeState.id}`,
          intentId: liveShapeState.intentId,
          kind: "SEMANTIC_VERIFICATION",
          contentHash: "d".repeat(64),
          payload: { verification, compilationId: "compilation-1" },
        },
      }),
      supersedeSemanticVerification: async (stateId: string) =>
        ({ ok: true, value: { stateId, successor: "state-2" } }),
    } as never, {
      getEnvelope: async (id: string) =>
        ({
          ok: true,
          value: {
            id,
            source: "verified-evidence",
            contentHash: `${id}-hash`.padEnd(64, "e").slice(0, 64),
            trustClass: "ELEVATED_EXTERNAL",
            captureTime: "2026-08-22T12:00:00.000Z",
            taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
          },
        }),
      getClaim: async (id: string) =>
        ({
          ok: true,
          value:
            id === "claim-provider"
              ? {
                  id,
                  evidenceId: "ev-provider",
                  concept: "booking_provider_approval",
                  value: { approved: true, provider: "Meridian Travel Partners" },
                  confidence: 1,
                  derivedBy: "verified-evidence:verify-1",
                  taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                }
              : {
                  id,
                  evidenceId: "ev-date",
                  concept: "stay_start_date",
                  value: "2026-12-20T00:00:00.000Z",
                  confidence: 1,
                  derivedBy: "verified-evidence:verify-1",
                  taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                },
        }),
    } as never).evaluate({
      packId: "travel",
      intentId: liveShapeState.intentId,
      intentStateId: liveShapeState.id,
      expectedIntentStateHash: liveShapeState.stateHash,
      verifiedEvidenceIds: ["ev-provider", "ev-date"],
      verifiedClaimIds: ["claim-provider", "claim-date"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proofRows).toContainEqual(
      expect.objectContaining({ constraintId: "c-provider", status: "SATISFIED" }),
    );
  });

  it("keeps booking_provider identity separate from booking_provider_approval facts", async () => {
    const liveShapeState: IntentState = {
      ...state,
      constraints: state.constraints.map((constraint) =>
        constraint.id === "c-provider" as never
          ? {
              ...constraint,
              concept: "booking_provider",
              operator: "EQ",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const liveShapeCandidate: CandidateInterpretation = {
      ...candidate,
      constraints: candidate.constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "booking_provider",
              operator: "EQ",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const result = await new PreExecutionReadinessService({
      intents: {
        getCurrentStateForIntent: async () => ({ ok: true, value: liveShapeState }),
        getVerificationForState: async () => ({ ok: true, value: verification }),
      } as never,
      owner: {
        getSemanticArtifact: async (id: string) =>
          id === "compilation-1"
            ? ({
                ok: true,
                value: {
                  id,
                  intentId: liveShapeState.intentId,
                  kind: "COMPILATION",
                  contentHash: "e".repeat(64),
                  payload: { candidate: liveShapeCandidate },
                },
              })
            : ({
                ok: true,
                value: {
                  id: `semantic-verification-${liveShapeState.id}`,
                  intentId: liveShapeState.intentId,
                  kind: "SEMANTIC_VERIFICATION",
                  contentHash: "d".repeat(64),
                  payload: { verification, compilationId: "compilation-1" },
                },
              }),
        supersedeSemanticVerification: async (stateId: string) =>
          ({ ok: true, value: { stateId, successor: "state-2" } }),
      } as never,
      evidence: {
        getEnvelope: async (id: string) =>
          ({
            ok: true,
            value: {
              id,
              source: "verified-evidence",
              contentHash: `${id}-hash`.padEnd(64, "e").slice(0, 64),
              trustClass: "ELEVATED_EXTERNAL",
              captureTime: "2026-08-22T12:00:00.000Z",
              taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
            },
          }),
        getClaim: async (id: string) =>
          ({
            ok: true,
            value:
              id === "claim-provider-identity"
                ? {
                    id,
                    evidenceId: "ev-provider",
                    concept: "booking_provider",
                    value: "Meridian Travel Partners",
                    confidence: 1,
                    derivedBy: "verified-evidence:verify-1",
                    taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                  }
                : id === "claim-provider-approval"
                  ? {
                      id,
                      evidenceId: "ev-provider",
                      concept: "booking_provider_approval",
                      value: { approved: true, provider: "Meridian Travel Partners" },
                      confidence: 1,
                      derivedBy: "verified-evidence:verify-1",
                      taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                    }
                  : id === "claim-stay-count"
                    ? {
                        id,
                        evidenceId: "ev-count",
                        concept: "hotel_stay_count",
                        value: 2,
                        confidence: 1,
                        derivedBy: "verified-evidence:verify-1",
                        taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                      }
                    : id === "claim-deadline"
                      ? {
                          id,
                          evidenceId: "ev-deadline",
                          concept: "completion_deadline",
                          value: "2026-12-30T00:00:00.000Z",
                          confidence: 1,
                          derivedBy: "verified-evidence:verify-1",
                          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                        }
                      : {
                          id,
                          evidenceId: "ev-date",
                          concept: "stay_start_date",
                          value: "2026-12-20T00:00:00.000Z",
                          confidence: 1,
                          derivedBy: "verified-evidence:verify-1",
                          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                        },
          }),
      } as never,
      registry: {
        get: async () => ({
          ok: true,
          value: {
            packId: "travel",
            pack: TravelDomainPack,
            toEngineInput: () => ({ ok: false, code: "VALIDATION_FAILED", message: "unused" }),
          },
        }),
      } as never,
      now: () => "2026-08-22T12:05:00.000Z",
    }).evaluate({
      packId: "travel",
      intentId: liveShapeState.intentId,
      intentStateId: liveShapeState.id,
      expectedIntentStateHash: liveShapeState.stateHash,
      verifiedEvidenceIds: ["ev-provider", "ev-count", "ev-date", "ev-deadline"],
      verifiedClaimIds: [
        "claim-provider-identity",
        "claim-provider-approval",
        "claim-stay-count",
        "claim-stay-date",
        "claim-deadline",
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      proofRows: Array<{ constraintId?: string; status: string; reason: string }>;
    };
    expect(value.proofRows).toContainEqual(
      expect.objectContaining({
        constraintId: "c-provider",
        status: "SATISFIED",
        reason: expect.stringContaining("matched claim concept booking_provider"),
      }),
    );
  });

  it("does not let provider identity evidence satisfy provider approval", async () => {
    const result = await service({
      getClaim: async (id) => ({
        ok: true,
        value: {
          id,
          evidenceId: "ev-provider",
          concept: "booking_provider",
          value: "Meridian Travel Partners",
          confidence: 1,
          derivedBy: "verified-evidence:verify-1",
          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
        },
      }),
    }).evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      verifiedEvidenceIds: ["ev-provider"],
      verifiedClaimIds: ["claim-provider"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ superseded: false });
    expect(
      (result.value as { proofRows: Array<{ constraintId?: string; status: string }> }).proofRows,
    ).toContainEqual(expect.objectContaining({ constraintId: "c-provider", status: "UNKNOWN" }));
  });

  it("detects missing required execution-critical proof coverage deterministically", () => {
    const requirements = classifyRequiredProofCoverage(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: TravelDomainPack.planning,
    });
    const obligations = deriveRequiredProofObligations(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: TravelDomainPack.planning,
    });
    const coverage = assessProofCoverage(
      requirements,
      obligations,
      [
        {
          obligationId: "o-provider",
          constraintId: "c-provider",
          concept: "approved_provider",
          evidenceId: "ev-provider",
          claimId: "claim-provider",
          evidenceTrustClass: "ELEVATED_EXTERNAL",
          status: "SATISFIED",
          reason: "matched",
          proofMechanism: "EVIDENCE_OBLIGATION",
        },
        {
          obligationId: "o-stay-date",
          constraintId: "c-stay-date",
          concept: "stay_start_date",
          evidenceId: "ev-date",
          claimId: "claim-stay-date",
          evidenceTrustClass: "ELEVATED_EXTERNAL",
          status: "SATISFIED",
          reason: "matched",
          proofMechanism: "EVIDENCE_OBLIGATION",
        },
      ],
    );

    expect(coverage.allRequiredCovered).toBe(false);
    expect(coverage.missingObligationConstraintIds).toEqual([]);
    expect(coverage.missingEvaluationConstraintIds).toEqual(["c-deadline", "c-stay-count"]);
  });

  it("detects a deliberately broken obligation derivation independently", () => {
    const requirements = classifyRequiredProofCoverage(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: TravelDomainPack.planning,
    });
    const obligations = deriveRequiredProofObligations(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: TravelDomainPack.planning,
    }).filter((row) => row.constraintId !== "c-stay-date");
    const coverage = assessProofCoverage(requirements, obligations, []);

    expect(coverage.requiredConstraintIds).toContain("c-stay-date");
    expect(coverage.derivedObligationConstraintIds).not.toContain("c-stay-date");
    expect(coverage.missingObligationConstraintIds).toContain("c-stay-date");
    expect(coverage.allRequiredCovered).toBe(false);
  });

  it("requires an explicit satisfied result for deterministic proof rules", () => {
    const coverage = assessProofCoverage(
      [{
        constraintId: "c-deterministic",
        originalConcept: "deterministic_check",
        canonicalConcept: "deterministic_check",
        reason: "DOMAIN_EXECUTION_CRITICAL",
        proofMechanism: { kind: "DETERMINISTIC_RULE", ruleId: "rule-1" },
      }],
      [],
      [],
    );

    expect(coverage.incompleteDeterministicRuleIds).toEqual(["rule-1"]);
    expect(coverage.allRequiredCovered).toBe(false);
  });

  it("supersedes semantic readiness when verified travel evidence satisfies execution-critical obligations", async () => {
    const seen: Array<{ stateId: string; body: unknown }> = [];
    const result = await service({
      supersede: async (stateId, body) => {
        seen.push({ stateId, body });
        return { ok: true, value: { stateId, successor: "state-2" } };
      },
    }).evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      expectedIntentStateHash: state.stateHash,
      verifiedEvidenceIds: ["ev-provider", "ev-count", "ev-date", "ev-deadline"],
      verifiedClaimIds: ["claim-provider", "claim-stay-count", "claim-stay-date", "claim-deadline"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      superseded: true,
    });
    expect((result.value as { coverage: { allRequiredCovered: boolean } }).coverage.allRequiredCovered).toBe(true);
    expect(seen).toHaveLength(1);
    const body = seen[0]?.body as {
      sourceCompilationId?: string;
      verification?: SemanticVerificationResult;
      proofSummary?: { ambiguityResolution?: { resolvedAmbiguityIds?: string[] } };
    };
    expect(body.sourceCompilationId).toBe("compilation-1");
    expect(body.verification).toMatchObject({
      lifecycle: "VERIFIED",
      readiness: "ACTIONABLE",
      ambiguityClass: "A0",
    });
    expect(body.verification?.id).not.toBe(verification.id);
    expect(body.proofSummary?.ambiguityResolution?.resolvedAmbiguityIds).toEqual([
      "amb-approved-provider",
    ]);
  });

  it("does not supersede readiness when required verified evidence is missing", async () => {
    const result = await service().evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      verifiedEvidenceIds: ["ev-provider"],
      verifiedClaimIds: ["claim-provider"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      superseded: false,
      readiness: "PLANNABLE",
    });
    expect(
      (result.value as { coverage: { allRequiredCovered: boolean } }).coverage.allRequiredCovered,
    ).toBe(true);
    expect(
      (
        result.value as {
          proofRows: Array<{ constraintId?: string; status?: string }>;
        }
      ).proofRows.filter((row) => row.status === "UNKNOWN").map((row) => row.constraintId).sort(),
    ).toEqual(["c-deadline", "c-stay-count", "c-stay-date"]);
  });

  it("does not supersede when verified evidence is unsatisfied", async () => {
    const result = await service({
      getClaim: async (id) => ({
        ok: true,
        value: {
          id,
          evidenceId: "ev-provider",
          concept: "approved_provider",
          value: false,
          confidence: 1,
          derivedBy: "verified-evidence:verify-1",
          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
        },
      }),
    }).evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      verifiedEvidenceIds: ["ev-provider"],
      verifiedClaimIds: ["claim-provider"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ superseded: false });
    expect((result.value as { proofRows: Array<{ constraintId?: string; status: string }> }).proofRows)
      .toContainEqual(expect.objectContaining({ constraintId: "c-provider", status: "UNSATISFIED" }));
  });

  it("fails closed on contradictory verified claims for one canonical constraint", async () => {
    const result = await service({
      getClaim: async (id) => ({
        ok: true,
        value: {
          id,
          evidenceId: id.endsWith("one") ? "ev-provider-one" : "ev-provider-two",
          concept: id.endsWith("one") ? "approved_provider" : "provider_approval_status",
          value: id.endsWith("one") ? true : false,
          confidence: 1,
          derivedBy: "verified-evidence:verify-1",
          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
        },
      }),
    }).evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      verifiedEvidenceIds: ["ev-provider-one", "ev-provider-two"],
      verifiedClaimIds: ["claim-provider-one", "claim-provider-two"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ superseded: false });
    expect((result.value as { proofRows: Array<{ constraintId?: string; status: string; reason: string }> }).proofRows)
      .toContainEqual(expect.objectContaining({
        constraintId: "c-provider",
        status: "UNSATISFIED",
        reason: expect.stringContaining("contradictory verified claims"),
      }));
  });

  it("binds verified deadline evidence to the completion_deadline proof row", async () => {
    const result = await service().evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      expectedIntentStateHash: state.stateHash,
      verifiedEvidenceIds: ["ev-provider", "ev-count", "ev-date", "ev-deadline"],
      verifiedClaimIds: ["claim-provider", "claim-stay-count", "claim-stay-date", "claim-deadline"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const deadlineRow = (
      result.value as {
        proofRows: Array<{
          constraintId?: string;
          evidenceId?: string;
          claimId?: string;
          status?: string;
        }>;
      }
    ).proofRows.find((row) => row.constraintId === "c-deadline");
    expect(deadlineRow).toMatchObject({
      evidenceId: "ev-deadline",
      claimId: "claim-deadline",
      status: "SATISFIED",
    });
  });

  it("accepts the live compiled travel vocabulary for semantic supersession", async () => {
    const liveShapeState: IntentState = {
      ...state,
      constraints: [
        {
          ...state.constraints[0],
          id: "c-provider-identity" as never,
          concept: "booking_channel",
          operator: "EQ",
          value: "Meridian Travel Partners",
        },
        {
          id: "c-stay-count" as never,
          concept: "booking_count",
          operator: "EQ",
          value: 2,
          kind: "HARD",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          sourceText: "2 guests",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
        },
        {
          id: "c-property" as never,
          concept: "lodging_facility",
          operator: "EQ",
          value: "Seaside Lodge",
          kind: "HARD",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          sourceText: "Seaside Lodge",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
        },
        {
          id: "c-refundability" as never,
          concept: "cancellation_policy",
          operator: "EQ",
          value: true,
          kind: "HARD",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          sourceText: "refundable",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
        },
        {
          ...state.constraints[2],
          id: "c-checkin" as never,
          concept: "checkin_date",
          value: "2026-12-20",
        },
        {
          id: "c-checkout" as never,
          concept: "checkout_date",
          operator: "EQ",
          value: "2026-12-22",
          kind: "TEMPORAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          sourceText: "Dec 22",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
        },
        {
          id: "c-budget" as never,
          concept: "total_cost_budget",
          operator: "LT",
          value: 5000,
          kind: "FINANCIAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          sourceText: "under USD 5,000",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
        },
        {
          ...state.constraints[3],
          id: "c-deadline" as never,
          concept: "execution_deadline",
          value: "2026-12-31",
        },
      ],
      temporalAuthority: {
        executionNotAfter: "2026-12-31T00:00:00.000Z",
        source: "EXPLICIT_HUMAN",
        sourceRef: "c-deadline" as never,
      },
    };
    const liveShapeVerification: SemanticVerificationResult = {
      ...verification,
      ambiguityClass: "A1",
      modelProposedAmbiguityClass: "A1",
    };
    const liveShapeCandidate: CandidateInterpretation = {
      ...candidate,
      constraints: liveShapeState.constraints.map((constraint) => ({
        id: constraint.id,
        concept: constraint.concept,
        operator: constraint.operator,
        value: constraint.value as string | number | boolean,
        kind: constraint.kind,
        importance: constraint.importance,
        confidence: constraint.confidence,
        sourceType: constraint.sourceType,
        mutability: constraint.mutability,
        meaningClass: constraint.meaningClass,
        grounding: {
          sourceText: constraint.sourceText,
          quoteExact: true,
        },
      })),
      ambiguities: [
        {
          id: "amb-provider-approval",
          description: "Provider approval and payment authority require verification",
          ambiguityClass: "A1",
          relatedConcepts: ["booking_channel", "approved_provider"],
          sourceText: "approved provider",
        },
      ],
    };

    const result = await new PreExecutionReadinessService({
      intents: {
        getCurrentStateForIntent: async () => ({ ok: true, value: liveShapeState }),
        getVerificationForState: async () => ({ ok: true, value: liveShapeVerification }),
      } as never,
      owner: {
        getSemanticArtifact: async (id: string) =>
          id === "compilation-live"
            ? ({
                ok: true,
                value: {
                  id,
                  intentId: liveShapeState.intentId,
                  kind: "COMPILATION",
                  contentHash: "e".repeat(64),
                  payload: { candidate: liveShapeCandidate },
                },
              })
            : ({
                ok: true,
                value: {
                  id: `semantic-verification-${liveShapeState.id}`,
                  intentId: liveShapeState.intentId,
                  kind: "SEMANTIC_VERIFICATION",
                  contentHash: "d".repeat(64),
                  payload: { verification: liveShapeVerification, compilationId: "compilation-live" },
                },
              }),
        supersedeSemanticVerification: async (stateId: string, body: unknown) =>
          ({ ok: true, value: { stateId, body } }),
      } as never,
      evidence: {
        getEnvelope: async (id: string) =>
          ({
            ok: true,
            value: {
              id,
              source: "verified-offer",
              contentHash: `${id}-hash`.padEnd(64, "e").slice(0, 64),
              trustClass: "ELEVATED_EXTERNAL",
              captureTime: "2026-08-22T12:00:00.000Z",
              taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
            },
          }),
        getClaim: async (id: string) =>
          ({
            ok: true,
            value:
              id === "claim-provider"
                ? {
                    id,
                    evidenceId: "ev-offer",
                    concept: "booking_provider",
                    value: "Meridian Travel Partners",
                    confidence: 1,
                    derivedBy: "verified-evidence:verify-1",
                    taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                  }
                : id === "claim-provider-approval"
                  ? {
                      id,
                      evidenceId: "ev-offer",
                      concept: "booking_provider_approval",
                      value: { approved: true, provider: "Meridian Travel Partners" },
                      confidence: 1,
                      derivedBy: "verified-evidence:verify-1",
                      taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                    }
                  : id === "claim-property"
                    ? {
                        id,
                        evidenceId: "ev-offer",
                        concept: "property_name",
                        value: "Seaside Lodge",
                        confidence: 1,
                        derivedBy: "verified-evidence:verify-1",
                        taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                      }
                    : id === "claim-refundability"
                      ? {
                          id,
                          evidenceId: "ev-offer",
                    concept: "refundable_policy",
                          value: true,
                          confidence: 1,
                          derivedBy: "verified-evidence:verify-1",
                          taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                        }
                      : id === "claim-stay-count"
                        ? {
                            id,
                            evidenceId: "ev-offer",
                            concept: "hotel_stay_count",
                            value: 2,
                            confidence: 1,
                            derivedBy: "verified-evidence:verify-1",
                            taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                          }
                        : id === "claim-checkin"
                          ? {
                              id,
                              evidenceId: "ev-offer",
                              concept: "check_in_date",
                              value: "2026-12-20",
                              confidence: 1,
                              derivedBy: "verified-evidence:verify-1",
                              taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                            }
                          : id === "claim-checkout"
                            ? {
                                id,
                                evidenceId: "ev-offer",
                                concept: "check_out_date",
                                value: "2026-12-22",
                                confidence: 1,
                                derivedBy: "verified-evidence:verify-1",
                                taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                              }
                            : id === "claim-budget"
                            ? {
                                id,
                                evidenceId: "ev-offer",
                                  concept: "total_cost_usd",
                                  value: 3200,
                                  confidence: 1,
                                  derivedBy: "verified-evidence:verify-1",
                                  taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                                }
                              : {
                                  id,
                                  evidenceId: "ev-offer",
                                  concept: "booking_deadline",
                                  value: "2026-12-30T23:59:59.000Z",
                                  confidence: 1,
                                  derivedBy: "verified-evidence:verify-1",
                                  taint: { classes: ["EXTERNAL_CONTENT"], origins: [id] },
                                },
          }),
      } as never,
      registry: {
        get: async () => ({
          ok: true,
          value: {
            packId: "travel",
            pack: TravelDomainPack,
            toEngineInput: () => ({ ok: false, code: "VALIDATION_FAILED", message: "unused" }),
          },
        }),
      } as never,
      now: () => "2026-08-22T12:05:00.000Z",
    }).evaluate({
      packId: "travel",
      intentId: liveShapeState.intentId,
      intentStateId: liveShapeState.id,
      expectedIntentStateHash: liveShapeState.stateHash,
      verifiedEvidenceIds: ["ev-offer"],
      verifiedClaimIds: [
        "claim-provider",
        "claim-provider-approval",
        "claim-property",
        "claim-refundability",
        "claim-stay-count",
        "claim-checkin",
        "claim-checkout",
        "claim-budget",
        "claim-deadline",
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      superseded: true,
    });
    const value = result.value as {
      proofRows: Array<{ constraintId?: string; claimId?: string; status?: string }>;
      coverage: { allRequiredCovered: boolean };
    };
    expect(value.coverage.allRequiredCovered).toBe(true);
    expect(value.proofRows).toContainEqual(
      expect.objectContaining({
        constraintId: "c-budget",
        claimId: "claim-budget",
        status: "SATISFIED",
      }),
    );
    expect(value.proofRows).toContainEqual(
      expect.objectContaining({
        constraintId: "c-deadline",
        claimId: "claim-deadline",
        status: "SATISFIED",
      }),
    );
  });

  it("does not raise readiness when verified evidence is unrelated to blocking ambiguity", async () => {
    const unrelatedCandidate = {
      ...candidate,
      ambiguities: [
        {
          id: "amb-unrelated-policy",
          description: "A separate policy remains unresolved",
          ambiguityClass: "A2" as const,
          relatedConcepts: ["unrelated_policy"],
        },
      ],
    };
    const result = await service({ candidate: unrelatedCandidate }).evaluate({
      packId: "travel",
      intentId: state.intentId,
      intentStateId: state.id,
      verifiedEvidenceIds: ["ev-provider", "ev-count", "ev-date", "ev-deadline"],
      verifiedClaimIds: ["claim-provider", "claim-stay-count", "claim-stay-date", "claim-deadline"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      superseded: false,
      semanticStateConsistent: false,
      ambiguityResolution: {
        ambiguityClass: "A2",
        unresolvedAmbiguityIds: ["amb-unrelated-policy"],
      },
    });
  });
});
