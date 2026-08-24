import { randomUUID } from "node:crypto";
import type { InternalRoute, InternalRouteResponse, VerifiedInternalCaller } from "@truemandate/cloud-runtime";
import {
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import { logStructured } from "@truemandate/observability/structured-log";
import {
  ApprovalDecision,
  ErrorCode,
  WorkflowStage,
  WorkflowStageEventStatus,
  type ApprovalEvent,
  type ApprovalRequest,
  type Result,
} from "@truemandate/protocol";
import {
  createApprovalRequest,
  decideApproval,
  expireIfPast,
  parseApprovalRequest,
  requestedEvent,
  supersedePending,
} from "@truemandate/authority";
import { z } from "zod";
import type { EvaluationStore } from "./evaluation-record.js";
import { parseAuthorityEvaluationRecord } from "./evaluation-record.js";

/**
 * Fail-open, best-effort stage timing emission. A telemetry write must
 * never throw into or delay the approval create/decide path.
 */
async function recordStage(
  recorder: WorkflowStageRecorder | undefined,
  event: Omit<WorkflowStageEvent, "id" | "occurredAt">,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.recordStage({
      id: `${event.workflowId}-${event.stage}-${event.status}-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      ...event,
    });
  } catch {
    // Fail-open: stage timing telemetry must never affect approvals.
  }
}

/**
 * Durable human-approval routes (owner: authority-service).
 *
 * Identity: decidedBy is ALWAYS the verified caller identity from the S2S
 * identity layer (route `caller`), never accepted from request JSON.
 * Scope: a request is created FROM the durable evaluation — the caller can
 * never supply capability/amount/merchant/currency.
 */

export interface ApprovalStorePorts {
  readonly approvals: {
    get(id: string): Promise<ApprovalRequest | undefined>;
    putIfAbsent(id: string, value: ApprovalRequest): Promise<boolean>;
    put(id: string, value: ApprovalRequest): Promise<void>;
  };
  readonly approvalEvents: {
    putIfAbsent(id: string, value: ApprovalEvent): Promise<boolean>;
  };
  readonly evaluations: EvaluationStore;
  readonly tip: {
    getCurrentIntentState(intentId: string): Promise<Result<{ id: string; stateHash: string }>>;
  };
  readonly now?: () => string;
  /** Wave 2: optional fail-open workflow stage recorder for APPROVAL timing. */
  readonly stageRecorder?: WorkflowStageRecorder;
}

const CreateApprovalSchema = z
  .object({
    id: z.string().min(1),
    evaluationId: z.string().min(1),
    intentId: z.string().min(1),
    actionId: z.string().min(1).optional(),
    preparedActionHash: z.string().min(1).optional(),
    requestedAt: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

const DecideApprovalSchema = z
  .object({
    decision: z.enum(["APPROVE", "DENY"]),
    reason: z.string().max(2048).optional(),
  })
  .strict();

function fromResult<T>(result: Result<T>): InternalRouteResponse {
  if (result.ok) return { status: 200, body: result.value };
  const retryable = result.details?.retryable === true;
  return {
    status: retryable ? 503 : 400,
    body: { error: result.code, message: result.message, details: result.details },
  };
}

function requireVerifiedCaller(caller: VerifiedInternalCaller | undefined): Result<VerifiedInternalCaller> {
  if (!caller?.email) {
    return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Verified caller identity required" };
  }
  return { ok: true, value: caller };
}

export function createApprovalRoutes(ports: ApprovalStorePorts): readonly InternalRoute[] {
  const now = () => ports.now?.() ?? new Date().toISOString();

  return [
    {
      method: "POST",
      pattern: "/internal/approvals",
      handler: async ({ body }): Promise<InternalRouteResponse> => {
        const parsed = CreateApprovalSchema.safeParse(body);
        if (!parsed.success) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: parsed.error.message } };
        }
        const input = parsed.data;

        const evaluationResult = await ports.evaluations.get(input.evaluationId);
        if (!evaluationResult.ok) return fromResult(evaluationResult);
        const evaluation = evaluationResult.value;
        if (!evaluation) {
          return { status: 400, body: { error: "VALIDATION_FAILED", message: "Unknown evaluation", details: { evaluationId: input.evaluationId } } };
        }
        const parsedEvaluation = parseAuthorityEvaluationRecord(evaluation);
        if (!parsedEvaluation.ok) return fromResult(parsedEvaluation);
        const ev = parsedEvaluation.value;

        const approvalStarted = Date.now();
        await recordStage(ports.stageRecorder, {
          workflowId: ev.workflowId,
          intentId: input.intentId as ApprovalRequest["intentId"],
          stage: WorkflowStage.APPROVAL,
          status: WorkflowStageEventStatus.STARTED,
        });

        const request = createApprovalRequest({
          draft: {
            id: input.id,
            workflowId: ev.workflowId,
            intentId: input.intentId,
            intentStateId: ev.evaluatedIntentState.id,
            intentStateHash: ev.evaluatedIntentState.hash,
            authorityEvaluationId: ev.id,
            actionId: input.actionId ?? ev.action.id,
            preparedActionHash: input.preparedActionHash,
            requestedCapability: ev.capability,
            requestedScope: {
              amount: ev.amount ?? 0,
              currency: ev.currency ?? "",
              merchant: ev.merchant ?? "",
            },
            requestedAt: input.requestedAt,
            expiresAt: input.expiresAt,
          },
          evaluation: {
            decision: ev.decision,
            capability: ev.capability,
            merchant: ev.merchant,
            amount: ev.amount,
            currency: ev.currency,
            evaluatedIntentState: ev.evaluatedIntentState,
          },
        });
        if (!request.ok) {
          await recordStage(ports.stageRecorder, {
            workflowId: ev.workflowId,
            intentId: input.intentId as ApprovalRequest["intentId"],
            stage: WorkflowStage.APPROVAL,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - approvalStarted,
          });
          return fromResult(request);
        }

        const at = now();
        const eventResult = requestedEvent(request.value, {
          eventId: `approval-event-${request.value.id}-requested`,
          at,
        });
        if (!eventResult.ok) {
          await recordStage(ports.stageRecorder, {
            workflowId: request.value.workflowId,
            intentId: request.value.intentId,
            stage: WorkflowStage.APPROVAL,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - approvalStarted,
          });
          return fromResult(eventResult);
        }

        // Supersede any earlier PENDING request for the same evaluation
        // (same id space: a re-request for the same evaluation reuses the
        // deterministic id, so the earlier doc IS the prior request).
        const prior = await ports.approvals.get(request.value.id);
        if (prior) {
          const existingParsed = parseApprovalRequest(prior);
          if (existingParsed.ok) {
            const superseded = supersedePending(existingParsed.value, {
              supersededBy: request.value.id,
              eventId: `approval-event-${existingParsed.value.id}-superseded`,
              at,
            });
            if (superseded.ok && superseded.value.updated && superseded.value.event) {
              await ports.approvals.put(superseded.value.updated.id, superseded.value.updated);
              await ports.approvalEvents.putIfAbsent(superseded.value.event.id, superseded.value.event);
              await recordStage(ports.stageRecorder, {
                workflowId: existingParsed.value.workflowId,
                intentId: existingParsed.value.intentId,
                stage: WorkflowStage.APPROVAL,
                status: WorkflowStageEventStatus.FAILED,
                durationMs: Date.now() - approvalStarted,
              });
            }
          }
        }

        const inserted = await ports.approvals.putIfAbsent(request.value.id, request.value);
        if (!inserted) {
          await recordStage(ports.stageRecorder, {
            workflowId: request.value.workflowId,
            intentId: request.value.intentId,
            stage: WorkflowStage.APPROVAL,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - approvalStarted,
          });
          return { status: 400, body: { error: "APPROVAL_ALREADY_DECIDED", message: "ApprovalRequest id already exists" } };
        }
        await ports.approvalEvents.putIfAbsent(eventResult.value.id, eventResult.value);
        // STARTED already emitted above; create leaves the request PENDING
        // (awaiting decide). Duration here is create-path latency only.
        return { status: 200, body: request.value };
      },
    },
    {
      method: "POST",
      pattern: "/internal/approvals/:id/decide",
      handler: async ({ params, body, caller }): Promise<InternalRouteResponse> => {
        const approvalId = params.id;
        if (!approvalId) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing approval id" } };
        }
        const identity = requireVerifiedCaller(caller);
        if (!identity.ok) return fromResult(identity);

        const parsed = DecideApprovalSchema.safeParse(body);
        if (!parsed.success) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: parsed.error.message } };
        }

        const loaded = await ports.approvals.get(approvalId);
        if (!loaded) {
          return { status: 400, body: { error: "VALIDATION_FAILED", message: "Unknown approval request", details: { id: params.id } } };
        }
        const request = parseApprovalRequest(loaded);
        if (!request.ok) return fromResult(request);

        const decideStarted = Date.now();
        const at = now();

        // Lazy expiry first (persist + event when it fires).
        const expiry = expireIfPast(request.value, {
          eventId: `approval-event-${approvalId}-expired`,
          at,
        });
        if (!expiry.ok) return fromResult(expiry);
        if (expiry.value.updated) {
          await ports.approvals.put(expiry.value.updated.id, expiry.value.updated);
          if (expiry.value.event) {
            await ports.approvalEvents.putIfAbsent(expiry.value.event.id, expiry.value.event);
          }
          await recordStage(ports.stageRecorder, {
            workflowId: request.value.workflowId,
            intentId: request.value.intentId,
            stage: WorkflowStage.APPROVAL,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - decideStarted,
          });
          // Fail closed: the durable row is now EXPIRED; the decision is refused.
          return { status: 400, body: { error: ErrorCode.APPROVAL_EXPIRED, message: "Approval request has expired", details: {} } };
        }

        // Fresh IntentState revalidation (owner-read tip, never caller data).
        const tip = await ports.tip.getCurrentIntentState(request.value.intentId);
        if (!tip.ok) return fromResult(tip);

        const decided = decideApproval(request.value, {
          decision: parsed.data.decision as ApprovalDecision,
          decidedBy: identity.value.email,
          reason: parsed.data.reason,
          at,
          eventId: `approval-event-${approvalId}-decided`,
          currentIntentStateHash: tip.value.stateHash,
        });
        if (!decided.ok) {
          await recordStage(ports.stageRecorder, {
            workflowId: request.value.workflowId,
            intentId: request.value.intentId,
            stage: WorkflowStage.APPROVAL,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - decideStarted,
          });
          return fromResult(decided);
        }

        await ports.approvals.put(decided.value.updated.id, decided.value.updated);
        await ports.approvalEvents.putIfAbsent(decided.value.event.id, decided.value.event);
        const approved = parsed.data.decision === "APPROVE";
        await recordStage(ports.stageRecorder, {
          workflowId: request.value.workflowId,
          intentId: request.value.intentId,
          stage: WorkflowStage.APPROVAL,
          status: approved
            ? WorkflowStageEventStatus.COMPLETED
            : WorkflowStageEventStatus.FAILED,
          durationMs: Date.now() - decideStarted,
        });
        logStructured("info", {
          event: "tm.approval.decision",
          service: "authority-service",
          decision: parsed.data.decision,
          approvalId,
          workflowId: request.value.workflowId,
          intentId: request.value.intentId,
        });
        return { status: 200, body: decided.value.updated };
      },
    },
    {
      method: "GET",
      pattern: "/internal/approvals/:id",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const approvalId = params.id;
        if (!approvalId) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing approval id" } };
        }
        const loaded = await ports.approvals.get(approvalId);
        if (!loaded) {
          return { status: 400, body: { error: "VALIDATION_FAILED", message: "Unknown approval request", details: { id: params.id } } };
        }
        const parsed = parseApprovalRequest(loaded);
        if (!parsed.ok) return fromResult(parsed);
        return { status: 200, body: parsed.value };
      },
    },
  ];
}
