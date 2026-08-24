import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  SourceType,
  asConstraintId,
  type CandidateConstraint,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  assertSourceSpan,
  candidatePreservesNegation,
  detectApproxLeak,
  normalizeCurrencyAmount,
  resolveRelativeDate,
  validateCandidateGrounding,
  validateComparisonOperator,
} from "./validators.js";

function c(
  partial: Partial<CandidateConstraint> &
    Pick<CandidateConstraint, "concept" | "operator" | "value" | "kind">,
): CandidateConstraint {
  return {
    id: asConstraintId(partial.id ?? partial.concept),
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: {
      sourceText: partial.grounding?.sourceText ?? partial.concept,
      quoteExact: true,
      sourceSpan: partial.grounding?.sourceSpan,
    },
    ...partial,
  };
}

describe("semantic grounding validators", () => {
  it("validates source spans", () => {
    const raw = "Buy 500 food grade containers";
    const start = raw.indexOf("food grade");
    expect(
      assertSourceSpan(raw, { start, end: start + "food grade".length }, "food grade")
        .ok,
    ).toBe(true);
  });

  it("accepts harmless trailing sentence punctuation drift in exact source spans", () => {
    const raw = "Pay the invoice before November 30, 2026.";
    const sourceText = "before November 30, 2026";
    const start = raw.indexOf(sourceText);
    const span = { start, end: raw.length };
    expect(assertSourceSpan(raw, span, sourceText).ok).toBe(true);
  });

  it("normalizes INR 800000", () => {
    const r = normalizeCurrencyAmount("under INR 800000");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.currency).toBe("INR");
      expect(r.value.amount).toBe(800000);
      expect(r.value.comparison).toBe("UNDER");
    }
  });

  it("rejects under becoming approximately", () => {
    const raw = "buy under INR 10000";
    const constraint = c({
      concept: "budget",
      operator: ConstraintOperator.EQ,
      value: "approximately 10000",
      kind: ConstraintKind.FINANCIAL,
      grounding: { sourceText: "under INR 10000", quoteExact: true },
    });
    const r = detectApproxLeak(raw, constraint);
    expect(r.ok).toBe(false);
  });

  it("rejects around becoming hard max", () => {
    const raw = "budget around INR 10000";
    const constraint = c({
      concept: "budget",
      operator: ConstraintOperator.LTE,
      value: 10000,
      kind: ConstraintKind.HARD,
      grounding: { sourceText: "around INR 10000", quoteExact: true },
    });
    expect(detectApproxLeak(raw, constraint).ok).toBe(false);
  });

  it("requires LT/LTE for under", () => {
    expect(
      validateComparisonOperator("under INR 800000", ConstraintOperator.EQ).ok,
    ).toBe(false);
    expect(
      validateComparisonOperator("under INR 800000", ConstraintOperator.LTE).ok,
    ).toBe(true);
  });

  it("preserves negation", () => {
    const raw = "do not book Air India";
    const constraints = [
      c({
        concept: "exclude_air_india",
        operator: ConstraintOperator.FORBID,
        value: "Air India",
        kind: ConstraintKind.NEGATIVE_PREFERENCE,
        grounding: { sourceText: "do not book Air India", quoteExact: true },
      }),
    ];
    expect(candidatePreservesNegation(raw, constraints).ok).toBe(true);
  });

  it("detects negation loss", () => {
    const raw = "nothing containing peanuts";
    expect(candidatePreservesNegation(raw, []).ok).toBe(false);
    if (!candidatePreservesNegation(raw, []).ok) {
      expect(candidatePreservesNegation(raw, []).code).toBe(ErrorCode.NEGATION_LOSS);
    }
  });

  it("resolves relative dates stably for replay", () => {
    const ctx = { now: "2026-06-01T12:00:00.000Z", timezone: "Asia/Kolkata" };
    const a = resolveRelativeDate("tomorrow", ctx);
    const b = resolveRelativeDate("tomorrow", ctx);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.resolvedValue).toBe(b.value.resolvedValue);
      expect(a.value.resolutionTimestamp).toBe(ctx.now);
      expect(a.value.timezone).toBe(ctx.timezone);
    }
  });

  it("rejects invented BPA_free", () => {
    const raw = "Buy 500 food grade containers under INR 800000";
    const constraints = [
      c({
        concept: "BPA_free",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.HARD,
        grounding: { sourceText: "BPA free", quoteExact: false },
      }),
    ];
    const r = validateCandidateGrounding(raw, constraints);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(ErrorCode.INVENTED_CONSTRAINT);
  });

  it("source spans use UTF-16 code units for emoji (surrogate pairs)", () => {
    const raw = "Buy food 🍎 grade containers";
    const sourceText = "food 🍎 grade";
    const start = raw.indexOf(sourceText);
    expect(start).toBeGreaterThanOrEqual(0);
    // 🍎 is one code point, two UTF-16 code units
    expect("🍎".length).toBe(2);
    const span = { start, end: start + sourceText.length };
    expect(assertSourceSpan(raw, span, sourceText).ok).toBe(true);
    expect(raw.slice(span.start, span.end)).toBe(sourceText);
  });

  it("composed vs decomposed Unicode must match exactly (no silent NFC)", () => {
    const composed = "café"; // é = U+00E9
    const decomposed = "cafe\u0301"; // e + combining acute
    expect(composed).not.toBe(decomposed);
    const start = 0;
    const span = { start, end: composed.length };
    expect(assertSourceSpan(composed, span, composed).ok).toBe(true);
    expect(assertSourceSpan(composed, span, decomposed).ok).toBe(false);
  });

  it("round-trips ASCII span + sourceText", () => {
    const raw = "Buy 500 food grade containers";
    const sourceText = "500";
    const start = raw.indexOf(sourceText);
    const span = { start, end: start + sourceText.length };
    expect(assertSourceSpan(raw, span, sourceText).ok).toBe(true);
    expect(raw.slice(span.start, span.end)).toBe(sourceText);
  });
});
