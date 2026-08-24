import { describe, expect, it } from "vitest";
import { createSdkCore } from "./client.js";
import type { SdkHttpResponse, SdkTransport } from "./types.js";

function recordingTransport(
  handler: (method: string, path: string, body: unknown) => SdkHttpResponse,
): {
  transport: SdkTransport;
  calls: { method: string; path: string; body: unknown }[];
} {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const transport: SdkTransport = {
    async post(path, body) {
      calls.push({ method: "POST", path, body });
      return handler("POST", path, body);
    },
    async get(path) {
      calls.push({ method: "GET", path, body: undefined });
      return handler("GET", path, undefined);
    },
  };
  return { transport, calls };
}

const REAL_PATHS = [
  "POST /v1/intents",
  "GET /v1/demo/canonical-phase-c-v5",
  "POST /v1/workflows",
  "GET /v1/workflows/wf-1",
  "POST /v1/workflows/wf-1/resume-approval",
  "POST /v1/workflows/wf-1/commit",
  "GET /v1/approvals/appr-1",
  "POST /v1/approvals/appr-1/decide",
  "POST /v1/evidence",
  "GET /v1/evidence/evidence-1",
  "GET /v1/outcomes/contracts/outcome-1",
  "GET /v1/resolutions/cases/rc-1",
  "GET /v1/resolutions/cases/by-outcome/outcome-1",
  "GET /v1/resolutions/cases/rc-1/remedies",
  "GET /v1/resolutions/mandates/mandate-1",
  "GET /v1/workspace/intent-1",
] as const;

const GENERIC_WORKFLOW_REQUEST = {
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

describe("sdk-core route truth", () => {
  it("issues exactly the governed public routes and nothing else", async () => {
    const { transport, calls } = recordingTransport(() => ({
      status: 200,
      body: {},
    }));

    const sdk = createSdkCore({ baseUrl: "https://tm.example/", transport });
    await sdk.recordIntent({ principalId: "alice", rawText: "Buy nothing." });
    await sdk.readCanonicalProjection();
    await sdk.submitWorkflow(GENERIC_WORKFLOW_REQUEST);
    await sdk.readWorkflow("wf-1");
    await sdk.resumeWorkflow("wf-1", { approvalId: "appr-1" });
    await sdk.commitWorkflow("wf-1");
    await sdk.readApproval("appr-1");
    await sdk.decideApproval("appr-1", { decision: "APPROVE" });
    await sdk.submitEvidence({ envelopes: [], claims: [] });
    await sdk.readEvidence("evidence-1");
    await sdk.readOutcome("outcome-1");
    await sdk.readResolutionCase("rc-1");
    await sdk.readResolutionByOutcome("outcome-1");
    await sdk.listResolutionRemedies("rc-1");
    await sdk.readResolutionMandate("mandate-1");
    await sdk.readWorkspace("intent-1");

    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(
      [...REAL_PATHS].sort(),
    );
    for (const call of calls) {
      expect(
        REAL_PATHS.includes(
          `${call.method} ${call.path}` as (typeof REAL_PATHS)[number],
        ),
        `unexpected route ${call.method} ${call.path}`,
      ).toBe(true);
    }
  });

  it("recordIntent issues exactly one request and passes the strict wire schema", async () => {
    const { transport, calls } = recordingTransport(() => ({
      status: 200,
      body: {
        id: "intent-abc",
        principalId: "alice",
        rawText: "Buy nothing.",
        createdAt: "2026-08-19T00:00:00Z",
        contentHash: "hash-abc",
      },
    }));
    const sdk = createSdkCore({ baseUrl: "https://tm.example", transport });

    const result = await sdk.recordIntent({
      principalId: "alice",
      rawText: "Buy nothing.",
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.path).toBe("/v1/intents");
    expect(calls[0]!.body).toEqual({
      principalId: "alice",
      rawText: "Buy nothing.",
    });
  });

  it("rejects invalid local input without touching the network", async () => {
    const { transport, calls } = recordingTransport(() => ({
      status: 200,
      body: {},
    }));
    const sdk = createSdkCore({ baseUrl: "https://tm.example", transport });

    const missingPrincipal = await sdk.recordIntent({
      rawText: "no principal",
    } as unknown as Parameters<typeof sdk.recordIntent>[0]);
    expect(missingPrincipal.ok).toBe(false);
    expect(calls).toHaveLength(0);

    const badWorkflow = await sdk.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "" },
    } as unknown as Parameters<typeof sdk.submitWorkflow>[0]);
    expect(badWorkflow.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("maps remote structured errors into Result errors", async () => {
    const { transport } = recordingTransport(() => ({
      status: 422,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "Intent already exists",
          details: {},
        },
      },
    }));
    const sdk = createSdkCore({ baseUrl: "https://tm.example", transport });

    const result = await sdk.recordIntent({
      principalId: "alice",
      rawText: "dup",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_FAILED");
      expect(result.message).toBe("Intent already exists");
    }
  });

  it("verifies the canonical projection read-only contract", async () => {
    const { transport } = recordingTransport(() => ({
      status: 200,
      body: {
        meta: {
          projectionKind: "canonical-phase-c-v5-live-read",
          readOnly: true,
        },
        intent: { id: "intent-1", rawText: "Buy 500.", contentHash: "h" },
      },
    }));
    const sdk = createSdkCore({ baseUrl: "https://tm.example", transport });
    const result = await sdk.readCanonicalProjection();
    expect(result.ok).toBe(true);

    const { transport: badTransport } = recordingTransport(() => ({
      status: 200,
      body: { meta: { projectionKind: "x", readOnly: false } },
    }));
    const badSdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: badTransport,
    });
    const bad = await badSdk.readCanonicalProjection();
    expect(bad.ok).toBe(false);
  });

  it("classifies capabilities honestly across governed, demo, and infrastructure-owned surfaces", async () => {
    const sdk = createSdkCore({
      baseUrl: "https://tm.example",
      transport: recordingTransport(() => ({ status: 200, body: {} })).transport,
    });

    expect(sdk.capabilities["intents.record"]).toMatchObject({
      status: "supported",
      route: "POST /v1/intents",
    });
    expect(sdk.capabilities["proof.canonical"]).toMatchObject({
      status: "supported",
      route: "GET /v1/demo/canonical-phase-c-v5",
    });
    for (const capability of [
      "workflow.submit",
      "workflow.read",
      "workflow.resume",
      "workflow.commit",
      "approval.read",
      "approval.decide",
      "evidence.submit",
      "evidence.read",
      "outcome.read",
      "resolution.read",
      "resolution.read_by_outcome",
      "resolution.remedies",
      "resolution.mandate",
    ] as const) {
      expect(sdk.capabilities[capability].status).toBe("supported");
      expect(sdk.capabilities[capability].route).toBeTruthy();
    }
    expect(sdk.capabilities["workspace.read"]).toMatchObject({
      status: "demo-only",
      route: "GET /v1/workspace/:intentId",
    });
    for (const infra of [
      "intents.compile",
      "workflow.trigger",
      "guardian.verdict",
      "authority.evaluate",
      "grant.mint",
      "commit.token",
      "gateway.commit",
      "provenance.write",
    ] as const) {
      expect(sdk.capabilities[infra]).toMatchObject({
        status: "infrastructure-owned",
      });
      expect(sdk.capabilities[infra].route).toBeUndefined();
    }
  });
});
