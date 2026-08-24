import { hashCanonical } from "@truemandate/crypto";
import {
  ApprovalDecision,
  ApprovalEventType,
  ApprovalRequestStatus,
  ErrorCode,
  err,
  ok,
  asActionId,
  asApprovalRequestId,
  asAuthorityRequestId,
  asHashDigest,
  asIntentId,
  asIntentStateId,
  asPrincipalId,
  type ApprovalEvent,
  type ApprovalRequest,
  type Result,
} from "@truemandate/protocol";
import { ApprovalEventSchema, ApprovalRequestSchema, parseWithSchema } from "@truemandate/schemas";

/**
 * Durable human-approval lifecycle core (PROJECT_SPEC Wave 1).
 *
 * Security invariants (all enforced here, fail-closed):
 *  - a human approval authorizes ONLY the already-evaluated bounded request
 *    (it can never increase amount, broaden merchant scope, add capability,
 *    change PreparedAction params, or apply to another IntentState);
 *  - it never creates arbitrary new authority and never calls the Gateway;
 *  - it cannot survive supersession or expiry;
 *  - it cannot be replayed as a second approval (decided is terminal);
 *  - it cannot be caller-forged (decidedBy is set by the service from the
 *    verified caller identity, never from request JSON).
 */

export interface ApprovalRequestDraft {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly intentStateHash: string;
  readonly authorityEvaluationId: string;
  readonly actionId?: string;
  readonly preparedActionHash?: string;
  readonly requestedCapability: string;
  readonly requestedScope: {
    readonly amount: number;
    readonly currency: string;
    readonly merchant: string;
    readonly quantity?: number;
  };
  readonly requestedAt: string;
  readonly expiresAt: string;
}

export interface EvaluationSnapshotForApproval {
  readonly decision: string;
  readonly capability: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly evaluatedIntentState: { readonly id: string; readonly hash: string };
}

export function approvalRequestHash(value: Omit<ApprovalRequest, "contentHash">): string {
  return hashCanonical(value);
}

/** The contentHash covers the CURRENT lifecycle state, so every transition
 * (decide/expire/supersede) re-proves the durable row at its new stage.
 * A stale contentHash on the input (spread from the prior stage) is stripped
 * before re-hashing. */
function withHash(value: Omit<ApprovalRequest, "contentHash">): ApprovalRequest {
  const { contentHash: _stale, ...canonical } = value as ApprovalRequest;
  return { ...canonical, contentHash: asHashDigest(approvalRequestHash(canonical)) };
}

export function parseApprovalRequest(value: unknown): Result<ApprovalRequest> {
  const parsed = parseWithSchema(ApprovalRequestSchema, value, "ApprovalRequest");
  if (!parsed.ok) return parsed as Result<ApprovalRequest>;
  const request = parsed.value as unknown as ApprovalRequest;
  const { contentHash, ...canonical } = request;
  if (contentHash !== approvalRequestHash(canonical)) {
    return err(ErrorCode.VALIDATION_FAILED, "ApprovalRequest canonical hash mismatch");
  }
  return ok(request);
}

