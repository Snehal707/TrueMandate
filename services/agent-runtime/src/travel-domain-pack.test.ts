import { describe, expect, it } from "vitest";
import {
  resolveCanonicalConcept,
  resolveCanonicalSemanticFact,
} from "@truemandate/semantic-readiness";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type IntentState,
} from "@truemandate/protocol";
import { TravelDomainPack, type TravelInput } from "./travel-domain-pack.js";

const baseInput: TravelInput = {
  intentId: "intent-travel",
  idempotencyKey: "travel-pack-test",
  capability: "book_travel",
  provider: {
    id: "travel-provider",
    name: "Travel Provider",
    approved: true,
    approvalEvidenceId: "approval-evidence",
  },
  booking: {
    itineraryId: "it-1",
    lodgingName: "Seaside Lodge",
    travelDate: "2026-12-20T00:00:00.000Z",
    checkInDate: "2026-12-20T00:00:00.000Z",
    checkOutDate: "2026-12-22T00:00:00.000Z",
    travelerCount: 2,
  },
  totalAmount: 3200,
  currency: "USD",
  refundable: true,
  deliveryTerms: "travel from 2026-12-20 to 2026-12-22",
  parameters: {},
  consequenceLevel: "HIGH",
  evidenceIds: ["verified-envelope"],
};

