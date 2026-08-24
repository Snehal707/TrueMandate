import {
  PreferenceOrigin,
  PreferenceRecordStatus,
  asHashDigest,
  asLearningProposalId,
  asPreferenceRecordId,
  asPrincipalId,
  type PreferenceRecord,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  MIN_WORKFLOW_RULE_EVIDENCE,
  countDistinctEvidence,
  deriveEvidenceFromPreferenceHistory,
  hasSufficientEvidence,
} from "./evidence.js";

function makePref(
  overrides: Partial<PreferenceRecord> &
    Pick<PreferenceRecord, "id" | "sourceLearningProposalId">,
): PreferenceRecord {
  return {
    subjectId: "principal:a@example.com",
    domain: "TRAVEL",
    concept: "refundable",
    value: true,
    origin: PreferenceOrigin.CONFIRMED_LEARNING,
    status: PreferenceRecordStatus.ACTIVE,
    createdAt: "2026-08-21T12:00:00.000Z",
    confirmedAt: "2026-08-21T12:00:00.000Z",
    confirmedBy: asPrincipalId("a@example.com"),
    contentHash: asHashDigest("a".repeat(64)),
    ...overrides,
    id: asPreferenceRecordId(overrides.id),
    sourceLearningProposalId: asLearningProposalId(
      String(overrides.sourceLearningProposalId),
    ),
  };
}

describe("workflow-rule evidence threshold", () => {
  it("requires MIN_WORKFLOW_RULE_EVIDENCE distinct refs", () => {
    expect(MIN_WORKFLOW_RULE_EVIDENCE).toBe(3);
    expect(hasSufficientEvidence(["a", "b"])).toBe(false);
    expect(hasSufficientEvidence(["a", "b", "c"])).toBe(true);
  });

  it("dedupes duplicate refs so they do not inflate the count", () => {
    expect(countDistinctEvidence(["a", "a", "b", "b"])).toBe(2);
    expect(hasSufficientEvidence(["a", "a", "b", "b", "c"])).toBe(true);
    expect(hasSufficientEvidence(["a", "a", "a"])).toBe(false);
  });

  it("deriveEvidenceFromPreferenceHistory dedupes by sourceLearningProposalId", () => {
    const records = [
      makePref({ id: "p1", sourceLearningProposalId: "lp-1", confirmedAt: "2026-01-01T00:00:00.000Z" }),
      makePref({ id: "p2", sourceLearningProposalId: "lp-2", confirmedAt: "2026-01-02T00:00:00.000Z" }),
      makePref({ id: "p3", sourceLearningProposalId: "lp-1", confirmedAt: "2026-01-03T00:00:00.000Z" }),
      makePref({ id: "p4", sourceLearningProposalId: "lp-3", confirmedAt: "2026-01-04T00:00:00.000Z" }),
      makePref({
        id: "other",
        sourceLearningProposalId: "lp-x",
        subjectId: "principal:b@example.com",
      }),
    ];
    const derived = deriveEvidenceFromPreferenceHistory(
      records,
      "principal:a@example.com",
      "TRAVEL",
      "refundable",
    );
    expect(derived.evidenceRefs).toEqual(["lp-1", "lp-2", "lp-3"]);
    expect(derived.basis).toHaveLength(3);
    expect(derived.sufficient).toBe(true);
  });

  it("insufficient history yields sufficient=false", () => {
    const derived = deriveEvidenceFromPreferenceHistory(
      [
        makePref({ id: "p1", sourceLearningProposalId: "lp-1" }),
        makePref({ id: "p2", sourceLearningProposalId: "lp-2" }),
      ],
      "principal:a@example.com",
      "TRAVEL",
      "refundable",
    );
    expect(derived.sufficient).toBe(false);
    expect(derived.evidenceRefs).toHaveLength(2);
  });
});
