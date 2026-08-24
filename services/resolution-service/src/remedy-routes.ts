import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import { ErrorCode, err, type IntentState, type Result } from "@truemandate/protocol";
import type { WorkflowStageRecorder } from "@truemandate/observability/workflow-stage";
import type { OutcomeService } from "@truemandate/outcome-service";
import type { PrivilegedRemedyPort } from "./remedy-pipeline.js";
import { executeRemedyPipeline } from "./remedy-pipeline.js";
import type { ResolutionService } from "./service.js";
import { z } from "zod";

/**
 * Wave 1 remedy lifecycle owner routes. All remedy scope is server-derived:
 * callers may only reference the planned RemedyProposal and the issued
 * RemediationMandate — never amount, merchant, capability, or execution
 * parameters.
 */

const response = <T>(r: Result<T>): InternalRouteResponse =>
  r.ok
    ? { status: 200, body: r.value }
    : { status: 400, body: { error: r.code, message: r.message, details: r.details } };

const IssueMandateSchema = z.object({ expiresAt: z.string().min(1) }).strict();
const ExecuteRemedySchema = z.object({
  mandateId: z.string().min(1),
  originalPaymentGrantId: z.string().min(1),
}).strict();
const VerifyRemedySchema = z.object({ remedyOutcomeContractId: z.string().min(1) }).strict();

