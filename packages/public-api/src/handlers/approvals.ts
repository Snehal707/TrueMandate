import type { ApprovalSubmitPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

export function createApprovalHandler(port: ApprovalSubmitPort): RouteHandler {
  return async ({ res, body }) => {
    const result = await Promise.resolve(port.submitApproval(body));
    sendResult(res, result);
  };
}
