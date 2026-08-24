import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { ErrorCode, err, ok } from "@truemandate/protocol";
import type { IntentWorkspaceView } from "@truemandate/read-model";
import {
  createPublicBff,
  createPublicBffServer,
  loadPublicBffConfig,
  PublicBffConfigError,
  toPublicEvidenceView,
} from "./index.js";
import type { PublicBffPorts } from "./ports.js";

export function request(
  server: Server,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      reject(new Error("server not listening"));
      return;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path: pathname,
        method,
        headers:
          payload === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            json: text ? (JSON.parse(text) as unknown) : null,
          });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const workspaceFixture: IntentWorkspaceView = {
  summary: {
    intentId: "intent-1",
    rawIntent: "Buy headphones under $200",
    principalId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    historicalStateIds: [],
  },
  semantic: {
    intentId: "intent-1",
    rawIntent: "Buy headphones under $200",
    constraints: [],
  },
  plan: { steps: [] },
  guardian: {
    judges: [],
    aggregator: { decision: "ALLOW", semanticStatus: "PASS", criticalFailure: false },
  },
  authority: {
    guardianRecommendation: "ALLOW",
    semanticGate: "PASS",
    decision: "NONE",
    capability: "",
    principalId: "user-1",
    agentId: "agent-1",
    cumulativeExposure: 0,
    approvalState: "NONE",
    grantState: "NONE",
    revocationState: "NONE",
    explanation: "",
  },
  execution: {
    phase: "PROPOSE",
    sideEffects: [],
    unknownPending: false,
    blockedRetry: false,
  },
  graph: { nodes: [], edges: [] },
  timeline: { events: [] },
};

