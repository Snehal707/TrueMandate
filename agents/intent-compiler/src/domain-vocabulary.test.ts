import { FakeModel } from "@truemandate/model";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  SourceType,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { compileIntent } from "./compiler.js";
import { COMPILER_SCHEMA_ID } from "./prompts/v1.js";

const RAW =
  "Buy 500 food grade containers from an approved supplier for under INR 800000 delivered before 2026-12-31";
const INTENT = {
  id: "intent-nondeterminism",
  principalId: "p",
  rawText: RAW,
  createdAt: "2026-08-29T00:00:00.000Z",
  contentHash: "n".repeat(64),
} as never;

function constraint(
  id: string,
  concept: string,
  operator: ConstraintOperator,
  value: unknown,
  sourceText: string,
  kind: ConstraintKind = ConstraintKind.HARD,
) {
  const start = RAW.indexOf(sourceText);
  return {
    id,
    concept,
    operator,
    value,
    kind,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: {
      sourceText,
      sourceSpan: start >= 0 ? { start, end: start + sourceText.length } : undefined,
      quoteExact: start >= 0,
    },
  };
}

function singleConstraintOutput(concept: string) {
  return {
    goal: "Procure food-grade containers",
    readiness: "EXECUTABLE",
    constraints: [constraint("c-bad", concept, ConstraintOperator.EQ, 500, "500")],
    preferences: [],
    assumptions: [],
    ambiguities: [],
  };
}

function legitimateCanonicalOutput() {
  return {
    goal: "Procure food-grade containers",
    readiness: "EXECUTABLE",
    constraints: [
      constraint("c-quantity", "quantity", ConstraintOperator.EQ, 500, "500"),
      constraint("c-material", "material", ConstraintOperator.REQUIRE, "food grade containers", "food grade containers"),
      constraint("c-supplier", "supplier", ConstraintOperator.REQUIRE, "approved supplier", "approved supplier"),
      constraint("c-budget", "budget", ConstraintOperator.LT, 800000, "under INR 800000", ConstraintKind.FINANCIAL),
      constraint("c-deadline", "delivery_deadline", ConstraintOperator.LT, "2026-12-31T00:00:00.000Z", "before 2026-12-31"),
    ],
    preferences: [],
    assumptions: [],
    ambiguities: [],
  };
}

// Real-Gemini synonyms observed across separate compilations of identical
// rawText (see the live canary investigation) — none of these may ever
// become an authoritative Procurement concept once packId constrains the
// vocabulary, regardless of whether Vertex's own enum or the deterministic
// post-parse ontology check is what actually rejects them.
const OBSERVED_NONCANONICAL_SYNONYMS = [
  "item_quantity",
  "supplier_status",
  "supplier_qualification",
  "completion_deadline",
  "vendor_eligibility",
];

