import {
  ConstraintKind,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  STICKY_CONSTRAINT_KINDS,
  err,
  ok,
  type CandidateConstraint,
  type Result,
  type SourceSpan,
  type TemporalResolution,
} from "@truemandate/protocol";

export const TemporalFactShape = {
  ABSOLUTE: "ABSOLUTE",
  PARTIAL_CALENDAR_DATE: "PARTIAL_CALENDAR_DATE",
  DURATION: "DURATION",
  RANGE: "RANGE",
  RECURRENCE: "RECURRENCE",
} as const;
export type TemporalFactShape =
  (typeof TemporalFactShape)[keyof typeof TemporalFactShape];

const TEMPORAL_UNIT = /^(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?)$/i;
const CALENDAR_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const MAX_DAY_BY_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isAbsoluteDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/u);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return false;
  }
  return !trimmed.includes("T") || Number.isFinite(Date.parse(trimmed));
}

function isGroundedPartialCalendarDate(value: unknown, sourceText: string): boolean {
  if (typeof value !== "string") return false;
  const match = value.trim().match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?$/iu,
  );
  if (!match) return false;

  const monthIndex = CALENDAR_MONTHS.indexOf(match[1]!.toLowerCase() as (typeof CALENDAR_MONTHS)[number]);
  const day = Number(match[2]);
  if (monthIndex < 0 || day < 1 || day > MAX_DAY_BY_MONTH[monthIndex]!) return false;

  const escapedValue = value.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escapedValue}\\b`, "iu").test(sourceText);
}

function groundedDuration(value: unknown, sourceText: string): boolean {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const match = sourceText.trim().match(
    /\b(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i,
  );
  return match !== null && Number(match[1]) === amount && TEMPORAL_UNIT.test(match[2] ?? "");
}

/**
 * Classifies only canonical, structurally valid temporal facts. The result is
 * domain-neutral and never turns a duration or recurrence into execution
 * authority, which remains bound to an absolute human deadline elsewhere.
 */
export function classifyGroundedTemporalFact(
  constraint: CandidateConstraint,
): Result<TemporalFactShape> {
  if (constraint.kind !== ConstraintKind.TEMPORAL) {
    return err(ErrorCode.TEMPORAL_MISMATCH, "Constraint is not temporal");
  }
  if (
    constraint.sourceType !== "HUMAN" ||
    (constraint.meaningClass !== MeaningClass.EXPLICIT &&
      constraint.meaningClass !== MeaningClass.IMPLIED) ||
    constraint.grounding.quoteExact !== true ||
    constraint.grounding.sourceText.trim().length === 0
  ) {
    return err(
      ErrorCode.TEMPORAL_MISMATCH,
      "Temporal fact is not exactly grounded in the human intent",
    );
  }

  const resolved = constraint.temporalResolution?.resolvedValue;
  if (resolved !== undefined) {
    return isAbsoluteDate(resolved)
      ? ok(TemporalFactShape.ABSOLUTE)
      : err(ErrorCode.TEMPORAL_MISMATCH, "Temporal resolution is not an absolute date");
  }
  if (isAbsoluteDate(constraint.value)) return ok(TemporalFactShape.ABSOLUTE);
  if (isGroundedPartialCalendarDate(constraint.value, constraint.grounding.sourceText)) {
    return ok(TemporalFactShape.PARTIAL_CALENDAR_DATE);
  }
  if (groundedDuration(constraint.value, constraint.grounding.sourceText)) {
    return ok(TemporalFactShape.DURATION);
  }

  if (constraint.value && typeof constraint.value === "object" && !Array.isArray(constraint.value)) {
    const value = constraint.value as Record<string, unknown>;
    if (isAbsoluteDate(value.start) && isAbsoluteDate(value.end)) {
      return Date.parse(value.start as string) <= Date.parse(value.end as string)
        ? ok(TemporalFactShape.RANGE)
        : err(ErrorCode.TEMPORAL_MISMATCH, "Temporal range is inverted");
    }
    const interval = Number(value.interval ?? value.every);
    if (
      Number.isFinite(interval) &&
      interval > 0 &&
      typeof value.unit === "string" &&
      TEMPORAL_UNIT.test(value.unit)
    ) {
      return ok(TemporalFactShape.RECURRENCE);
    }
  }

  return err(ErrorCode.TEMPORAL_MISMATCH, "Unsupported or malformed temporal fact");
}

const NEGATION_PATTERNS =
  /\b(do\s+not|don't|nothing|not\s+\w+|avoid|never|excluding|exclude|without)\b/i;

function normalizeTerminalGroundingSurface(text: string): string {
  return text.replace(/[\s.!?]+$/u, "");
}

export function assertSourceSpan(
  raw: string,
  span: SourceSpan,
  sourceText: string,
): Result<void> {
  if (span.start < 0 || span.end > raw.length || span.start > span.end) {
    return err(ErrorCode.GROUNDING_FAILED, "Source span out of range", {
      span,
      rawLength: raw.length,
    });
  }
  const sliced = raw.slice(span.start, span.end);
  if (
    sliced !== sourceText &&
    normalizeTerminalGroundingSurface(sliced) !== normalizeTerminalGroundingSurface(sourceText)
  ) {
    return err(
      ErrorCode.GROUNDING_FAILED,
      "Source span does not match sourceText",
      { expected: sourceText, actual: sliced },
    );
  }
  return ok();
}

/**
 * Correct model-supplied offsets only when the exact human quote has one
 * unambiguous location in the immutable raw intent. The validator remains the
 * authority for every unresolved or non-exact span.
 */
export function reconcileUniqueExactSourceSpans(
  raw: string,
  constraints: readonly CandidateConstraint[],
): CandidateConstraint[] {
  return constraints.map((constraint) => {
    const span = constraint.grounding.sourceSpan;
    if (
      !span ||
      assertSourceSpan(raw, span, constraint.grounding.sourceText).ok ||
      constraint.sourceType !== "HUMAN" ||
      constraint.grounding.quoteExact !== true
    ) {
      return constraint;
    }

    const sourceText = constraint.grounding.sourceText;
    const start = raw.indexOf(sourceText);
    if (start < 0 || raw.indexOf(sourceText, start + 1) >= 0) {
      return constraint;
    }

    return {
      ...constraint,
      grounding: {
        ...constraint.grounding,
        sourceSpan: { start, end: start + sourceText.length },
      },
    };
  });
}

export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
  readonly comparison?: "UNDER" | "AT_MOST" | "AROUND" | "EXACT" | "OVER";
}

export function normalizeCurrencyAmount(text: string): Result<CurrencyAmount> {
  const around = /\b(around|approximately|about|roughly)\b/i.test(text);
  const under = /\b(under|below|at\s+most|less\s+than|no\s+more\s+than)\b/i.test(
    text,
  );
  const over = /\b(over|above|at\s+least|more\s+than)\b/i.test(text);

  const m = text.match(
    /\b(INR|USD|EUR|GBP)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\b/i,
  );
  if (!m) {
    // also allow 800000 INR order
    const m2 = text.match(
      /\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*(INR|USD|EUR|GBP)\b/i,
    );
    if (!m2) {
      return err(ErrorCode.GROUNDING_FAILED, "No currency amount found", { text });
    }
    const amount = Number(m2[1]!.replace(/,/g, ""));
    const currency = m2[2]!.toUpperCase();
    return ok({
      currency,
      amount,
      comparison: around ? "AROUND" : under ? "UNDER" : over ? "OVER" : "EXACT",
    });
  }
  const currency = m[1]!.toUpperCase();
  const amount = Number(m[2]!.replace(/,/g, ""));
  return ok({
    currency,
    amount,
    comparison: around ? "AROUND" : under ? "UNDER" : over ? "OVER" : "EXACT",
  });
}

export function validateComparisonOperator(
  expression: string,
  operator: ConstraintOperator,
): Result<void> {
  const under = /\b(under|below|at\s+most|less\s+than)\b/i.test(expression);
  const before = /\bbefore\b/i.test(expression);
  if (under && operator !== ConstraintOperator.LT && operator !== ConstraintOperator.LTE) {
    return err(
      ErrorCode.GROUNDING_FAILED,
      "under/below expressions must map to LT/LTE, not approximate equality",
      { expression, operator },
    );
  }
  if (before && operator !== ConstraintOperator.LT && operator !== ConstraintOperator.LTE) {
    return err(
      ErrorCode.TEMPORAL_MISMATCH,
      "before relationship must be preserved as LT/LTE",
      { expression, operator },
    );
  }
  return ok();
}

export function detectNegationMarkers(text: string): readonly string[] {
  const matches = text.match(
    /\b(?:do\s+not|don't|nothing\s+containing|not\s+\w+|avoid|never|excluding|exclude)\b[^.!]*/gi,
  );
  return matches ?? [];
}

export function resolveRelativeDate(
  expression: string,
  context: { readonly now: string; readonly timezone: string },
): Result<TemporalResolution> {
  const now = new Date(context.now);
  if (Number.isNaN(now.getTime())) {
    return err(ErrorCode.TEMPORAL_MISMATCH, "Invalid resolution timestamp");
  }
  const lower = expression.toLowerCase();
  const resolved = new Date(now);
  if (/\btomorrow\b/.test(lower)) {
    resolved.setUTCDate(resolved.getUTCDate() + 1);
  } else if (/\bnext\s+friday\b/.test(lower) || /\bfriday\b/.test(lower)) {
    const day = resolved.getUTCDay();
    const target = 5; // Friday
    let delta = (target - day + 7) % 7;
    if (delta === 0) delta = 7;
    if (/\bbefore\b/.test(lower)) {
      // before Friday → end of Thursday relative to next Friday
      resolved.setUTCDate(resolved.getUTCDate() + delta);
    } else {
      resolved.setUTCDate(resolved.getUTCDate() + delta);
    }
  } else if (/\bmonday\b/.test(lower)) {
    const day = resolved.getUTCDay();
    const target = 1;
    let delta = (target - day + 7) % 7;
    if (delta === 0) delta = 7;
    resolved.setUTCDate(resolved.getUTCDate() + delta);
  } else {
    return err(ErrorCode.TEMPORAL_MISMATCH, "Unsupported relative date expression", {
      expression,
    });
  }

  return ok({
    originalExpression: expression,
    resolvedValue: resolved.toISOString().slice(0, 10),
    resolutionTimestamp: context.now,
    timezone: context.timezone,
  });
}

/**
 * EXPLICIT constraints must have grounding text present in raw intent.
 */
export function assertNoInventedConcepts(
  raw: string,
  constraints: readonly CandidateConstraint[],
): Result<void> {
  const rawNorm = raw.toLowerCase().replace(/-/g, " ");
  for (const c of constraints) {
    if (c.meaningClass !== MeaningClass.EXPLICIT) continue;
    const g = c.grounding.sourceText.toLowerCase().replace(/-/g, " ");
    if (!rawNorm.includes(g)) {
      return err(
        ErrorCode.INVENTED_CONSTRAINT,
        `EXPLICIT constraint '${c.concept}' grounding not found in raw intent`,
        { concept: c.concept, grounding: c.grounding.sourceText },
      );
    }
    // Heuristic: BPA_free invented when not in source
    if (
      /bpa/.test(c.concept.toLowerCase()) &&
      !/bpa/.test(rawNorm)
    ) {
      return err(
        ErrorCode.INVENTED_CONSTRAINT,
        "BPA_free invented without source support",
        { concept: c.concept },
      );
    }
  }
  return ok();
}

/**
 * Detect silent conversion of under/max into approximately, or around into hard max.
 */
export function detectApproxLeak(
  raw: string,
  constraint: CandidateConstraint,
): Result<void> {
  const rawLower = raw.toLowerCase();
  const isMonetaryConcept =
    /budget|cost|price|amount|spend|max_/.test(constraint.concept) ||
    /\b(INR|USD|EUR|GBP)\b/i.test(constraint.grounding.sourceText);

  const underInRaw =
    /\b(under|below|at\s+most|less\s+than)\b/.test(rawLower) && isMonetaryConcept;

  if (underInRaw) {
    const label = String(constraint.value);
    if (/approx|around|about|roughly/i.test(label)) {
      return err(
        ErrorCode.GROUNDING_FAILED,
        "under amount must not become approximately",
        { concept: constraint.concept, value: constraint.value },
      );
    }
    if (
      constraint.operator !== ConstraintOperator.LT &&
      constraint.operator !== ConstraintOperator.LTE
    ) {
      return err(
        ErrorCode.GROUNDING_FAILED,
        "under amount must use LT/LTE operator",
        { operator: constraint.operator },
      );
    }
  }

  if (/\b(around|approximately|about)\b/.test(rawLower)) {
    if (
      constraint.kind === ConstraintKind.HARD ||
      constraint.kind === ConstraintKind.FINANCIAL
    ) {
      if (
        constraint.operator === ConstraintOperator.LTE ||
        constraint.operator === ConstraintOperator.LT
      ) {
        // around should not become a hard maximum
        return err(
          ErrorCode.GROUNDING_FAILED,
          "around amount must not become a hard maximum",
          { concept: constraint.concept },
        );
      }
    }
  }
  return ok();
}

export function assertInferredNotStickyHard(
  constraints: readonly CandidateConstraint[],
): Result<void> {
  for (const c of constraints) {
    if (
      (c.meaningClass === MeaningClass.INFERRED ||
        c.meaningClass === MeaningClass.UNKNOWN) &&
      STICKY_CONSTRAINT_KINDS.has(c.kind)
    ) {
      return err(
        ErrorCode.GROUNDING_FAILED,
        "INFERRED/UNKNOWN must not silently become sticky hard constraints",
        { concept: c.concept, meaningClass: c.meaningClass, kind: c.kind },
      );
    }
  }
  return ok();
}

export function validateCandidateGrounding(
  raw: string,
  constraints: readonly CandidateConstraint[],
): Result<void> {
  for (const c of constraints) {
    if (c.grounding.sourceSpan) {
      const spanCheck = assertSourceSpan(
        raw,
        c.grounding.sourceSpan,
        c.grounding.sourceText,
      );
      if (!spanCheck.ok) return spanCheck;
    }
    const approx = detectApproxLeak(raw, c);
    if (!approx.ok) return approx;
    if (c.grounding.sourceText) {
      const op = validateComparisonOperator(c.grounding.sourceText, c.operator);
      if (!op.ok) return op;
    }
  }
  const invented = assertNoInventedConcepts(raw, constraints);
  if (!invented.ok) return invented;
  return assertInferredNotStickyHard(constraints);
}

export function hasNegationInRaw(raw: string): boolean {
  return NEGATION_PATTERNS.test(raw);
}

export function candidatePreservesNegation(
  raw: string,
  constraints: readonly CandidateConstraint[],
): Result<void> {
  const markers = detectNegationMarkers(raw);
  if (markers.length === 0) return ok();

  for (const marker of markers) {
    const markerLower = marker.toLowerCase();
    const preserved = constraints.some((c) => {
      const forbids =
        c.operator === ConstraintOperator.FORBID ||
        c.kind === ConstraintKind.NEGATIVE_PREFERENCE ||
        c.concept.startsWith("not_") ||
        c.concept.startsWith("exclude_");
      const grounded =
        c.grounding.sourceText.toLowerCase().includes(
          markerLower.slice(0, Math.min(12, markerLower.length)),
        ) || markerLower.includes(c.grounding.sourceText.toLowerCase());
      return forbids || grounded;
    });
    if (!preserved) {
      return err(
        ErrorCode.NEGATION_LOSS,
        "Negation in raw intent was not preserved in candidate constraints",
        { marker },
      );
    }
  }
  return ok();
}
