import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ok } from "@truemandate/protocol";
import { createWorkspaceHandler } from "./workspace.js";
import type { WorkspaceReadPort } from "../ports.js";

function fakeCtx(url: string | undefined) {
  const req = { url } as IncomingMessage;
  const chunks: Buffer[] = [];
  const res = new PassThrough() as unknown as ServerResponse;
  (res as unknown as { statusCode: number }).statusCode = 200;
  (res as unknown as { setHeader: () => void }).setHeader = () => undefined;
  (res as unknown as { end: (chunk: unknown) => void }).end = (chunk: unknown) => {
    if (chunk) chunks.push(Buffer.from(String(chunk)));
  };
  return { req, res, chunks, params: { intentId: "intent-1" }, body: undefined };
}

describe("workspace route: additive optional workflowId query parameter", () => {
  it("passes the query-string workflowId through to the port", async () => {
    let received: { intentId?: string; workflowId?: string } = {};
    const port: WorkspaceReadPort = {
      getWorkspace: (intentId, workflowId) => {
        received = { intentId, workflowId };
        return ok({} as never);
      },
    };
    const ctx = fakeCtx("/v1/workspace/intent-1?workflowId=wf-42");
    await createWorkspaceHandler(port)(ctx);
    expect(received).toEqual({ intentId: "intent-1", workflowId: "wf-42" });
  });

  it("passes undefined when the query string is absent", async () => {
    let received: { workflowId?: string } = {};
    const port: WorkspaceReadPort = {
      getWorkspace: (_intentId, workflowId) => {
        received = { workflowId };
        return ok({} as never);
      },
    };
    await createWorkspaceHandler(port)(fakeCtx("/v1/workspace/intent-1"));
    expect(received.workflowId).toBeUndefined();
  });

  it("ignores an empty workflowId value", async () => {
    let received: { workflowId?: string } = { workflowId: "unset" };
    const port: WorkspaceReadPort = {
      getWorkspace: (_intentId, workflowId) => {
        received = { workflowId };
        return ok({} as never);
      },
    };
    await createWorkspaceHandler(port)(fakeCtx("/v1/workspace/intent-1?workflowId="));
    expect(received.workflowId).toBeUndefined();
  });

  it("does not confuse other query parameters for workflowId", async () => {
    let received: { workflowId?: string } = {};
    const port: WorkspaceReadPort = {
      getWorkspace: (_intentId, workflowId) => {
        received = { workflowId };
        return ok({} as never);
      },
    };
    await createWorkspaceHandler(port)(fakeCtx("/v1/workspace/intent-1?graphFilter=full"));
    expect(received.workflowId).toBeUndefined();
  });
});
