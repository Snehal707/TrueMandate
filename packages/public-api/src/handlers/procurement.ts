import type { WorkflowSubmitPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";
import { ErrorCode, err } from "@truemandate/protocol";
import { z } from "zod";

export const ProcurementOfferSchema = z.object({
  intentId: z.string().min(1),
  supplier: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    approved: z.boolean(),
    approvalEvidenceId: z.string().min(1).optional(),
  }).strict(),
  item: z.object({ sku: z.string().min(1).optional(), specification: z.string().min(1) }).strict(),
  quantity: z.number().positive(),
  totalAmount: z.number().positive(),
  currency: z.string().length(3),
  foodGradeEvidenceId: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  delivery: z.object({ deadline: z.string().min(1).optional(), terms: z.string().min(1).optional() }).strict().optional(),
  idempotencyKey: z.string().min(1),
}).strict();

/** Public procurement compatibility alias. It wraps the generic workflow API
 * with packId=procurement instead of exposing procurement fields at the
 * canonical top level. */
export function createProcurementWorkflowHandler(port: WorkflowSubmitPort): RouteHandler {
  return async ({ res, body }) => {
    const parsed = ProcurementOfferSchema.safeParse(body);
    if (!parsed.success) {
      sendResult(res, err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid procurement offer", { issues: parsed.error.issues }));
      return;
    }
    sendResult(
      res,
      await Promise.resolve(
        port.submitWorkflow({
          intent: {
            kind: "REFERENCE",
            intentId: parsed.data.intentId,
          },
          action: {
            capability: "execute_payment",
            merchant: parsed.data.supplier.id,
            product: parsed.data.item.specification,
            quantity: parsed.data.quantity,
            amount: parsed.data.totalAmount,
            currency: parsed.data.currency,
            deliveryTerms: parsed.data.delivery?.terms,
            parameters: {
              supplierName: parsed.data.supplier.name,
              supplierApproved: parsed.data.supplier.approved,
              supplierApprovalEvidenceId: parsed.data.supplier.approvalEvidenceId,
              deliveryDeadline: parsed.data.delivery?.deadline,
              evidenceIds: parsed.data.evidenceIds ?? [
                ...(parsed.data.foodGradeEvidenceId
                  ? [parsed.data.foodGradeEvidenceId]
                  : []),
              ],
            },
            consequenceLevel: "HIGH",
          },
          domain: {
            packId: "procurement",
            payload: {
              supplier: parsed.data.supplier,
              item: parsed.data.item,
              foodGradeEvidenceId: parsed.data.foodGradeEvidenceId,
              evidenceIds: parsed.data.evidenceIds ?? [
                parsed.data.foodGradeEvidenceId,
                parsed.data.supplier.approvalEvidenceId,
              ].filter((value): value is string => typeof value === "string"),
              delivery: parsed.data.delivery,
            },
          },
          idempotencyKey: parsed.data.idempotencyKey,
        }),
      ),
    );
  };
}