export function makePorts(overrides: Partial<PublicBffPorts> = {}): PublicBffPorts {
  return {
    intentCreate: {
      createIntent: (raw) =>
        ok({
          id: "intent-test",
          principalId: "user-1",
          rawText: String((raw as { rawText?: string }).rawText ?? "test"),
          createdAt: "2026-01-01T00:00:00.000Z",
          contentHash: "abc",
        }),
    },
    workspaceRead: {
      getWorkspace: (intentId) => ok({ ...workspaceFixture, summary: { ...workspaceFixture.summary, intentId } }),
    },
    approvalSubmit: {
      submitApproval: (raw) =>
        ok({
          id: "approval-1",
          principalId: "user-1",
          preparedActionHash: "hash",
          decision: "APPROVE",
          createdAt: "2026-01-01T00:00:00.000Z",
          artifactHash: "artifact-hash",
          ...(raw as object),
        }),
    },
    evidenceRead: {
      getEvidence: (id) =>
        ok(
          toPublicEvidenceView({
            id,
            source: "merchant",
            contentHash: "hash",
            trustClass: "EXTERNAL",
            captureTime: "2026-01-01T00:00:00.000Z",
          }),
        ),
    },
    evidenceSubmit: {
      submitEvidence: async () =>
        ok({ envelopeIds: ["e-1"], claimIds: ["c-1"] }),
    },
    workflowSubmit: {
      submitWorkflow: async (raw) =>
        ok({
          workflowId: "wf-generic-1",
          state: "AUTHORIZED",
          authorization: {
            commitToken: { id: "ct-secret" },
            grant: { id: "grant-secret", preparedActionId: "prep-secret" },
          },
          execution: { status: "AUTHORIZED" },
          echoed: raw,
        }),
    },
    workflowRead: {
      getWorkflow: async (workflowId) =>
        ok({
          workflowId,
          state: "AUTHORIZED",
          execution: { status: "AUTHORIZED" },
          authorization: { commitToken: { id: "ct-secret" } },
        }),
    },
    workflowResume: {
      resumeWorkflow: async (workflowId, body) =>
        ok({
          workflowId,
          state: "AUTHORIZED",
          approval: { id: (body as { approvalId?: string }).approvalId },
          authorization: {
            commitToken: { id: "ct-secret" },
          },
          execution: { status: "AUTHORIZED" },
        }),
    },
    workflowCommit: {
      commitWorkflow: async (workflowId) =>
        ok({
          workflowId,
          status: "SUCCESS",
          executionId: "exec-1",
          resultRef: "result-1",
          grantId: "grant-secret",
          commitToken: { id: "ct-secret" },
        }),
    },
    outcomeRead: {
      getOutcomeContract: async (id) =>
        ok({
          id,
          workflowId: "wf-generic-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          domain: "procurement",
          state: "AWAITING_OUTCOME",
          paymentStatus: "SUCCESS",
          updatedAt: "2026-08-21T00:00:00.000Z",
          requirementSecrets: ["nope"],
        }),
    },
    approvalRead: {
      getApproval: async (id) =>
        ok({
          id,
          workflowId: "wf-approval-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          status: "APPROVED",
          requestedCapability: "execute_payment",
          requestedScope: {
            amount: 742000,
            currency: "INR",
            merchant: "approved-supplier",
          },
          requestedAt: "2026-08-21T00:00:00.000Z",
          expiresAt: "2026-12-01T12:00:00.000Z",
          decidedBy: "human-approver@example.com",
          hiddenHash: "secret",
        }),
    },
    approvalDecide: {
      decideApproval: async (id, body) =>
        ok({
          id,
          workflowId: "wf-approval-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          status:
            (body as { decision?: string }).decision === "DENY"
              ? "REJECTED"
              : "APPROVED",
          requestedCapability: "execute_payment",
          requestedScope: {
            amount: 742000,
            currency: "INR",
            merchant: "approved-supplier",
          },
          requestedAt: "2026-08-21T00:00:00.000Z",
          expiresAt: "2026-12-01T12:00:00.000Z",
          decidedBy: "human-approver@example.com",
        }),
    },
    resolutionRead: {
      getResolutionCase: async (id) =>
        ok({
          id,
          contractId: "outcome-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          openedAt: "2026-08-21T00:00:00.000Z",
          responsibilityState: "UNKNOWN",
          state: "OPEN",
          updatedAt: "2026-08-21T00:00:00.000Z",
          secret: "nope",
        }),
      getResolutionCaseByOutcome: async (contractId) =>
        ok({
          id: "rc-1",
          contractId,
          intentId: "intent-1",
          intentStateId: "state-1",
          openedAt: "2026-08-21T00:00:00.000Z",
          responsibilityState: "UNKNOWN",
          state: "OPEN",
          updatedAt: "2026-08-21T00:00:00.000Z",
          secret: "nope",
        }),
      getRemedies: async (caseId) =>
        ok([{ id: "remedy-1", resolutionCaseId: caseId }]),
      getMandate: async (id) =>
        ok({
          id,
          resolutionCaseId: "rc-1",
          remedyProposalId: "remedy-1",
          maxAmount: 6000,
          currency: "INR",
          allowedCapabilities: ["execute_payment"],
          allowedMerchants: ["remedy-counterparty"],
          expiresAt: "2026-12-01T12:00:00.000Z",
          status: "ACTIVE",
        }),
    },
    ...overrides,
  };
}

