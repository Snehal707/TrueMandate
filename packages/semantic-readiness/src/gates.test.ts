import {
  AmbiguityClass,
  CommitmentLevel,
  ErrorCode,
  IntentReadiness,
  SemanticLifecycle,
  type SemanticVerificationResult,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  assertEconomicDelegationAllowed,
  assertPlanningAllowed,
  assertPrivilegedPlanningAllowed,
} from "./gates.js";

function verification(
  partial: Partial<SemanticVerificationResult>,
): SemanticVerificationResult {
  return {
    id: "v1",
    intentId: "intent-1" as SemanticVerificationResult["intentId"],
    candidateId: "c1",
    candidateHash: "h" as SemanticVerificationResult["candidateHash"],
    lifecycle: SemanticLifecycle.AMBIGUOUS,
    findings: [],
    transformations: [],
    criticalFailure: false,
    readiness: IntentReadiness.PLANNABLE,
    ambiguityClass: AmbiguityClass.A2,
    modelMeta: {
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "s",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "r",
      timestamp: "2026-06-01T00:00:00.000Z",
    },
    verifiedAt: "2026-06-01T00:00:00.000Z",
    ...partial,
  };
}

describe("semantic readiness gates", () => {
  it("IntentState tip alone is not enough — gate uses verification", () => {
    const ctx = {
      intentStateId: "state-1",
      verification: verification({ readiness: IntentReadiness.SEARCHABLE }),
    };
    expect(assertPlanningAllowed(ctx).ok).toBe(false);
  });

  it("A2 PLANNABLE may plan research but not economic commitment", () => {
    const ctx = {
      intentStateId: "state-1",
      verification: verification({}),
    };
    expect(assertPlanningAllowed(ctx).ok).toBe(true);
    expect(assertPrivilegedPlanningAllowed(ctx).ok).toBe(false);
    const econ = assertEconomicDelegationAllowed(ctx, CommitmentLevel.ECONOMIC);
    expect(econ.ok).toBe(false);
    if (!econ.ok) expect(econ.code).toBe(ErrorCode.SEMANTIC_READINESS_INSUFFICIENT);
  });

  it("REJECTED / criticalFailure blocks planning", () => {
    const ctx = {
      intentStateId: "state-1",
      verification: verification({
        lifecycle: SemanticLifecycle.REJECTED,
        criticalFailure: true,
      }),
    };
    expect(assertPlanningAllowed(ctx).ok).toBe(false);
  });
});
