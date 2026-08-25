import { FakeModel } from "@truemandate/model";
import {
  AmbiguityClass,
  ConstraintKind,
  IntentReadiness,
  MeaningClass,
  SemanticLifecycle,
  SourceType,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  mergeAmbiguityClass,
  normalizeApprovalSourceAmbiguities,
  readinessAfterVerification,
} from "./deterministic.js";
import { verifyCandidate } from "./verifier.js";

const INTENT = {
  id: "intent-rp",
  principalId: "p",
  rawText: "Buy 500 food grade containers from an approved supplier for under INR 800000 before 2030-12-31T23:59:59.000Z",
  createdAt: "2026-06-01T12:00:00.000Z",
  contentHash: "h".repeat(64),
} as never;

const NAMED_INTENT = {
  ...INTENT,
  rawText:
    "Buy 500 food-grade containers from approved supplier Wave1 Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z",
} as never;

function constraint(partial: Record<string, unknown>) {
  return {
    id: partial.id,
    concept: partial.concept,
    operator: partial.operator ?? "EQ",
    value: partial.value,
    kind: partial.kind ?? ConstraintKind.HARD,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: "IMMUTABLE",
    meaningClass: MeaningClass.EXPLICIT,
    grounding: { sourceText: String(partial.value), sourceSpan: { start: 0, end: 1 }, quoteExact: true },
    ...(partial.temporalResolution ? { temporalResolution: partial.temporalResolution } : {}),
  } as never;
}

function purchaseConstraints(namedVendor: boolean) {
  return [
    constraint({ id: "c-quantity", concept: "quantity", value: 500, kind: ConstraintKind.HARD }),
    constraint({ id: "c-item", concept: "item_specification", value: "food-grade containers", kind: ConstraintKind.SAFETY_CRITICAL }),
    namedVendor
      ? constraint({ id: "c-vendor", concept: "vendor_identity", value: "Wave1 Supplier", kind: ConstraintKind.HARD })
      : constraint({ id: "c-supplier", concept: "approved_supplier", value: true, operator: "REQUIRE", kind: ConstraintKind.ORGANIZATIONAL_POLICY }),
    constraint({ id: "c-budget", concept: "budget", value: 800000, operator: "LT", kind: ConstraintKind.FINANCIAL }),
    constraint({
      id: "c-deadline", concept: "delivery_deadline", value: "2030-12-31T23:59:59.000Z", operator: "LTE", kind: ConstraintKind.TEMPORAL,
      temporalResolution: { originalExpression: "before 2030-12-31T23:59:59.000Z", resolvedValue: "2030-12-31T23:59:59.000Z", resolutionTimestamp: "2026-06-01T12:00:00.000Z", timezone: "UTC" },
    }),
  ];
}

function candidate(overrides: { constraints?: unknown[]; ambiguities?: unknown[]; readiness?: IntentReadiness } = {}) {
  return {
    id: "candidate-rp",
    intentId: "intent-rp",
    rawIntentHash: "h".repeat(64),
    goal: "Procure food-grade containers",
    constraints: overrides.constraints ?? purchaseConstraints(false),
    preferences: [],
    assumptions: [],
    ambiguities: overrides.ambiguities ?? [],
    readiness: overrides.readiness ?? IntentReadiness.EXECUTABLE,
    lifecycle: SemanticLifecycle.COMPILED,
    compiledAt: "2026-06-01T12:00:00.000Z",
    candidateHash: "c".repeat(64),
    modelMeta: { modelId: "fake", modelVersion: "1", promptVersion: "v1", schemaId: "c", schemaVersion: "1", protocolVersion: "0.1", requestId: "r", timestamp: "2026-06-01T12:00:00.000Z" },
  } as never;
}

function approvalAmbiguity(cls: AmbiguityClass) {
  return {
    id: "amb-approved-supplier",
    description: "Approval source and validation registry for approved supplier status are not specified.",
    ambiguityClass: cls,
    relatedConcepts: ["vendor_identity", "supplier_approval_status"],
    sourceText: "approved supplier",
  };
}

