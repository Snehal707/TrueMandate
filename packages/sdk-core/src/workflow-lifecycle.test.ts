import { describe, expect, it } from "vitest";
import { createSdkCore } from "./client.js";
import type { SdkHttpResponse, SdkTransport } from "./types.js";

function makeTransport(
  handler: (method: string, path: string, body: unknown) => SdkHttpResponse,
): SdkTransport {
  return {
    async post(path, body) {
      return handler("POST", path, body);
    },
    async get(path) {
      return handler("GET", path, undefined);
    },
  };
}

const WORKFLOW_REQUEST = {
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
      supplier: {
        id: "approved-supplier",
        name: "Approved Supplier",
        approved: true,
      },
      item: { specification: "food-grade containers" },
    },
  },
  adaptiveSubjectId: "subject-1",
  idempotencyKey: "wf-1",
} as const;

describe("sdk workflow lifecycle", () => {
  it("submits and reads governed workflows through public-safe routes", async () => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: makeTransport((method, path) => {
        if (method === "POST" && path === "/v1/workflows") {
          return {
            status: 200,
            body: {
              workflowId: "wf-1",
              state: "AUTHORIZED",
              monitoringContract: { id: "mc-1" },
              outcomeContract: { id: "oc-1" },
              execution: { status: "AUTHORIZED" },
            },
          };
        }
        if (method === "GET" && path === "/v1/workflows/wf-1") {
          return {
            status: 200,
            body: {
              workflowId: "wf-1",
              state: "COMMITTED",
              approval: { id: "appr-1", status: "APPROVED" },
              execution: { status: "SUCCESS", executionId: "exec-1" },
            },
          };
        }
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } };
      }),
    });

    const submitted = await sdk.submitWorkflow(WORKFLOW_REQUEST);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.value.workflowId).toBe("wf-1");
      expect(submitted.value.execution?.status).toBe("AUTHORIZED");
    }

    const read = await sdk.readWorkflow("wf-1");
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.state).toBe("COMMITTED");
      expect(read.value.execution?.executionId).toBe("exec-1");
    }
  });

  it("supports approval read, decision, resume, and commit by workflow id", async () => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: makeTransport((method, path, body) => {
        if (method === "GET" && path === "/v1/approvals/appr-1") {
          return {
            status: 200,
            body: {
              id: "appr-1",
              workflowId: "wf-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              status: "PENDING",
              requestedCapability: "execute_payment",
              requestedScope: {
                amount: 742000,
                currency: "INR",
                merchant: "approved-supplier",
              },
              requestedAt: "2026-08-21T00:00:00.000Z",
              expiresAt: "2026-12-01T00:00:00.000Z",
            },
          };
        }
        if (method === "POST" && path === "/v1/approvals/appr-1/decide") {
          return {
            status: 200,
            body: {
              id: "appr-1",
              workflowId: "wf-1",
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
              expiresAt: "2026-12-01T00:00:00.000Z",
              decidedAt: "2026-08-21T01:00:00.000Z",
              decidedBy: "approver@example.com",
              decision: (body as { decision?: string }).decision,
            },
          };
        }
        if (
          method === "POST" &&
          path === "/v1/workflows/wf-1/resume-approval"
        ) {
          return {
            status: 200,
            body: {
              workflowId: "wf-1",
              state: "AUTHORIZED",
              approval: { id: "appr-1", status: "APPROVED" },
              execution: { status: "AUTHORIZED" },
            },
          };
        }
        if (method === "POST" && path === "/v1/workflows/wf-1/commit") {
          return {
            status: 200,
            body: {
              status: "SUCCESS",
              executionId: "exec-1",
              resultRef: "result-1",
            },
          };
        }
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } };
      }),
    });

    const approval = await sdk.readApproval("appr-1");
    expect(approval.ok).toBe(true);
    if (approval.ok) {
      expect(approval.value.status).toBe("PENDING");
    }

    const decided = await sdk.decideApproval("appr-1", {
      decision: "APPROVE",
    });
    expect(decided.ok).toBe(true);
    if (decided.ok) {
      expect(decided.value.status).toBe("APPROVED");
      expect(decided.value.decision).toBe("APPROVE");
    }

    const resumed = await sdk.resumeWorkflow("wf-1", { approvalId: "appr-1" });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.value.state).toBe("AUTHORIZED");
    }

    const committed = await sdk.commitWorkflow("wf-1");
    expect(committed.ok).toBe(true);
    if (committed.ok) {
      expect(committed.value.executionId).toBe("exec-1");
    }
  });

  it("supports evidence, outcome, and resolution lifecycle reads", async () => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: makeTransport((method, path) => {
        if (method === "POST" && path === "/v1/evidence") {
          return {
            status: 200,
            body: { envelopeIds: ["e-1"], claimIds: ["c-1"] },
          };
        }
        if (method === "GET" && path === "/v1/evidence/e-1") {
          return {
            status: 200,
            body: {
              id: "e-1",
              source: "merchant",
              contentHash: "hash",
              trustClass: "EXTERNAL",
              captureTime: "2026-08-21T00:00:00.000Z",
            },
          };
        }
        if (method === "GET" && path === "/v1/outcomes/contracts/outcome-1") {
          return {
            status: 200,
            body: {
              id: "outcome-1",
              workflowId: "wf-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              domain: "procurement",
              state: "AWAITING_OUTCOME",
              paymentStatus: "SUCCESS",
              resolutionCaseId: "rc-1",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
          };
        }
        if (method === "GET" && path === "/v1/resolutions/cases/rc-1") {
          return {
            status: 200,
            body: {
              id: "rc-1",
              contractId: "outcome-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              openedAt: "2026-08-21T00:00:00.000Z",
              responsibilityState: "UNKNOWN",
              state: "OPEN",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
          };
        }
        if (
          method === "GET" &&
          path === "/v1/resolutions/cases/by-outcome/outcome-1"
        ) {
          return {
            status: 200,
            body: {
              id: "rc-1",
              contractId: "outcome-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              openedAt: "2026-08-21T00:00:00.000Z",
              responsibilityState: "UNKNOWN",
              state: "OPEN",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
          };
        }
        if (method === "GET" && path === "/v1/resolutions/cases/rc-1/remedies") {
          return {
            status: 200,
            body: [{ id: "remedy-1", resolutionCaseId: "rc-1" }],
          };
        }
        if (method === "GET" && path === "/v1/resolutions/mandates/mandate-1") {
          return {
            status: 200,
            body: {
              id: "mandate-1",
              resolutionCaseId: "rc-1",
              status: "ACTIVE",
            },
          };
        }
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } };
      }),
    });

    const submittedEvidence = await sdk.submitEvidence({ envelopes: [], claims: [] });
    expect(submittedEvidence.ok).toBe(true);

    const evidence = await sdk.readEvidence("e-1");
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(evidence.value.id).toBe("e-1");
    }

    const outcome = await sdk.readOutcome("outcome-1");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.resolutionCaseId).toBe("rc-1");
    }

    const resolution = await sdk.readResolutionCase("rc-1");
    expect(resolution.ok).toBe(true);

    const resolutionByOutcome = await sdk.readResolutionByOutcome("outcome-1");
    expect(resolutionByOutcome.ok).toBe(true);

    const remedies = await sdk.listResolutionRemedies("rc-1");
    expect(remedies.ok).toBe(true);

    const mandate = await sdk.readResolutionMandate("mandate-1");
    expect(mandate.ok).toBe(true);
  });

  it("fails closed if the BFF leaks privileged workflow or outcome fields", async () => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: makeTransport((method, path) => {
        if (method === "GET" && path === "/v1/workflows/wf-1") {
          return {
            status: 200,
            body: {
              workflowId: "wf-1",
              state: "AUTHORIZED",
              execution: { status: "AUTHORIZED" },
              authorization: { commitToken: { id: "ct-secret" } },
            },
          };
        }
        if (method === "GET" && path === "/v1/outcomes/contracts/outcome-1") {
          return {
            status: 200,
            body: {
              id: "outcome-1",
              workflowId: "wf-1",
              intentId: "intent-1",
              intentStateId: "state-1",
              domain: "procurement",
              state: "AWAITING_OUTCOME",
              paymentStatus: "SUCCESS",
              requirementSecrets: ["secret"],
            },
          };
        }
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } };
      }),
    });

    const workflow = await sdk.readWorkflow("wf-1");
    expect(workflow.ok).toBe(false);

    const outcome = await sdk.readOutcome("outcome-1");
    expect(outcome.ok).toBe(false);
  });

  it.each([
    ["workflowId", {
      id: "outcome-1",
      intentId: "intent-1",
      intentStateId: "state-1",
      domain: "travel",
      state: "AWAITING_OUTCOME",
      paymentStatus: "SUCCESS",
    }],
    ["domain", {
      id: "outcome-1",
      workflowId: "wf-1",
      intentId: "intent-1",
      intentStateId: "state-1",
      state: "AWAITING_OUTCOME",
      paymentStatus: "SUCCESS",
    }],
  ])("fails closed when the outcome response omits required %s lineage", async (_field, body) => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: makeTransport((method, path) =>
        method === "GET" && path === "/v1/outcomes/contracts/outcome-1"
          ? { status: 200, body }
          : { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } },
      ),
    });

    expect(await sdk.readOutcome("outcome-1")).toMatchObject({
      ok: false,
      code: "SCHEMA_PARSE_FAILED",
    });
  });
});
