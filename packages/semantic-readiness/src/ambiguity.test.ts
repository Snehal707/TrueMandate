import {
  AmbiguityClass,
  IntentReadiness,
  type AmbiguityRecord,
  type Constraint,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  isPrivilegedSemanticStateConsistent,
  reconcileAmbiguitiesWithProofs,
} from "./ambiguity.js";

const providerConstraint = {
  id: "c-provider",
  concept: "provider_approval_status",
  operator: "EQ",
  value: "approved",
  kind: "ORGANIZATIONAL_POLICY",
  importance: 1,
  confidence: 1,
  sourceType: "HUMAN",
  sourceText: "approved provider",
  mutability: "IMMUTABLE",
  meaningClass: "EXPLICIT",
} as Constraint;

const providerAmbiguity = (ambiguityClass: AmbiguityClass): AmbiguityRecord => ({
  id: "amb-approved-provider",
  description: "Specific list or registry of approved providers is not defined",
  ambiguityClass,
  relatedConcepts: ["provider_approval_status", "approved_provider"],
  sourceText: "approved provider",
});

const satisfiedProviderProof = {
  obligationId: "o-provider",
  constraintId: "c-provider",
  evidenceId: "ev-provider-verified",
  evidenceTrustClass: "ELEVATED_EXTERNAL" as const,
  status: "SATISFIED" as const,
};

describe("ambiguity reconciliation", () => {
  it("resolves the live approved-provider A2 ambiguity from its verified proof", () => {
    const result = reconcileAmbiguitiesWithProofs({
      ambiguities: [providerAmbiguity(AmbiguityClass.A2)],
      requiredConstraints: [providerConstraint],
      proofRows: [satisfiedProviderProof],
    });

    expect(result.ambiguityClass).toBe(AmbiguityClass.A0);
    expect(result.resolvedAmbiguityIds).toEqual(["amb-approved-provider"]);
  });

  it("does not resolve ambiguity from unrelated evidence", () => {
    const result = reconcileAmbiguitiesWithProofs({
      ambiguities: [providerAmbiguity(AmbiguityClass.A2)],
      requiredConstraints: [providerConstraint],
      proofRows: [{ ...satisfiedProviderProof, constraintId: "c-budget" }],
    });

    expect(result.ambiguityClass).toBe(AmbiguityClass.A2);
    expect(result.unresolvedAmbiguityIds).toEqual(["amb-approved-provider"]);
  });

  it.each([AmbiguityClass.A3, AmbiguityClass.A4])(
    "keeps %s fail-closed even when related evidence is satisfied",
    (ambiguityClass) => {
      const result = reconcileAmbiguitiesWithProofs({
        ambiguities: [providerAmbiguity(ambiguityClass)],
        requiredConstraints: [providerConstraint],
        proofRows: [satisfiedProviderProof],
      });
      expect(result.ambiguityClass).toBe(ambiguityClass);
      expect(result.resolvedAmbiguityIds).toEqual([]);
    },
  );

  it("rejects privileged-capable readiness paired with blocking ambiguity", () => {
    expect(
      isPrivilegedSemanticStateConsistent({
        readiness: IntentReadiness.ACTIONABLE,
        ambiguityClass: AmbiguityClass.A2,
      }),
    ).toBe(false);
    expect(
      isPrivilegedSemanticStateConsistent({
        readiness: IntentReadiness.ACTIONABLE,
        ambiguityClass: AmbiguityClass.A1,
      }),
    ).toBe(true);
  });
});
