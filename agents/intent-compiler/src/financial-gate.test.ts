import { FakeModel } from "@truemandate/model";
import { ConstraintKind, ConstraintMutability, ConstraintOperator, ErrorCode, MeaningClass, SourceType } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { compileIntent } from "./compiler.js";
import { COMPILER_SCHEMA_ID } from "./prompts/v1.js";

const RAW = "Buy 500 food grade containers from an approved supplier for under INR 800000";
const INTENT = {
  id: "intent-fin", principalId: "p", rawText: RAW,
  createdAt: "2026-06-01T12:00:00.000Z", contentHash: "h".repeat(64),
} as never;
const INVOICE_RAW = "Pay the invoice monthly for INR 25000";
const INVOICE_INTENT = {
  id: "intent-invoice", principalId: "p", rawText: INVOICE_RAW,
  createdAt: "2026-06-01T12:00:00.000Z", contentHash: "i".repeat(64),
} as never;

function constraint(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-budget", concept: "budget", operator: ConstraintOperator.LT,
    value: 800000, kind: ConstraintKind.FINANCIAL, importance: 1, confidence: 1,
    sourceType: SourceType.HUMAN, mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: { sourceText: "under INR 800000", sourceSpan: { start: RAW.indexOf("under"), end: RAW.length }, quoteExact: true },
    ...overrides,
  };
}

async function compileWith(budget: unknown) {
  const model = new FakeModel({ handlers: { [COMPILER_SCHEMA_ID]: async () => ({
    goal: "Procure food-grade containers", readiness: "EXECUTABLE",
    constraints: [constraint({ value: budget })], preferences: [], assumptions: [], ambiguities: [],
  }) } });
  return compileIntent(INTENT, { model });
}

async function compileWithConstraints(constraints: readonly Record<string, unknown>[]) {
  const model = new FakeModel({ handlers: { [COMPILER_SCHEMA_ID]: async () => ({
    goal: "Process invoice", readiness: "EXECUTABLE",
    constraints, preferences: [], assumptions: [], ambiguities: [],
  }) } });
  return compileIntent(INVOICE_INTENT, { model });
}

describe("deterministic financial constraint structural gate", () => {
  it("preserves a canonical numeric budget value", async () => {
    const result = await compileWith(800000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints[0]!.value).toBe(800000);
  });

  it("normalizes an equivalent numeric string to the canonical number", async () => {
    const result = await compileWith("800000");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints[0]!.value).toBe(800000);
  });

  it("rejects an empty value object before the candidate can become authoritative", async () => {
    const result = await compileWith({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.GROUNDING_FAILED);
  });

  it("rejects missing, null, NaN and non-finite amounts fail-closed before authority", async () => {
    for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, "not-a-number", [800000]]) {
      const result = await compileWith(bad);
      expect(result.ok).toBe(false);
    }
  });

  it("does not treat categorical financial scheduling constraints as numeric amounts", async () => {
    const result = await compileWithConstraints([
      constraint({
        id: "c-frequency",
        concept: "payment_frequency",
        operator: ConstraintOperator.REQUIRE,
        value: "monthly",
        grounding: {
          sourceText: "monthly",
          sourceSpan: { start: INVOICE_RAW.indexOf("monthly"), end: INVOICE_RAW.indexOf("monthly") + "monthly".length },
          quoteExact: true,
        },
      }),
      constraint({
        id: "c-amount",
        concept: "invoice_budget",
        operator: ConstraintOperator.LTE,
        value: "25000",
        grounding: {
          sourceText: "INR 25000",
          sourceSpan: { start: INVOICE_RAW.indexOf("INR 25000"), end: INVOICE_RAW.indexOf("INR 25000") + "INR 25000".length },
          quoteExact: true,
        },
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.find((row) => row.id === "c-frequency")?.value).toBe("monthly");
    expect(result.value.constraints.find((row) => row.id === "c-amount")?.value).toBe(25000);
  });

  it("still rejects non-numeric amount-like financial constraints fail-closed", async () => {
    const result = await compileWithConstraints([
      constraint({
        id: "c-amount",
        concept: "invoice_amount",
        operator: ConstraintOperator.EQ,
        value: "monthly",
      }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.GROUNDING_FAILED);
  });
});
