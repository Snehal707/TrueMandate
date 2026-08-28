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

export const ProcurementWorkflowDomainPayloadSchema = z.object({
  supplier: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    approved: z.boolean(),
    approvalEvidenceId: z.string().min(1).optional(),
  }).strict(),
  item: z.object({
    sku: z.string().min(1).optional(),
    specification: z.string().min(1).optional(),
  }).strict().optional(),
  foodGradeEvidenceId: z.string().min(1).optional(),
  delivery: z.object({
    deadline: z.string().min(1).optional(),
    terms: z.string().min(1).optional(),
  }).strict().optional(),
  evidenceIds: z.array(z.string().min(1)).default([]),
}).strict();

/** Business-input only. Trusted semantic/authority objects are intentionally absent. */
export const ProcurementWorkflowRequestSchema = z.object({
  intentId: z.string().min(1),
  workflowId: z.string().min(1).optional(),
  expectedIntentStateId: z.string().min(1).optional(),
  expectedIntentStateHash: z.string().min(1).optional(),
  adaptiveSubjectId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  capability: z.string().min(1).default("execute_payment"),
  supplier: z.object({ id: z.string().min(1), name: z.string().min(1), approved: z.boolean(), approvalEvidenceId: z.string().min(1).optional() }).strict(),
  item: z.object({ specification: z.string().min(1), sku: z.string().min(1).optional() }).strict(),
  quantity: z.number().positive(), totalAmount: z.number().positive(), currency: z.string().length(3),
  refundable: z.boolean().optional(),
  foodGradeEvidenceId: z.string().min(1).optional(),
  delivery: z.object({ terms: z.string().min(1).optional(), deadline: z.string().min(1).optional() }).strict().optional(),
  parameters: z.record(z.unknown()).default({}),
  consequenceLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("HIGH"),
  evidenceIds: z.array(z.string().min(1)).default([]),
  /** Durable human approval presented on REQUIRE_APPROVAL resumption. */
  approvalId: z.string().min(1).optional(),
}).strict();

export type ProcurementInput = z.infer<typeof ProcurementWorkflowRequestSchema>;

export function parseProcurementWorkflowRequest(raw: unknown): Result<ProcurementInput> {
  const parsed = ProcurementWorkflowRequestSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid procurement workflow request", { issues: parsed.error.issues });
}

export function workflowIdFor(input: ProcurementInput, intentStateHash: string): string {
  // `workflowId` is deliberately excluded: it is only an assertion over the
  // deterministic identity, never caller-controlled workflow selection.
  return `wf-${hashCanonical({
    intentStateHash,
    offer: {
      intentId: input.intentId,
      supplier: input.supplier,
      item: input.item,
      quantity: input.quantity,
      totalAmount: input.totalAmount,
      currency: input.currency,
      foodGradeEvidenceId: input.foodGradeEvidenceId,
      delivery: input.delivery,
      evidenceIds: input.evidenceIds,
    },
    idempotencyKey: input.idempotencyKey,
  }).slice(0, 24)}`;
}

export function assertWorkflowId(input: ProcurementInput, intentStateHash: string): Result<string> {
  const id = workflowIdFor(input, intentStateHash);
  return input.workflowId && input.workflowId !== id
    ? err(ErrorCode.VALIDATION_FAILED, "workflowId does not match the canonical workflow identity")
    : ok(id);
}

function buildActionProposal(input: ProcurementInput, ctx: ActionProposalContext): DomainActionFields {
  return {
    capability: input.capability,
    merchant: input.supplier.id,
    product: input.item.specification,
    quantity: input.quantity,
    amount: input.totalAmount,
    currency: input.currency,
    refundable: input.refundable,
    deliveryTerms: input.delivery?.terms,
    parameters: {
      ...input.parameters,
      supplierName: input.supplier.name,
      supplierApproved: input.supplier.approved,
      itemSpecification: input.item.specification,
      foodGradeOffered: /\bfood[\s-]?grade\b/i.test(input.item.specification),
      supplierApprovalEvidenceId: input.supplier.approvalEvidenceId,
      foodGradeEvidenceId: input.foodGradeEvidenceId,
      deliveryDeadline: input.delivery?.deadline,
      evidenceIds: input.evidenceIds,
      externalOfferNodeId: ctx.offerNodeId,
    },
    consequenceLevel: input.consequenceLevel,
  };
}