/** A request can only be created from a REQUIRE_APPROVAL evaluation. */
export function createApprovalRequest(input: {
  readonly draft: ApprovalRequestDraft;
  readonly evaluation: EvaluationSnapshotForApproval;
}): Result<ApprovalRequest> {
  const { draft, evaluation } = input;
  if (evaluation.decision !== "REQUIRE_APPROVAL") {
    return err(ErrorCode.APPROVAL_REQUIRED, "ApprovalRequest requires a REQUIRE_APPROVAL evaluation", {
      decision: evaluation.decision,
    });
  }
  if (evaluation.evaluatedIntentState.id !== draft.intentStateId || evaluation.evaluatedIntentState.hash !== draft.intentStateHash) {
    return err(ErrorCode.APPROVAL_STALE_INTENT_STATE, "ApprovalRequest must bind the evaluated IntentState");
  }
  const scopeMismatch = (() => {
    if (draft.requestedCapability !== evaluation.capability) return "capability";
    if (draft.requestedScope.amount !== (evaluation.amount ?? 0)) return "amount";
    if (draft.requestedScope.currency !== (evaluation.currency ?? "")) return "currency";
    if (draft.requestedScope.merchant !== (evaluation.merchant ?? "")) return "merchant";
    return null;
  })();
  if (scopeMismatch) {
    return err(ErrorCode.APPROVAL_SCOPE_MISMATCH, "ApprovalRequest scope must equal the evaluated scope", {
      field: scopeMismatch,
    });
  }
  if (Date.parse(draft.expiresAt) <= Date.parse(draft.requestedAt)) {
    return err(ErrorCode.VALIDATION_FAILED, "ApprovalRequest expiry must follow request time");
  }
  const base: Omit<ApprovalRequest, "contentHash"> = {
    id: asApprovalRequestId(draft.id),
    workflowId: draft.workflowId,
    intentId: asIntentId(draft.intentId),
    intentStateId: asIntentStateId(draft.intentStateId),
    intentStateHash: asHashDigest(draft.intentStateHash),
    authorityEvaluationId: asAuthorityRequestId(draft.authorityEvaluationId),
    actionId: draft.actionId ? asActionId(draft.actionId) : undefined,
    preparedActionHash: draft.preparedActionHash ? asHashDigest(draft.preparedActionHash) : undefined,
    requestedCapability: draft.requestedCapability,
    requestedScope: draft.requestedScope,
    status: ApprovalRequestStatus.PENDING,
    requestedAt: draft.requestedAt,
    expiresAt: draft.expiresAt,
  };
  return ok(withHash(base));
}

export function requestedEvent(
  request: ApprovalRequest,
  input: { readonly eventId: string; readonly at: string },
): Result<ApprovalEvent> {
  const event: ApprovalEvent = {
    id: input.eventId,
    approvalRequestId: request.id,
    workflowId: request.workflowId,
    type: ApprovalEventType.APPROVAL_REQUESTED,
    at: input.at,
    payload: {
      intentId: request.intentId,
      intentStateHash: request.intentStateHash,
      authorityEvaluationId: request.authorityEvaluationId,
      requestedCapability: request.requestedCapability,
      requestedScope: request.requestedScope,
    },
    dedupeKey: `approval_requested:${request.id}`,
  };
  const parsed = parseWithSchema(ApprovalEventSchema, event, "ApprovalEvent");
  if (!parsed.ok) return parsed as Result<ApprovalEvent>;
  return ok(event);
}

/**
 * Lazy expiry: a PENDING request past expiresAt is treated as EXPIRED and
 * must never be approved. Returns the expiry transition when it happens.
 */
export function expireIfPast(
  request: ApprovalRequest,
  input: { readonly eventId: string; readonly at: string },
): Result<{ readonly updated?: ApprovalRequest; readonly event?: ApprovalEvent }> {
  if (request.status !== ApprovalRequestStatus.PENDING) return ok({});
  if (Date.parse(input.at) <= Date.parse(request.expiresAt)) return ok({});
  const updated: ApprovalRequest = withHash({ ...request, status: ApprovalRequestStatus.EXPIRED });
  const event: ApprovalEvent = {
    id: input.eventId,
    approvalRequestId: request.id,
    workflowId: request.workflowId,
    type: ApprovalEventType.APPROVAL_EXPIRED,
    at: input.at,
    payload: { expiresAt: request.expiresAt },
    dedupeKey: `approval_expired:${request.id}`,
  };
  return ok({ updated, event });
}

/**
 * Decide a PENDING approval. decidedBy MUST be the verified caller identity
 * (set by the service layer, never accepted from request JSON).
 */
