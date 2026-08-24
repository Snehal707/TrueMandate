import { hashCanonical } from "@truemandate/crypto";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { z } from "zod";
import type {
  ActionProposalContext,
  ActionFidelityEvaluation,
  DomainActionFields,
  DomainPack,
  OfferNodeContext,
  OutcomeContractContext,
} from "./domain-pack.js";
import { actionField, evaluateActionChecks } from "./action-fidelity.js";

export const TravelWorkflowDomainPayloadSchema = z
  .object({
    provider: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    booking: z
      .object({
        itineraryId: z.string().min(1).optional(),
        lodgingName: z.string().min(1).optional(),
        travelDate: z.string().min(1),
        checkInDate: z.string().min(1).optional(),
        checkOutDate: z.string().min(1).optional(),
        travelerCount: z.number().positive(),
      })
      .strict(),
    policy: z
      .object({
        refundableRequired: z.boolean().optional(),
        bookingDeadline: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const TravelWorkflowRequestSchema = z
  .object({
    intentId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    expectedIntentStateId: z.string().min(1).optional(),
    expectedIntentStateHash: z.string().min(1).optional(),
    adaptiveSubjectId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    capability: z.string().min(1).default("book_travel"),
    provider: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    booking: z
      .object({
        itineraryId: z.string().min(1).optional(),
        lodgingName: z.string().min(1).optional(),
        travelDate: z.string().min(1),
        checkInDate: z.string().min(1).optional(),
        checkOutDate: z.string().min(1).optional(),
        travelerCount: z.number().positive(),
      })
      .strict(),
    totalAmount: z.number().positive(),
    currency: z.string().length(3),
    refundable: z.boolean().optional(),
    deliveryTerms: z.string().min(1).optional(),
    parameters: z.record(z.unknown()).default({}),
    consequenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("HIGH"),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type TravelInput = z.infer<typeof TravelWorkflowRequestSchema>;

export function workflowIdFor(input: TravelInput, intentStateHash: string): string {
  return `wf-${hashCanonical({
    intentStateHash,
    booking: input.booking,
    provider: input.provider,
    totalAmount: input.totalAmount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 24)}`;
}

export function assertWorkflowId(
  input: TravelInput,
  intentStateHash: string,
): Result<string> {
  const id = workflowIdFor(input, intentStateHash);
  return input.workflowId && input.workflowId !== id
    ? err(
        ErrorCode.VALIDATION_FAILED,
        "workflowId does not match the canonical workflow identity",
      )
    : ok(id);
}

function buildActionProposal(
  input: TravelInput,
  ctx: ActionProposalContext,
): DomainActionFields {
  const checkInDate = input.booking.checkInDate ?? input.booking.travelDate;
  const checkOutDate =
    input.booking.checkOutDate ??
    (typeof input.parameters.checkOutDate === "string"
      ? input.parameters.checkOutDate
      : undefined);
  return {
    capability: input.capability,
    merchant: input.provider.id,
    product: input.booking.lodgingName ?? "travel-booking",
    quantity: input.booking.travelerCount,
    amount: input.totalAmount,
    currency: input.currency,
    refundable: input.refundable,
    deliveryTerms:
      input.deliveryTerms ??
      (checkOutDate
        ? `travel from ${checkInDate} to ${checkOutDate}`
        : `travel on ${checkInDate}`),
    parameters: {
      ...input.parameters,
      itineraryId: input.booking.itineraryId,
      lodgingName: input.booking.lodgingName,
      travelDate: input.booking.travelDate,
      checkInDate,
      ...(checkOutDate ? { checkOutDate } : {}),
      travelerCount: input.booking.travelerCount,
      providerName: input.provider.name,
      providerApproved: input.provider.approved,
      refundableRequired: input.refundable ?? false,
      providerApprovalEvidenceId: input.provider.approvalEvidenceId,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

function evaluateActionFidelity(
  _input: TravelInput,
  state: import("@truemandate/protocol").IntentState,
  action: import("@truemandate/protocol").ActionProposal,
): ActionFidelityEvaluation {
  return evaluateActionChecks(state, TravelDomainPack.planning, [
    {
      canonicalConcept: "provider",
      factType: "identity",
      field: "parameters.providerName",
      actualValue: actionField<string>(action, "providerName"),
    },
    {
      canonicalConcept: "provider",
      factType: "approval",
      field: "parameters.providerApproved",
      actualValue: {
        approved: actionField<boolean>(action, "providerApproved"),
        provider: actionField<string>(action, "providerName"),
      },
    },
    {
      canonicalConcept: "property",
      field: "action.product",
      actualValue: action.product,
    },
    {
      canonicalConcept: "refundability",
      field: "action.refundable",
      actualValue: action.refundable,
    },
    {
      canonicalConcept: "stay_count",
      field: "action.quantity",
      actualValue: action.quantity,
    },
    {
      canonicalConcept: "stay_start",
      field: "parameters.checkInDate",
      actualValue: actionField<string>(action, "checkInDate"),
    },
    {
      canonicalConcept: "stay_end",
      field: "parameters.checkOutDate",
      actualValue: actionField<string>(action, "checkOutDate"),
    },
    {
      canonicalConcept: "budget",
      field: "action.amount",
      actualValue: action.amount,
    },
  ]);
}

function buildExternalOfferNode(
  input: TravelInput,
  ctx: OfferNodeContext,
): { readonly label: string; readonly metadata: Record<string, unknown> } {
  return {
    label: `travel-offer:${input.provider.id}`,
    metadata: {
      workflowId: ctx.workflowId,
      intentStateId: ctx.intentStateId,
      offerHash: ctx.offerHash,
    },
  };
}

function buildOutcomeContractInput(
  input: TravelInput,
  _ctx: OutcomeContractContext,
) {
  return {
    merchant: input.provider.id,
    quantity: input.booking.travelerCount,
    budgetMax: input.totalAmount,
    product: input.booking.lodgingName ?? "travel-booking",
    domain: "travel",
    parameters: {
      itineraryId: input.booking.itineraryId,
      travelDate: input.booking.travelDate,
      checkInDate: input.booking.checkInDate ?? input.booking.travelDate,
      ...(input.booking.checkOutDate ? { checkOutDate: input.booking.checkOutDate } : {}),
      travelerCount: input.booking.travelerCount,
      refundableRequired: input.refundable ?? false,
      lodgingName: input.booking.lodgingName,
    },
  };
}

export const TravelDomainPack: DomainPack<TravelInput> = {
  id: "travel",
  requestSchema: TravelWorkflowRequestSchema as z.ZodType<TravelInput>,
  planning: {
    executionCapability: "book_travel",
    executionLabel: "travel booking",
    requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
    conceptFamilies: [
      {
        canonicalConcept: "provider",
        aliases: [
          "provider",
          "approved_provider",
          "provider_approval",
          "provider_approval_status",
          "booking_provider",
          "booking_channel",
          "booking_provider_approval",
          "service_provider",
          "travel_provider",
          "travel_provider_approval",
        ],
        factFamilies: [
          {
            factType: "approval",
            aliases: [
              "approved_provider",
              "provider_approval",
              "provider_approval_status",
              "booking_provider_approval",
              "travel_provider_approval",
            ],
          },
        ],
      },
      {
        canonicalConcept: "property",
        aliases: [
          "property",
          "property_name",
          "accommodation_vendor",
          "lodging_facility",
          "lodging_name",
          "lodging_property",
          "lodging_property_name",
          "hotel",
          "hotel_name",
          "lodging",
          "hotel_property",
          "accommodation_name",
        ],
      },
      {
        canonicalConcept: "refundability",
        aliases: [
          "refund",
          "refundable",
          "refundability",
          "refundable_policy",
          "refundable_rate",
          "cancellation_policy",
        ],
      },
      {
        canonicalConcept: "stay_count",
        aliases: [
          "booking_count",
          "booking_quantity",
          "stay_count",
          "hotel_stay_count",
          "stay_quantity",
          "hotel_booking_quantity",
          "hotel_stay_quantity",
          "traveler_count",
          "room_quantity",
        ],
      },
      {
        canonicalConcept: "stay_start",
        aliases: ["stay_date", "stay_start_date", "travel_date", "check_in", "check_in_date", "checkin_date"],
      },
      {
        canonicalConcept: "stay_end",
        aliases: ["stay_end_date", "check_out", "check_out_date", "checkout_date"],
      },
      {
        canonicalConcept: "completion_deadline",
        aliases: [
          "completion_deadline",
          "booking_completion_deadline",
          "booking_execution_deadline",
          "booking_deadline",
          "execution_deadline",
          "deadline",
        ],
      },
      {
        canonicalConcept: "budget",
        aliases: [
          "budget",
          "travel_budget",
          "total_budget",
          "total_cost_budget",
          "total_cost",
          "total_cost_usd",
          "total_price",
          "price",
        ],
      },
    ],
    executionCriticalConceptRules: [
      "provider", "property", "refundability", "stay_count", "stay_start", "stay_end", "completion_deadline", "budget",
    ].map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
    offerBackedCanonicalConcepts: ["stay_start", "stay_end", "budget"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