export function createRemedyRoutes(input: {
  readonly resolution: ResolutionService;
  readonly outcomes: OutcomeService;
  readonly gateway: PrivilegedRemedyPort;
  readonly getIntentState: (id: string) => Promise<IntentState | undefined>;
  readonly remedyCallers: readonly string[];
  readonly stageRecorder?: WorkflowStageRecorder;
}): readonly InternalRoute[] {
  const { resolution, outcomes, gateway, getIntentState, remedyCallers, stageRecorder } = input;
  const callers = remedyCallers.length > 0 ? remedyCallers : undefined;

  return [
    {
      method: "GET",
      pattern: "/internal/resolutions/cases/:id/remedies",
      allowedCallers: callers,
      handler: async ({ params }) => {
        const caseId = params.id;
        if (!caseId) return response(err(ErrorCode.VALIDATION_FAILED, "ResolutionCase id missing"));
        // Restart-safe: hydrate the durable case (and embedded remedies)
        // before the in-memory lifecycle reads.
        const c = await resolution.hydrateCase(caseId);
        if (!c.ok) return response(c);
        // Idempotent planning: reading remedies plans them when the owner
        // lifecycle has not yet done so.
        let remedies = resolution.listRemedies(caseId);
        if (remedies.length === 0) {
          const planned = await resolution.planRemedies(caseId, new Date().toISOString());
          if (!planned.ok) return response(planned);
          remedies = planned.value;
          await resolution.flushCases();
          await resolution.flushEvents();
        }
        return { status: 200, body: { case: c.value, remedies } };
      },
    },
    {
      method: "POST",
      pattern: "/internal/resolutions/cases/:id/remedies/:remedyId/mandates",
      allowedCallers: callers,
      handler: async ({ params, body }) => {
        const caseId = params.id;
        const remedyId = params.remedyId;
        if (!caseId || !remedyId) return response(err(ErrorCode.VALIDATION_FAILED, "Remedy reference missing"));
        const parsed = IssueMandateSchema.safeParse(body);
        if (!parsed.success) return response(err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid mandate issue request"));
        if (Number.isNaN(Date.parse(parsed.data.expiresAt))) return response(err(ErrorCode.VALIDATION_FAILED, "Malformed mandate expiry"));
        const hydrated = await resolution.hydrateCase(caseId);
        if (!hydrated.ok) return response(hydrated);
        const remedyResult = resolution.getRemedy(caseId, remedyId);
        if (!remedyResult.ok) return response(remedyResult);
        const remedy = remedyResult.value;
        // Server-derived policy bounds: the mandate scope is computed from the
        // planned remedy, never from caller-supplied economics.
        const maxAmount = remedy.financialCost ?? remedy.estimatedAmount ?? 0;
        if (!remedy.requiresFinancialAction || maxAmount <= 0) {
          return response(err(ErrorCode.REMEDIATION_MANDATE_REQUIRED, "Remedy is not a financial action"));
        }
        return response(await resolution.issueMandate({
          caseId,
          remedy,
          principalId: "resolution-owner",
          maxAmount,
          currency: remedy.currency ?? "INR",
          allowedCapabilities: ["execute_payment"],
          allowedMerchants: ["remedy-counterparty"],
          expiresAt: parsed.data.expiresAt,
          now: new Date().toISOString(),
        }));
      },
    },
    {
      method: "POST",
      pattern: "/internal/resolutions/cases/:id/remedies/:remedyId/execute",
      allowedCallers: callers,
      handler: async ({ params, body }) => {
        const caseId = params.id;
        const remedyId = params.remedyId;
        if (!caseId || !remedyId) return response(err(ErrorCode.VALIDATION_FAILED, "Remedy reference missing"));
        const parsed = ExecuteRemedySchema.safeParse(body);
        if (!parsed.success) return response(err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid remedy execute request"));
        const caseResult = await resolution.hydrateCase(caseId);
        if (!caseResult.ok) return response(caseResult);
        const remedyResult = resolution.getRemedy(caseId, remedyId);
        if (!remedyResult.ok) return response(remedyResult);
        const mandateResult = await resolution.getMandate(parsed.data.mandateId);
        if (!mandateResult.ok) return response(mandateResult);
        const mandate = mandateResult.value;
        if (mandate.resolutionCaseId !== caseId || mandate.remedyProposalId !== remedyId) {
          return response(err(ErrorCode.REMEDIATION_MANDATE_CASE_MISMATCH, "Mandate does not bind this case/remedy"));
        }
        // The binding is now route-validated; persist it on the stored remedy
        // so the independent Authority evaluation observes it (restart-safe).
        const bound = resolution.bindRemedyToMandate(caseId, remedyId, mandate.id);
        if (!bound.ok) return response(bound);
        const remedy = bound.value;
        await resolution.flushCases();
        const intentState = await getIntentState(caseResult.value.intentStateId);
        if (!intentState) {
          return response(err(ErrorCode.VALIDATION_FAILED, "Unknown case IntentState"));
        }
        // The bounded execution window: the mandate expiry is authoritative.
        const now = new Date().toISOString();
        if (Date.parse(now) > Date.parse(mandate.expiresAt)) {
          return response(err(ErrorCode.REMEDIATION_MANDATE_STALE, "RemediationMandate has expired"));
        }
        const executed = await executeRemedyPipeline({
          resolution,
          outcomes,
          gateway,
          caseId,
          remedy,
          mandate,
          originalPaymentGrantId: parsed.data.originalPaymentGrantId as never,
          intentState,
          principalId: caseResult.value.principalId ?? "resolution-owner",
          now,
          expiresAt: mandate.expiresAt,
          stageRecorder,
        });
        // Durable checkpoint before the caller may observe the execution:
        // events, claims and case state must survive instance recycling.
        await resolution.flushCases();
        await resolution.flushEvents();
        return response(executed);
      },
    },
    {
      method: "POST",
      pattern: "/internal/resolutions/cases/:id/remedy-verification",
      allowedCallers: callers,
      handler: async ({ params, body }) => {
        const caseId = params.id;
        if (!caseId) return response(err(ErrorCode.VALIDATION_FAILED, "ResolutionCase id missing"));
        const parsed = VerifyRemedySchema.safeParse(body);
        if (!parsed.success) return response(err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid remedy verification request"));
        const hydrated = await resolution.hydrateCase(caseId);
        if (!hydrated.ok) return response(hydrated);
        // The remedy contract state is owner-read, never caller-supplied.
        const contract = await outcomes.getContract(parsed.data.remedyOutcomeContractId);
        if (!contract.ok) return response(contract);
        const resolved = resolution.resolveFromRemedyOutcome({
          caseId,
          remedyContractState: contract.value.state,
          now: new Date().toISOString(),
        });
        await resolution.flushCases();
        await resolution.flushEvents();
        return response(resolved);
      },
    },
  ];
}
