import { ErrorCode, err } from "@truemandate/protocol";
import type { WorkspaceReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

/**
 * `req.url` still carries the query string here — the router matches routes on
 * pathname only and passes the original request through unchanged.
 */
function workflowIdFromQuery(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return undefined;
  const value = new URLSearchParams(url.slice(queryStart + 1)).get("workflowId");
  return value && value.trim().length > 0 ? value : undefined;
}

export function createWorkspaceHandler(port: WorkspaceReadPort): RouteHandler {
  return async ({ req, res, params }) => {
    const intentId = params.intentId;
    if (!intentId) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing intentId", {}));
      return;
    }
    const workflowId = workflowIdFromQuery(req.url);
    const result = await Promise.resolve(port.getWorkspace(intentId, workflowId));
    sendResult(res, result);
  };
}
