import { describe, expect, it, afterEach } from "vitest";
import type { Server } from "node:http";
import { ok } from "@truemandate/protocol";
import { createPublicBffServer } from "./server.js";
import { makePorts, request } from "./public-api.test.js";
import type { PublicBffPorts } from "./ports.js";

/**
 * Wave 1 SDK surface: approval.get / approval.decide / resolution.get /
 * remedy inspection — and a hard absence of any grant/token/COMMIT/scope
 * construction surface.
 */

function wave1Ports(): PublicBffPorts {
  return {
    ...makePorts(),
    approvalRead: {
      getApproval: async (id) =>
        ok({
          id,
          workflowId: "wf-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          intentStateHash: "a".repeat(64),
          status: "APPROVED",
          requestedCapability: "execute_payment",
          requestedScope: { amount: 742000, currency: "INR", merchant: "supplier-a" },
          requestedAt: "2026-06-01T12:00:00.000Z",
          expiresAt: "2026-12-01T12:00:00.000Z",
          decidedAt: "2026-06-02T12:00:00.000Z",
          decidedBy: "human-approver@example.com",
          decision: "APPROVE",
          contentHash: "b".repeat(64),
        }),
    },
    approvalDecide: {
      decideApproval: async (id, body) => {
        // The owner derives decidedBy; the port only receives {decision, reason}.
        const input = body as { decision: string; reason?: string; decidedBy?: string };
        return ok({
          id,
          workflowId: "wf-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          requestedCapability: "execute_payment",
          requestedScope: { amount: 742000, currency: "INR", merchant: "supplier-a" },
          requestedAt: "2026-06-01T12:00:00.000Z",
          expiresAt: "2026-12-01T12:00:00.000Z",
          decidedAt: "2026-06-02T12:00:00.000Z",
          decidedBy: "human-approver@example.com",
          decision: input.decision,
          ...(input.reason ? { reason: input.reason } : {}),
        });
      },
    },
    resolutionRead: {
      getResolutionCase: async (id) =>
        ok({
          id,
          contractId: "oc-1",
          intentId: "intent-1",
          intentStateId: "state-1",
          openedAt: "2026-06-03T12:00:00.000Z",
          responsibilityState: "UNKNOWN",
          state: "VERIFYING_REMEDY",
          updatedAt: "2026-06-04T12:00:00.000Z",
          principalId: "secret-should-not-leak",
        }),
      listRemedies: async () => ok({ remedies: [{ id: "remedy-1", kind: "REPLACEMENT", requiresFinancialAction: true }] }),
      getMandate: async (id) => ok({ id, resolutionCaseId: "rc-1", remedyProposalId: "remedy-1", maxAmount: 6000, currency: "INR", allowedCapabilities: ["execute_payment"], allowedMerchants: ["remedy-counterparty"], expiresAt: "2026-12-01T12:00:00.000Z", status: "ACTIVE" }),
    },
  };
}

describe("Wave 1 SDK surface", () => {
  let server: Server | undefined;
  let closer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closer) await closer();
    server = undefined;
    closer = undefined;
  });

  async function start(): Promise<void> {
    const bffServer = createPublicBffServer(wave1Ports(), {
      requireConfig: false,
      config: { port: 0, host: "127.0.0.1" },
    });
    await bffServer.listen();
    server = bffServer.server;
    closer = () => bffServer.close();
  }

  it("GET /v1/approvals/:id returns the allowlisted approval view (no hash leakage)", async () => {
    await start();
    const res = await request(server!, "GET", "/v1/approvals/approval-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: "approval-1", status: "APPROVED", decidedBy: "human-approver@example.com" });
    expect(res.json).not.toHaveProperty("contentHash");
    expect(res.json).not.toHaveProperty("intentStateHash");
  });

  it("POST /v1/approvals/:id/decide records the decision; decidedBy is owner-derived", async () => {
    await start();
    const res = await request(server!, "POST", "/v1/approvals/approval-1/decide", {
      decision: "APPROVE",
      reason: "bounded and verified",
      decidedBy: "forged@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "APPROVED", reason: "bounded and verified", decidedBy: "human-approver@example.com" });
  });

  it("GET /v1/resolutions/cases/:id returns the allowlisted case view", async () => {
    await start();
    const res = await request(server!, "GET", "/v1/resolutions/cases/rc-1");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ id: "rc-1", state: "VERIFYING_REMEDY" });
    expect(res.json).not.toHaveProperty("principalId");
  });

  it("remedy inspection routes exist; execution routes do not", async () => {
    await start();
    const remedies = await request(server!, "GET", "/v1/resolutions/cases/rc-1/remedies");
    expect(remedies.status).toBe(200);
    expect(remedies.json).toMatchObject({ remedies: [{ id: "remedy-1" }] });
    const mandate = await request(server!, "GET", "/v1/resolutions/mandates/mandate-1");
    expect(mandate.status).toBe(200);
    expect(mandate.json).toMatchObject({ id: "mandate-1", maxAmount: 6000 });
    // No remedy execution, mandate issuance, grant mint, token, or COMMIT surface.
    for (const [method, path] of [
      ["POST", "/v1/resolutions/cases/rc-1/remedies/remedy-1/execute"],
      ["POST", "/v1/resolutions/cases/rc-1/remedies/remedy-1/mandates"],
      ["POST", "/v1/grants"],
      ["POST", "/v1/commit"],
      ["POST", "/v1/prepared-actions"],
    ] as const) {
      const res = await request(server!, method, path, {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});
