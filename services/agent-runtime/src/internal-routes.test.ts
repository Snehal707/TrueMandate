import { describe, expect, it } from "vitest";
import { createAgentRuntimeInternalRoutes } from "./internal-routes.js";

describe("agent-runtime internal workflow routes", () => {
  it("forwards only parsed workflow input to the evaluation-only coordinator", async () => {
    let received: unknown;
    const route = createAgentRuntimeInternalRoutes({ run: async (raw: unknown) => {
      received = raw;
      return { ok: true as const, value: { state: "AUTHORITY_EVALUATION" } };
    } } as never).find((candidate) => candidate.pattern === "/internal/workflows/procurement")!;
    const response = await route.handler({ params: {}, headers: {}, body: { intentId: "i", idempotencyKey: "k" } });
    expect(response.status).toBe(200);
    expect(received).toEqual({ intentId: "i", idempotencyKey: "k" });
  });

  it("uses the canonical generic submit hook when present", async () => {
    let received: unknown;
    const route = createAgentRuntimeInternalRoutes({
      run: async () => ({ ok: true as const, value: { state: "legacy" } }),
      submitWorkflow: async (raw: unknown) => {
        received = raw;
        return { ok: true as const, value: { workflowId: "wf-1", state: "AUTHORIZED" } };
      },
    } as never).find((candidate) => candidate.pattern === "/internal/workflows")!;
    const response = await route.handler({ params: {}, headers: {}, body: { workflowId: "wf-1" } });
    expect(response.status).toBe(200);
    expect(received).toEqual({ workflowId: "wf-1" });
  });

  it("threads workflowId from the canonical resume path into the payload", async () => {
    let received: unknown;
    const route = createAgentRuntimeInternalRoutes({
      run: async () => ({ ok: true as const, value: {} }),
      resumeWithApproval: async () => ({ ok: true as const, value: {} }),
      resumeWorkflow: async (raw: unknown) => {
        received = raw;
        return { ok: true as const, value: { workflowId: "wf-1", state: "AUTHORIZED" } };
      },
      commitAuthorizedExecution: async () => ({ ok: true as const, value: {} }),
    } as never).find((candidate) => candidate.pattern === "/internal/workflows/:workflowId/resume-approval")!;
    const response = await route.handler({
      params: { workflowId: "wf-1" },
      headers: {},
      body: { approvalId: "approval-1" },
    });
    expect(response.status).toBe(200);
    expect(received).toEqual({ workflowId: "wf-1", approvalId: "approval-1" });
  });

  it("uses workflowId-based workflow reads when the canonical hook is present", async () => {
    let received: unknown;
    const route = createAgentRuntimeInternalRoutes({
      run: async () => ({ ok: true as const, value: {} }),
      readWorkflow: async (workflowId: string) => {
        received = workflowId;
        return { ok: true as const, value: { workflowId, state: "AUTHORIZED" } };
      },
      resumeWithApproval: async () => ({ ok: true as const, value: {} }),
      commitAuthorizedExecution: async () => ({ ok: true as const, value: {} }),
    } as never).find((candidate) => candidate.pattern === "/internal/workflows/:workflowId" && candidate.method === "GET")!;
    const response = await route.handler({
      params: { workflowId: "wf-1" },
      headers: {},
      body: undefined,
    });
    expect(response.status).toBe(200);
    expect(received).toBe("wf-1");
  });

  it("uses workflowId-based commit when the canonical hook is present", async () => {
    let received: unknown;
    const route = createAgentRuntimeInternalRoutes({
      run: async () => ({ ok: true as const, value: {} }),
      resumeWithApproval: async () => ({ ok: true as const, value: {} }),
      commitAuthorizedExecution: async () => ({ ok: true as const, value: {} }),
      commitWorkflow: async (workflowId: string) => {
        received = workflowId;
        return { ok: true as const, value: { status: "SUCCESS" } };
      },
    } as never).find((candidate) => candidate.pattern === "/internal/workflows/:workflowId/commit")!;
    const response = await route.handler({
      params: { workflowId: "wf-1" },
      headers: {},
      body: undefined,
    });
    expect(response.status).toBe(200);
    expect(received).toBe("wf-1");
  });

  it("returns coordinator fail-closed results without any execution surface", async () => {
    const route = createAgentRuntimeInternalRoutes({ run: async () => ({ ok: false as const, code: "VALIDATION_FAILED" as never, message: "blocked", details: {} }) } as never).find((candidate) => candidate.pattern === "/internal/workflows/procurement")!;
    const response = await route.handler({ params: {}, headers: {}, body: {} });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "VALIDATION_FAILED" });
  });

  it("does not turn unrelated retryable failures into readiness responses", async () => {
    const route = createAgentRuntimeInternalRoutes({ run: async () => ({
      ok: false as const,
      code: "MODEL_UNAVAILABLE" as never,
      message: "model unavailable",
      details: { retryable: true },
    }) } as never).find((candidate) => candidate.pattern === "/internal/workflows/procurement")!;
    const response = await route.handler({ params: {}, headers: {}, body: {} });
    expect(response.status).toBe(400);
  });

  it("returns 503 only for the typed retryable IntentState readiness result", async () => {
    const route = createAgentRuntimeInternalRoutes({ run: async () => ({
      ok: false as const,
      code: "INTENT_STATE_NOT_READY" as never,
      message: "tip not finalized",
      details: { status: 404, retryable: true },
    }) } as never).find((candidate) => candidate.pattern === "/internal/workflows/procurement")!;
    const response = await route.handler({ params: {}, headers: {}, body: {} });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: "INTENT_STATE_NOT_READY" });
  });
});
