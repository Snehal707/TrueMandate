import { ErrorCode, err, ok } from "@truemandate/protocol";
import type { ApprovalDecidePort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";
import { toPublicApprovalView } from "../dto.js";

/**
 * Human decision on a PENDING durable ApprovalRequest. The body carries only
 * {decision: APPROVE|DENY, reason?} — decidedBy is derived by the owner
 * service from the verified caller identity, never from this JSON. The
 * response is allowlisted at this boundary.
 */
export function createApprovalDecideHandler(port: ApprovalDecidePort): RouteHandler {
  return async ({ res, params, body }) => {
    const id = params.id;
    if (!id) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing approval id", {}));
      return;
    }
    const result = await Promise.resolve(port.decideApproval(id, body));
    if (!result.ok) {
      sendResult(res, result);
      return;
    }
    sendResult(res, ok(toPublicApprovalView(result.value as unknown as Record<string, unknown>)));
  };
}
