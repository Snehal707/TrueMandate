import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type Result,
} from "@truemandate/protocol";
import type { CompileAndVerifyResult } from "./orchestrator.js";

export function cleanCompilerOutput(rawText: string) {
  const foodGradeText = /food-grade/i.test(rawText)
    ? rawText.match(/food-grade/i)![0]!
    : /food\s+grade/i.test(rawText)
      ? rawText.match(/food\s+grade/i)![0]!
      : "food grade";
  // The genuine specification phrase (e.g. "food-grade containers"), not
  // just the "food-grade" adjective — matches how the real compiler now
  // extracts a material/specification constraint's value as the actual
  // specification string, not a boolean flag. Falls back to a boolean when
  // no following noun is present in the raw text, preserving old behavior
  // for rawText that only asserts the adjective in isolation.
  const foodGradeSpecMatch = rawText.match(/food[\s-]?grade\s+(\S+?)[.,;:!?]?(?=\s|$)/i);
  const foodGradeValue: string | boolean = foodGradeSpecMatch
    ? foodGradeSpecMatch[0]!
    : true;
  const qtyMatch = rawText.match(/\b(500)\b/);
  const budgetMatch = rawText.match(/under\s+INR\s*800,?000/i);

  return {
    goal: "Procure food-grade containers",
    constraints: [
      {
        id: "c-qty",
        concept: "quantity",
        operator: ConstraintOperator.EQ,
        value: 500,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
        grounding: {
          sourceText: qtyMatch?.[0] ?? "500",
          quoteExact: true,
          sourceSpan: qtyMatch
            ? {
                start: rawText.indexOf(qtyMatch[0]!),
                end: rawText.indexOf(qtyMatch[0]!) + qtyMatch[0]!.length,
              }
            : undefined,
        },
      },
      {
        id: "c-food",
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: foodGradeValue,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
        grounding: {
          sourceText: foodGradeText,
          quoteExact: true,
          sourceSpan: {
            start: rawText.indexOf(foodGradeText),
            end: rawText.indexOf(foodGradeText) + foodGradeText.length,
          },
        },
      },
      {
        id: "c-budget",
        concept: "budget",
        operator: ConstraintOperator.LTE,
        value: 800000,
        kind: ConstraintKind.FINANCIAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
        grounding: {
          sourceText: budgetMatch?.[0] ?? "under INR 800000",
          quoteExact: true,
        },
      },
      ...( /approved supplier/i.test(rawText)
        ? [
            {
              id: "c-approved",
              concept: "approved_supplier",
              operator: ConstraintOperator.REQUIRE,
              value: true,
              kind: ConstraintKind.HARD,
              importance: 0.9,
              confidence: 0.8,
              sourceType: SourceType.HUMAN,
              mutability: ConstraintMutability.HUMAN_REVISABLE,
              meaningClass: MeaningClass.EXPLICIT,
              grounding: {
                sourceText: "approved supplier",
                quoteExact: true,
              },
            },
          ]
        : []),
    ],
    preferences: [
      {
        id: "p-morning",
        concept: "prefer_morning",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.PREFERENCE,
        importance: 0.3,
        confidence: 0.5,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.HUMAN_REVISABLE,
        meaningClass: MeaningClass.IMPLIED,
        grounding: {
          sourceText: "prefer morning",
          quoteExact: false,
        },
      },
    ].filter(() => /prefer morning/i.test(rawText)),
    assumptions: [],
    ambiguities: /approved supplier/i.test(rawText)
      ? [
          {
            id: "amb-approval",
            description: "Approval source for approved supplier is unknown",
            ambiguityClass: "A2" as const,
            relatedConcepts: ["approved_supplier"],
            sourceText: "approved supplier",
          },
        ]
      : [],
    readiness: "PLANNABLE" as const,
  };
}

export function cleanVerifierOutput() {
  return {
    findings: [
      {
        code: "APPROVAL_AMBIGUOUS",
        severity: "MEDIUM" as const,
        message: "approved supplier lacks known approval authority source",
        confidence: 0.9,
        sourceRefs: ["approved supplier"],
      },
    ],
    transformations: [],
    criticalFailure: false,
    readiness: "PLANNABLE" as const,
    ambiguityClass: "A2" as const,
  };
}

export function industrialGradeCompilerOutput(rawText: string) {
  const base = cleanCompilerOutput(rawText);
  return {
    ...base,
    constraints: base.constraints.map((c) =>
      c.concept === "food_grade"
        ? {
            ...c,
            // Defective: concept weakened while still quoting food-grade span
            concept: "industrial_grade",
            value: "industrial",
            grounding: c.grounding,
            meaningClass: MeaningClass.EXPLICIT,
          }
        : c,
    ),
  };
}

export function inventedBpaCompilerOutput(rawText: string) {
  const base = cleanCompilerOutput(rawText);
  return {
    ...base,
    constraints: [
      ...base.constraints,
      {
        id: "c-bpa",
        concept: "BPA_free",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 0.7,
        sourceType: SourceType.AGENT,
        mutability: ConstraintMutability.SYSTEM_DERIVED,
        meaningClass: MeaningClass.EXPLICIT,
        grounding: { sourceText: "BPA free", quoteExact: false },
      },
    ],
  };
}

export function rejectVerifierOutput(code: string, message: string) {
  return {
    findings: [
      {
        code,
        severity: "CRITICAL" as const,
        message,
        confidence: 1,
        sourceRefs: [],
        transformation: {
          fromConcept: "food_grade",
          toConcept: "industrial_grade",
          class: "WEAKENED" as const,
          severity: "CRITICAL" as const,
          evidenceSpans: [],
          message,
        },
      },
    ],
    transformations: [
      {
        fromConcept: "food_grade",
        toConcept: "industrial_grade",
        class: "WEAKENED" as const,
        severity: "CRITICAL" as const,
        evidenceSpans: [],
      },
    ],
    criticalFailure: true,
    readiness: "SEARCHABLE" as const,
    ambiguityClass: "A0" as const,
  };
}

export function asCompleted(result: Result<CompileAndVerifyResult>) {
  if (!result.ok) {
    throw new Error(result.message);
  }
  if (result.value.status !== "COMPLETED") {
    throw new Error(`expected COMPLETED, got ${result.value.status}`);
  }
  return result.value;
}
