import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import { ErrorCode, err, type Result } from "@truemandate/protocol";
import type { ResolutionService } from "./service.js";

const response = <T>(r: Result<T>): InternalRouteResponse =>
  r.ok
    ? { status: 200, body: r.value }
    : { status: 400, body: { error: r.code, message: r.message, details: r.details } };

/**
 * Route-specific read surface: the verified Phase C verifier may assert the
 * durable ResolutionCase after the owner's trigger lifecycle created it.
 * Reads only — never case creation, attribution or remedy authority.
 */
export function createResolutionReadRoutes(
  resolution: ResolutionService,
  readCallers: readonly string[],
): readonly InternalRoute[] {
  return [
    {
      method: "GET",
      pattern: "/internal/resolutions/cases/:id",
      allowedCallers: readCallers.length > 0 ? readCallers : undefined,
      handler: async ({ params }) => {
        const id = params.id;
        if (!id) return response(err(ErrorCode.VALIDATION_FAILED, "ResolutionCase id missing"));
        // Restart-safe read: hydrate the durable case before serving it.
        const caseResult = await resolution.hydrateCase(id);
        if (!caseResult.ok) return response(caseResult);
        return { status: 200, body: { case: caseResult.value, evidenceRequests: resolution.getEvidenceRequests(id) } };
      },
    },
    {
      method: "GET",
      pattern: "/internal/resolutions/cases/by-contract/:outcomeContractId",
      allowedCallers: readCallers.length > 0 ? readCallers : undefined,
      handler: async ({ params }) => {
        const contractId = params.outcomeContractId;
        if (!contractId) return response(err(ErrorCode.VALIDATION_FAILED, "OutcomeContract id missing"));
        const caseResult = resolution.getCaseByContract(contractId);
        if (!caseResult.ok) return response(caseResult);
        return { status: 200, body: { case: caseResult.value, evidenceRequests: resolution.getEvidenceRequests(caseResult.value.id) } };
      },
    },
    {
      method: "GET",
      pattern: "/internal/resolutions/mandates/:id",
      allowedCallers: readCallers.length > 0 ? readCallers : undefined,
      handler: async ({ params }) => {
        const id = params.id;
        if (!id) return response(err(ErrorCode.VALIDATION_FAILED, "RemediationMandate id missing"));
        return response(await resolution.getMandate(id));
      },
    },
    {
      method: "GET",
      pattern: "/internal/resolutions/cases/:id/remedies/:remedyId",
      allowedCallers: readCallers.length > 0 ? readCallers : undefined,
      handler: async ({ params }) => {
        const caseId = params.id;
        const remedyId = params.remedyId;
        if (!caseId || !remedyId) return response(err(ErrorCode.VALIDATION_FAILED, "Remedy reference missing"));
        const hydrated = await resolution.hydrateCase(caseId);
        if (!hydrated.ok) return response(hydrated);
        return response(resolution.getRemedy(caseId, remedyId));
      },
    },
  ];
}
