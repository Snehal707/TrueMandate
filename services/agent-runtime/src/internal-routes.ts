import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import { ErrorCode, type Result } from "@truemandate/protocol";
import { z } from "zod";

/** Minimal coordinator surface used by internal routes (domain-agnostic). */
export interface WorkflowCoordinatorPort {
  run(raw: unknown): Promise<Result<unknown>>;
  submitWorkflow?(raw: unknown): Promise<Result<unknown>>;
  readWorkflow?(workflowId: string): Promise<Result<unknown>>;
  resumeWithApproval(raw: unknown): Promise<Result<unknown>>;
  resumeWorkflow?(raw: unknown): Promise<Result<unknown>>;
  commitAuthorizedExecution(raw: unknown): Promise<Result<unknown>>;
  commitWorkflow?(workflowId: string): Promise<Result<unknown>>;
  evaluatePreExecutionReadiness?(raw: unknown): Promise<Result<unknown>>;
}

function response(result: Result<unknown>): InternalRouteResponse {
  return result.ok
    ? { status: 200, body: result.value }
    : { status: result.code === ErrorCode.INTENT_STATE_NOT_READY && result.details?.retryable === true ? 503 : 400, body: { error: result.code, message: result.message, details: result.details } };
}

export const AgentRuntimeExecutionCommitRequestSchema = z.object({ commitTokenId: z.string().min(1) }).strict();

export function createAgentRuntimeInternalRoutes(
  coordinator: WorkflowCoordinatorPort,
  auth?: {
    readonly workflowCallerEmails?: readonly string[];
    readonly workflowCommitCallerEmails?: readonly string[];
    readonly executionCallerEmails?: readonly string[];
    readonly preExecutionReadinessCallerEmails?: readonly string[];
  },
): readonly InternalRoute[] {
  return [
    {
      method: "POST", pattern: "/internal/workflows",
      allowedCallers: auth?.workflowCallerEmails?.length ? auth.workflowCallerEmails : undefined,
      handler: async ({ body }) => response(await (coordinator.submitWorkflow?.(body) ?? coordinator.run(body))),
    },
    {
      method: "GET", pattern: "/internal/workflows/:workflowId",
      allowedCallers: auth?.workflowCallerEmails?.length ? auth.workflowCallerEmails : undefined,
      handler: async ({ params }) => {
        const workflowId = params.workflowId ?? "";
        const result = coordinator.readWorkflow
          ? await coordinator.readWorkflow(workflowId)
          : {
              ok: false as const,
              code: ErrorCode.VALIDATION_FAILED,
              message: "Workflow read path is not wired",
              details: { workflowId },
            };
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
    {
      method: "POST", pattern: "/internal/workflows/:workflowId/resume-approval",
      allowedCallers: auth?.workflowCallerEmails?.length ? auth.workflowCallerEmails : undefined,
      handler: async ({ body, params }) => {
        const payload = typeof body === "object" && body !== null
          ? { ...(body as Record<string, unknown>), workflowId: params.workflowId ?? "" }
          : { workflowId: params.workflowId ?? "" };
        const result = await (coordinator.resumeWorkflow?.(payload) ?? coordinator.resumeWithApproval(payload));
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
    {
      method: "POST", pattern: "/internal/workflows/:workflowId/commit",
      allowedCallers: auth?.workflowCommitCallerEmails?.length ? auth.workflowCommitCallerEmails : undefined,
      handler: async ({ params }) => {
        const result = coordinator.commitWorkflow
          ? await coordinator.commitWorkflow(params.workflowId ?? "")
          : await coordinator.commitAuthorizedExecution({ workflowId: params.workflowId ?? "" });
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
    {
      method: "POST", pattern: "/internal/pre-execution-readiness",
      allowedCallers: auth?.preExecutionReadinessCallerEmails?.length ? auth.preExecutionReadinessCallerEmails : undefined,
      handler: async ({ body }) => {
        const result = coordinator.evaluatePreExecutionReadiness
          ? await coordinator.evaluatePreExecutionReadiness(body)
          : {
              ok: false as const,
              code: ErrorCode.VALIDATION_FAILED,
              message: "Pre-execution readiness path is not wired",
            };
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
    {
      method: "POST", pattern: "/internal/workflows/procurement",
      allowedCallers: auth?.workflowCallerEmails?.length ? auth.workflowCallerEmails : undefined,
      handler: async ({ body }) => response(await coordinator.run(body)),
    },
    {
      method: "POST", pattern: "/internal/workflows/procurement/resume-approval",
      allowedCallers: auth?.workflowCallerEmails?.length ? auth.workflowCallerEmails : undefined,
      handler: async ({ body }) => {
        const result = await coordinator.resumeWithApproval(body);
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
    {
      method: "POST", pattern: "/internal/execution/commit",
      allowedCallers: auth?.executionCallerEmails?.length ? auth.executionCallerEmails : undefined,
      handler: async ({ body }) => {
        const parsed = AgentRuntimeExecutionCommitRequestSchema.safeParse(body);
        if (!parsed.success) {
          return { status: 400, body: { error: ErrorCode.SCHEMA_PARSE_FAILED, message: "Invalid execution commit request" } };
        }
        // Reference-only: the Phase B verifier supplies only the CommitToken
        // identifier. Agent Runtime delegates to Gateway COMMIT — Gateway
        // remains the sole economic executor.
        const result = await coordinator.commitAuthorizedExecution({ commitTokenId: parsed.data.commitTokenId });
        return result.ok
          ? { status: 200, body: result.value }
          : { status: 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
  ];
}
