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

export const SaasItSpendWorkflowDomainPayloadSchema = z
  .object({
    vendor: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    subscription: z
      .object({
        planId: z.string().min(1).optional(),
        planName: z.string().min(1),
        termMonths: z.number().positive(),
        renewalSetting: z.string().min(1),
        seatCount: z.number().positive(),
      })
      .strict(),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const SaasItSpendWorkflowRequestSchema = z
  .object({
    intentId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    expectedIntentStateId: z.string().min(1).optional(),
    expectedIntentStateHash: z.string().min(1).optional(),
    adaptiveSubjectId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    capability: z.string().min(1).default("manage_saas_subscription"),
    vendor: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    subscription: z
      .object({
        planId: z.string().min(1).optional(),
        planName: z.string().min(1),
        termMonths: z.number().positive(),
        renewalSetting: z.string().min(1),
        seatCount: z.number().positive(),
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

export type SaasItSpendInput = z.infer<typeof SaasItSpendWorkflowRequestSchema>;

export function workflowIdFor(
  input: SaasItSpendInput,
  intentStateHash: string,
): string {
  return `wf-${hashCanonical({
    intentStateHash,
    vendor: input.vendor,
    subscription: input.subscription,
    totalAmount: input.totalAmount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 24)}`;
}

export function assertWorkflowId(
  input: SaasItSpendInput,
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
  input: SaasItSpendInput,
  ctx: ActionProposalContext,
): DomainActionFields {
  return {
    capability: input.capability,
    merchant: input.vendor.id,
    product: input.subscription.planName,
    quantity: input.subscription.seatCount,
    amount: input.totalAmount,
    currency: input.currency,
    refundable: input.refundable,
    deliveryTerms: input.deliveryTerms,
    parameters: {
      ...input.parameters,
      vendorName: input.vendor.name,
      planId: input.subscription.planId,
      planName: input.subscription.planName,
      seatCount: input.subscription.seatCount,
      termMonths: input.subscription.termMonths,
      renewalSetting: input.subscription.renewalSetting,
      vendorApproved: input.vendor.approved,
      vendorApprovalEvidenceId: input.vendor.approvalEvidenceId,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

function evaluateActionFidelity(
  _input: SaasItSpendInput,
  state: import("@truemandate/protocol").IntentState,
  action: import("@truemandate/protocol").ActionProposal,
): ActionFidelityEvaluation {
  return evaluateActionChecks(state, SaasItSpendDomainPack.planning, [
    {
      canonicalConcept: "vendor",
      factType: "identity",
      field: "parameters.vendorName",
      actualValue: actionField<string>(action, "vendorName"),
    },
    {
      canonicalConcept: "vendor",
      factType: "approval",
      field: "parameters.vendorApproved",
      actualValue: {
        approved: actionField<boolean>(action, "vendorApproved"),
        vendor: actionField<string>(action, "vendorName"),
      },
    },
    {
      canonicalConcept: "plan",
      field: "action.product",
      actualValue: action.product,
    },
    {
      canonicalConcept: "seat_count",
      field: "action.quantity",
      actualValue: action.quantity,
    },
    {
      canonicalConcept: "term",
      field: "parameters.termMonths",
      actualValue: actionField<number>(action, "termMonths"),
    },
    {
      canonicalConcept: "renewal",
      field: "parameters.renewalSetting",
      actualValue: actionField<string>(action, "renewalSetting"),
    },
    {
      canonicalConcept: "budget",
      field: "action.amount",
      actualValue: action.amount,
    },
  ]);
}

function buildExternalOfferNode(
  input: SaasItSpendInput,
  ctx: OfferNodeContext,
): { readonly label: string; readonly metadata: Record<string, unknown> } {
  return {
    label: `saas-offer:${input.vendor.id}`,
    metadata: {
      workflowId: ctx.workflowId,
      intentStateId: ctx.intentStateId,
      offerHash: ctx.offerHash,
    },
  };
}

function buildOutcomeContractInput(
  input: SaasItSpendInput,
  _ctx: OutcomeContractContext,
) {
  return {
    merchant: input.vendor.id,
    quantity: input.subscription.seatCount,
    budgetMax: input.totalAmount,
    product: input.subscription.planName,
    domain: "saas_it_spend",
    parameters: {
      planId: input.subscription.planId,
      planName: input.subscription.planName,
      seatCount: input.subscription.seatCount,
      termMonths: input.subscription.termMonths,
      renewalSetting: input.subscription.renewalSetting,
    },
  };
}

export const SaasItSpendDomainPack: DomainPack<SaasItSpendInput> = {
  id: "saas_it_spend",
  requestSchema: SaasItSpendWorkflowRequestSchema as z.ZodType<SaasItSpendInput>,
  planning: {
    executionCapability: "manage_saas_subscription",
    executionLabel: "SaaS subscription provisioning",
    requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
    conceptFamilies: [
      {
        canonicalConcept: "vendor",
        aliases: ["vendor", "approved_vendor", "preferred_vendor", "vendor_identity"],
        factFamilies: [
          { factType: "approval", aliases: ["approved_vendor", "preferred_vendor"] },
        ],
      },
      { canonicalConcept: "plan", aliases: ["plan", "plan_name", "subscription", "subscription_plan"] },
      { canonicalConcept: "seat_count", aliases: ["seat_count", "license", "license_count"] },
      { canonicalConcept: "term", aliases: ["term", "term_months", "subscription_term"] },
      { canonicalConcept: "renewal", aliases: ["renewal", "renewal_setting"] },
      { canonicalConcept: "budget", aliases: ["budget", "saas_budget", "total_cost", "total_price", "price", "amount"] },
      { canonicalConcept: "subscription_deadline", aliases: ["subscription_deadline", "completion_deadline", "deadline"] },
    ],
    executionCriticalConceptRules: ["vendor", "plan", "seat_count", "term", "renewal", "budget", "subscription_deadline"]
      .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
    offerBackedCanonicalConcepts: ["term", "renewal", "budget"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
