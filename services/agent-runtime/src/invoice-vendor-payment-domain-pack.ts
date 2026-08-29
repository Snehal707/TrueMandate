import { hashCanonical } from "@truemandate/crypto";
import { ErrorCode, err, ok, type IntentState, type ActionProposal, type Result } from "@truemandate/protocol";
import { resolveCanonicalConcept } from "@truemandate/semantic-readiness";
import { z } from "zod";
import type {
  ActionProposalContext,
  ActionFidelityEvaluation,
  ActionFidelityRow,
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

/**
 * Canonical, deterministic Invoice execution-binding identity. Namespaced by
 * the invoice's actual economic identity (payee + invoice + the business
 * duplicate-check key) rather than any per-submission value, so two
 * independent workflow attempts for the SAME underlying economic payment
 * converge on the SAME key -- and any attempt for a genuinely different
 * payee or invoice diverges. This is deliberately NOT the raw
 * duplicateCheckKey used as-is (that would let a caller widen or narrow the
 * binding by controlling one field in isolation); the hash binds all three
 * together.
 */
export function invoiceDuplicateExecutionKey(input: {
  readonly payeeId: string;
  readonly invoiceId: string;
  readonly duplicateCheckKey: string;
}): string {
  return `invoice-dup:${hashCanonical({
    domain: "invoice_vendor_payment",
    payeeId: input.payeeId,
    invoiceId: input.invoiceId,
    duplicateCheckKey: input.duplicateCheckKey,
  })}`;
}

function resolveExecutionIdempotencyKey(input: InvoiceVendorPaymentInput): string {
  return invoiceDuplicateExecutionKey({
    payeeId: input.payee.id,
    invoiceId: input.invoice.invoiceId,
    duplicateCheckKey: input.invoice.duplicateCheckKey,
  });
}

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
      // The canonical execution-binding identity this action's OWN payee/
      // invoice/duplicateCheckKey data derives to -- carried on the action so
      // action-fidelity can independently re-derive and cross-check it,
      // rather than trusting it silently. This is also the exact value
      // resolveExecutionIdempotencyKey binds the gateway/ledger execution key
      // to (see InvoiceVendorPaymentDomainPack.resolveExecutionIdempotencyKey
      // below) -- both read the same input, so a legitimate, untampered
      // action always has these two derivations agree.
      executionIdempotencyBinding: resolveExecutionIdempotencyKey(input),
      remittanceReference: input.invoice.remittanceReference,
      payeeApproved: input.payee.approved,
      payeeApprovalEvidenceId: input.payee.approvalEvidenceId,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

/**
 * duplicate_payment FORBID true cannot be honestly evaluated as a
 * FORBID-true-vs-value comparison against parameters.duplicateCheckKey (a
 * business dedup string, not a boolean) -- see forbid-operator.test.ts's
 * permanent proof that comparison is UNKNOWN, not a bug to paper over.
 * What CAN be honestly proven from the action alone is a deterministic
 * binding check: does this action's OWN payee/invoice/duplicateCheckKey data
 * derive the SAME canonical execution identity as the one it carries (and
 * that resolveExecutionIdempotencyKey binds the real gateway/ledger
 * execution key to)? Independently re-deriving from the action's observable
 * fields -- rather than trusting the carried value -- is what makes this
 * fail closed against a stale or tampered binding instead of merely
 * checking a key is present.
 */
export function evaluateInvoiceDuplicatePaymentBinding(
  state: IntentState,
  action: ActionProposal,
): ActionFidelityRow | undefined {
  const constraint = state.constraints.find(
    (item) =>
      resolveCanonicalConcept(item.concept, InvoiceVendorPaymentDomainPack.planning.conceptFamilies) ===
      "duplicate_payment",
  );
  if (!constraint) return undefined;

  const payeeId = action.merchant;
  const invoiceId = action.product;
  const duplicateCheckKey = actionField<string>(action, "duplicateCheckKey");
  const boundExecutionKey = actionField<string>(action, "executionIdempotencyBinding");

  if (!payeeId || !invoiceId || !duplicateCheckKey || !boundExecutionKey) {
    return {
      constraintId: constraint.id,
      canonicalConcept: "duplicate_payment",
      field: "parameters.executionIdempotencyBinding",
      expectedValue: "a canonical Invoice execution identity derived from payee, invoice, and duplicate-check data",
      actualValue: boundExecutionKey,
      status: "UNKNOWN",
      reason: "Action is missing the payee, invoice, duplicate-check, or execution-binding data needed to prove the one-time-payment identity",
    };
  }

  const expectedExecutionKey = invoiceDuplicateExecutionKey({ payeeId, invoiceId, duplicateCheckKey });
  const bound = expectedExecutionKey === boundExecutionKey;
  return {
    constraintId: constraint.id,
    canonicalConcept: "duplicate_payment",
    field: "parameters.executionIdempotencyBinding",
    expectedValue: expectedExecutionKey,
    actualValue: boundExecutionKey,
    status: bound ? "MATCH" : "MISMATCH",
    reason: bound
      ? "Action is bound to the canonical one-time Invoice execution identity derived from its own payee, invoice, and duplicate-check data"
      : "Action's carried execution-identity binding does not match the canonical identity its own payee/invoice/duplicate-check data derives -- possible stale or tampered binding",
  };
}

function evaluateActionFidelity(
  _input: InvoiceVendorPaymentInput,
  state: IntentState,
  action: ActionProposal,
): ActionFidelityEvaluation {
  const generic = evaluateActionChecks(state, InvoiceVendorPaymentDomainPack.planning, [
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
  const duplicatePaymentRow = evaluateInvoiceDuplicatePaymentBinding(state, action);
  const rows = duplicatePaymentRow ? [...generic.rows, duplicatePaymentRow] : generic.rows;
  return {
    rows,
    preservesIntent: rows.every((row) => row.status === "MATCH"),
  };
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
  resolveExecutionIdempotencyKey,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