function evaluateActionFidelity(
  _input: ProcurementInput,
  state: import("@truemandate/protocol").IntentState,
  action: import("@truemandate/protocol").ActionProposal,
): ActionFidelityEvaluation {
  return evaluateActionChecks(state, ProcurementDomainPack.planning, [
    {
      canonicalConcept: "supplier",
      factType: "identity",
      field: "parameters.supplierName",
      actualValue: actionField<string>(action, "supplierName"),
    },
    {
      canonicalConcept: "supplier",
      factType: "approval",
      field: "parameters.supplierApproved",
      actualValue: {
        approved: actionField<boolean>(action, "supplierApproved"),
        supplier: actionField<string>(action, "supplierName"),
      },
    },
    {
      canonicalConcept: "material",
      field: "parameters.foodGradeOffered",
      actualValue: actionField<boolean>(action, "foodGradeOffered"),
    },
    {
      canonicalConcept: "quantity",
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
  input: ProcurementInput,
  ctx: OfferNodeContext,
): { readonly label: string; readonly metadata: Record<string, unknown> } {
  return {
    label: `procurement-offer:${input.supplier.id}`,
    metadata: {
      workflowId: ctx.workflowId,
      intentStateId: ctx.intentStateId,
      offerHash: ctx.offerHash,
    },
  };
}

function buildOutcomeContractInput(
  input: ProcurementInput,
  _ctx: OutcomeContractContext,
): {
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly domain: string;
  readonly parameters?: Record<string, unknown>;
} {
  return {
    merchant: input.supplier.id,
    quantity: input.quantity,
    budgetMax: input.totalAmount,
    product: input.item.specification,
    domain: "procurement",
    parameters: {
      supplierApprovalEvidenceId: input.supplier.approvalEvidenceId,
      foodGradeEvidenceId: input.foodGradeEvidenceId,
      deliveryDeadline: input.delivery?.deadline,
      deliveryTerms: input.delivery?.terms,
    },
  };
}

/**
 * ProcurementDomainPack — domain semantics only.
 * Does not contain a governance pipeline; does not receive Authority/Gateway
 * clients; cannot mint grants, issue CommitTokens, or call Gateway commit.
 */
export const ProcurementDomainPack: DomainPack<ProcurementInput> = {
  id: "procurement",
  requestSchema: ProcurementWorkflowRequestSchema as z.ZodType<ProcurementInput>,
  planning: {
    executionCapability: "execute_payment",
    executionLabel: "procurement purchase",
    requiredPhases: ["VERIFY_OFFER", "BIND_EVIDENCE", "EXECUTE", "VERIFY_OUTCOME"],
    conceptFamilies: [
      {
        canonicalConcept: "supplier",
        aliases: ["supplier", "approved_supplier", "supplier_approved", "supplier_status"],
        factFamilies: [
          { factType: "approval", aliases: ["approved_supplier", "supplier_approved"] },
        ],
      },
      { canonicalConcept: "material", aliases: ["material", "food_grade", "food_grade_certificate", "food_grade_certified", "item_specification"] },
      { canonicalConcept: "quantity", aliases: ["quantity", "quantity_min"] },
      { canonicalConcept: "budget", aliases: ["budget", "budget_max", "budget_per_kg", "max_total_budget", "total_cost", "total_price", "price", "amount", "budget_limit"] },
      { canonicalConcept: "delivery_deadline", aliases: ["delivery_deadline", "execution_deadline", "delivery_before", "arrive_before", "deadline"] },
    ],
    executionCriticalConceptRules: ["supplier", "material", "quantity", "budget", "delivery_deadline"]
      .map((canonicalConcept) => ({ canonicalConcept, proofMechanism: { kind: "EVIDENCE_OBLIGATION" as const } })),
    offerBackedCanonicalConcepts: ["budget", "delivery_deadline"],
  },
  workflowId: workflowIdFor,
  assertWorkflowId,
  buildActionProposal,
  evaluateActionFidelity,
  buildExternalOfferNode,
  buildOutcomeContractInput,
};
