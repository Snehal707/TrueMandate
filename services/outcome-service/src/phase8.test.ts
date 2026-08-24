import { IntentService } from "@truemandate/intent-service";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  PaymentStatus,
  SourceType,
  asConstraintId,
} from "@truemandate/protocol";
import { EvidenceService } from "@truemandate/evidence-service";
import { FakeModel } from "@truemandate/model";
import { deriveObservations, type AcceptedEvidenceClaim } from "@truemandate/outcome-core";
import { OutcomeVerifier } from "@truemandate/outcome-verifier";
import { emptyTaint } from "@truemandate/provenance";
import { describe, expect, it } from "vitest";
import { OutcomeService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";
const WED = "2026-06-04T12:00:00.000Z";
const FRI = "2026-06-06T23:59:59.000Z";
const SAT = "2026-06-07T12:00:00.000Z";

async function seedIntent() {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: "intent-p8",
    principalId: "principal-1",
    rawText: "Buy 500 food-grade containers under INR 800000",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: "state-p8",
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.SAFETY_CRITICAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!state.ok) throw new Error("state");
  return { intents, intent: intent.value, state: state.value };
}

async function seedBareIntent(id: string, rawText: string) {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: `intent-${id}`,
    principalId: "principal-1",
    rawText,
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: `state-${id}`,
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [],
  });
  if (!state.ok) throw new Error("state");
  return { intents, intent: intent.value, state: state.value };
}

async function seedTravelIntent() {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: "intent-travel-p8",
    principalId: "principal-1",
    rawText:
      "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: "state-travel-p8",
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("travel-provider"),
        concept: "approved_provider",
        operator: ConstraintOperator.EQ,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-property"),
        concept: "property_name",
        operator: ConstraintOperator.EQ,
        value: "Seaside Lodge",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-refundable"),
        concept: "refundable",
        operator: ConstraintOperator.EQ,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-budget"),
        concept: "total_budget",
        operator: ConstraintOperator.LTE,
        value: 5000,
        kind: ConstraintKind.FINANCIAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-count"),
        concept: "hotel_stay_count",
        operator: ConstraintOperator.EQ,
        value: 2,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-date"),
        concept: "stay_start_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-20T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-checkout"),
        concept: "check_out_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-22T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-deadline"),
        concept: "completion_deadline",
        operator: ConstraintOperator.LTE,
        value: "2026-12-31T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!state.ok) throw new Error("state");
  return { intents, intent: intent.value, state: state.value };
}

function claim(id: string, concept: string, value: unknown): AcceptedEvidenceClaim {
  return {
    id,
    concept,
    value,
    source: "verifier",
    trustClass: "ELEVATED_EXTERNAL",
    capturedAt: NOW,
  };
}

