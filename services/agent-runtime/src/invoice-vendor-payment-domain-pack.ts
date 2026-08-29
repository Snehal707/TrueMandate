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
 * Canonical, deterministic Invoice execution-binding identity. Namespaced
 * ONLY by the invoice's immutable economic subject -- payee + invoice --
 * never by anything caller/domain-input-controlled or per-submission, so two
 * independent workflow attempts for the SAME underlying economic payment
 * always converge on the SAME key, and any attempt for a genuinely different
 * payee or invoice diverges.
 *
 * duplicateCheckKey is deliberately EXCLUDED. An earlier version of this
 * function included it, reasoning that binding all three fields together
 * would prevent a caller from "widening the binding by controlling one field
 * in isolation" -- that reasoning was backwards. duplicateCheckKey is
 * caller/domain-supplied business input (a fixture-hardcoded string, never
 * independently verified against an authoritative ledger); including it in
 * the uniqueness identity meant a resubmission that changed ONLY
 * duplicateCheckKey derived a genuinely NEW execution identity through the
 * normal, untampered path -- action-fidelity's re-derivation check matched
 * cleanly on both sides because both sides shifted together. Proven
 * empirically (see the PHASE A PROBE this file's git history carries): two
 * fresh submissions of the identical payee+invoice, differing only in
 * duplicateCheckKey ("dup-1" vs "dup-2"), produced two different execution
 * keys with action-fidelity reporting a clean MATCH on both -- a real
 * duplicate-prevention bypass, not merely a theoretical one. duplicateCheckKey
 * remains business/provenance data (see buildActionProposal/
 * buildOutcomeContractInput) but can no longer affect which execution
 * identity a payment binds to.
 */
export function invoiceDuplicateExecutionKey(input: {
  readonly payeeId: string;
  readonly invoiceId: string;
}): string {
  return `invoice-dup:${hashCanonical({
    domain: "invoice_vendor_payment",
    payeeId: input.payeeId,
    invoiceId: input.invoiceId,
  })}`;
}

function resolveExecutionIdempotencyKey(input: InvoiceVendorPaymentInput): string {
  return invoiceDuplicateExecutionKey({
    payeeId: input.payee.id,
    invoiceId: input.invoice.invoiceId,
  });
}

export const INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID = "invoice_duplicate_execution_binding_v1";

/**
 * Server-owned readiness inputs for the duplicate_payment DETERMINISTIC_RULE.
 * payeeId/invoiceId are the same raw identity fields
 * resolveExecutionIdempotencyKey uses; providedExecutionBinding is the
 * engine's OWN already-resolved execution key for this exact workflow
 * (GenericWorkflowEngine.run() computes it via resolveExecutionIdempotencyKey
 * above and forwards it here) -- not a value this function invents, and not
 * anything a caller/browser supplies directly. duplicateCheckKey is
 * deliberately absent: it is not part of the one-time-execution identity.
 */
function buildDeterministicRuleInputs(
  input: InvoiceVendorPaymentInput,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  return {
    [INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID]: {
      payeeId: input.payee.id,
      invoiceId: input.invoice.invoiceId,
      providedExecutionBinding: resolveExecutionIdempotencyKey(input),
    },
  };
}

/**
 * The actual deterministic proof: independently re-derives the canonical
 * execution identity from payeeId/invoiceId (never trusting
 * providedExecutionBinding at face value) and checks the engine's resolved
 * binding equals it. SATISFIED only when both identity fields are present
 * AND the derived key matches what was actually provided -- never merely
 * because some value exists. Fails closed to UNKNOWN on missing/malformed
 * input, UNSATISFIED (not UNKNOWN) on a genuine mismatch, and UNKNOWN on an
 * unrecognized ruleId (this pack owns exactly one deterministic rule today).
 */
function evaluateDeterministicRule(
  ruleId: string,
  inputs: Readonly<Record<string, unknown>> | undefined,
): { readonly status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN"; readonly reason: string } {
  if (ruleId !== INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID) {
    return { status: "UNKNOWN", reason: `Unrecognized deterministic rule id '${ruleId}' for invoice_vendor_payment` };
  }
  const payeeId = inputs?.payeeId;
  const invoiceId = inputs?.invoiceId;
  const providedExecutionBinding = inputs?.providedExecutionBinding;
  if (
    typeof payeeId !== "string" || !payeeId ||
    typeof invoiceId !== "string" || !invoiceId ||
    typeof providedExecutionBinding !== "string" || !providedExecutionBinding
  ) {
    return {
      status: "UNKNOWN",
      reason: "Missing payee identity, invoice identity, or execution binding needed to derive the canonical one-time-execution identity",
    };
  }
  const derivedExecutionKey = invoiceDuplicateExecutionKey({ payeeId, invoiceId });
  if (derivedExecutionKey !== providedExecutionBinding) {
    return {
      status: "UNSATISFIED",
      reason: "Provided execution binding does not match the canonical identity derived from payee and invoice identity",
    };
  }
  return {
    status: "SATISFIED",
    reason: "Canonical one-time-execution identity is derivable from payee and invoice identity, and the workflow's execution binding matches it",
  };
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
 * binding check: does this action's OWN payee/invoice data derive the SAME
 * canonical execution identity as the one it carries (and that
 * resolveExecutionIdempotencyKey binds the real gateway/ledger execution key
 * to)? Independently re-deriving from the action's observable fields --
 * rather than trusting the carried value -- is what makes this fail closed
 * against a stale or tampered binding instead of merely checking a key is
 * present.
 *
 * duplicateCheckKey is deliberately NOT part of this comparison (see
 * invoiceDuplicateExecutionKey's docstring for why including it was a real
 * bypass): a resubmission that changes ONLY duplicateCheckKey must not be
 * able to flip this row, because it does not change which economic payment
 * this action is.
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
  const boundExecutionKey = actionField<string>(action, "executionIdempotencyBinding");

  if (!payeeId || !invoiceId || !boundExecutionKey) {
    return {
      constraintId: constraint.id,
      canonicalConcept: "duplicate_payment",
      field: "parameters.executionIdempotencyBinding",
      expectedValue: "a canonical Invoice execution identity derived from payee and invoice identity",
      actualValue: boundExecutionKey,
      status: "UNKNOWN",
      reason: "Action is missing the payee, invoice, or execution-binding data needed to prove the one-time-payment identity",
    };
  }

  const expectedExecutionKey = invoiceDuplicateExecutionKey({ payeeId, invoiceId });
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
    executionCriticalConceptRules: [
      ...["payee", "invoice_identity", "due_date", "amount"]
        .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
      // duplicate_payment does not fundamentally require external vendor
      // evidence -- it requires deterministic proof that the action is bound
      // to the system's own one-time-execution mechanism, which no evidence
      // envelope/claim can establish (see evaluateDeterministicRule above).
      {
        canonicalConcept: "duplicate_payment",
        proofMechanism: { kind: "DETERMINISTIC_RULE" as const, ruleId: INVOICE_DUPLICATE_EXECUTION_BINDING_RULE_ID },
      },
    ],
    offerBackedCanonicalConcepts: ["due_date", "amount"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  resolveExecutionIdempotencyKey,
  buildDeterministicRuleInputs,
  evaluateDeterministicRule,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
