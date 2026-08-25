import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  IntentReadiness,
  MeaningClass,
  SourceType,
  asIntentId,
  asPrincipalId,
} from "@truemandate/protocol";
import { hashCanonical } from "@truemandate/crypto";
import { FakeModel } from "@truemandate/model";
import { describe, expect, it } from "vitest";
import { compileIntent } from "./compiler.js";
import { COMPILER_SCHEMA_ID } from "./prompts/v1.js";

const RAW = "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5000 before December 31, 2026, with check-in on December 20 and checkout on December 22.";

function temporal(id: string, concept: string, value: string, sourceText: string, start: number, end: number) {
  return {
    id,
    concept,
    operator: ConstraintOperator.EQ,
    value,
    kind: ConstraintKind.TEMPORAL,
    importance: 1,
    confidence: 0.95,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.HUMAN_REVISABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: { sourceText, sourceSpan: { start, end }, quoteExact: true },
  };
}

describe("compiler source-span reconciliation", () => {
  it("accepts the production Travel shape when an exact unique quote has the wrong offset", async () => {
    const model = new FakeModel({
      handlers: { [COMPILER_SCHEMA_ID]: async () => ({
        goal: "Book the requested refundable stays",
        constraints: [
          temporal("c-check-in", "check_in_date", "2026-12-20", "December 20", 127, 138),
          temporal("c-check-out", "check_out_date", "2026-12-22", "December 22", 155, 166),
        ],
        preferences: [],
        assumptions: [],
        ambiguities: [],
        readiness: IntentReadiness.PLANNABLE,
      }) },
    });
    const intent = {
      id: asIntentId("intent-travel-span-regression"),
      principalId: asPrincipalId("principal"),
      rawText: RAW,
      createdAt: "2026-08-25T11:53:32.468Z",
      contentHash: hashCanonical(RAW),
    };

    const result = await compileIntent(intent, {
      model,
      now: intent.createdAt,
      timezone: "UTC",
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.value.constraints.map((constraint) => constraint.grounding.sourceSpan)).toEqual([
      { start: RAW.indexOf("December 20"), end: RAW.indexOf("December 20") + "December 20".length },
      { start: RAW.indexOf("December 22"), end: RAW.indexOf("December 22") + "December 22".length },
    ]);
  });
});
