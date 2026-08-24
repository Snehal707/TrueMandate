/**
 * Wave 4.3 — durable MonitoringContract routes (owner: authority-service).
 *
 * Monitoring cannot mint grants, issue CommitTokens, or call Gateway.
 * Escalation only narrows/freezes future privileged materialization.
 */
import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import {
  createMonitoringContract,
  markVerifiedOutcomeFailure,
  parseMonitoringContract,
  recordRiskSignal,
  type MonitoringContractStore,
} from "@truemandate/authority";
import {
  AuthorityDecision,
  ErrorCode,
  MonitoringSignalSeverity,
  type MonitoringContract,
  type Result,
} from "@truemandate/protocol";
import { MonitoringRiskSignalSchema, parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";
import type { EvaluationStore } from "./evaluation-record.js";
import { parseAuthorityEvaluationRecord } from "./evaluation-record.js";

export interface MonitoringRoutePorts {
  readonly monitoring: MonitoringContractStore;
  readonly evaluations: EvaluationStore;
  readonly now?: () => string;
}

const CreateMonitoringSchema = z
  .object({
    id: z.string().min(1).optional(),
    evaluationId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    workflowId: z.string().min(1),
    grantId: z.string().min(1).optional(),
    outcomeContractId: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();

const SignalBodySchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
    source: z.string().min(1),
    reason: z.string().min(1),
    observedAt: z.string().min(1).optional(),
  })
  .strict();

const OutcomeFailureSchema = z
  .object({
    resolutionCaseHint: z.string().min(1).optional(),
    observedAt: z.string().min(1).optional(),
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

export function createMonitoringRoutes(ports: MonitoringRoutePorts): readonly InternalRoute[] {
  const now = () => ports.now?.() ?? new Date().toISOString();

  return [
    {
      method: "POST",
      pattern: "/internal/monitoring",
      handler: async ({ body }): Promise<InternalRouteResponse> => {
        const parsed = CreateMonitoringSchema.safeParse(body);
        if (!parsed.success) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: parsed.error.message } };
        }
        const input = parsed.data;
        const evaluationResult = await ports.evaluations.get(input.evaluationId);
        if (!evaluationResult.ok) return fromResult(evaluationResult);
        if (!evaluationResult.value) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Unknown evaluation",
              details: { evaluationId: input.evaluationId },
            },
          };
        }
        const ev = parseAuthorityEvaluationRecord(evaluationResult.value);
        if (!ev.ok) return fromResult(ev);
        if (ev.value.decision !== AuthorityDecision.ALLOW_WITH_MONITORING) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "MonitoringContract requires ALLOW_WITH_MONITORING evaluation",
              details: { decision: ev.value.decision },
            },
          };
        }
        if (ev.value.workflowId !== input.workflowId) {
          return {
            status: 400,
            body: {
              error: ErrorCode.VALIDATION_FAILED,
              message: "Evaluation workflowId mismatch",
            },
          };
        }

        const id = input.id ?? `monitoring-${input.workflowId}`;
        const created = createMonitoringContract({
          id,
          workflowId: input.workflowId,
          intentId: input.intentId,
          intentStateId: input.intentStateId,
          evaluationId: ev.value.id,
          evaluationHash: ev.value.recordHash,
          capability: ev.value.capability,
          merchant: ev.value.merchant,
          amount: ev.value.amount,
          currency: ev.value.currency,
          grantId: input.grantId,
          outcomeContractId: input.outcomeContractId,
          createdAt: input.createdAt ?? now(),
        });
        if (!created.ok) return fromResult(created);

        const inserted = await ports.monitoring.putIfAbsent(id, created.value);
        if (!inserted.ok) return fromResult(inserted);
        if (!inserted.value) {
          const existing = await ports.monitoring.get(id);
          if (!existing.ok) return fromResult(existing);
          if (!existing.value) {
            return {
              status: 400,
              body: {
                error: ErrorCode.VALIDATION_FAILED,
                message: "MonitoringContract persistence race",
              },
            };
          }
          return { status: 200, body: existing.value };
        }
        return { status: 200, body: created.value };
      },
    },
    {
      method: "POST",
      pattern: "/internal/monitoring/:id/signals",
      handler: async ({ params, body }): Promise<InternalRouteResponse> => {
        const id = params.id;
        if (!id) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing monitoring id" } };
        }
        const parsed = SignalBodySchema.safeParse(body);
        if (!parsed.success) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: parsed.error.message } };
        }
        const loaded = await ports.monitoring.get(id);
        if (!loaded.ok) return fromResult(loaded);
        if (!loaded.value) {
          return {
            status: 400,
            body: { error: ErrorCode.VALIDATION_FAILED, message: "Unknown MonitoringContract" },
          };
        }
        const signalParsed = parseWithSchema(
          MonitoringRiskSignalSchema,
          {
            id: parsed.data.id,
            severity: parsed.data.severity,
            source: parsed.data.source,
            reason: parsed.data.reason,
            observedAt: parsed.data.observedAt ?? now(),
          },
          "MonitoringRiskSignal",
        );
        if (!signalParsed.ok) return fromResult(signalParsed);
        const recorded = recordRiskSignal(
          loaded.value,
          signalParsed.value as MonitoringContract["signals"][number],
          parsed.data.observedAt ?? now(),
        );
        if (!recorded.ok) return fromResult(recorded);
        const saved = await ports.monitoring.put(id, recorded.value.updated);
        if (!saved.ok) return fromResult(saved);
        return { status: 200, body: recorded.value.updated };
      },
    },
    {
      method: "POST",
      pattern: "/internal/monitoring/:id/outcome-failure",
      handler: async ({ params, body }): Promise<InternalRouteResponse> => {
        const id = params.id;
        if (!id) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing monitoring id" } };
        }
        const parsed = OutcomeFailureSchema.safeParse(body ?? {});
        if (!parsed.success) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: parsed.error.message } };
        }
        const loaded = await ports.monitoring.get(id);
        if (!loaded.ok) return fromResult(loaded);
        if (!loaded.value) {
          return {
            status: 400,
            body: { error: ErrorCode.VALIDATION_FAILED, message: "Unknown MonitoringContract" },
          };
        }
        const marked = markVerifiedOutcomeFailure(
          loaded.value,
          parsed.data.observedAt ?? now(),
          parsed.data.resolutionCaseHint,
        );
        if (!marked.ok) return fromResult(marked);
        const saved = await ports.monitoring.put(id, marked.value);
        if (!saved.ok) return fromResult(saved);
        return { status: 200, body: marked.value };
      },
    },
    {
      method: "GET",
      pattern: "/internal/monitoring/:id",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const id = params.id;
        if (!id) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing monitoring id" } };
        }
        const loaded = await ports.monitoring.get(id);
        if (!loaded.ok) return fromResult(loaded);
        if (!loaded.value) {
          return {
            status: 400,
            body: { error: ErrorCode.VALIDATION_FAILED, message: "Unknown MonitoringContract" },
          };
        }
        const parsed = parseMonitoringContract(loaded.value);
        return fromResult(parsed);
      },
    },
    {
      method: "GET",
      pattern: "/internal/monitoring/by-workflow/:workflowId",
      handler: async ({ params }): Promise<InternalRouteResponse> => {
        const workflowId = params.workflowId;
        if (!workflowId) {
          return { status: 400, body: { error: "MALFORMED_JSON", message: "missing workflowId" } };
        }
        const loaded = await ports.monitoring.getByWorkflowId(workflowId);
        if (!loaded.ok) return fromResult(loaded);
        if (!loaded.value) {
          return {
            status: 400,
            body: { error: ErrorCode.VALIDATION_FAILED, message: "Unknown MonitoringContract" },
          };
        }
        return { status: 200, body: loaded.value };
      },
    },
  ];
}

