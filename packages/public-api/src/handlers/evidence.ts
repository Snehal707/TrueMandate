import { ErrorCode, err } from "@truemandate/protocol";
import type { EvidenceReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

export function createEvidenceHandler(port: EvidenceReadPort): RouteHandler {
  return async ({ res, params }) => {
    const id = params.id;
    if (!id) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing evidence id", {}));
      return;
    }
    const result = await Promise.resolve(port.getEvidence(id));
    sendResult(res, result);
  };
}
