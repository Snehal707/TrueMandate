import { ErrorCode, err, ok } from "@truemandate/protocol";
import type { ApprovalReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";
import { toPublicApprovalView } from "../dto.js";

/** Read a durable ApprovalRequest — the public surface allowlists the view
 * at this boundary (no hash material or scope construction ever leaks). */
export function createApprovalReadHandler(port: ApprovalReadPort): RouteHandler {
  return async ({ res, params }) => {
    const id = params.id;
    if (!id) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing approval id", {}));
      return;
    }
    const result = await Promise.resolve(port.getApproval(id));
    if (!result.ok) {
      sendResult(res, result);
      return;
    }
    sendResult(res, ok(toPublicApprovalView(result.value as unknown as Record<string, unknown>)));
  };
}