describe("Phase 8 Outcome Contract Engine", () => {
  it("A: payment SUCCESS → AWAITING_OUTCOME; then 500+cert → SATISFIED", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-a",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      product: "fg-container",
      createdAt: NOW,
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;

    const paid = await outcomes.onPaymentSuccess(contract.value.id, NOW);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(paid.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(paid.value.state).not.toBe(OutcomeContractState.SATISFIED);

    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        paymentSettled: true,
        quantityReceived: 500,
        quantityOrdered: 500,
        pricePaid: 742000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        productObserved: "fg-container",
        productExpected: "fg-container",
        certificateValid: true,
      },
      NOW,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
  });

  it("B: 450 received → PARTIAL; payment still SUCCESS", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-b",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 450,
        quantityOrdered: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: true,
        productObserved: "fg",
        productExpected: "fg",
      },
      NOW,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.PARTIAL);
    expect(verified.value.contract.paymentStatus).toBe(PaymentStatus.SUCCESS);
    const qty = verified.value.contract.requirements.find(
      (r) => r.concept === "quantity_received",
    );
    expect(qty?.state).toBe(OutcomeRequirementState.PARTIAL);
  });

  it("C: industrial grade → food_grade BREACHED dominates", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-c",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: false,
        productObserved: "industrial",
        productExpected: "food-grade",
      },
      NOW,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.verification.criticalFailure).toBe(true);
    expect(verified.value.contract.state).toBe(OutcomeContractState.BREACHED);
    const food = verified.value.contract.requirements.find(
      (r) => r.concept === "food_grade",
    );
    expect(food?.criticality).toBe(OutcomeRequirementCriticality.SAFETY_CRITICAL);
    expect(food?.state).toBe(OutcomeRequirementState.BREACHED);
  });

  it("D: merchant 500 vs warehouse 450 → CONFLICTED", async () => {
    const { state } = await seedIntent();
    const evidence = new EvidenceService();
    const outcomes = new OutcomeService(evidence);
    const contract = await outcomes.createContractFromIntent({
      id: "oc-d",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    evidence.putEnvelope({
      id: "env-m",
      source: "merchant",
      contentHash: "h1",
      trustClass: "UNTRUSTED_EXTERNAL",
      captureTime: NOW,
      taint: emptyTaint(),
      lineageGroupId: "merchant-src",
    });
    evidence.putEnvelope({
      id: "env-w",
      source: "warehouse",
      contentHash: "h2",
      trustClass: "UNTRUSTED_EXTERNAL",
      captureTime: NOW,
      taint: emptyTaint(),
      lineageGroupId: "warehouse-src",
    });
    evidence.putClaim({
      id: "cl-m",
      evidenceId: "env-m",
      concept: "quantity_received",
      value: 500,
      confidence: 1,
      derivedBy: "system",
      taint: emptyTaint(),
    });
    evidence.putClaim({
      id: "cl-w",
      evidenceId: "env-w",
      concept: "quantity_received",
      value: 450,
      confidence: 1,
      derivedBy: "system",
      taint: emptyTaint(),
    });
    const conflict = evidence.detectConflict("quantity_received", ["cl-m", "cl-w"]);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe(ErrorCode.EVIDENCE_CONFLICT);

    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: true,
        productObserved: "fg",
        productExpected: "fg",
      },
      NOW,
      { conflictedConcepts: ["quantity_received"] },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.CONFLICTED);
    expect(verified.value.contract.state).not.toBe(OutcomeContractState.SATISFIED);
  });

  it("E: ETA Saturday vs Friday deadline → AT_RISK Wednesday", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel",
      principalId: "principal-1",
      rawText: "Deliver by Friday",
      createdAt: WED,
    });
    if (!intent.ok) return;
    const state = await intents.createIntentState({
      id: "state-travel",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: WED,
      constraints: [
        {
          id: asConstraintId("c-deadline"),
          concept: "delivery_before",
          operator: ConstraintOperator.LTE,
          value: FRI,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) return;
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-e",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "carrier",
      quantity: 1,
      budgetMax: 1000,
      createdAt: WED,
      domain: "travel",
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    // Move to AWAITING_OUTCOME via payment then observe ETA
    await outcomes.onPaymentSuccess(contract.value.id, WED);
    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        deliveryEta: SAT,
        deadline: FRI,
        now: WED,
      },
      WED,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.AT_RISK);
    expect(outcomes.listRiskSignals(contract.value.id).length).toBeGreaterThan(0);
  });

  it("travel verified outcome evidence reaches SATISFIED without procurement-only quantity requirements", async () => {
    const { state } = await seedTravelIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-satisfied",
      intentState: state,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    expect(
      contract.value.requirements.some((requirement) => requirement.concept === "quantity_received"),
    ).toBe(false);
    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 2),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
  });

  it("treats cancellation_policy requirements as refundability on the shared evaluator for travel outcomes", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel-cancellation-policy",
      principalId: "principal-1",
      rawText:
        "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error("intent");
    const state = await intents.createIntentState({
      id: "state-travel-cancellation-policy",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("travel-cancellation"),
          concept: "cancellation_policy",
          operator: ConstraintOperator.EQ,
          value: "refundable",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error("state");
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-cancellation-policy",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    const liveRequirement = contract.value.requirements.find(
      (requirement) => requirement.concept === "cancellation_policy",
    );
    expect(liveRequirement).toBeDefined();
    expect(liveRequirement?.value).toBe("refundable");

    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 2),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "cancellation_policy",
      )?.state,
    ).toBe(OutcomeRequirementState.SATISFIED);
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
  });

  it("keeps cancellation_policy UNSATISFIED when verified evidence proves non-refundable", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel-cancellation-policy-fail",
      principalId: "principal-1",
      rawText: "Book a refundable stay.",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error("intent");
    const state = await intents.createIntentState({
      id: "state-travel-cancellation-policy-fail",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("travel-cancellation-fail"),
          concept: "cancellation_policy",
          operator: ConstraintOperator.EQ,
          value: "refundable",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error("state");
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-cancellation-policy-fail",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 1,
      budgetMax: 5000,
      createdAt: NOW,
      domain: "travel",
      parameters: {
        refundableRequired: true,
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    const derived = deriveObservations(contract.value, [
      claim("travel-refundable-fail", "refundable", false),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "cancellation_policy",
      )?.state,
    ).toBe(OutcomeRequirementState.BREACHED);
  });

  it("travel count shortfall can legitimately BREACH when the authoritative contract carries hard stay-count constraints", async () => {
    const { state } = await seedTravelIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-partial",
      intentState: state,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 1),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.BREACHED);
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "traveler_count_confirmed",
      )?.state,
    ).toBe(OutcomeRequirementState.PARTIAL);
  });

  it("satisfies a live-shape travel stay_quantity outcome requirement from traveler_count evidence on the shared evaluator", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel-live-shape",
      principalId: "principal-1",
      rawText:
        "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error("intent");
    const state = await intents.createIntentState({
      id: "state-travel-live-shape",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("travel-provider"),
          concept: "approved_provider",
          operator: ConstraintOperator.EQ,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-property"),
          concept: "property_name",
          operator: ConstraintOperator.EQ,
          value: "Seaside Lodge",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-refundable"),
          concept: "refundable",
          operator: ConstraintOperator.EQ,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-budget"),
          concept: "total_budget",
          operator: ConstraintOperator.LTE,
          value: 5000,
          kind: ConstraintKind.FINANCIAL,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-count"),
          concept: "stay_quantity",
          operator: ConstraintOperator.EQ,
          value: 2,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-date"),
          concept: "stay_start_date",
          operator: ConstraintOperator.EQ,
          value: "2026-12-20T00:00:00.000Z",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-checkout"),
          concept: "check_out_date",
          operator: ConstraintOperator.EQ,
          value: "2026-12-22T00:00:00.000Z",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
        {
          id: asConstraintId("travel-deadline"),
          concept: "completion_deadline",
          operator: ConstraintOperator.LTE,
          value: "2026-12-31T00:00:00.000Z",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error("state");

    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-live-shape",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    expect(
      contract.value.requirements.some((requirement) => requirement.concept === "stay_quantity"),
    ).toBe(true);

    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 2),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "stay_quantity",
      )?.state,
    ).toBe(OutcomeRequirementState.SATISFIED);
  });

  it("satisfies a live-shape lodging_property outcome requirement from verified property_name evidence", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel-lodging-property-live-shape",
      principalId: "principal-1",
      rawText:
        "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error("intent");
    const state = await intents.createIntentState({
      id: "state-travel-lodging-property-live-shape",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("travel-lodging-property"),
          concept: "lodging_property",
          operator: ConstraintOperator.EQ,
          value: "Seaside Lodge",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error("state");

    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-lodging-property-live-shape",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 2),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "lodging_property",
      )?.state,
    ).toBe(OutcomeRequirementState.SATISFIED);
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
  });

  it("satisfies a live-shape hotel_property outcome requirement from verified property_name evidence", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-travel-hotel-property-live-shape",
      principalId: "principal-1",
      rawText:
        "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error("intent");
    const state = await intents.createIntentState({
      id: "state-travel-hotel-property-live-shape",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("travel-hotel-property"),
          concept: "hotel_property",
          operator: ConstraintOperator.EQ,
          value: "Seaside Lodge",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error("state");

    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-travel-hotel-property-live-shape",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      createdAt: NOW,
      domain: "travel",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
    });
    expect(contract.ok).toBe(true);
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    const derived = deriveObservations(contract.value, [
      claim("travel-provider", "provider", "Approved Travel Co"),
      claim("travel-approved", "approved_provider", true),
      claim("travel-booking", "booking_confirmed", true),
      claim("travel-count", "traveler_count", 2),
      claim("travel-amount", "total_amount", 3200),
      claim("travel-refundable", "refundable", true),
      claim("travel-property", "property_name", "Seaside Lodge"),
      claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
      claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
      claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const verified = await outcomes.applyObservations(
      contract.value.id,
      derived.value.facts,
      NOW,
      { conflictedConcepts: derived.value.conflictedConcepts },
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(
      verified.value.contract.requirements.find(
        (requirement) => requirement.concept === "hotel_property",
      )?.state,
    ).toBe(OutcomeRequirementState.SATISFIED);
    expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
  });

  it.each([
    {
      id: "procurement",
      domain: "procurement",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      product: "fg-container",
      claims: [
        claim("proc-merchant", "merchant_observed", "ApprovedFoodChem"),
        claim("proc-qty", "quantity_received", 500),
        claim("proc-price", "price_paid", 742000),
        claim("proc-product", "product_observed", "fg-container"),
        claim("proc-cert", "certificate_valid", true),
      ],
    },
    {
      id: "travel",
      domain: "travel",
      merchant: "Approved Travel Co",
      quantity: 2,
      budgetMax: 5000,
      product: "Seaside Lodge",
      parameters: {
        travelDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
        travelerCount: 2,
        refundableRequired: true,
        lodgingName: "Seaside Lodge",
      },
      claims: [
        claim("travel-provider", "provider", "Approved Travel Co"),
        claim("travel-approved", "approved_provider", true),
        claim("travel-booking", "booking_confirmed", true),
        claim("travel-count", "traveler_count", 2),
        claim("travel-amount", "total_amount", 3200),
        claim("travel-refundable", "refundable", true),
        claim("travel-property", "property_name", "Seaside Lodge"),
        claim("travel-date", "stay_start_date", "2026-12-20T00:00:00.000Z"),
        claim("travel-checkout", "check_out_date", "2026-12-22T00:00:00.000Z"),
        claim("travel-deadline", "completion_deadline", "2026-12-30T00:00:00.000Z"),
      ],
    },
    {
      id: "saas",
      domain: "saas_it_spend",
      merchant: "VendorCo",
      quantity: 25,
      budgetMax: 1200,
      product: "Pro Plan",
      parameters: {
        planName: "Pro Plan",
        seatCount: 25,
        termMonths: 12,
        renewalSetting: "MANUAL",
      },
      claims: [
        claim("saas-vendor", "vendor", "VendorCo"),
        claim("saas-plan", "plan_name", "Pro Plan"),
        claim("saas-seats", "seat_count", 25),
        claim("saas-amount", "total_amount", 1200),
        claim("saas-term", "term_months", 12),
        claim("saas-renewal", "renewal_setting", "MANUAL"),
      ],
    },
    {
      id: "invoice",
      domain: "invoice_vendor_payment",
      merchant: "PayeeCo",
      quantity: 1,
      budgetMax: 5000,
      product: "INV-100",
      parameters: {
        invoiceId: "INV-100",
        dueDate: "2026-12-31T00:00:00.000Z",
        remittanceReference: "REM-100",
      },
      claims: [
        claim("invoice-payee", "payee", "PayeeCo"),
        claim("invoice-amount", "total_amount", 5000),
        claim("invoice-identity", "invoice_id", "INV-100"),
        claim("invoice-remittance", "remittance_reference", "REM-100"),
        claim("invoice-settled", "invoice_settled_exactly_once", true),
        claim("invoice-due", "due_date", "2026-12-31T00:00:00.000Z"),
      ],
    },
    {
      id: "logistics",
      domain: "logistics_fulfillment",
      merchant: "CarrierCo",
      quantity: 10,
      budgetMax: 900,
      product: "EXPRESS",
      parameters: {
        destination: "Mumbai",
        serviceLevel: "EXPRESS",
        shipBy: "2026-12-30T00:00:00.000Z",
        fulfillCount: 10,
      },
      claims: [
        claim("log-provider", "carrier", "CarrierCo"),
        claim("log-dispatch", "dispatch_confirmed", true),
        claim("log-quantity", "shipment_quantity", 10),
        claim("log-price", "total_amount", 900),
        claim("log-destination", "destination", "Mumbai"),
        claim("log-service", "service_level", "EXPRESS"),
        claim("log-shipby", "ship_by", "2026-12-30T00:00:00.000Z"),
      ],
    },
  ])(
    "evaluates %s through the same shared outcome engine",
    async ({ id, domain, merchant, quantity, budgetMax, product, parameters, claims }) => {
      const state =
        domain === "travel"
          ? (await seedTravelIntent()).state
          : (
              await seedBareIntent(
                `${id}-domain`,
                `Domain outcome validation fixture for ${domain}`,
              )
            ).state;
      const outcomes = new OutcomeService();
      const contract = await outcomes.createContractFromIntent({
        id: `oc-${id}-domain`,
        intentState: state,
        principalId: "principal-1",
        merchant,
        quantity,
        budgetMax,
        product,
        createdAt: NOW,
        domain,
        parameters,
      });
      expect(contract.ok).toBe(true);
      if (!contract.ok) return;
      await outcomes.onPaymentSuccess(contract.value.id, NOW);
      const derived = deriveObservations(contract.value, claims);
      expect(derived.ok).toBe(true);
      if (!derived.ok) return;
      const verified = await outcomes.applyObservations(
        contract.value.id,
        derived.value.facts,
        NOW,
        { conflictedConcepts: derived.value.conflictedConcepts },
      );
      expect(verified.ok).toBe(true);
      if (!verified.ok) return;
      expect(verified.value.contract.state).toBe(OutcomeContractState.SATISFIED);
    },
  );

  it("UNKNOWN execution keeps AWAITING_EXECUTION; never SATISFIED", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-unk",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    const unk = await outcomes.onPaymentUnknown(contract.value.id, NOW);
    expect(unk.ok).toBe(true);
    if (!unk.ok) return;
    expect(unk.value.state).toBe(OutcomeContractState.AWAITING_EXECUTION);
    expect(unk.value.state).not.toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(unk.value.state).not.toBe(OutcomeContractState.SATISFIED);
  });

  it("quiet-hotel semantic contradict via outcome-verifier findings", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-hotel",
      principalId: "principal-1",
      rawText: "Quiet hotel",
      createdAt: NOW,
    });
    if (!intent.ok) return;
    const state = await intents.createIntentState({
      id: "state-hotel",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-quiet"),
          concept: "quiet_hotel",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) return;
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-hotel",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "HotelLoud",
      quantity: 1,
      budgetMax: 20000,
      createdAt: NOW,
      domain: "travel",
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);

    const model = new FakeModel({
      handlers: {
        OutcomeVerifierFindings: () => ({
          findings: [
            {
              requirementId: "req-quiet_hotel",
              concept: "quiet_hotel",
              match: false,
              confidence: 0.95,
              rationale: "Street-facing nightclub adjacent",
            },
          ],
        }),
      },
    });
    const verifier = new OutcomeVerifier(model);
    const findings = await verifier.evaluate({
      requirements: contract.value.requirements,
      observations: { reviews: "very loud at night" },
    });
    expect(findings.ok).toBe(true);
    if (!findings.ok) return;
    expect(findings.value.findings[0]?.match).toBe(false);

    const verified = await outcomes.applyObservations(
      contract.value.id,
      { semanticMatch: false },
      NOW,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.contract.state).not.toBe(OutcomeContractState.SATISFIED);
  });

  it("model unavailable → HARD semantic UNKNOWN blocks SATISFIED", async () => {
    const model = new FakeModel({ unavailable: true });
    const verifier = new OutcomeVerifier(model);
    const result = await verifier.evaluate({
      requirements: [
        {
          id: "r1" as never,
          concept: "quiet_hotel",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          criticality: OutcomeRequirementCriticality.HARD,
          state: OutcomeRequirementState.PENDING,
          type: "SEMANTIC",
          evaluationMethod: "SEMANTIC",
        },
      ],
      observations: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
  });

  it("CREATED → SATISFIED transition rejected", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-illegal",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    const verified = await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 500,
        certificateValid: true,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        pricePaid: 1,
        budgetMax: 800000,
        productObserved: "x",
        productExpected: "x",
      },
      NOW,
    );
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.code).toBe(ErrorCode.OUTCOME_TRANSITION_INVALID);
    }
  });

  it("trigger identity stable across duplicate PARTIAL aggregation", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-trigger",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    const facts = {
      quantityReceived: 450,
      quantityOrdered: 500,
      pricePaid: 700000,
      budgetMax: 800000,
      merchantObserved: "ApprovedFoodChem",
      merchantExpected: "ApprovedFoodChem",
      certificateValid: true,
      productObserved: "fg",
      productExpected: "fg",
    };
    await outcomes.applyObservations(contract.value.id, facts, NOW);
    await outcomes.applyObservations(contract.value.id, facts, NOW);
    const partials = outcomes
      .listEvents(contract.value.id)
      .filter((e) => e.type === "OUTCOME_PARTIAL");
    expect(partials.length).toBe(1);
    expect(partials[0]?.triggerIdentity).toBeTruthy();
    expect(partials[0]?.conditionKey).toContain("quantity_received");
  });

  it("event dedupe suppresses duplicate payment_settled", async () => {
    const { state } = await seedIntent();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-dedupe",
      intentState: state,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    const events = outcomes.listEvents(contract.value.id).filter(
      (e) => e.type === "payment_settled",
    );
    expect(events.length).toBe(1);
  });

  it("stale evidence fails freshness check", async () => {
    const evidence = new EvidenceService();
    evidence.putEnvelope({
      id: "env-stale",
      source: "carrier",
      contentHash: "hs",
      trustClass: "UNTRUSTED_EXTERNAL",
      captureTime: "2020-01-01T00:00:00.000Z",
      freshnessDeadline: "2020-01-02T00:00:00.000Z",
      taint: emptyTaint(),
    });
    const fresh = evidence.assertFresh("env-stale", NOW);
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.code).toBe(ErrorCode.EVIDENCE_STALE);
  });

  it("copies of same source are not independent", async () => {
    const evidence = new EvidenceService();
    evidence.putEnvelope({
      id: "e1",
      source: "a",
      contentHash: "c1",
      trustClass: "UNTRUSTED_EXTERNAL",
      captureTime: NOW,
      taint: emptyTaint(),
      lineageGroupId: "same",
    });
    evidence.putEnvelope({
      id: "e2",
      source: "a-copy",
      contentHash: "c2",
      trustClass: "UNTRUSTED_EXTERNAL",
      captureTime: NOW,
      taint: emptyTaint(),
      lineageGroupId: "same",
    });
    const indep = evidence.assertIndependent(["e1", "e2"]);
    expect(indep.ok).toBe(false);
    if (!indep.ok) expect(indep.code).toBe(ErrorCode.EVIDENCE_NOT_INDEPENDENT);
  });
});
