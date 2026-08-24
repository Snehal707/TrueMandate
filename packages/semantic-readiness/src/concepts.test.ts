import {
  ConstraintKind,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type Constraint,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  evaluateApprovalFactSatisfaction,
  classifyRequiredProofCoverage,
  isApprovalFactConcept,
  normalizeApprovalFactSubject,
  isRefundabilityFactConcept,
  normalizeApprovalFactValue,
  normalizeRefundabilityFactValue,
  resolveCanonicalConcept,
  resolveCanonicalSemanticFact,
  validateConceptContract,
  type ConceptContract,
} from "./concepts.js";

const contract: ConceptContract = {
  conceptFamilies: [
    { canonicalConcept: "stay_start", aliases: ["stay_date", "stay_start_date", "check_in"] },
    { canonicalConcept: "completion_deadline", aliases: ["completion_deadline", "deadline"] },
    {
      canonicalConcept: "provider",
      aliases: ["provider", "booking_provider", "booking_provider_approval", "approved_provider"],
      factFamilies: [
        { factType: "approval", aliases: ["booking_provider_approval", "approved_provider"] },
      ],
    },
  ],
  executionCriticalConceptRules: [
    { canonicalConcept: "stay_start", proofMechanism: { kind: "EVIDENCE_OBLIGATION" } },
    { canonicalConcept: "completion_deadline", proofMechanism: { kind: "EVIDENCE_OBLIGATION" } },
  ],
  offerBackedCanonicalConcepts: ["stay_start"],
};

function temporal(id: string, concept: string): Constraint {
  return {
    id,
    concept,
    operator: ConstraintOperator.EQ,
    value: "2026-12-20",
    kind: ConstraintKind.TEMPORAL,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: "HUMAN_REVISABLE",
    meaningClass: MeaningClass.EXPLICIT,
    grounding: { sourceText: "2026-12-20", sourceSpan: { start: 0, end: 10 }, quoteExact: true },
  } as Constraint;
}

describe("canonical concept contracts", () => {
  it("resolves exact aliases without fuzzy substring inference", () => {
    expect(resolveCanonicalConcept(" Stay_Start_Date ", contract.conceptFamilies)).toBe("stay_start");
    expect(resolveCanonicalConcept("pre_stay_start_date_note", contract.conceptFamilies)).toBeUndefined();
  });

  it("rejects aliases assigned to different canonical concepts", () => {
    const result = validateConceptContract({
      conceptFamilies: [
        { canonicalConcept: "first", aliases: ["shared"] },
        { canonicalConcept: "second", aliases: ["shared"] },
      ],
      executionCriticalConceptRules: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects rules that reference an undeclared canonical concept", () => {
    const result = validateConceptContract({
      conceptFamilies: [{ canonicalConcept: "known", aliases: [] }],
      executionCriticalConceptRules: [
        { canonicalConcept: "unknown", proofMechanism: { kind: "EVIDENCE_OBLIGATION" } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("classifies authoritative stay_start_date independently of obligation derivation", () => {
    const required = classifyRequiredProofCoverage([temporal("c-date-5", "stay_start_date")], {
      conceptContract: contract,
    });
    expect(required).toEqual([expect.objectContaining({
      constraintId: "c-date-5",
      originalConcept: "stay_start_date",
      canonicalConcept: "stay_start",
      reason: "DOMAIN_EXECUTION_CRITICAL",
      proofMechanism: { kind: "EVIDENCE_OBLIGATION" },
    })]);
  });

  it("normalizes approval facts without inferring approval from provider identity", () => {
    expect(isApprovalFactConcept("booking_provider_approval")).toBe(true);
    expect(isApprovalFactConcept("approved_vendor")).toBe(true);
    expect(isApprovalFactConcept("property_name")).toBe(false);
    expect(normalizeApprovalFactValue({ approved: true, provider: "Meridian Travel Partners" })).toBe(true);
    expect(normalizeApprovalFactValue({ approved: false, provider: "Meridian Travel Partners" })).toBe(false);
    expect(normalizeApprovalFactValue("approved provider")).toBe(true);
    expect(normalizeApprovalFactValue("Meridian Travel Partners")).toBeUndefined();
    expect(normalizeApprovalFactSubject("Meridian Travel Partners")).toBe("meridian travel partners");
    expect(normalizeApprovalFactSubject("approved provider")).toBeUndefined();
  });

  it("treats a named approved provider constraint as requiring approval plus the named provider", () => {
    expect(
      evaluateApprovalFactSatisfaction(
        "Meridian Travel Partners",
        { approved: true, provider: "Meridian Travel Partners" },
      ),
    ).toBe("SATISFIED");
    expect(
      evaluateApprovalFactSatisfaction(
        "Meridian Travel Partners",
        { approved: false, provider: "Meridian Travel Partners" },
      ),
    ).toBe("UNSATISFIED");
    expect(
      evaluateApprovalFactSatisfaction(
        "Meridian Travel Partners",
        { approved: true, provider: "Other Provider" },
      ),
    ).toBe("UNSATISFIED");
    expect(
      evaluateApprovalFactSatisfaction("Meridian Travel Partners", true),
    ).toBe("UNKNOWN");
  });

  it("normalizes refundability facts without inferring them from unrelated strings", () => {
    expect(isRefundabilityFactConcept("cancellation_policy")).toBe(true);
    expect(isRefundabilityFactConcept("refundable_rate")).toBe(true);
    expect(isRefundabilityFactConcept("property_name")).toBe(false);
    expect(normalizeRefundabilityFactValue(true)).toBe(true);
    expect(normalizeRefundabilityFactValue(false)).toBe(false);
    expect(normalizeRefundabilityFactValue("refundable")).toBe(true);
    expect(normalizeRefundabilityFactValue("free cancellation")).toBe(true);
    expect(normalizeRefundabilityFactValue("non-refundable")).toBe(false);
    expect(normalizeRefundabilityFactValue("Seaside Lodge")).toBeUndefined();
  });

  it("separates provider identity facts from provider approval facts", () => {
    expect(resolveCanonicalSemanticFact("booking_provider", contract.conceptFamilies)).toEqual({
      canonicalConcept: "provider",
      factType: "identity",
      factKey: "provider.identity",
    });
    expect(resolveCanonicalSemanticFact("booking_provider_approval", contract.conceptFamilies)).toEqual({
      canonicalConcept: "provider",
      factType: "approval",
      factKey: "provider.approval",
    });
    expect(
      resolveCanonicalSemanticFact("provider", contract.conceptFamilies, {
        value: "Meridian Travel Partners",
      }),
    ).toEqual({
      canonicalConcept: "provider",
      factType: "identity",
      factKey: "provider.identity",
    });
    expect(
      resolveCanonicalSemanticFact("provider", contract.conceptFamilies, {
        value: { approved: true, provider: "Meridian Travel Partners" },
      }),
    ).toEqual({
      canonicalConcept: "provider",
      factType: "approval",
      factKey: "provider.approval",
    });
  });
});