describe("public-api BFF", () => {
  let server: Server | undefined;
  let closer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closer) await closer();
    server = undefined;
    closer = undefined;
  });

  it("fail closed when requireConfig and project id missing", () => {
    expect(() =>
      loadPublicBffConfig({
        requireConfig: true,
        config: { projectId: "", serviceName: "public-bff" },
      }),
    ).toThrow(PublicBffConfigError);
  });

  it("exposes health and ready endpoints", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const health = await request(server, "GET", "/healthz");
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ status: "ok" });

    const ready = await request(server, "GET", "/readyz");
    expect(ready.status).toBe(200);
    expect(ready.json).toMatchObject({ status: "ready" });
  });

  it("POST /v1/intents delegates to IntentCreatePort", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/intents", {
      principalId: "user-1",
      rawText: "hello",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: "intent-test" });
  });

  it("GET /v1/workspace/:intentId returns allowlisted workspace", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "GET", "/v1/workspace/intent-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ summary: { intentId: "intent-1" } });
  });

  it("POST /v1/approvals accepts ApprovalArtifact only path", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/approvals", {
      id: "approval-1",
      principalId: "user-1",
      preparedActionHash: "hash",
      decision: "APPROVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      artifactHash: "artifact-hash",
    });
    expect(res.status).toBe(200);
  });

  it("GET /v1/evidence/:id returns public evidence view", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "GET", "/v1/evidence/ev-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: "ev-1", source: "merchant" });
    expect(res.json).not.toHaveProperty("signature");
  });

  it("returns 404 for unknown routes (no gateway commit surface)", async () => {
    const bff = createPublicBff(makePorts(), {
      requireConfig: false,
      config: { port: 0 },
    });
    const resObj = { statusCode: 0, body: "" };
    const fakeRes = {
      statusCode: 200,
      setHeader: () => undefined,
      end: (body: string) => {
        resObj.statusCode = fakeRes.statusCode;
        resObj.body = body;
      },
    } as unknown as ServerResponse;
    const fakeReq = {} as IncomingMessage;
    await bff.handleRequest("POST", "/v1/commit", fakeReq, fakeRes);
    expect(fakeRes.statusCode).toBe(404);
  });

  it("POST /v1/workflows accepts only the generic neutral envelope and sanitizes privileged output", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows", {
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        deliveryTerms: "deliver before 2026-12-30",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "procurement",
        payload: {
          supplier: { id: "approved-supplier", name: "Approved Supplier", approved: true },
          item: { specification: "food-grade containers" },
        },
      },
      idempotencyKey: "wf-generic-1",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      workflowId: "wf-generic-1",
      state: "AUTHORIZED",
      execution: { status: "AUTHORIZED" },
    });
    expect(res.json).not.toHaveProperty("authorization");
    expect(res.json).not.toHaveProperty("commitToken");
    expect(res.json).not.toHaveProperty("grant");
    expect(res.json).not.toHaveProperty("preparedAction");
  });

  it("POST /v1/workflows preserves retryable not-ready status from the workflow port", async () => {
    const bffServer = createPublicBffServer(
      makePorts({
        workflowSubmit: {
          submitWorkflow: async () =>
            err(
              ErrorCode.INTENT_STATE_NOT_READY,
              "IntentState tip is not finalized",
              { status: 503, retryable: true },
            ),
        },
      }),
      {
        requireConfig: false,
        config: { port: 0, host: "127.0.0.1" },
      },
    );
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows", {
      intent: { kind: "RAW", principalId: "user-1", rawText: "buy 500 containers" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: { packId: "procurement", payload: {} },
      idempotencyKey: "wf-not-ready",
    });
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({
      error: {
        code: "INTENT_STATE_NOT_READY",
        details: { retryable: true, status: 503 },
      },
    });
  });

  it("POST /v1/workflows preserves explicit downstream 400 status from the workflow port", async () => {
    const bffServer = createPublicBffServer(
      makePorts({
        workflowSubmit: {
          submitWorkflow: async () =>
            err(ErrorCode.VALIDATION_FAILED, "S2S request failed (403)", {
              status: 400,
              retryable: false,
            }),
        },
      }),
      {
        requireConfig: false,
        config: { port: 0, host: "127.0.0.1" },
      },
    );
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows", {
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: { packId: "procurement", payload: {} },
      idempotencyKey: "wf-downstream-400",
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: { retryable: false, status: 400 },
      },
    });
  });

  it("POST /v1/workflows rejects procurement-specific top-level fields in the generic schema", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows", {
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: { packId: "procurement", payload: {} },
      supplier: { id: "should-not-be-here" },
      idempotencyKey: "wf-invalid",
    });
    expect(res.status).toBe(400);
  });

  it("POST /v1/procurement/offers remains a compatibility alias over the generic workflow port", async () => {
    const seen: unknown[] = [];
    const bffServer = createPublicBffServer(
      makePorts({
        workflowSubmit: {
          submitWorkflow: async (raw) => {
            seen.push(raw);
            return ok({ workflowId: "wf-procurement-1", state: "AUTHORIZED", execution: { status: "AUTHORIZED" } });
          },
        },
      }),
      {
        requireConfig: false,
        config: { port: 0, host: "127.0.0.1" },
      },
    );
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/procurement/offers", {
      intentId: "intent-1",
      supplier: {
        id: "approved-supplier",
        name: "Approved Supplier",
        approved: true,
      },
      item: { specification: "food-grade containers" },
      quantity: 500,
      totalAmount: 742000,
      currency: "INR",
      idempotencyKey: "wf-procurement-1",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      workflowId: "wf-procurement-1",
      state: "AUTHORIZED",
    });
    expect(seen[0]).toMatchObject({
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      domain: { packId: "procurement" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
      },
    });
  });

  it("POST /v1/workflows/:workflowId/resume-approval operates by workflowId and sanitizes the response", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows/wf-approve-1/resume-approval", {
      approvalId: "approval-1",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      workflowId: "wf-approve-1",
      state: "AUTHORIZED",
      approval: { id: "approval-1" },
    });
    expect(res.json).not.toHaveProperty("authorization");
  });

  it("GET /v1/workflows/:workflowId returns a sanitized workflow status view", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "GET", "/v1/workflows/wf-read-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      workflowId: "wf-read-1",
      state: "AUTHORIZED",
      execution: { status: "AUTHORIZED" },
    });
    expect(res.json).not.toHaveProperty("authorization");
  });

  it("POST /v1/workflows/:workflowId/commit commits by workflowId and never leaks token or grant material", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/workflows/wf-commit-1/commit");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      status: "SUCCESS",
      executionId: "exec-1",
      resultRef: "result-1",
    });
    expect(res.json).not.toHaveProperty("grantId");
    expect(res.json).not.toHaveProperty("commitToken");
  });

  it("GET /v1/outcomes/contracts/:id returns the allowlisted outcome view", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "GET", "/v1/outcomes/contracts/outcome-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: "outcome-1",
      workflowId: "wf-generic-1",
      domain: "procurement",
      state: "AWAITING_OUTCOME",
      paymentStatus: "SUCCESS",
    });
    expect(res.json).not.toHaveProperty("requirementSecrets");
    expect(res.json).not.toHaveProperty("commitToken");
    expect(res.json).not.toHaveProperty("grant");
    expect(res.json).not.toHaveProperty("preparedAction");
    expect(res.json).not.toHaveProperty("authorization");
  });

  it("GET /v1/resolutions/cases/by-outcome/:outcomeContractId returns the allowlisted resolution view", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "GET", "/v1/resolutions/cases/by-outcome/outcome-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      id: "rc-1",
      contractId: "outcome-1",
      state: "OPEN",
    });
    expect(res.json).not.toHaveProperty("secret");
  });

  it("POST /v1/evidence delegates to the safe evidence submit port", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/evidence", {
      envelopes: [{
        id: "e-1",
        source: "merchant-portal",
        contentHash: "hash",
        captureTime: "2026-08-22T00:00:00.000Z",
      }],
      claims: [],
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ envelopeIds: ["e-1"], claimIds: ["c-1"] });
  });

  it("POST /v1/evidence rejects privileged submission fields", async () => {
    const bffServer = createPublicBffServer(makePorts(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();

    const res = await request(server, "POST", "/v1/evidence", {
      envelopes: [{
        id: "e-1",
        source: "merchant-portal",
        contentHash: "hash",
        captureTime: "2026-08-22T00:00:00.000Z",
        trustClass: "TRUSTED",
      }],
      claims: [{
        id: "c-1",
        evidenceId: "e-1",
        concept: "merchant",
        value: "supplier-a",
        confidence: 0.9,
        derivedBy: "verifier",
      }],
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({
      error: { code: "SCHEMA_PARSE_FAILED" },
    });
  });
});