export function decideApproval(
  request: ApprovalRequest,
  input: {
    readonly decision: ApprovalDecision;
    readonly decidedBy: string;
    readonly reason?: string;
    readonly at: string;
    readonly eventId: string;
    /** Fresh tip revalidation the caller (authority owner) performed. */
    readonly currentIntentStateHash: string;
  },
): Result<{ readonly updated: ApprovalRequest; readonly event: ApprovalEvent }> {
  if (request.status === ApprovalRequestStatus.EXPIRED) {
    return err(ErrorCode.APPROVAL_EXPIRED, "Approval request has expired");
  }
  if (request.status === ApprovalRequestStatus.SUPERSEDED) {
    return err(ErrorCode.APPROVAL_SUPERSEDED, "Approval request was superseded");
  }
  if (request.status !== ApprovalRequestStatus.PENDING) {
    return err(ErrorCode.APPROVAL_NOT_PENDING, "Approval request already decided", {
      status: request.status,
    });
  }
  if (Date.parse(input.at) > Date.parse(request.expiresAt)) {
    return err(ErrorCode.APPROVAL_EXPIRED, "Approval request has expired");
  }
  if (input.currentIntentStateHash !== request.intentStateHash) {
    return err(ErrorCode.APPROVAL_STALE_INTENT_STATE, "IntentState has changed since the approval was requested");
  }
  const updated: ApprovalRequest = withHash({
    ...request,
    status: input.decision === ApprovalDecision.APPROVE ? ApprovalRequestStatus.APPROVED : ApprovalRequestStatus.REJECTED,
    decidedAt: input.at,
    decidedBy: asPrincipalId(input.decidedBy),
    decision: input.decision,
    reason: input.reason,
  });
  const event: ApprovalEvent = {
    id: input.eventId,
    approvalRequestId: request.id,
    workflowId: request.workflowId,
    type: input.decision === ApprovalDecision.APPROVE ? ApprovalEventType.APPROVED : ApprovalEventType.REJECTED,
    at: input.at,
    actor: asPrincipalId(input.decidedBy),
    payload: { decision: input.decision, reason: input.reason ?? null },
    dedupeKey: `approval_decided:${request.id}`,
  };
  return ok({ updated, event });
}

/**
 * Supersession: a NEWER request for the same evaluation/action replaces a
 * PENDING one. The old request becomes SUPERSEDED (terminal).
 */
export function supersedePending(
  request: ApprovalRequest,
  input: { readonly supersededBy: string; readonly eventId: string; readonly at: string },
): Result<{ readonly updated?: ApprovalRequest; readonly event?: ApprovalEvent }> {
  if (request.status !== ApprovalRequestStatus.PENDING) return ok({});
  const updated: ApprovalRequest = withHash({
    ...request,
    status: ApprovalRequestStatus.SUPERSEDED,
    supersededBy: input.supersededBy as ApprovalRequest["supersededBy"],
  });
  const event: ApprovalEvent = {
    id: input.eventId,
    approvalRequestId: request.id,
    workflowId: request.workflowId,
    type: ApprovalEventType.APPROVAL_SUPERSEDED,
    at: input.at,
    payload: { supersededBy: input.supersededBy },
    dedupeKey: `approval_superseded:${request.id}`,
  };
  return ok({ updated, event });
}

/**
 * Approve-time revalidation of the evaluated scope (the owner re-reads the
 * durable evaluation; the request scope must still equal it exactly).
 */
export function assertApprovalScopeMatchesEvaluation(
  request: ApprovalRequest,
  evaluation: EvaluationSnapshotForApproval,
): Result<void> {
  if (evaluation.capability !== request.requestedCapability) {
    return err(ErrorCode.APPROVAL_SCOPE_MISMATCH, "Evaluation capability no longer matches approval", {
      field: "capability",
    });
  }
  if ((evaluation.amount ?? 0) !== request.requestedScope.amount) {
    return err(ErrorCode.APPROVAL_SCOPE_MISMATCH, "Evaluation amount no longer matches approval", {
      field: "amount",
    });
  }
  if ((evaluation.merchant ?? "") !== request.requestedScope.merchant) {
    return err(ErrorCode.APPROVAL_SCOPE_MISMATCH, "Evaluation merchant no longer matches approval", {
      field: "merchant",
    });
  }
  if ((evaluation.currency ?? "") !== request.requestedScope.currency) {
    return err(ErrorCode.APPROVAL_SCOPE_MISMATCH, "Evaluation currency no longer matches approval", {
      field: "currency",
    });
  }
  return ok();
}