describe("deterministic authorization-readiness policy", () => {
  it("returns the identical tier when the model proposes EXECUTABLE or PLANNABLE/A1 with identical non-blocking findings", () => {
    const high = readinessAfterVerification(INTENT, candidate({ readiness: IntentReadiness.EXECUTABLE }), false, AmbiguityClass.A0);
    const low = readinessAfterVerification(INTENT, candidate({ readiness: IntentReadiness.PLANNABLE }), false, AmbiguityClass.A1);
    expect(high).toBe(IntentReadiness.ACTIONABLE);
    expect(low).toBe(IntentReadiness.ACTIONABLE);
  });

  it("keeps genuine structured ambiguity below privileged readiness", () => {
    const ambiguous = candidate({ ambiguities: [{ id: "a1", description: "Supplier list unclear", ambiguityClass: AmbiguityClass.A2, relatedConcepts: ["approved_supplier"] }] });
    const tier = readinessAfterVerification(INTENT, ambiguous, false, AmbiguityClass.A2);
    expect(tier).toBe(IntentReadiness.PLANNABLE);
  });

  it("refuses model over-promotion when authoritative purchase conditions are missing", () => {
    const noSupplier = candidate({ constraints: candidate().constraints.filter((c: { concept: string }) => c.concept !== "approved_supplier") });
    const tier = readinessAfterVerification(INTENT, noSupplier, false, AmbiguityClass.A0);
    expect(tier).not.toBe(IntentReadiness.ACTIONABLE);
    expect(tier).not.toBe(IntentReadiness.EXECUTABLE);
  });

  it("reaches ACTIONABLE for a fully specified executable purchase", () => {
    expect(readinessAfterVerification(INTENT, candidate(), false, AmbiguityClass.A0)).toBe(IntentReadiness.ACTIONABLE);
  });

  it("requires a grounded explicit-human temporal constraint when the intent contains a deadline", () => {
    const noTemporal = candidate({ constraints: candidate().constraints.filter((c: { kind: string }) => c.kind !== "TEMPORAL") });
    const tier = readinessAfterVerification(INTENT, noTemporal, false, AmbiguityClass.A0);
    expect(tier).toBe(IntentReadiness.SEARCHABLE);
  });

  it("gives the live SaaS A1 shape a deterministic planning floor without privileged readiness", () => {
    const saasIntent = {
      ...INTENT,
      rawText: "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term for under USD 12000 before December 31, 2026.",
    } as never;
    const saasConstraints = [
      constraint({ id: "c-seat", concept: "seat_count", value: 10 }),
      constraint({ id: "c-plan", concept: "plan_approval_status", value: true, operator: "REQUIRE", kind: ConstraintKind.ORGANIZATIONAL_POLICY }),
      constraint({ id: "c-renewal", concept: "renewal_type", value: "MANUAL" }),
      constraint({ id: "c-term", concept: "term_length_months", value: 12 }),
      constraint({ id: "c-budget", concept: "budget_limit", value: 12000, operator: "LT", kind: ConstraintKind.FINANCIAL }),
      constraint({ id: "c-deadline", concept: "deadline", value: "2026-12-31", operator: "LTE", kind: ConstraintKind.TEMPORAL }),
    ];
    const searchable = candidate({ constraints: saasConstraints, readiness: IntentReadiness.SEARCHABLE });
    const executable = candidate({ constraints: saasConstraints, readiness: IntentReadiness.EXECUTABLE });

    expect(readinessAfterVerification(saasIntent, searchable, false, AmbiguityClass.A1)).toBe(IntentReadiness.PLANNABLE);
    expect(readinessAfterVerification(saasIntent, executable, false, AmbiguityClass.A1)).toBe(IntentReadiness.PLANNABLE);
  });

  it("treats a human-grounded SaaS term as a duration rather than a calendar date", () => {
    const saasIntent = {
      ...INTENT,
      rawText: "Purchase an approved SaaS plan with a 12 month term under USD 12000.",
    } as never;
    const term = {
      ...constraint({ id: "c-term", concept: "contract_term_months", value: 12, kind: ConstraintKind.TEMPORAL }),
      grounding: { sourceText: "12 month term", quoteExact: true },
    };
    const budget = constraint({ id: "c-budget", concept: "budget_limit", value: 12000, kind: ConstraintKind.FINANCIAL });
    expect(readinessAfterVerification(
      saasIntent,
      candidate({ constraints: [term, budget], readiness: IntentReadiness.SEARCHABLE }),
      false,
      AmbiguityClass.A1,
    )).toBe(IntentReadiness.PLANNABLE);
  });

  it("accepts human-grounded implied Travel dates at the planning floor", () => {
    const travelIntent = {
      ...INTENT,
      rawText: "Book a refundable stay from 2026-11-10 to 2026-11-12 under USD 2000 before 2026-10-31.",
    } as never;
    const impliedDate = (id: string, concept: string, value: string) => ({
      ...constraint({ id, concept, value, kind: ConstraintKind.TEMPORAL }),
      meaningClass: MeaningClass.IMPLIED,
      grounding: { sourceText: value, sourceSpan: { start: 0, end: value.length }, quoteExact: true },
    });
    const travel = candidate({
      readiness: IntentReadiness.EXECUTABLE,
      constraints: [
        constraint({ id: "c-provider", concept: "booking_provider", value: "Meridian" }),
        constraint({ id: "c-refundable", concept: "refundable", value: true }),
        constraint({ id: "c-budget", concept: "total_budget", value: 2000, kind: ConstraintKind.FINANCIAL }),
        impliedDate("c-checkin", "check_in_date", "2026-11-10"),
        impliedDate("c-checkout", "check_out_date", "2026-11-12"),
        constraint({ id: "c-deadline", concept: "completion_deadline", value: "2026-10-31", kind: ConstraintKind.TEMPORAL }),
      ],
    });

    expect(readinessAfterVerification(travelIntent, travel, false, AmbiguityClass.A0))
      .toBe(IntentReadiness.PLANNABLE);
  });

  it("does not let implied temporal facts satisfy the stricter ACTIONABLE purchase rule", () => {
    const constraints = purchaseConstraints(false).map((row: { concept: string }) =>
      row.concept === "delivery_deadline"
        ? { ...row, meaningClass: MeaningClass.IMPLIED }
        : row,
    );
    expect(readinessAfterVerification(INTENT, candidate({ constraints }), false, AmbiguityClass.A0))
      .toBe(IntentReadiness.PLANNABLE);
  });

  it("rejects missing, malformed, inferred, and ungrounded planning facts", () => {
    const base = constraint({ id: "c-date", concept: "stay_start_date", value: "2026-11-10", kind: ConstraintKind.TEMPORAL });
    for (const invalid of [
      { ...base, value: null },
      { ...base, value: "not-a-date" },
      { ...base, meaningClass: MeaningClass.INFERRED },
      { ...base, grounding: { ...base.grounding, quoteExact: false } },
    ]) {
      expect(readinessAfterVerification(INTENT, candidate({ constraints: [invalid] }), false, AmbiguityClass.A1))
        .toBe(IntentReadiness.SEARCHABLE);
    }
  });

  it("keeps incomplete and ungrounded A0/A1 candidates fail-closed", () => {
    const incomplete = candidate({ constraints: [], readiness: IntentReadiness.EXECUTABLE });
    const ungroundedConstraint = {
      ...constraint({ id: "c-budget", concept: "budget", value: 800000, kind: ConstraintKind.FINANCIAL }),
      grounding: { sourceText: "under INR 800000", sourceSpan: { start: 0, end: 17 }, quoteExact: false },
    };
    const ungrounded = candidate({ constraints: [ungroundedConstraint], readiness: IntentReadiness.PLANNABLE });

    expect(readinessAfterVerification(INTENT, incomplete, false, AmbiguityClass.A0)).toBe(IntentReadiness.SEARCHABLE);
    expect(readinessAfterVerification(INTENT, ungrounded, false, AmbiguityClass.A1)).toBe(IntentReadiness.SEARCHABLE);
  });

  it("keeps critical failures and A3/A4 fail-closed regardless of complete facts", () => {
    expect(readinessAfterVerification(INTENT, candidate(), true, AmbiguityClass.A0)).toBe(IntentReadiness.SEARCHABLE);
    expect(readinessAfterVerification(INTENT, candidate(), false, AmbiguityClass.A3)).toBe(IntentReadiness.SEARCHABLE);
    expect(readinessAfterVerification(INTENT, candidate(), false, AmbiguityClass.A4)).toBe(IntentReadiness.SEARCHABLE);
  });

  it("keeps tainted/advisory model findings from altering the deterministic tier", () => {
    // Advisory non-blocking model findings (including injected instruction
    // text) never change the tier computed from authoritative facts.
    const tier = readinessAfterVerification(INTENT, candidate(), false, AmbiguityClass.A0);
    expect(tier).toBe(IntentReadiness.ACTIONABLE);
    expect(mergeAmbiguityClass(candidate(), [] as never)).toBe(AmbiguityClass.A0);
  });

  it("stamps the model-proposed tier as audit-only while the consumed tier is deterministic", async () => {
    const model = new FakeModel({
      handlers: {
        "verifier.result.v1": async () => ({
          findings: [], transformations: [], criticalFailure: false,
          readiness: IntentReadiness.PLANNABLE, ambiguityClass: AmbiguityClass.A1,
        }),
      },
    });
    const result = await verifyCandidate(INTENT, candidate(), { model });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.modelProposedReadiness).toBe(IntentReadiness.PLANNABLE);
    expect(result.value.modelProposedAmbiguityClass).toBe(AmbiguityClass.A1);
    // Authorization-readiness consumed by gates is deterministic.
    expect(result.value.readiness).toBe(IntentReadiness.ACTIONABLE);
    expect(result.value.lifecycle).toBe(SemanticLifecycle.VERIFIED);
  });
});

