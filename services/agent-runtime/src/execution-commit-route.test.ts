import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createAgentRuntimeInternalRoutes } from "./internal-routes.js";
import { request, runtime } from "./generic-workflow.e2e.test.js";

const PHASE_B_CALLER = "tm-dev-phase-b-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const PHASE_A_CALLER = "tm-dev-phase-a-verifier@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const PUBLIC_BFF_CALLER = "tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com";
const UNAUTHORIZED_CALLER = "tm-dev-unknown@elite-crossbar-505104-t9.iam.gserviceaccount.com";

describe("Agent Runtime execution boundary", () => {
  it("isolates public workflow-id commit from the verifier-only raw token route", () => {
    const r = createAgentRuntimeInternalRoutes({} as never, {
      workflowCallerEmails: [PHASE_A_CALLER, PHASE_B_CALLER],
      workflowCommitCallerEmails: [PUBLIC_BFF_CALLER],
      executionCallerEmails: [PHASE_B_CALLER],
    });
    const workflow = r.find((x) => x.pattern === "/internal/workflows/procurement");
    const workflowCommit = r.find((x) => x.pattern === "/internal/workflows/:workflowId/commit");
    const execution = r.find((x) => x.pattern === "/internal/execution/commit");
    expect(workflow?.allowedCallers).toEqual([PHASE_A_CALLER, PHASE_B_CALLER]);
    expect(workflowCommit?.allowedCallers).toEqual([PUBLIC_BFF_CALLER]);
    expect(workflowCommit?.allowedCallers).not.toContain(UNAUTHORIZED_CALLER);
    expect(execution?.allowedCallers).toEqual([PHASE_B_CALLER]);
    expect(execution?.allowedCallers).not.toContain(PUBLIC_BFF_CALLER);
    expect(execution?.allowedCallers).not.toContain(PHASE_A_CALLER);
  });

  it("passes only the path workflow id to governed commit", async () => {
    const received: string[] = [];
    const routes = createAgentRuntimeInternalRoutes({
      commitWorkflow: async (workflowId) => {
        received.push(workflowId);
        return { ok: true as const, value: { status: "SUCCESS" } };
      },
    } as never, { workflowCommitCallerEmails: [PUBLIC_BFF_CALLER] });
    const workflowCommit = routes.find((x) => x.pattern === "/internal/workflows/:workflowId/commit")!;

    const result = await workflowCommit.handler({
      body: { commitTokenId: "caller-supplied-token", grant: {}, preparedAction: {} },
      headers: {},
      params: { workflowId: "wf-safe" },
    });

    expect(result.status).toBe(200);
    expect(received).toEqual(["wf-safe"]);
  });

  it("rejects extra execution fields strictly", async () => {
    const r = await runtime();
    const routes = createAgentRuntimeInternalRoutes(r.coordinator, { workflowCallerEmails: [PHASE_A_CALLER, PHASE_B_CALLER], executionCallerEmails: [PHASE_B_CALLER] });
    const execution = routes.find((x) => x.pattern === "/internal/execution/commit")!;
    const res = await execution.handler({ body: { commitTokenId: "ct-1", amount: 1, adapterMode: "success" }, headers: {}, params: {} });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe(ErrorCode.SCHEMA_PARSE_FAILED);
  });

  it("executes a fresh Phase A chain token exactly once through the boundary", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const tokenId = (result.value as { authorization: { commitToken: { id: string } } }).authorization.commitToken.id;
    const routes = createAgentRuntimeInternalRoutes(r.coordinator, { workflowCallerEmails: [PHASE_A_CALLER, PHASE_B_CALLER], executionCallerEmails: [PHASE_B_CALLER] });
    const execution = routes.find((x) => x.pattern === "/internal/execution/commit")!;
    const res = await execution.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
    expect(res.status).toBe(200);
    const body = res.body as { status: string; executionId?: string; resultRef?: string };
    expect(body.status).toBe("SUCCESS");
    expect(body.executionId).toBeDefined();
    expect(body.resultRef).toBeDefined();
    const token = await r.gateway.getCommitTokenStore().get(tokenId);
    expect(token.ok && token.value?.consumed).toBe(true);
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
    // Replay through the boundary: idempotent, no second effect.
    const replay = await execution.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
    expect((replay.body as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });
});
