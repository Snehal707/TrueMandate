import { ErrorCode, err, ok } from "@truemandate/protocol";
import type { OutcomeReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";
import { toPublicOutcomeView } from "../dto.js";

/** OutcomeContract inspection only. Never exposes verifier internals or any
 * owner mutation surface. */
export function createOutcomeReadHandler(port: OutcomeReadPort): RouteHandler {
  return async ({ res, params }) => {
    const id = params.id;
    if (!id) {
      sendResult(
        res,
        err(ErrorCode.VALIDATION_FAILED, "Missing outcome contract id", {}),
      );
      return;
    }
    const result = await Promise.resolve(port.getOutcomeContract(id));
    if (!result.ok) {
      sendResult(res, result);
      return;
    }
    sendResult(
      res,
      ok(toPublicOutcomeView(result.value as unknown as Record<string, unknown>)),
    );
  };
}
