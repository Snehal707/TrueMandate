import {
  ConstraintOperator,
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  PaymentStatus,
  asOutcomeRequirementId,
  type OutcomeContract,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { deriveObservations } from "./evidence-observations.js";

function contract(
  requirements: OutcomeContract["requirements"],
): OutcomeContract {
  return {
    id: "oc-1" as OutcomeContract["id"],
    intentId: "intent-1" as OutcomeContract["intentId"],
    intentStateId: "state-1" as OutcomeContract["intentStateId"],
    intentStateHash: "h".repeat(64) as OutcomeContract["intentStateHash"],
    principalId: "principal-1" as OutcomeContract["principalId"],
    merchant: "Approved Travel Co",
    requirements,
    state: OutcomeContractState.AWAITING_OUTCOME,
    paymentStatus: PaymentStatus.SUCCESS,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    version: 1,
  };
}

describe("deriveObservations", () => {
  it("derives travel observations from the authoritative contract without requiring procurement quantity_received", () => {
    const travel = contract([
      {
        id: asOutcomeRequirementId("travel-provider"),
        concept: "travel_provider_match",
        operator: ConstraintOperator.EQ,
        value: "Approved Travel Co",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "travel_provider_match",
      },
      {
        id: asOutcomeRequirementId("travel-booking"),
        concept: "travel_booking_confirmed",
        operator: ConstraintOperator.EQ,
        value: true,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "travel_booking_confirmed",
      },
      {
        id: asOutcomeRequirementId("travel-count"),
        concept: "traveler_count_confirmed",
        operator: ConstraintOperator.GTE,
        value: 2,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "traveler_count_confirmed",
      },
      {
        id: asOutcomeRequirementId("travel-refund"),
        concept: "travel_refundable",
        operator: ConstraintOperator.EQ,
        value: true,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "travel_refundable",
      },
      {
        id: asOutcomeRequirementId("travel-date"),
        concept: "stay_start_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-20T00:00:00.000Z",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "stay_start_date",
      },
      {
        id: asOutcomeRequirementId("travel-end-date"),
        concept: "check_out_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-22T00:00:00.000Z",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "check_out_date",
      },
      {
        id: asOutcomeRequirementId("travel-deadline"),
        concept: "completion_deadline",
        operator: ConstraintOperator.LTE,
        value: "2026-12-31T00:00:00.000Z",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "completion_deadline",
      },
    ]);

    const derived = deriveObservations(travel, [
      {
        id: "claim-provider",
        concept: "provider",
        value: "Approved Travel Co",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:00.000Z",
      },
      {
        id: "claim-approved",
        concept: "approved_provider",
        value: true,
        source: "policy-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:01.000Z",
      },
      {
        id: "claim-booking",
        concept: "booking_confirmed",
        value: true,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:02.000Z",
      },
      {
        id: "claim-count",
        concept: "traveler_count",
        value: 2,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:03.000Z",
      },
      {
        id: "claim-refund",
        concept: "refundable",
        value: true,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:04.000Z",
      },
      {
        id: "claim-amount",
        concept: "total_amount",
        value: 3200,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:05.000Z",
      },
      {
        id: "claim-date",
        concept: "stay_start_date",
        value: "2026-12-20T00:00:00.000Z",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:06.000Z",
      },
      {
        id: "claim-checkout",
        concept: "check_out_date",
        value: "2026-12-22T00:00:00.000Z",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:06.500Z",
      },
      {
        id: "claim-deadline",
        concept: "completion_deadline",
        value: "2026-12-30T00:00:00.000Z",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:05:07.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.observedValues?.travel_provider_match).toBeUndefined();
    expect(derived.value.facts.observedValues?.counterparty).toBe("Approved Travel Co");
    expect(derived.value.facts.observedValues?.provider_approval).toBe(true);
    expect(derived.value.facts.observedValues?.booking_confirmed).toBe(true);
    expect(derived.value.facts.observedValues?.quantity).toBe(2);
    expect(derived.value.facts.observedValues?.refundability).toBe(true);
    expect(derived.value.facts.observedValues?.date).toBe("2026-12-20T00:00:00.000Z");
    expect(derived.value.facts.observedValues?.end_date).toBe("2026-12-22T00:00:00.000Z");
    expect(derived.value.facts.observedValues?.deadline).toBe("2026-12-30T00:00:00.000Z");
    expect(derived.value.divergence).toBeUndefined();
  });

  it("preserves procurement quantity divergence semantics when quantity evidence is short", () => {
    const procurement = contract([
      {
        id: asOutcomeRequirementId("qty"),
        concept: "quantity_received",
        operator: ConstraintOperator.GTE,
        value: 500,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "quantity_received",
      },
    ]);

    const derived = deriveObservations(procurement, [
      {
        id: "claim-qty",
        concept: "quantity_received",
        value: 450,
        source: "warehouse",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:06:00.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.quantityReceived).toBe(450);
    expect(derived.value.facts.quantityOrdered).toBe(500);
    expect(derived.value.divergence).toEqual({
      requiredQuantity: 500,
      verifiedReceived: 450,
      shortfall: 50,
      evidenceIds: ["claim-qty"],
    });
  });

  it("treats live-shape travel stay_quantity requirements as the same quantity family as traveler_count evidence", () => {
    const travel = contract([
      {
        id: asOutcomeRequirementId("travel-stay-quantity"),
        concept: "stay_quantity",
        operator: ConstraintOperator.EQ,
        value: 2,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "stay_quantity",
      },
    ]);

    const derived = deriveObservations(travel, [
      {
        id: "claim-count",
        concept: "traveler_count",
        value: 2,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:06:00.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.quantityReceived).toBe(2);
    expect(derived.value.facts.quantityOrdered).toBe(2);
    expect(derived.value.facts.observedValues?.quantity).toBe(2);
    expect(derived.value.divergence).toBeUndefined();
  });

  it("treats cancellation_policy as the same refundability family as refundable evidence", () => {
    const travel = contract([
      {
        id: asOutcomeRequirementId("travel-cancellation-policy"),
        concept: "cancellation_policy",
        operator: ConstraintOperator.EQ,
        value: "refundable",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "cancellation_policy",
      },
    ]);

    const derived = deriveObservations(travel, [
      {
        id: "claim-refundable",
        concept: "refundable",
        value: true,
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:06:30.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.observedValues?.refundability).toBe(true);
  });

  it("treats lodging_property as the same property family as property_name evidence", () => {
    const travel = contract([
      {
        id: asOutcomeRequirementId("travel-lodging-property"),
        concept: "lodging_property",
        operator: ConstraintOperator.EQ,
        value: "Seaside Lodge",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "lodging_property",
      },
    ]);

    const derived = deriveObservations(travel, [
      {
        id: "claim-property",
        concept: "property_name",
        value: "Seaside Lodge",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:07:00.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.observedValues?.property).toBe("Seaside Lodge");
    expect(derived.value.divergence).toBeUndefined();
  });

  it("treats hotel_property as the same property family as property_name evidence", () => {
    const travel = contract([
      {
        id: asOutcomeRequirementId("travel-hotel-property"),
        concept: "hotel_property",
        operator: ConstraintOperator.EQ,
        value: "Seaside Lodge",
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        predicate: "hotel_property",
      },
    ]);

    const derived = deriveObservations(travel, [
      {
        id: "claim-property",
        concept: "property_name",
        value: "Seaside Lodge",
        source: "booking-engine",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: "2026-08-22T10:07:30.000Z",
      },
    ]);

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.facts.observedValues?.property).toBe("Seaside Lodge");
    expect(derived.value.divergence).toBeUndefined();
  });
});