describe("compiler nondeterminism regression — Procurement canonical vocabulary", () => {
  it.each(OBSERVED_NONCANONICAL_SYNONYMS)(
    "rejects '%s' as an authoritative Procurement concept when packId is set",
    async (concept) => {
      const model = new FakeModel({
        handlers: { [COMPILER_SCHEMA_ID]: async () => singleConstraintOutput(concept) },
      });
      const result = await compileIntent(INTENT, { model, packId: "procurement" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Either Vertex's own enum-constrained schema or the deterministic
      // post-parse ontology check may be what actually catches this — both
      // are acceptable and both converge on the same fail-closed model-
      // output-rejection lifecycle (MODEL_OUTPUT_RETRY_CODES in
      // orchestrator.ts), never a silent guess or an invented alias.
      expect(result.code).toBe(ErrorCode.MODEL_OUTPUT_INVALID);
    },
  );

  it("accepts the legitimate canonical output for the same scenario", async () => {
    const model = new FakeModel({
      handlers: { [COMPILER_SCHEMA_ID]: async () => legitimateCanonicalOutput() },
    });
    const result = await compileIntent(INTENT, { model, packId: "procurement" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const concepts = result.value.constraints.map((c) => c.concept).sort();
    expect(concepts).toEqual(["budget", "delivery_deadline", "material", "quantity", "supplier"]);
  });

  it("leaves the legacy free-form vocabulary unrestricted when no packId is supplied", async () => {
    // Backward compatibility for the standalone POST /v1/intents route and
    // any other caller that never resolves a domain — canonical enforcement
    // must never punish a compilation that never opted into it.
    const model = new FakeModel({
      handlers: { [COMPILER_SCHEMA_ID]: async () => singleConstraintOutput("item_quantity") },
    });
    const result = await compileIntent(INTENT, { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints[0]?.concept).toBe("item_quantity");
  });
});

// Part 16: the same mechanism, generically, for the other four domain
// packs — using each domain's EXISTING canonical concept set from
// @truemandate/domain-ontology (no new vocabulary invented here). Each case
// proves a canonical concept compiles, and that a plausible synonym —
// including a real backward-compatibility alias from that domain's own
// ontology, which is legitimate as compiler INPUT-reading but never as new
// compiler OUTPUT (see Part 9) — is rejected once packId is set.
const OTHER_DOMAIN_CASES: readonly {
  readonly packId: string;
  readonly rawText: string;
  readonly canonicalConcept: string;
  readonly sourceText: string;
  readonly value: unknown;
  readonly nonCanonicalSynonym: string;
}[] = [
  {
    packId: "travel",
    rawText: "Book 2 rooms at an approved hotel provider for under USD 3200 checking in before 2026-12-31",
    canonicalConcept: "stay_count",
    sourceText: "2",
    value: 2,
    nonCanonicalSynonym: "travel_provider_approval",
  },
  {
    packId: "saas_it_spend",
    rawText: "Purchase 10 seats of the premium plan from an approved vendor for under USD 9000",
    canonicalConcept: "seat_count",
    sourceText: "10",
    value: 10,
    nonCanonicalSynonym: "preferred_vendor",
  },
  {
    packId: "invoice_vendor_payment",
    rawText: "Pay invoice INV-1001 to an approved payee for under USD 24000",
    canonicalConcept: "invoice_identity",
    sourceText: "INV-1001",
    value: "INV-1001",
    nonCanonicalSynonym: "invoice_budget",
  },
  {
    packId: "logistics_fulfillment",
    rawText: "Arrange fulfillment of 12 units to the approved carrier for under USD 3500",
    canonicalConcept: "fulfillment_count",
    sourceText: "12",
    value: 12,
    nonCanonicalSynonym: "approved_carrier",
  },
];

describe("compiler domain vocabulary — travel, saas_it_spend, invoice_vendor_payment, logistics_fulfillment", () => {
  it.each(OTHER_DOMAIN_CASES)(
    "accepts $packId's own canonical concept '$canonicalConcept'",
    async ({ packId, rawText, canonicalConcept, sourceText, value }) => {
      const intent = {
        id: `intent-${packId}`,
        principalId: "p",
        rawText,
        createdAt: "2026-08-29T00:00:00.000Z",
        contentHash: packId.slice(0, 8).padEnd(64, "0"),
      } as never;
      const start = rawText.indexOf(sourceText);
      const output = {
        goal: `Process ${packId} request`,
        readiness: "EXECUTABLE",
        constraints: [
          {
            id: "c-1",
            concept: canonicalConcept,
            operator: ConstraintOperator.EQ,
            value,
            kind: ConstraintKind.HARD,
            importance: 1,
            confidence: 1,
            sourceType: SourceType.HUMAN,
            mutability: ConstraintMutability.IMMUTABLE,
            meaningClass: MeaningClass.EXPLICIT,
            grounding: {
              sourceText,
              sourceSpan: start >= 0 ? { start, end: start + sourceText.length } : undefined,
              quoteExact: start >= 0,
            },
          },
        ],
        preferences: [],
        assumptions: [],
        ambiguities: [],
      };
      const model = new FakeModel({ handlers: { [COMPILER_SCHEMA_ID]: async () => output } });
      const result = await compileIntent(intent, { model, packId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.constraints[0]?.concept).toBe(canonicalConcept);
    },
  );

  it.each(OTHER_DOMAIN_CASES)(
    "rejects $packId's own alias '$nonCanonicalSynonym' as new compiler output",
    async ({ packId, rawText, nonCanonicalSynonym }) => {
      const intent = {
        id: `intent-${packId}-alias`,
        principalId: "p",
        rawText,
        createdAt: "2026-08-29T00:00:00.000Z",
        contentHash: packId.slice(0, 8).padEnd(64, "1"),
      } as never;
      const start = rawText.indexOf("approved");
      const output = {
        goal: `Process ${packId} request`,
        readiness: "EXECUTABLE",
        constraints: [
          {
            id: "c-1",
            concept: nonCanonicalSynonym,
            operator: ConstraintOperator.REQUIRE,
            value: true,
            kind: ConstraintKind.HARD,
            importance: 1,
            confidence: 1,
            sourceType: SourceType.HUMAN,
            mutability: ConstraintMutability.IMMUTABLE,
            meaningClass: MeaningClass.EXPLICIT,
            grounding: {
              sourceText: "approved",
              sourceSpan: start >= 0 ? { start, end: start + "approved".length } : undefined,
              quoteExact: start >= 0,
            },
          },
        ],
        preferences: [],
        assumptions: [],
        ambiguities: [],
      };
      const model = new FakeModel({ handlers: { [COMPILER_SCHEMA_ID]: async () => output } });
      const result = await compileIntent(intent, { model, packId });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.MODEL_OUTPUT_INVALID);
    },
  );
});