/**
 * Fail-open outcome-event → MonitoringContract escalation.
 * Never throws into or delays the outcome/resolution path.
 */
export async function applyOutcomeEventToMonitoring(
  store: MonitoringContractStore,
  envelope: {
    readonly type?: string;
    readonly payload?: Record<string, unknown>;
  },
  at = new Date().toISOString(),
): Promise<void> {
  try {
    const payload = envelope.payload ?? {};
    const monitoringId =
      typeof payload.monitoringContractId === "string"
        ? payload.monitoringContractId
        : undefined;
    if (!monitoringId) return;

    const type = String(envelope.type ?? payload.state ?? "");
    const loaded = await store.get(monitoringId);
    if (!loaded.ok || !loaded.value) return;

    if (type.includes("BREACHED") || payload.state === "BREACHED") {
      const marked = markVerifiedOutcomeFailure(loaded.value, at);
      if (marked.ok) await store.put(monitoringId, marked.value);
      return;
    }

    let severity: (typeof MonitoringSignalSeverity)[keyof typeof MonitoringSignalSeverity] | undefined;
    if (
      type.includes("AT_RISK") ||
      type.includes("PARTIAL") ||
      type.includes("CONFLICT") ||
      payload.state === "AT_RISK" ||
      payload.state === "PARTIAL" ||
      payload.state === "CONFLICTED"
    ) {
      severity = MonitoringSignalSeverity.MEDIUM;
    }
    if (!severity) return;

    const recorded = recordRiskSignal(
      loaded.value,
      {
        id: `outcome-signal-${monitoringId}-${at}`,
        severity,
        source: "outcome-event",
        reason: type || String(payload.state ?? "risk"),
        observedAt: at,
      },
      at,
    );
    if (recorded.ok) await store.put(monitoringId, recorded.value.updated);
  } catch {
    // Fail-open: monitoring escalation must never affect outcome correctness.
  }
}
