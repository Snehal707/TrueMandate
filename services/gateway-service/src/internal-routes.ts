import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import {
  ApprovalRequestStatus,
  ErrorCode,
  err,
  type ActionProposal,
  type GuardianVerdict,
  type Result,
} from "@truemandate/protocol";
import { assertPreparedActionIntegrity, parseApprovalRequest, parseAuthorityEvaluationRecord } from "@truemandate/authority";
import { authorityGrantNodeId, executionActionNodeId } from "@truemandate/provenance";
import { parseOutcomeContract } from "@truemandate/outcome-core";
import { ActionProposalSchema, GuardianVerdictSchema, parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";
import type { TwoPhaseGateway } from "./two-phase.js";

/**
 * Authorize by server-side PreparedAction id and an already-minted grant.
 * Gateway does not mint grants.
 */
export const GatewayAuthorizeRequestSchema = z
  .object({
    preparedActionId: z.string().min(1),
    grantId: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const GatewayPrepareReferencesSchema = z.object({
  evaluation: z.object({ id: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
  outcomeContract: z.object({ id: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
  workflow: z.object({ id: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
  action: z.object({ id: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
  idempotencyKey: z.string().min(1), correlationId: z.string().min(1).optional(), approvalId: z.string().min(1).optional(),
}).strict();

/**
 * Commit by server-side ids. Omits adapterMode, now, exposureThreshold, and
 * caller-supplied externalState so HTTP callers cannot change MockPaymentAdapter,
 * TOCTOU clocks, or bypass trusted refresh.
 */

function fromResult<T>(result: Result<T>): InternalRouteResponse {
  if (result.ok) {
    return { status: 200, body: result.value };
  }
  const retryable =
    result.details?.retryable === true || result.code === ErrorCode.MODEL_UNAVAILABLE;
  return {
    status: retryable ? 503 : 400,
    body: {
      error: result.code,
      message: result.message,
      details: result.details,
    },
  };
}

export const GatewayCommitRequestSchema = z
  .object({
    commitTokenId: z.string().min(1),
  })
  .strict();

function selectWorkflowToolId(action: ActionProposal): string {
  switch (action.capability) {
    case "book_travel":
      return "travel.book";
    case "manage_saas_subscription":
      return "saas.provision";
    case "pay_invoice":
      return "invoice.pay";
    case "arrange_fulfillment":
      return "logistics.fulfill";
    case "non_refundable_purchase":
      return "purchase.non_refundable";
    case "execute_payment":
    default:
      return "payment.execute";
  }
}

export function createGatewayInternalRoutes(input: {
  readonly gateway: TwoPhaseGateway;
  readonly owners?: { getEvaluation(id: string): Promise<Result<unknown>>; getOutcomeContract(id: string): Promise<Result<unknown>>; getArtifact(id: string): Promise<Result<unknown>>; getState(id: string): Promise<Result<unknown>>; getTip(intentId: string): Promise<Result<unknown>> };
  readonly commitCallers?: readonly string[];
  /** Durable ApprovalRequest read for REQUIRE_APPROVAL materialization. */
  readonly approvalReadPort?: { get(id: string): Promise<unknown> };
}): readonly InternalRoute[] {
  const { gateway, owners, approvalReadPort } = input;

  return [
    ...(owners ? [{ method: "POST", pattern: "/internal/gateway/prepare-references", handler: async ({ body }) => {
      const request = GatewayPrepareReferencesSchema.safeParse(body);
      if (!request.success) return fromResult(err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid Gateway prepare references"));
      const rawEvaluation = await owners.getEvaluation(request.data.evaluation.id); if (!rawEvaluation.ok) return fromResult(rawEvaluation);
      const evaluation = parseAuthorityEvaluationRecord(rawEvaluation.value); if (!evaluation.ok || evaluation.value.recordHash !== request.data.evaluation.hash) return fromResult(err(ErrorCode.VALIDATION_FAILED, "EvaluationRecord hash mismatch"));
      // REQUIRE_APPROVAL evaluations become preparable ONLY when unlocked by a
      // durable APPROVED ApprovalRequest bound to this exact evaluation, scope
      // and IntentState hash. The approval never widens anything.
      let approvalUnlocked = false;
      if (evaluation.value.decision === "REQUIRE_APPROVAL") {
        if (!request.data.approvalId || !approvalReadPort) return fromResult(err(ErrorCode.APPROVAL_REQUIRED, "REQUIRE_APPROVAL evaluation requires a durable approval"));
        const rawApproval = await approvalReadPort.get(request.data.approvalId);
        if (!rawApproval) return fromResult(err(ErrorCode.APPROVAL_NOT_PENDING, "Unknown approval request", { approvalId: request.data.approvalId }));
        const approval = parseApprovalRequest(rawApproval);
        if (!approval.ok) return fromResult(approval);
        approvalUnlocked =
          evaluation.value.materializationReason === "PENDING_APPROVAL" &&
          approval.value.status === ApprovalRequestStatus.APPROVED &&
          approval.value.authorityEvaluationId === evaluation.value.id &&
          approval.value.workflowId === evaluation.value.workflowId &&
          approval.value.intentStateHash === evaluation.value.evaluatedIntentState.hash &&
          approval.value.requestedCapability === evaluation.value.capability &&
          approval.value.requestedScope.amount === (evaluation.value.amount ?? 0) &&
          approval.value.requestedScope.merchant === (evaluation.value.merchant ?? "") &&
          approval.value.requestedScope.currency === (evaluation.value.currency ?? "");
        if (!approvalUnlocked) return fromResult(err(ErrorCode.AUTHORITY_BLOCKED, "Approval does not unlock this evaluation"));
      }
      if (!(approvalUnlocked || ((evaluation.value.decision === "ALLOW" || evaluation.value.decision === "ALLOW_WITH_MONITORING") && evaluation.value.materializationEligible)) || !evaluation.value.expiresAt || Date.parse(evaluation.value.expiresAt) <= Date.now()) return fromResult(err(ErrorCode.AUTHORITY_BLOCKED, "EvaluationRecord is not eligible"));
      const rawOutcome = await owners.getOutcomeContract(request.data.outcomeContract.id); if (!rawOutcome.ok) return fromResult(rawOutcome);
      const outcome = parseOutcomeContract(rawOutcome.value); if (!outcome.ok || outcome.value.definitionHash !== request.data.outcomeContract.hash || outcome.value.preExecutionBinding?.evaluationId !== evaluation.value.id || outcome.value.preExecutionBinding?.evaluationHash !== evaluation.value.recordHash || outcome.value.preExecutionBinding?.workflowId !== evaluation.value.workflowId || outcome.value.preExecutionBinding?.actionId !== evaluation.value.action.id || outcome.value.preExecutionBinding?.actionHash !== evaluation.value.action.hash || outcome.value.preExecutionBinding?.evaluatedIntentStateId !== evaluation.value.evaluatedIntentState.id || outcome.value.preExecutionBinding?.evaluatedIntentStateHash !== evaluation.value.evaluatedIntentState.hash || outcome.value.preExecutionBinding?.evaluatedIntentStateVersion !== evaluation.value.evaluatedIntentState.version) return fromResult(err(ErrorCode.OUTCOME_CONTRACT_STALE, "OutcomeContract lineage mismatch"));
      const rawWorkflow = await owners.getArtifact(request.data.workflow.id); const rawAction = await owners.getArtifact(request.data.action.id); const rawGuardian = await owners.getArtifact(evaluation.value.guardian.id); if (!rawWorkflow.ok) return fromResult(rawWorkflow); if (!rawAction.ok) return fromResult(rawAction); if (!rawGuardian.ok) return fromResult(rawGuardian);
      const workflowArtifact = rawWorkflow.value as Record<string, unknown>, actionArtifact = rawAction.value as Record<string, unknown>, guardianArtifact = rawGuardian.value as Record<string, unknown>;
      if (workflowArtifact.kind !== "WORKFLOW" || workflowArtifact.id !== evaluation.value.workflowId || workflowArtifact.id !== request.data.workflow.id || workflowArtifact.contentHash !== evaluation.value.workflow.hash || workflowArtifact.contentHash !== request.data.workflow.hash) return fromResult(err(ErrorCode.VALIDATION_FAILED, "Workflow lineage mismatch"));
      if (actionArtifact.kind !== "ACTION" || actionArtifact.id !== evaluation.value.action.id || actionArtifact.contentHash !== evaluation.value.action.hash || actionArtifact.contentHash !== request.data.action.hash || actionArtifact.workflowId !== evaluation.value.workflowId) return fromResult(err(ErrorCode.VALIDATION_FAILED, "Action lineage mismatch"));
      const payload = actionArtifact.payload as Record<string, unknown>; const parsedAction = ActionProposalSchema.safeParse(payload?.action); const parsedVerdict = GuardianVerdictSchema.safeParse((guardianArtifact.payload as Record<string, unknown>)?.verdict);
      if (!parsedAction.success || !parsedVerdict.success || guardianArtifact.kind !== "GUARDIAN" || guardianArtifact.workflowId !== evaluation.value.workflowId || guardianArtifact.id !== evaluation.value.guardian.id || guardianArtifact.contentHash !== evaluation.value.guardian.hash || payload.intentStateId !== evaluation.value.evaluatedIntentState.id || payload.intentStateHash !== evaluation.value.evaluatedIntentState.hash) return fromResult(err(ErrorCode.VALIDATION_FAILED, "Malformed owner artifacts"));
      const action = parsedAction.data as unknown as ActionProposal; const verdict = parsedVerdict.data as unknown as GuardianVerdict;
      if (action.id !== evaluation.value.action.id || action.amount !== evaluation.value.amount || action.currency !== evaluation.value.currency || action.merchant !== evaluation.value.merchant) return fromResult(err(ErrorCode.VALIDATION_FAILED, "Action exceeds evaluated economic bounds"));
      const state = await owners.getState(evaluation.value.evaluatedIntentState.id); if (!state.ok || (state.value as { stateHash?: string; version?: number; intentId?: string }).stateHash !== evaluation.value.evaluatedIntentState.hash || (state.value as { version?: number }).version !== evaluation.value.evaluatedIntentState.version || (state.value as { intentId?: string }).intentId !== action.intentId) return fromResult(err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "IntentState stale"));
      const tip = await owners.getTip(String(action.intentId)); if (!tip.ok || (tip.value as { id?: string; stateHash?: string }).id !== evaluation.value.evaluatedIntentState.id || (tip.value as { stateHash?: string }).stateHash !== evaluation.value.evaluatedIntentState.hash) return fromResult(err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "IntentState is not current"));
      return fromResult(await gateway.prepare({ action, verdict, principalId: String(action.agentId), toolId: selectWorkflowToolId(action), agentCapabilities: evaluation.value.scope.capabilities, authorityScope: evaluation.value.scope, externalState: { merchant: action.merchant, product: action.product, quantity: action.quantity, amount: action.amount, currency: action.currency, deliveryTerms: action.deliveryTerms }, idempotencyKey: request.data.idempotencyKey, expiresAt: evaluation.value.expiresAt, outcomeContractId: outcome.value.id, outcomeContractHash: outcome.value.definitionHash, evaluationRecordId: evaluation.value.id, evaluationRecordHash: evaluation.value.recordHash, workflowId: evaluation.value.workflowId, workflowHash: evaluation.value.workflow.hash, actionContentHash: actionArtifact.contentHash as import("@truemandate/protocol").HashDigest, evaluatedIntentStateVersion: evaluation.value.evaluatedIntentState.version }));
    }} satisfies InternalRoute] : []),
    {
      method: "GET",
      pattern: "/internal/gateway/prepared-actions/:id",
      handler: async ({ params }) => {
        const id = params.id;
        if (!id) return fromResult(err(ErrorCode.PREPARED_ACTION_REQUIRED, "PreparedAction id missing"));
        const recordRead = await gateway.getPreparedActionStore().get(id);
        if (!recordRead.ok) return fromResult(recordRead);
        const record = recordRead.value;
        if (!record) return fromResult(err(ErrorCode.PREPARED_ACTION_REQUIRED, "Unknown PreparedAction", { id }));
        const integrity = assertPreparedActionIntegrity(record.preparedAction);
        if (!integrity.ok) return fromResult(integrity);
        return { status: 200, body: record };
      },
    },
    {
      method: "POST",
      pattern: "/internal/gateway/authorize",
      handler: async ({ body }) => {
        const parsed = parseWithSchema(
          GatewayAuthorizeRequestSchema,
          body,
          "GatewayAuthorizeRequest",
        );
        if (!parsed.ok) return fromResult(parsed);
        const authorized = await gateway.authorize({
          preparedActionId: parsed.value.preparedActionId,
          grantId: parsed.value.grantId,
          expiresAt: parsed.value.expiresAt,
        });
        return fromResult(authorized);
      },
    },
    ...(input.commitCallers ? [{
      method: "POST", pattern: "/internal/gateway/commit", allowedCallers: input.commitCallers,
      handler: async ({ body }: { body: unknown }) => {
        const request = GatewayCommitRequestSchema.safeParse(body);
        if (!request.success) return fromResult(err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid Gateway commit request"));
        // Reference-only COMMIT: the caller supplies only the CommitToken
        // identifier. Everything else is reconstructed from durable owner
        // records — the caller cannot redefine supplier, amount, recipient,
        // currency, parameters, PreparedAction contents, or authority scope.
        const tokenRead = await gateway.getCommitTokenStore().get(request.data.commitTokenId);
        if (!tokenRead.ok) return fromResult(tokenRead);
        const token = tokenRead.value;
        if (!token) return fromResult(err(ErrorCode.VALIDATION_FAILED, "Unknown CommitToken"));
        const recordRead = await gateway.getPreparedActionStore().get(token.preparedActionId);
        if (!recordRead.ok) return fromResult(recordRead);
        const record = recordRead.value;
        if (!record) return fromResult(err(ErrorCode.PREPARED_ACTION_REQUIRED, "Unknown prepared action for CommitToken"));
        const prepared = record.preparedAction;
        const agentId = token.agentId ?? prepared.agentId;
        // Remediation spend is scoped to its own mandate-bound exposure group
        // (independent authority, INV_023) — never against the original
        // purchase's cumulative exposure. The remedy marker travels inside
        // the PreparedAction toolParameters (the action-parameter snapshot).
        const remedyParameters = (prepared.parameters.toolParameters ?? {}) as { remedy?: boolean; remediationMandateId?: string };
        const remedyScoped = remedyParameters.remedy === true;
        // Remediation-specific scope must never become an evasion of ROOT
        // related cumulative exposure: the remedy additionally reserves
        // against the root intent/policy budget group, with the root budget
        // read from the authoritative IntentState (never caller-supplied).
        let rootExposure: { relatedGroupId: string; threshold: number } | undefined;
        if (remedyScoped && owners) {
          const stateResult = await owners.getState(prepared.intentStateId);
          if (stateResult.ok) {
            const state = stateResult.value as { constraints?: readonly { kind?: string; concept?: string; value?: unknown }[] };
            const budget = state?.constraints?.find(
              (constraint) =>
                constraint.kind === "FINANCIAL" ||
                /budget|cost|amount|price|spend/.test(String(constraint.concept ?? "")),
            );
            const rootThreshold = typeof budget?.value === "number" ? budget.value : undefined;
            if (rootThreshold === undefined) {
              // Fail closed: a remedy without an authoritative root budget
              // policy cannot execute.
              return fromResult(err(ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED, "Root exposure policy unavailable for remedy execution"));
            }
            rootExposure = {
              relatedGroupId: `${prepared.intentId}:${prepared.parameters.currency ?? "NA"}`,
              threshold: rootThreshold,
            };
          }
        }
        const commitResult = await gateway.commit({
          preparedAction: prepared,
          grantId: token.grantId,
          commitToken: token,
          agentId: String(agentId),
          actionNodeId: executionActionNodeId({ preparedActionId: prepared.id }),
          authorityNodeId: authorityGrantNodeId(String(token.grantId)),
          ...(remedyScoped
            ? { relatedGroupId: `remedy:${String(remedyParameters?.remediationMandateId ?? token.grantId)}:${prepared.parameters.currency ?? "NA"}` }
            : {}),
          ...(rootExposure ? { rootExposure } : {}),
        });
        return fromResult(commitResult);
      },
    }] : []),
  ];
}
