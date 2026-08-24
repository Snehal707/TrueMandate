import { ErrorCode, err, ok } from "@truemandate/protocol";
import type { ResolutionReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";
import { toPublicResolutionCaseView } from "../dto.js";

/** ResolutionCase inspection — no case creation, attribution, or remedy
 * authority. The response is allowlisted at this boundary. */
export function createResolutionCaseHandler(port: ResolutionReadPort): RouteHandler {
  return async ({ res, params }) => {
    const id = params.id;
    if (!id) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing resolution case id", {}));
      return;
    }
    const result = await Promise.resolve(port.getResolutionCase(id));
    if (!result.ok) {
      sendResult(res, result);
      return;
    }
    sendResult(res, ok(toPublicResolutionCaseView(result.value as unknown as Record<string, unknown>)));
  };
}

export function createResolutionCaseByOutcomeHandler(
  port: ResolutionReadPort,
): RouteHandler {
  return async ({ res, params }) => {
    const contractId = params.outcomeContractId;
    if (!contractId) {
      sendResult(
        res,
        err(ErrorCode.VALIDATION_FAILED, "Missing outcome contract id", {}),
      );
      return;
    }
    const result = await Promise.resolve(
      port.getResolutionCaseByOutcome(contractId),
    );
    if (!result.ok) {
      sendResult(res, result);
      return;
    }
    sendResult(
      res,
      ok(toPublicResolutionCaseView(result.value as unknown as Record<string, unknown>)),
    );
  };
}

/** Planned remedy inspection — never remedy execution. */
export function createResolutionRemediesHandler(port: ResolutionReadPort): RouteHandler {
  return async ({ res, params }) => {
    const caseId = params.id;
    if (!caseId) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing resolution case id", {}));
      return;
    }
    const result = await Promise.resolve(port.listRemedies(caseId));
    sendResult(res, result);
  };
}

/** RemediationMandate inspection (scope prerequisite; never an execution grant). */
export function createResolutionMandateHandler(port: ResolutionReadPort): RouteHandler {
  return async ({ res, params }) => {
    const id = params.id;
    if (!id) {
      sendResult(res, err(ErrorCode.VALIDATION_FAILED, "Missing mandate id", {}));
      return;
    }
    const result = await Promise.resolve(port.getMandate(id));
    sendResult(res, result);
  };
}
