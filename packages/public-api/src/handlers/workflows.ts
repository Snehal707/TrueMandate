import {
  GenericWorkflowRequestSchema,
  WorkflowApprovalResumeRequestSchema,
} from "@truemandate/schemas";
import { ErrorCode, err } from "@truemandate/protocol";
import { sendResult, type RouteHandler } from "../http.js";
import type {
  WorkflowCommitPort,
  WorkflowReadPort,
  WorkflowResumePort,
  WorkflowSubmitPort,
} from "../ports.js";

function sanitizeWorkflowResult(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const response: Record<string, unknown> = {};
  for (const key of [
    "workflowId",
    "state",
    "artifacts",
    "evaluation",
    "approval",
    "monitoringContract",
    "outcomeContract",
  ] as const) {
    if (key in value) response[key] = value[key];
  }
  if (
    value.execution &&
    typeof value.execution === "object" &&
    !Array.isArray(value.execution)
  ) {
    const execution = value.execution as Record<string, unknown>;
    response.execution = {
      ...(typeof execution.status === "string"
        ? { status: execution.status }
        : {}),
      ...(typeof execution.executionId === "string"
        ? { executionId: execution.executionId }
        : {}),
      ...(typeof execution.resultRef === "string"
        ? { resultRef: execution.resultRef }
        : {}),
    };
  }
  return response;
}

function sanitizeCommitResult(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const response: Record<string, unknown> = {};
  for (const key of ["status", "executionId", "resultRef"] as const) {
    if (key in value) response[key] = value[key];
  }
  return response;
}

export function createWorkflowSubmitHandler(
  port: WorkflowSubmitPort,
): RouteHandler {
  return async ({ res, body }) => {
    const parsed = GenericWorkflowRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid workflow request", {
          issues: parsed.error.issues,
        }),
      );
      return;
    }
    const result = await Promise.resolve(port.submitWorkflow(parsed.data));
    sendResult(
      res,
      result.ok ? { ...result, value: sanitizeWorkflowResult(result.value) } : result,
    );
  };
}

export function createWorkflowReadHandler(
  port: WorkflowReadPort,
): RouteHandler {
  return async ({ res, params }) => {
    if (!params.workflowId) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Workflow id is required"),
      );
      return;
    }
    const result = await Promise.resolve(port.getWorkflow(params.workflowId));
    sendResult(
      res,
      result.ok ? { ...result, value: sanitizeWorkflowResult(result.value) } : result,
    );
  };
}

export function createWorkflowResumeHandler(
  port: WorkflowResumePort,
): RouteHandler {
  return async ({ res, body, params }) => {
    const payload =
      body && typeof body === "object" && !Array.isArray(body)
        ? { ...(body as Record<string, unknown>), workflowId: params.workflowId ?? "" }
        : { workflowId: params.workflowId ?? "" };
    const parsed = WorkflowApprovalResumeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      sendResult(
        res,
        err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "Invalid workflow approval resumption request",
          { issues: parsed.error.issues },
        ),
      );
      return;
    }
    const result = await Promise.resolve(
      port.resumeWorkflow(parsed.data.workflowId, {
        approvalId: parsed.data.approvalId,
      }),
    );
    sendResult(
      res,
      result.ok ? { ...result, value: sanitizeWorkflowResult(result.value) } : result,
    );
  };
}

export function createWorkflowCommitHandler(
  port: WorkflowCommitPort,
): RouteHandler {
  return async ({ res, params }) => {
    if (!params.workflowId) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Workflow id is required"),
      );
      return;
    }
    const result = await Promise.resolve(port.commitWorkflow(params.workflowId));
    sendResult(
      res,
      result.ok ? { ...result, value: sanitizeCommitResult(result.value) } : result,
    );
  };
}