function travelState(): IntentState {
  return {
    id: "state-travel",
    intentId: "intent-travel",
    version: 1,
    createdBy: "principal",
    createdAt: "2026-08-22T12:00:00.000Z",
    stateHash: "state-hash",
    constraints: [
      {
        id: "c-provider",
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
        id: "c-property",
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
        id: "c-refund",
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
        id: "c-count",
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
        id: "c-start",
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
        id: "c-end",
        concept: "stay_end_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-22T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
    assumptions: [],
    rawIntentHash: "raw-hash",
  } as IntentState;
}

function travelAction(overrides?: Partial<TravelInput>) {
  const input: TravelInput = {
    ...baseInput,
    ...overrides,
    booking: {
      ...baseInput.booking,
      ...overrides?.booking,
    },
  };
  return TravelDomainPack.buildActionProposal(input, {
    workflowId: "wf-travel",
    intentId: input.intentId,
    intentStateId: "state-travel",
    createdAt: "2026-08-22T12:00:00.000Z",
    offerNodeId: "external-offer-wf-travel",
  });
}

describe("TravelDomainPack semantics", () => {
  it.each([
    ["stay_date", "stay_start"],
    ["stay_start_date", "stay_start"],
    ["stay_end_date", "stay_end"],
    ["check_in", "stay_start"],
    ["check_out", "stay_end"],
    ["lodging_name", "property"],
    ["lodging_facility", "property"],
    ["lodging_property", "property"],
    ["accommodation_vendor", "property"],
    ["booking_channel", "provider"],
    ["booking_count", "stay_count"],
    ["booking_quantity", "stay_count"],
    ["hotel_booking_quantity", "stay_count"],
    ["total_cost_budget", "budget"],
    ["total_cost_usd", "budget"],
    ["completion_deadline", "completion_deadline"],
    ["execution_deadline", "completion_deadline"],
  ])("maps travel compiler concept %s to %s exactly", (concept, canonical) => {
    expect(resolveCanonicalConcept(concept, TravelDomainPack.planning.conceptFamilies)).toBe(canonical);
  });

  it("keeps provider identity and provider approval in separate semantic fact buckets", () => {
    expect(
      resolveCanonicalSemanticFact(
        "booking_provider",
        TravelDomainPack.planning.conceptFamilies,
        { value: "Meridian Travel Partners" },
      ),
    ).toMatchObject({ factKey: "provider.identity" });
    expect(
      resolveCanonicalSemanticFact(
        "booking_provider_approval",
        TravelDomainPack.planning.conceptFamilies,
        { value: { approved: true, provider: "Meridian Travel Partners" } },
      ),
    ).toMatchObject({ factKey: "provider.approval" });
  });

  it("preserves distinct check-in and check-out fields in the action representation", () => {
    const action = TravelDomainPack.buildActionProposal(baseInput, {
      workflowId: "wf-travel",
      intentId: baseInput.intentId,
      intentStateId: "state-travel",
      createdAt: "2026-08-22T12:00:00.000Z",
      offerNodeId: "external-offer-wf-travel",
    });

    expect(action.parameters).toMatchObject({
      travelDate: "2026-12-20T00:00:00.000Z",
      checkInDate: "2026-12-20T00:00:00.000Z",
      checkOutDate: "2026-12-22T00:00:00.000Z",
      travelerCount: 2,
    });
    expect(action.deliveryTerms).toBe("travel from 2026-12-20 to 2026-12-22");
  });

  it("keeps checkout absent when the caller does not provide it", () => {
    const action = TravelDomainPack.buildActionProposal(
      {
        ...baseInput,
        deliveryTerms: undefined,
        booking: {
          ...baseInput.booking,
          checkOutDate: undefined,
        },
      },
      {
        workflowId: "wf-travel-open",
        intentId: baseInput.intentId,
        intentStateId: "state-travel-open",
        createdAt: "2026-08-22T12:00:00.000Z",
        offerNodeId: "external-offer-wf-travel-open",
      },
    );

    expect(action.parameters).toMatchObject({
      checkInDate: "2026-12-20T00:00:00.000Z",
    });
    expect(action.parameters).not.toHaveProperty("checkOutDate");
    expect(action.deliveryTerms).toBe("travel on 2026-12-20T00:00:00.000Z");
  });

  it("marks action fidelity valid when both check-in and check-out preserve the authoritative travel dates", () => {
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      baseInput,
      travelState(),
      {
        ...travelAction(),
        id: "action-1" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(true);
    expect(fidelity.rows.find((row) => row.canonicalConcept === "stay_end")?.status).toBe("MATCH");
  });

  it("passes provider identity fidelity when booking_provider matches the action provider name", () => {
    const stateWithProviderIdentity: IntentState = {
      ...travelState(),
      constraints: travelState().constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "booking_provider",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Meridian Travel Partners",
        },
      },
      stateWithProviderIdentity,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Meridian Travel Partners",
          },
        }),
        id: "action-provider-match" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      field: "parameters.providerName",
      actualValue: "Meridian Travel Partners",
      status: "MATCH",
    });
  });

  it("fails provider identity fidelity when booking_provider does not match the action provider name", () => {
    const stateWithProviderIdentity: IntentState = {
      ...travelState(),
      constraints: travelState().constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "booking_provider",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Other Provider",
        },
      },
      stateWithProviderIdentity,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Other Provider",
          },
        }),
        id: "action-provider-mismatch" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(false);
    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      field: "parameters.providerName",
      actualValue: "Other Provider",
      status: "MISMATCH",
    });
  });

  it("passes provider approval fidelity when booking_provider_approval matches providerApproved", () => {
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      baseInput,
      travelState(),
      {
        ...travelAction(),
        id: "action-provider-approval-pass" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      field: "parameters.providerApproved",
      actualValue: { approved: true, provider: "Travel Provider" },
      status: "MATCH",
    });
  });

  it("passes refundability fidelity when cancellation_policy requires refundable and the action stays refundable", () => {
    const stateWithCancellationPolicy: IntentState = {
      ...travelState(),
      constraints: travelState().constraints.map((constraint) =>
        constraint.id === "c-refund"
          ? {
              ...constraint,
              concept: "cancellation_policy",
              operator: ConstraintOperator.REQUIRE,
              value: "refundable",
            }
          : constraint,
      ),
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      baseInput,
      stateWithCancellationPolicy,
      {
        ...travelAction(),
        id: "action-cancellation-policy-pass" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-refund")).toMatchObject({
      field: "action.refundable",
      actualValue: true,
      status: "MATCH",
    });
  });

  it("fails provider approval fidelity when booking_provider_approval does not match providerApproved", () => {
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          approved: false,
        },
      },
      travelState(),
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            approved: false,
          },
        }),
        id: "action-provider-approval-fail" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(false);
    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      field: "parameters.providerApproved",
      actualValue: { approved: false, provider: "Travel Provider" },
      status: "MISMATCH",
    });
  });

  it("passes provider approval fidelity for a fused approved_provider identity constraint only when provider and approval both match", () => {
    const stateWithApprovedProviderIdentity: IntentState = {
      ...travelState(),
      constraints: travelState().constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "approved_provider",
              operator: ConstraintOperator.EQ,
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Meridian Travel Partners",
        },
      },
      stateWithApprovedProviderIdentity,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Meridian Travel Partners",
          },
        }),
        id: "action-provider-approved-identity" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      field: "parameters.providerApproved",
      actualValue: { approved: true, provider: "Meridian Travel Partners" },
      status: "MATCH",
    });
  });

  it("fails only approval when provider identity is correct but provider approval is wrong", () => {
    const stateWithBothProviderFacts: IntentState = {
      ...travelState(),
      constraints: [
        {
          ...travelState().constraints[0]!,
          id: "c-provider-identity",
          concept: "booking_provider",
          operator: ConstraintOperator.EQ,
          value: "Meridian Travel Partners",
        },
        {
          ...travelState().constraints[0]!,
          id: "c-provider-approval",
          concept: "booking_provider_approval",
          operator: ConstraintOperator.REQUIRE,
          value: "approved provider",
        },
        ...travelState().constraints.slice(1),
      ],
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Meridian Travel Partners",
          approved: false,
        },
      },
      stateWithBothProviderFacts,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Meridian Travel Partners",
            approved: false,
          },
        }),
        id: "action-provider-split-approval-fail" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-provider-identity")?.status).toBe("MATCH");
    expect(fidelity.rows.find((row) => row.constraintId === "c-provider-approval")?.status).toBe("MISMATCH");
  });

  it("fails only identity when provider approval is correct but provider identity is wrong", () => {
    const stateWithBothProviderFacts: IntentState = {
      ...travelState(),
      constraints: [
        {
          ...travelState().constraints[0]!,
          id: "c-provider-identity",
          concept: "booking_provider",
          operator: ConstraintOperator.EQ,
          value: "Meridian Travel Partners",
        },
        {
          ...travelState().constraints[0]!,
          id: "c-provider-approval",
          concept: "booking_provider_approval",
          operator: ConstraintOperator.REQUIRE,
          value: "approved provider",
        },
        ...travelState().constraints.slice(1),
      ],
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Other Provider",
          approved: true,
        },
      },
      stateWithBothProviderFacts,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Other Provider",
            approved: true,
          },
        }),
        id: "action-provider-split-identity-fail" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.rows.find((row) => row.constraintId === "c-provider-identity")?.status).toBe("MISMATCH");
    expect(fidelity.rows.find((row) => row.constraintId === "c-provider-approval")?.status).toBe("MATCH");
  });

  it("fails action fidelity when checkout date is wrong", () => {
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      baseInput,
      travelState(),
      {
        ...travelAction({
          booking: {
            ...baseInput.booking,
            checkOutDate: "2026-12-23T00:00:00.000Z",
          },
        }),
        id: "action-2" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(false);
    expect(fidelity.rows.find((row) => row.canonicalConcept === "stay_end")?.status).toBe("MISMATCH");
  });

  it("does not collapse a broad booking_provider identity constraint into providerApproved", () => {
    const stateWithProviderIdentity: IntentState = {
      ...travelState(),
      constraints: travelState().constraints.map((constraint) =>
        constraint.id === "c-provider"
          ? {
              ...constraint,
              concept: "booking_provider",
              value: "Meridian Travel Partners",
            }
          : constraint,
      ),
    };
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        provider: {
          ...baseInput.provider,
          name: "Meridian Travel Partners",
        },
      },
      stateWithProviderIdentity,
      {
        ...travelAction({
          provider: {
            ...baseInput.provider,
            name: "Meridian Travel Partners",
          },
        }),
        id: "action-provider-identity" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(true);
    expect(fidelity.rows.find((row) => row.constraintId === "c-provider")).toMatchObject({
      canonicalConcept: "provider",
      field: "parameters.providerName",
      expectedValue: "Meridian Travel Partners",
      actualValue: "Meridian Travel Partners",
      status: "MATCH",
    });
  });

  it("fails closed when checkout date is missing from an authoritative stay_end constraint", () => {
    const fidelity = TravelDomainPack.evaluateActionFidelity(
      {
        ...baseInput,
        booking: {
          ...baseInput.booking,
          checkOutDate: undefined,
        },
      },
      travelState(),
      {
        ...travelAction({
          booking: {
            ...baseInput.booking,
            checkOutDate: undefined,
          },
        }),
        id: "action-3" as never,
        intentId: "intent-travel" as never,
        intentStateId: "state-travel" as never,
        agentId: "agent-runtime" as never,
        createdAt: "2026-08-22T12:00:00.000Z",
      },
    );

    expect(fidelity.preservesIntent).toBe(false);
    expect(fidelity.rows.find((row) => row.canonicalConcept === "stay_end")?.status).toBe("UNKNOWN");
  });
});
