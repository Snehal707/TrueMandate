import { ErrorCode, err } from "@truemandate/protocol";
import type { WorkspaceReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

export function createWorkspaceHandler(port: WorkspaceReadPort): RouteHandler {
  return async ({ res, params }) => {
    const intentId = params.intentId;
    if (!intentId) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing intentId", {}));
      return;
    }
    const result = await Promise.resolve(port.getWorkspace(intentId));
    sendResult(res, result);
  };
}
