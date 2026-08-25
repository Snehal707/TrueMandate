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
  classifyGroundedTemporalFact,
  detectApproxLeak,
  normalizeCurrencyAmount,
  reconcileUniqueExactSourceSpans,
  resolveRelativeDate,
  validateCandidateGrounding,
  validateComparisonOperator,
  TemporalFactShape,
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

  it("repairs an incorrect model offset only from one exact human quote", () => {
    const raw = "Book a stay with check-in on December 20 and checkout on December 22.";
    const constraint = c({
      concept: "check_in_date",
      operator: ConstraintOperator.EQ,
      value: "2026-12-20",
      kind: ConstraintKind.TEMPORAL,
      grounding: {
        sourceText: "December 20",
        sourceSpan: {
          start: raw.indexOf("check-in on"),
          end: raw.indexOf("check-in on") + "check-in on".length,
        },
        quoteExact: true,
      },
    });

    const [reconciled] = reconcileUniqueExactSourceSpans(raw, [constraint]);
    const expectedStart = raw.indexOf("December 20");
    expect(reconciled?.grounding.sourceSpan).toEqual({
      start: expectedStart,
      end: expectedStart + "December 20".length,
    });
    expect(validateCandidateGrounding(raw, [reconciled!]).ok).toBe(true);
  });

  it("does not repair ambiguous, absent, non-exact, or non-human grounding", () => {
    const raw = "Book December 20 and return December 20.";
    const invalidSpan = { start: 0, end: 4 };
    const base = c({
      concept: "travel_date",
      operator: ConstraintOperator.EQ,
      value: "2026-12-20",
      kind: ConstraintKind.TEMPORAL,
      grounding: { sourceText: "December 20", sourceSpan: invalidSpan, quoteExact: true },
    });
    const rows = [
      base,
      { ...base, id: asConstraintId("absent"), grounding: { ...base.grounding, sourceText: "December 21" } },
      { ...base, id: asConstraintId("non-exact"), grounding: { ...base.grounding, quoteExact: false } },
      { ...base, id: asConstraintId("agent"), sourceType: SourceType.AGENT },
    ];

    for (const row of reconcileUniqueExactSourceSpans(raw, rows)) {
      expect(row.grounding.sourceSpan).toEqual(invalidSpan);
      expect(validateCandidateGrounding(raw, [row]).ok).toBe(false);
    }
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

  it("classifies absolute dates, partial calendar dates, grounded durations, ranges, and recurrences", () => {
    const temporal = (concept: string, value: unknown, sourceText: string) => c({
      concept,
      operator: ConstraintOperator.EQ,
      value,
      kind: ConstraintKind.TEMPORAL,
      grounding: { sourceText, quoteExact: true },
    });
    expect(classifyGroundedTemporalFact(temporal("stay_start_date", "2026-11-10", "2026-11-10")))
      .toMatchObject({ ok: true, value: TemporalFactShape.ABSOLUTE });
    expect(classifyGroundedTemporalFact(temporal("stay_start_date", "December 20", "check-in on December 20")))
      .toMatchObject({ ok: true, value: TemporalFactShape.PARTIAL_CALENDAR_DATE });
    expect(classifyGroundedTemporalFact(temporal("contract_term_months", 12, "12 month term")))
      .toMatchObject({ ok: true, value: TemporalFactShape.DURATION });
    expect(classifyGroundedTemporalFact(temporal("stay_window", { start: "2026-11-10", end: "2026-11-12" }, "from 2026-11-10 to 2026-11-12")))
      .toMatchObject({ ok: true, value: TemporalFactShape.RANGE });
    expect(classifyGroundedTemporalFact(temporal("billing_interval", { interval: 1, unit: "month" }, "every month")))
      .toMatchObject({ ok: true, value: TemporalFactShape.RECURRENCE });
  });

  it("rejects impossible or ungrounded partial calendar dates", () => {
    const temporal = (value: string, sourceText: string) => c({
      concept: "stay_start_date",
      operator: ConstraintOperator.EQ,
      value,
      kind: ConstraintKind.TEMPORAL,
      grounding: { sourceText, quoteExact: true },
    });
    expect(classifyGroundedTemporalFact(temporal("February 30", "check-in on February 30")).ok)
      .toBe(false);
    expect(classifyGroundedTemporalFact(temporal("April 31", "check-in on April 31")).ok)
      .toBe(false);
    expect(classifyGroundedTemporalFact(temporal("December 20", "check-in date unavailable")).ok)
      .toBe(false);
    expect(classifyGroundedTemporalFact(temporal("2026-02-30", "check-in on 2026-02-30")).ok)
      .toBe(false);
    expect(classifyGroundedTemporalFact({
      ...temporal("December 20", "check-in on December 20"),
      meaningClass: MeaningClass.INFERRED,
    }).ok).toBe(false);
  });

  it("rejects malformed or ungrounded duration representations", () => {
    const malformed = c({
      concept: "contract_term_months",
      operator: ConstraintOperator.EQ,
      value: 12,
      kind: ConstraintKind.TEMPORAL,
      grounding: { sourceText: "annual contract", quoteExact: true },
    });
    expect(classifyGroundedTemporalFact(malformed).ok).toBe(false);
    expect(classifyGroundedTemporalFact({
      ...malformed,
      grounding: { sourceText: "12 month term", quoteExact: false },
    }).ok).toBe(false);
    expect(classifyGroundedTemporalFact({
      ...malformed,
      sourceType: SourceType.AGENT,
      grounding: { sourceText: "12 month term", quoteExact: true },
    }).ok).toBe(false);
    expect(classifyGroundedTemporalFact({
      ...malformed,
      meaningClass: MeaningClass.INFERRED,
      grounding: { sourceText: "12 month term", quoteExact: true },
    }).ok).toBe(false);
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
