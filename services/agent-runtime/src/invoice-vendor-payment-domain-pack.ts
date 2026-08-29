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

export const InvoiceVendorPaymentWorkflowDomainPayloadSchema = z
  .object({
    payee: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    invoice: z
      .object({
        invoiceId: z.string().min(1),
        poReference: z.string().min(1).optional(),
        dueDate: z.string().min(1).optional(),
        duplicateCheckKey: z.string().min(1),
        remittanceReference: z.string().min(1).optional(),
      })
      .strict(),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const InvoiceVendorPaymentWorkflowRequestSchema = z
  .object({
    intentId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    expectedIntentStateId: z.string().min(1).optional(),
    expectedIntentStateHash: z.string().min(1).optional(),
    adaptiveSubjectId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    capability: z.string().min(1).default("pay_invoice"),
    payee: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        approved: z.boolean(),
        approvalEvidenceId: z.string().min(1).optional(),
      })
      .strict(),
    invoice: z
      .object({
        invoiceId: z.string().min(1),
        poReference: z.string().min(1).optional(),
        dueDate: z.string().min(1).optional(),
        duplicateCheckKey: z.string().min(1),
        remittanceReference: z.string().min(1).optional(),
      })
      .strict(),
    totalAmount: z.number().positive(),
    currency: z.string().length(3),
    parameters: z.record(z.unknown()).default({}),
    consequenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("HIGH"),
    evidenceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type InvoiceVendorPaymentInput = z.infer<
  typeof InvoiceVendorPaymentWorkflowRequestSchema
>;

export function workflowIdFor(
  input: InvoiceVendorPaymentInput,
  intentStateHash: string,
): string {
  return `wf-${hashCanonical({
    intentStateHash,
    payee: input.payee,
    invoice: input.invoice,
    totalAmount: input.totalAmount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 24)}`;
}

export function assertWorkflowId(
  input: InvoiceVendorPaymentInput,
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
  input: InvoiceVendorPaymentInput,
  ctx: ActionProposalContext,
): DomainActionFields {
  return {
    capability: input.capability,
    merchant: input.payee.id,
    product: input.invoice.invoiceId,
    quantity: 1,
    amount: input.totalAmount,
    currency: input.currency,
    parameters: {
      ...input.parameters,
      payeeName: input.payee.name,
      invoiceId: input.invoice.invoiceId,
      poReference: input.invoice.poReference,
      dueDate: input.invoice.dueDate,
      duplicateCheckKey: input.invoice.duplicateCheckKey,
      remittanceReference: input.invoice.remittanceReference,
      payeeApproved: input.payee.approved,
      payeeApprovalEvidenceId: input.payee.approvalEvidenceId,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

function evaluateActionFidelity(
  _input: InvoiceVendorPaymentInput,
  state: import("@truemandate/protocol").IntentState,
  action: import("@truemandate/protocol").ActionProposal,
): ActionFidelityEvaluation {
  return evaluateActionChecks(state, InvoiceVendorPaymentDomainPack.planning, [
    {
      canonicalConcept: "payee",
      factType: "identity",
      field: "parameters.payeeName",
      actualValue: actionField<string>(action, "payeeName"),
    },
    {
      canonicalConcept: "payee",
      factType: "approval",
      field: "parameters.payeeApproved",
      actualValue: {
        approved: actionField<boolean>(action, "payeeApproved"),
        payee: actionField<string>(action, "payeeName"),
      },
    },
    {
      canonicalConcept: "invoice_identity",
      field: "action.product",
      actualValue: action.product,
    },
    {
      canonicalConcept: "duplicate_payment",
      field: "parameters.duplicateCheckKey",
      actualValue: actionField<string>(action, "duplicateCheckKey"),
    },
    {
      canonicalConcept: "due_date",
      field: "parameters.dueDate",
      actualValue: actionField<string>(action, "dueDate"),
    },
    {
      canonicalConcept: "amount",
      field: "action.amount",
      actualValue: action.amount,
    },
  ]);
}

function buildExternalOfferNode(
  input: InvoiceVendorPaymentInput,
  ctx: OfferNodeContext,
): { readonly label: string; readonly metadata: Record<string, unknown> } {
  return {
    label: `invoice-offer:${input.payee.id}`,
    metadata: {
      workflowId: ctx.workflowId,
      intentStateId: ctx.intentStateId,
      offerHash: ctx.offerHash,
    },
  };
}

function buildOutcomeContractInput(
  input: InvoiceVendorPaymentInput,
  _ctx: OutcomeContractContext,
) {
  return {
    merchant: input.payee.id,
    quantity: 1,
    budgetMax: input.totalAmount,
    product: input.invoice.invoiceId,
    domain: "invoice_vendor_payment",
    parameters: {
      invoiceId: input.invoice.invoiceId,
      dueDate: input.invoice.dueDate,
      duplicateCheckKey: input.invoice.duplicateCheckKey,
      remittanceReference: input.invoice.remittanceReference,
    },
  };
}

export const InvoiceVendorPaymentDomainPack: DomainPack<InvoiceVendorPaymentInput> = {
  id: "invoice_vendor_payment",
  requestSchema:
    InvoiceVendorPaymentWorkflowRequestSchema as z.ZodType<InvoiceVendorPaymentInput>,
  planning: {
    executionCapability: "pay_invoice",
    executionLabel: "invoice payment",
    requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
    conceptFamilies: conceptFamiliesFor("invoice_vendor_payment"),
    executionCriticalConceptRules: ["payee", "invoice_identity", "duplicate_payment", "due_date", "amount"]
      .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
    offerBackedCanonicalConcepts: ["due_date", "amount"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