describe("normalizeApprovalSourceAmbiguities — named EXPLICIT vendor", () => {
  it("caps exact approved-supplier sourceText A2 to A1 and yields ACTIONABLE", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [approvalAmbiguity(AmbiguityClass.A2)],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A1);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A1);
    expect(
      readinessAfterVerification(NAMED_INTENT, normalized, false, AmbiguityClass.A1),
    ).toBe(IntentReadiness.ACTIONABLE);
  });

  it("caps exact approved-supplier sourceText A3 to A1 and yields ACTIONABLE", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [approvalAmbiguity(AmbiguityClass.A3)],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A1);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A1);
    expect(
      readinessAfterVerification(NAMED_INTENT, normalized, false, AmbiguityClass.A1),
    ).toBe(IntentReadiness.ACTIONABLE);
  });

  it("never caps A4 — exact approved-supplier sourceText remains A4/SEARCHABLE", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [approvalAmbiguity(AmbiguityClass.A4)],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A4);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A4);
    expect(
      readinessAfterVerification(NAMED_INTENT, normalized, false, AmbiguityClass.A4),
    ).toBe(IntentReadiness.SEARCHABLE);
  });

  it("leaves supplier-certification description A3 unchanged (no exact source match)", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [{
        id: "amb-cert",
        description: "supplier certification unclear",
        ambiguityClass: AmbiguityClass.A3,
        relatedConcepts: ["supplier_approval_status"],
        sourceText: "supplier certification unclear",
      }],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A3);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A3);
  });

  it("leaves approved payment terms A3 unchanged", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [{
        id: "amb-payment",
        description: "Approved payment terms are underspecified",
        ambiguityClass: AmbiguityClass.A3,
        relatedConcepts: ["payment_terms"],
        sourceText: "approved payment terms",
      }],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A3);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A3);
  });

  it("leaves unnamed-supplier exact approval A2/A3 unchanged", () => {
    for (const cls of [AmbiguityClass.A2, AmbiguityClass.A3] as const) {
      const raw = candidate({ ambiguities: [approvalAmbiguity(cls)] });
      const normalized = normalizeApprovalSourceAmbiguities(raw);
      expect(normalized.ambiguities[0]?.ambiguityClass).toBe(cls);
      expect(mergeAmbiguityClass(normalized, [])).toBe(cls);
      const tier = readinessAfterVerification(INTENT, normalized, false, cls);
      if (cls === AmbiguityClass.A3) expect(tier).toBe(IntentReadiness.SEARCHABLE);
      else expect(tier).toBe(IntentReadiness.PLANNABLE);
    }
  });

  it("leaves unrelated budget A3 unchanged even when vendor is EXPLICIT named", () => {
    const raw = candidate({
      constraints: purchaseConstraints(true),
      ambiguities: [{
        id: "amb-budget-scope",
        description: "Budget currency conversion source is unclear",
        ambiguityClass: AmbiguityClass.A3,
        relatedConcepts: ["budget", "fx_rate"],
        sourceText: "under INR 800000",
      }],
    });
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.ambiguities[0]?.ambiguityClass).toBe(AmbiguityClass.A3);
    expect(mergeAmbiguityClass(normalized, [])).toBe(AmbiguityClass.A3);
    expect(
      readinessAfterVerification(NAMED_INTENT, normalized, false, AmbiguityClass.A3),
    ).toBe(IntentReadiness.SEARCHABLE);
  });

  it("does not mutate constraints (Guardian/proof inputs untouched)", () => {
    const constraints = purchaseConstraints(true);
    const raw = candidate({
      constraints,
      ambiguities: [approvalAmbiguity(AmbiguityClass.A3)],
    });
    const before = structuredClone(raw.constraints);
    const normalized = normalizeApprovalSourceAmbiguities(raw);
    expect(normalized.constraints).toEqual(before);
    expect(raw.constraints).toEqual(before);
  });

  it("verifyCandidate consumes normalized A3 approval ambiguity as A1/ACTIONABLE", async () => {
    const model = new FakeModel({
      handlers: {
        "verifier.result.v1": async () => ({
          findings: [], transformations: [], criticalFailure: false,
          readiness: IntentReadiness.SEARCHABLE, ambiguityClass: AmbiguityClass.A3,
        }),
      },
    });
    const result = await verifyCandidate(
      NAMED_INTENT,
      candidate({
        constraints: purchaseConstraints(true),
        ambiguities: [approvalAmbiguity(AmbiguityClass.A3)],
      }),
      { model },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ambiguityClass).toBe(AmbiguityClass.A1);
    expect(result.value.readiness).toBe(IntentReadiness.ACTIONABLE);
    expect(result.value.lifecycle).toBe(SemanticLifecycle.VERIFIED);
    expect(result.value.modelProposedAmbiguityClass).toBe(AmbiguityClass.A3);
  });
});
