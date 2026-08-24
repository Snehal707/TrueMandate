import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import {
  parseApprovalRequest,
  parseAuthorityEvaluationRecord,
} from "@truemandate/authority";
import { hashCanonical } from "@truemandate/crypto";
import {
  ApprovalRequestStatus,
  ErrorCode,
  OutcomeContractState,
  err,
  ok,
  type HashDigest,
  type IntentState,
  type Result,
} from "@truemandate/protocol";
import { OutcomeService } from "@truemandate/outcome-service";
import {
  deriveObservations,
  type AcceptedEvidenceClaim,
} from "@truemandate/outcome-core";
import { parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const Ref = z.object({ id: z.string().min(1), hash }).strict();
const OutcomeWorkflowLineage = z
  .object({
    id: z.string().min(1),
    kind: z.literal("WORKFLOW"),
    workflowId: z.string().min(1),
    contentHash: hash,
    payload: z
      .object({
        packId: z.enum([
          "procurement",
          "travel",
          "saas_it_spend",
          "invoice_vendor_payment",
          "logistics_fulfillment",
        ]),
      })
      .passthrough(),
  })
  .passthrough();
const Request = z
  .object({
    evaluation: Ref,
    workflow: Ref,
    action: Ref,
    idempotencyKey: z.string().min(1),
    correlationId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    monitoringContractId: z.string().min(1).optional(),
  })
  .strict();
const response = <T>(r: Result<T>): InternalRouteResponse =>
  r.ok
    ? { status: 200, body: r.value }
    : {
        status: r.details?.retryable === true ? 503 : 400,
        body: { error: r.code, message: r.message, details: r.details },
      };

export interface OutcomeCreationOwners {
  getEvaluation(id: string): Promise<Result<unknown>>;
  getArtifact(id: string): Promise<Result<unknown>>;
  getState(id: string): Promise<Result<IntentState>>;
  getTip(intentId: string): Promise<Result<IntentState>>;
}

function actionParameters(
  action: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const value = action.parameters;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function outcomeMerchantFor(
  packId: string,
  action: Record<string, unknown>,
): string | undefined {
  const parameters = actionParameters(action);
  const fallback =
    typeof action.merchant === "string" ? action.merchant : undefined;
  switch (packId) {
    case "travel":
    case "logistics_fulfillment":
      return typeof parameters?.providerName === "string"
        ? parameters.providerName
        : fallback;
    case "procurement":
      return typeof parameters?.supplierName === "string"
        ? parameters.supplierName
        : fallback;
    case "saas_it_spend":
      return typeof parameters?.vendorName === "string"
        ? parameters.vendorName
        : fallback;
    case "invoice_vendor_payment":
      return typeof parameters?.payeeName === "string"
        ? parameters.payeeName
        : fallback;
    default:
      return fallback;
  }
}

export function createOutcomeInternalRoutes(
  outcomes: OutcomeService,
  owners: OutcomeCreationOwners,
  auth?: {
    readonly globalCallers?: readonly string[];
    readonly readerCallerEmails?: readonly string[];
    readonly authorityCallerEmail?: string;
    readonly evaluationCallerEmail?: string;
    readonly evidenceReadPort?: {
      getClaim(id: string): Promise<Result<unknown>>;
      getEnvelope(id: string): Promise<Result<unknown>>;
    };
    readonly approvalReadPort?: {
      get(id: string): Promise<unknown>;
    };
    readonly resolutionRead?: {
      getCaseByContract(contractId: string): Result<unknown>;
    };
    readonly closeCallers?: readonly string[];
  },
): readonly InternalRoute[] {
  const readCallers = [
    ...(auth?.globalCallers ?? []),
    ...(auth?.readerCallerEmails ?? []),
    ...(auth?.authorityCallerEmail ? [auth.authorityCallerEmail] : []),
    ...(auth?.evaluationCallerEmail ? [auth.evaluationCallerEmail] : []),
  ].filter((value, index, all) => all.indexOf(value) === index);

  const contractRead: InternalRoute = {
    method: "GET",
    pattern: "/internal/outcomes/contracts/:id",
    allowedCallers: readCallers,
    handler: async ({ params }) => {
      const id = params.id;
      if (!id) {
        return response(err(ErrorCode.VALIDATION_FAILED, "OutcomeContract id missing"));
      }
      const loaded = await outcomes.getContract(id);
      if (!loaded.ok) return response(loaded);
      const binding = loaded.value.preExecutionBinding;
      // Historical contracts without a workflow binding remain owner-readable.
      // The strict public SDK continues to reject their absent lineage.
      if (!binding) return response(loaded);

      const workflow = await owners.getArtifact(binding.workflowId);
      if (!workflow.ok) {
        return response(
          err(
            ErrorCode.OUTCOME_CONTRACT_STALE,
            "OutcomeContract workflow lineage unavailable",
            { workflowId: binding.workflowId },
          ),
        );
      }
      const parsed = OutcomeWorkflowLineage.safeParse(workflow.value);
      if (
        !parsed.success ||
        parsed.data.id !== binding.workflowId ||
        parsed.data.workflowId !== binding.workflowId ||
        parsed.data.contentHash !== binding.workflowHash
      ) {
        return response(
          err(
            ErrorCode.OUTCOME_CONTRACT_STALE,
            "OutcomeContract workflow lineage mismatch",
            { workflowId: binding.workflowId },
          ),
        );
      }

      return response(
        ok({
          ...loaded.value,
          workflowId: binding.workflowId,
          domain: parsed.data.payload.packId,
        }),
      );
    },
  };

  const createContract = async (body: unknown): Promise<InternalRouteResponse> => {
    const request = Request.safeParse(body);
    if (!request.success) {
      return response(
        err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "Invalid OutcomeContract creation request",
        ),
      );
    }
    const rawEvaluation = await owners.getEvaluation(request.data.evaluation.id);
    if (!rawEvaluation.ok) return response(rawEvaluation);
    const evaluation = parseAuthorityEvaluationRecord(
      rawEvaluation.value,
      "AuthorityEvaluationRecord",
    );
    if (
      !evaluation.ok ||
      evaluation.value.recordHash !== request.data.evaluation.hash
    ) {
      return response(
        err(ErrorCode.VALIDATION_FAILED, "EvaluationRecord hash mismatch"),
      );
    }

    let approvalUnlocked = false;
    if (evaluation.value.decision === "REQUIRE_APPROVAL") {
      if (!request.data.approvalId || !auth?.approvalReadPort) {
        return response(
          err(
            ErrorCode.APPROVAL_REQUIRED,
            "REQUIRE_APPROVAL evaluation requires a durable approval",
          ),
        );
      }
      const rawApproval = await auth.approvalReadPort.get(request.data.approvalId);
      if (!rawApproval) {
        return response(
          err(ErrorCode.APPROVAL_NOT_PENDING, "Unknown approval request", {
            approvalId: request.data.approvalId,
          }),
        );
      }
      const approval = parseApprovalRequest(rawApproval);
      if (!approval.ok) return response(approval);
      approvalUnlocked =
        evaluation.value.materializationReason === "PENDING_APPROVAL" &&
        approval.value.status === ApprovalRequestStatus.APPROVED &&
        approval.value.authorityEvaluationId === evaluation.value.id &&
        approval.value.workflowId === evaluation.value.workflowId &&
        approval.value.intentStateHash ===
          evaluation.value.evaluatedIntentState.hash &&
        approval.value.requestedCapability === evaluation.value.capability &&
        approval.value.requestedScope.amount === (evaluation.value.amount ?? 0) &&
        approval.value.requestedScope.merchant ===
          (evaluation.value.merchant ?? "") &&
        approval.value.requestedScope.currency ===
          (evaluation.value.currency ?? "");
      if (!approvalUnlocked) {
        return response(
          err(ErrorCode.AUTHORITY_BLOCKED, "Approval does not unlock this evaluation"),
        );
      }
    }
    if (
      !(
        approvalUnlocked ||
        ((evaluation.value.decision === "ALLOW" ||
          evaluation.value.decision === "ALLOW_WITH_MONITORING") &&
          evaluation.value.materializationEligible)
      )
    ) {
      return response(
        err(
          ErrorCode.AUTHORITY_BLOCKED,
          "EvaluationRecord is not materializable",
        ),
      );
    }
    if (
      !evaluation.value.expiresAt ||
      Date.parse(evaluation.value.expiresAt) <= Date.now()
    ) {
      return response(err(ErrorCode.GRANT_EXPIRED, "EvaluationRecord is expired"));
    }

    const rawWorkflow = await owners.getArtifact(request.data.workflow.id);
    const rawAction = await owners.getArtifact(request.data.action.id);
    if (!rawWorkflow.ok) return response(rawWorkflow);
    if (!rawAction.ok) return response(rawAction);
    const workflow = rawWorkflow.value as Record<string, unknown>;
    const artifact = rawAction.value as Record<string, unknown>;
    if (
      !workflow ||
      workflow.kind !== "WORKFLOW" ||
      workflow.contentHash !== request.data.workflow.hash ||
      workflow.id !== evaluation.value.workflow.id ||
      workflow.contentHash !== evaluation.value.workflow.hash
    ) {
      return response(err(ErrorCode.VALIDATION_FAILED, "Workflow binding mismatch"));
    }
    if (
      !artifact ||
      artifact.kind !== "ACTION" ||
      artifact.contentHash !== request.data.action.hash ||
      artifact.id !== evaluation.value.action.id ||
      artifact.contentHash !== evaluation.value.action.hash ||
      artifact.workflowId !== evaluation.value.workflowId
    ) {
      return response(err(ErrorCode.VALIDATION_FAILED, "Action binding mismatch"));
    }
    const payload = artifact.payload as Record<string, unknown> | undefined;
    const action = payload?.action as Record<string, unknown> | undefined;
    if (
      !payload ||
      !action ||
      payload.intentStateId !== evaluation.value.evaluatedIntentState.id ||
      payload.intentStateHash !== evaluation.value.evaluatedIntentState.hash
    ) {
      return response(
        err(
          ErrorCode.GRANT_INTENT_STATE_MISMATCH,
          "Action state binding mismatch",
        ),
      );
    }

    const state = await owners.getState(evaluation.value.evaluatedIntentState.id);
    if (!state.ok || state.value.stateHash !== evaluation.value.evaluatedIntentState.hash) {
      return response(
        err(
          ErrorCode.GRANT_INTENT_STATE_MISMATCH,
          "Authoritative IntentState mismatch",
        ),
      );
    }
    const tip = await owners.getTip(String(state.value.intentId));
    if (
      !tip.ok ||
      tip.value.id !== state.value.id ||
      tip.value.stateHash !== state.value.stateHash ||
      tip.value.version !== evaluation.value.evaluatedIntentState.version
    ) {
      return response(
        err(
          ErrorCode.GRANT_INTENT_STATE_MISMATCH,
          "Evaluation IntentState is no longer current",
        ),
      );
    }

    const createdAt = typeof action.createdAt === "string" ? action.createdAt : undefined;
    const packId =
      workflow.payload &&
      typeof workflow.payload === "object" &&
      typeof (workflow.payload as Record<string, unknown>).packId === "string"
        ? String((workflow.payload as Record<string, unknown>).packId)
        : "procurement";
    const merchant = outcomeMerchantFor(packId, action);
    if (
      !createdAt ||
      !merchant ||
      typeof action.quantity !== "number" ||
      typeof action.amount !== "number"
    ) {
      return response(err(ErrorCode.VALIDATION_FAILED, "Malformed durable Action payload"));
    }
    const binding = {
      workflowId: evaluation.value.workflowId,
      workflowHash: evaluation.value.workflow.hash as HashDigest,
      actionId: evaluation.value.action.id,
      actionHash: evaluation.value.action.hash as HashDigest,
      evaluationId: evaluation.value.id,
      evaluationHash: evaluation.value.recordHash as HashDigest,
      evaluatedIntentStateId: evaluation.value.evaluatedIntentState.id,
      evaluatedIntentStateHash:
        evaluation.value.evaluatedIntentState.hash as HashDigest,
      evaluatedIntentStateVersion: evaluation.value.evaluatedIntentState.version,
    };
    const contractId = `outcome-${evaluation.value.id}-${hashCanonical({
      workflow: request.data.workflow,
      idempotencyKey: request.data.idempotencyKey,
    }).slice(0, 16)}`;
    return response(
      await outcomes.createPreExecutionContract({
        id: contractId,
        intentState: state.value,
        principalId: String(action.agentId ?? "agent-runtime"),
        merchant,
        quantity: action.quantity,
        budgetMax: action.amount,
        product: typeof action.product === "string" ? action.product : undefined,
        domain: packId,
        parameters:
          actionParameters(action),
        actionProposalId: artifact.id as string,
        actionContentHash: artifact.contentHash as HashDigest,
        planId: typeof action.planId === "string" ? action.planId : undefined,
        createdAt,
        preExecutionBinding: binding,
        ...(request.data.monitoringContractId
          ? { monitoringContractId: request.data.monitoringContractId }
          : {}),
      }),
    );
  };

  const routes: InternalRoute[] = [
    contractRead,
    {
      method: "POST",
      pattern: "/internal/outcomes/contracts",
      allowedCallers: auth?.globalCallers,
      handler: async ({ body }) => createContract(body),
    },
    {
      method: "POST",
      pattern: "/internal/outcomes/procurement-contract",
      allowedCallers: auth?.globalCallers,
      handler: async ({ body }) => createContract(body),
    },
    {
      method: "POST",
      pattern: "/internal/outcomes/contracts/:id/close",
      allowedCallers: auth?.closeCallers ?? auth?.globalCallers,
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const id = params.id;
        if (!id) {
          return response(err(ErrorCode.VALIDATION_FAILED, "OutcomeContract id missing"));
        }
        const contract = await outcomes.getContract(id);
        if (!contract.ok) return response(contract);
        if (
          contract.value.state === OutcomeContractState.SATISFIED &&
          auth?.resolutionRead
        ) {
          const existing = auth.resolutionRead.getCaseByContract(id);
          if (existing.ok) {
            return response(
              err(
                ErrorCode.VALIDATION_FAILED,
                "Open ResolutionCase exists - resolve before closing",
                { caseId: existing.value },
              ),
            );
          }
        }
        return response(await outcomes.closeContract(id, new Date().toISOString()));
      },
    },
  ];

  if (auth?.evaluationCallerEmail && auth.evidenceReadPort) {
    routes.push({
      method: "POST",
      pattern: "/internal/outcomes/:outcomeContractId/evaluate-evidence",
      allowedCallers: [auth.evaluationCallerEmail],
      handler: async ({
        params,
        body,
      }: {
        params: Record<string, string>;
        body: unknown;
      }) => {
        const request = parseWithSchema(
          z
            .object({
              claimIds: z.array(z.string().min(1)).min(1),
              executionRef: z.object({ id: z.string().min(1) }).optional(),
            })
            .strict(),
          body,
          "OutcomeEvaluateEvidenceRequest",
        );
        if (!request.ok) return response(request);
        const contractId = params.outcomeContractId;
        if (!contractId) {
          return response(err(ErrorCode.VALIDATION_FAILED, "OutcomeContract id missing"));
        }
        const contract = await outcomes.getContract(contractId);
        if (!contract.ok) return response(contract);
        const accepted: AcceptedEvidenceClaim[] = [];
        for (const claimId of request.value.claimIds) {
          const claimResult = await auth.evidenceReadPort!.getClaim(claimId);
          if (!claimResult.ok) return response(claimResult);
          const claim = claimResult.value as {
            id?: string;
            evidenceId?: string;
            concept?: string;
            value?: unknown;
          };
          if (
            !claim ||
            typeof claim.evidenceId !== "string" ||
            typeof claim.concept !== "string"
          ) {
            return response(
              err(ErrorCode.VALIDATION_FAILED, "Malformed accepted claim", {
                claimId,
              }),
            );
          }
          const envelopeResult = await auth.evidenceReadPort!.getEnvelope(
            claim.evidenceId,
          );
          if (!envelopeResult.ok) return response(envelopeResult);
          const envelope = envelopeResult.value as {
            source?: string;
            trustClass?: string;
            captureTime?: string;
          };
          accepted.push({
            id: String(claim.id ?? claimId),
            concept: claim.concept,
            value: claim.value,
            source: String(envelope.source ?? "unknown"),
            trustClass: String(envelope.trustClass ?? "UNTRUSTED_EXTERNAL"),
            capturedAt: String(envelope.captureTime ?? ""),
          });
        }
        const derived = deriveObservations(contract.value, accepted);
        if (!derived.ok) return response(derived);
        const now = new Date().toISOString();
        const applied = await outcomes.applyObservations(
          contract.value.id,
          { ...derived.value.facts },
          now,
          { conflictedConcepts: derived.value.conflictedConcepts },
        );
        if (!applied.ok) return response(applied);
        return {
          status: 200,
          body: {
            contract: applied.value.contract,
            verification: applied.value.verification,
            divergence: derived.value.divergence ?? null,
            contributingClaimIds: derived.value.contributingClaimIds,
          },
        };
      },
    });
  }

  return routes;
}
