import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  PreferenceOrigin,
  PreferenceRecordStatus,
  SourceType,
  asConstraintId,
  asHashDigest,
  asLearningProposalId,
  asPreferenceRecordId,
  asPrincipalId,
  type Constraint,
  type PreferenceRecord,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  EffectiveConstraintSourceKind,
  resolveEffectiveConstraintSource,
} from "./retrieval.js";

function makeConstraint(
  concept: string,
  kind: ConstraintKind = ConstraintKind.SOFT,
): Constraint {
  return {
    id: asConstraintId(`c-${concept}`),
    concept,
    operator: ConstraintOperator.EQ,
    value: true,
    kind,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.HUMAN_REVISABLE,
    meaningClass: MeaningClass.EXPLICIT,
  };
}

function makePref(concept: string): PreferenceRecord {
  return {
    id: asPreferenceRecordId(`pref-${concept}`),
    subjectId: "principal:a@example.com",
    domain: "TRAVEL",
    concept,
    value: true,
    origin: PreferenceOrigin.EXPLICIT_USER_INPUT,
    status: PreferenceRecordStatus.ACTIVE,
    sourceLearningProposalId: asLearningProposalId("lp-1"),
    createdAt: "2026-08-21T12:00:00.000Z",
    confirmedAt: "2026-08-21T12:00:00.000Z",
    confirmedBy: asPrincipalId("a@example.com"),
    contentHash: asHashDigest("b".repeat(64)),
  };
}

describe("resolveEffectiveConstraintSource", () => {
  it("sticky constraint always wins over preference", () => {
    const result = resolveEffectiveConstraintSource(
      [makeConstraint("food_grade", ConstraintKind.HARD)],
      "food_grade",
      makePref("food_grade"),
    );
    expect(result.kind).toBe(EffectiveConstraintSourceKind.EXPLICIT_CURRENT);
  });

  it("any existing explicit constraint wins (never silently modified)", () => {
    const result = resolveEffectiveConstraintSource(
      [makeConstraint("refundable", ConstraintKind.PREFERENCE)],
      "refundable",
      makePref("refundable"),
    );
    expect(result.kind).toBe(EffectiveConstraintSourceKind.EXPLICIT_CURRENT);
  });

  it("protected concept yields NONE even when unspecified", () => {
    const result = resolveEffectiveConstraintSource([], "budget", makePref("budget"));
    expect(result.kind).toBe(EffectiveConstraintSourceKind.NONE);
  });

  it("unspecified non-protected concept fills from active preference", () => {
    const pref = makePref("refundable");
    const result = resolveEffectiveConstraintSource([], "refundable", pref);
    expect(result.kind).toBe(EffectiveConstraintSourceKind.PREFERENCE);
    expect(result.preference).toBe(pref);
  });

  it("no preference → NONE (caller falls through to model inference)", () => {
    const result = resolveEffectiveConstraintSource([], "refundable");
    expect(result.kind).toBe(EffectiveConstraintSourceKind.NONE);
  });
});
