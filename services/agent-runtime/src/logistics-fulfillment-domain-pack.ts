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
import { conceptFamiliesFor } from "./ontology.js";

export const LogisticsFulfillmentWorkflowDomainPayloadSchema = z
  .object({
    provider: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    shipment: z
      .object({
        serviceLevel: z.string().min(1),
        destination: z.string().min(1),
        shipBy: z.string().min(1),
        fulfillCount: z.number().positive(),
      })
      .strict(),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const LogisticsFulfillmentWorkflowRequestSchema = z
  .object({
    intentId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    expectedIntentStateId: z.string().min(1).optional(),
    expectedIntentStateHash: z.string().min(1).optional(),
    adaptiveSubjectId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    capability: z.string().min(1).default("arrange_fulfillment"),
    provider: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    shipment: z
      .object({
        serviceLevel: z.string().min(1),
        destination: z.string().min(1),
        shipBy: z.string().min(1),
        fulfillCount: z.number().positive(),
      })
      .strict(),
    totalAmount: z.number().positive(),
    currency: z.string().length(3),
    deliveryTerms: z.string().min(1).optional(),
    parameters: z.record(z.unknown()).default({}),
    consequenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("HIGH"),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type LogisticsFulfillmentInput = z.infer<
  typeof LogisticsFulfillmentWorkflowRequestSchema
>;

export function workflowIdFor(
  input: LogisticsFulfillmentInput,
  intentStateHash: string,
): string {
  return `wf-${hashCanonical({
    intentStateHash,
    provider: input.provider,
    shipment: input.shipment,
    totalAmount: input.totalAmount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 24)}`;
}

export function assertWorkflowId(
  input: LogisticsFulfillmentInput,
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
  input: LogisticsFulfillmentInput,
  ctx: ActionProposalContext,
): DomainActionFields {
  return {
    capability: input.capability,
    merchant: input.provider.id,
    product: input.shipment.serviceLevel,
    quantity: input.shipment.fulfillCount,
    amount: input.totalAmount,
    currency: input.currency,
    deliveryTerms:
      input.deliveryTerms ?? `ship by ${input.shipment.shipBy} to ${input.shipment.destination}`,
    parameters: {
      ...input.parameters,
      providerName: input.provider.name,
      destination: input.shipment.destination,
      serviceLevel: input.shipment.serviceLevel,
      shipBy: input.shipment.shipBy,
      fulfillCount: input.shipment.fulfillCount,
      providerApproved: input.provider.approved,
      providerApprovalEvidenceId: input.provider.approvalEvidenceId,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

function evaluateActionFidelity(
  _input: LogisticsFulfillmentInput,
  state: import("@truemandate/protocol").IntentState,
  action: import("@truemandate/protocol").ActionProposal,
): ActionFidelityEvaluation {
  return evaluateActionChecks(state, LogisticsFulfillmentDomainPack.planning, [
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
      canonicalConcept: "destination",
      field: "parameters.destination",
      actualValue: actionField<string>(action, "destination"),
    },
    {
      canonicalConcept: "service_level",
      field: "action.product",
      actualValue: action.product,
    },
    {
      canonicalConcept: "shipment_deadline",
      field: "parameters.shipBy",
      actualValue: actionField<string>(action, "shipBy"),
    },
    {
      canonicalConcept: "fulfillment_count",
      field: "action.quantity",
      actualValue: action.quantity,
    },
    {
      canonicalConcept: "budget",
      field: "action.amount",
      actualValue: action.amount,
    },
  ]);
}

function buildExternalOfferNode(
  input: LogisticsFulfillmentInput,
  ctx: OfferNodeContext,
): { readonly label: string; readonly metadata: Record<string, unknown> } {
  return {
    label: `logistics-offer:${input.provider.id}`,
    metadata: {
      workflowId: ctx.workflowId,
      intentStateId: ctx.intentStateId,
      offerHash: ctx.offerHash,
    },
  };
}

function buildOutcomeContractInput(
  input: LogisticsFulfillmentInput,
  _ctx: OutcomeContractContext,
) {
  return {
    merchant: input.provider.id,
    quantity: input.shipment.fulfillCount,
    budgetMax: input.totalAmount,
    product: input.shipment.serviceLevel,
    domain: "logistics_fulfillment",
    parameters: {
      destination: input.shipment.destination,
      serviceLevel: input.shipment.serviceLevel,
      shipBy: input.shipment.shipBy,
      fulfillCount: input.shipment.fulfillCount,
    },
  };
}

export const LogisticsFulfillmentDomainPack: DomainPack<LogisticsFulfillmentInput> = {
  id: "logistics_fulfillment",
  requestSchema:
    LogisticsFulfillmentWorkflowRequestSchema as z.ZodType<LogisticsFulfillmentInput>,
  planning: {
    executionCapability: "arrange_fulfillment",
    executionLabel: "logistics fulfillment",
    requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
    conceptFamilies: conceptFamiliesFor("logistics_fulfillment"),
    executionCriticalConceptRules: ["provider", "destination", "service_level", "shipment_deadline", "fulfillment_count", "budget"]
      .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
    offerBackedCanonicalConcepts: ["destination", "service_level", "shipment_deadline", "budget"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
