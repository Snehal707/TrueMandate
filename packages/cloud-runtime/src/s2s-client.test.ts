import { ErrorCode } from "@truemandate/protocol";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { extractContext } from "@truemandate/observability";
import {
  AgentRuntimeS2SClient,
  EvidenceS2SClient,
  GatewayS2SClient,
  IntentProvenanceS2SClient,
  OutcomeS2SClient,
  fetchS2SJson,
  s2sHttpRetryable,
  s2sResultFromHttp,
  staticTokenProvider,
} from "./s2s-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("s2sResultFromHttp", () => {
  it("classifies 5xx and network failures as retryable", () => {
    const five = s2sResultFromHttp({
      status: 503,
      body: { error: "VALIDATION_FAILED", message: "unavailable" },
    });
    expect(five.ok).toBe(false);
    if (!five.ok) {
      expect(five.details?.retryable).toBe(true);
      expect(five.details?.status).toBe(503);
    }
  });

  it("classifies application JSON 4xx as permanent", () => {
    const four = s2sResultFromHttp({
      status: 400,
      body: { error: "VALIDATION_FAILED", message: "Unknown intent" },
    });
    expect(four.ok).toBe(false);
    if (!four.ok) {
      expect(four.details?.retryable).toBe(false);
      expect(four.details?.status).toBe(400);
    }
  });

  it("treats GFE HTML 404 as retryable and app JSON 404 as permanent", () => {
    expect(
      s2sHttpRetryable({
        status: 404,
        body: { error: "MALFORMED_JSON", raw: "<html>Not Found</html>" },
      }),
    ).toBe(true);
    expect(
      s2sHttpRetryable({
        status: 404,
        body: { error: "VALIDATION_FAILED", message: "Unknown node" },
      }),
    ).toBe(false);
  });

  it("wraps fetch network errors as 503 retryable", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNRESET");
    };
    const response = await fetchS2SJson({
      baseUrl: "https://intent.example.run.app",
      path: "/internal/intents",
      method: "POST",
      token: "t",
      body: {},
    });
    expect(response.status).toBe(503);
    const result = s2sResultFromHttp(response);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.details?.retryable).toBe(true);
    }
  });
});

describe("GatewayS2SClient", () => {
  it("maps owner/gateway S2S 503 as retryable", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: "VALIDATION_FAILED", message: "gateway unavailable" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    const client = new GatewayS2SClient(
      "https://gateway.example.run.app",
      staticTokenProvider("t"),
    );
    const result = await client.prepareFromReferences({ idempotencyKey: "k" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details?.retryable).toBe(true);
      expect(result.details?.status).toBe(503);
    }
  });
});

describe("OutcomeS2SClient", () => {
  it("uses the service origin audience and canonical contract read route", async () => {
    const call: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      call.url = String(input);
      call.authorization =
        new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ id: "outcome-1" }), { status: 200 });
    };
    const baseUrl = "https://outcome.example.run.app";
    const client = new OutcomeS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        call.audience = audience;
        return "verified-token";
      },
    });

    await client.getContract("outcome/1");

    expect(call).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/outcomes/contracts/outcome%2F1`,
      authorization: "Bearer verified-token",
    });
  });

  it("sends a gateway payment status update to the authoritative owner route", async () => {
    const call: { audience?: string; url?: string; method?: string; body?: unknown } = {};
    globalThis.fetch = async (input, init) => {
      call.url = String(input);
      call.method = String(init?.method ?? "GET");
      call.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({ paymentStatus: "SUCCESS" }), { status: 200 });
    };
    const baseUrl = "https://outcome.example.run.app";
    const client = new OutcomeS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        call.audience = audience;
        return "verified-token";
      },
    });

    await client.recordPaymentStatus("outcome/1", "SUCCESS", "2026-08-31T00:00:00.000Z");

    expect(call).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/outcomes/contracts/outcome%2F1/payment-status`,
      method: "POST",
      body: { status: "SUCCESS", occurredAt: "2026-08-31T00:00:00.000Z" },
    });
  });
});

describe("AgentRuntimeS2SClient", () => {
  it("calls the canonical generic workflow routes", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const client = new AgentRuntimeS2SClient(
      "https://agent-runtime.example.run.app",
      staticTokenProvider("t"),
    );

    await client.submitWorkflow({ workflowId: "wf-1" });
    await client.resumeWorkflowApproval("wf/2", { approvalId: "approval-2" });
    await client.commitWorkflow("wf/3");

    expect(calls).toEqual([
      {
        url: "https://agent-runtime.example.run.app/internal/workflows",
        method: "POST",
        body: { workflowId: "wf-1" },
      },
      {
        url: "https://agent-runtime.example.run.app/internal/workflows/wf%2F2/resume-approval",
        method: "POST",
        body: { approvalId: "approval-2" },
      },
      {
        url: "https://agent-runtime.example.run.app/internal/workflows/wf%2F3/commit",
        method: "POST",
        body: {},
      },
    ]);
  });

  it("uses the configured service origin as audience and attaches Authorization on submitWorkflow", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ workflowId: "wf-1", state: "AUTHORIZED" }), {
        status: 200,
      });
    };
    const baseUrl = "https://agent-runtime.example.run.app";
    const client = new AgentRuntimeS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.submitWorkflow({ workflowId: "wf-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { workflowId: "wf-1", state: "AUTHORIZED" },
    });
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/workflows`,
      authorization: "Bearer verified-token",
    });
  });

  it("uses the configured service origin as audience and attaches Authorization on evaluatePreExecutionReadiness", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ superseded: true }), {
        status: 200,
      });
    };
    const baseUrl = "https://agent-runtime.example.run.app";
    const client = new AgentRuntimeS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.evaluatePreExecutionReadiness({
      intentId: "intent-1",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { superseded: true },
    });
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/pre-execution-readiness`,
      authorization: "Bearer verified-token",
    });
  });
});

describe("EvidenceS2SClient", () => {
  it("uses the configured service origin as audience and attaches Authorization on submitEvidence", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ envelopeIds: ["ev-1"], claimIds: ["claim-1"] }), {
        status: 200,
      });
    };
    const baseUrl = "https://evidence.example.run.app";
    const client = new EvidenceS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.submitEvidence({ envelopes: [{ id: "ev-1" }] });

    expect(result).toMatchObject({
      ok: true,
      value: { envelopeIds: ["ev-1"], claimIds: ["claim-1"] },
    });
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/evidence/submissions`,
      authorization: "Bearer verified-token",
    });
  });

  it("uses the configured service origin as audience and attaches Authorization on verifyEvidence", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ envelopeIds: ["ev-1-verified"], claimIds: [] }), {
        status: 200,
      });
    };
    const baseUrl = "https://evidence.example.run.app";
    const client = new EvidenceS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.verifyEvidence({ envelopeId: "ev-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { envelopeIds: ["ev-1-verified"], claimIds: [] },
    });
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/evidence/verifications`,
      authorization: "Bearer verified-token",
    });
  });
});

describe("fetchS2SJson trace propagation", () => {
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(new BasicTracerProvider());
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  it("propagates an inbound traceparent's trace id onto the outbound request headers", async () => {
    const inboundTraceparent =
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const inboundContext = extractContext({ traceparent: inboundTraceparent });

    let outboundTraceparent: string | undefined;
    globalThis.fetch = async (_input, init) => {
      outboundTraceparent = new Headers(init?.headers).get("traceparent") ?? undefined;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await context.with(inboundContext, () =>
      fetchS2SJson({
        baseUrl: "https://intent-provenance.example.run.app",
        path: "/internal/intents",
        method: "GET",
        token: "t",
      }),
    );

    expect(outboundTraceparent).toBeDefined();
    expect(outboundTraceparent).toContain("0af7651916cd43dd8448eb211c80319c");
  });

  it("still attaches Authorization and completes normally when no inbound trace context exists", async () => {
    globalThis.fetch = async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer t");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const response = await fetchS2SJson({
      baseUrl: "https://intent-provenance.example.run.app",
      path: "/internal/intents",
      method: "GET",
      token: "t",
    });
    expect(response.status).toBe(200);
  });
});

describe("IntentProvenanceS2SClient", () => {
  it("uses the canonical owner URL as audience and attaches its bearer on GET tip", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ id: "state-1" }), { status: 200 });
    };
    const baseUrl = "https://intent-provenance.example.run.app";
    const client = new IntentProvenanceS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.getTip("intent/a");

    expect(result).toMatchObject({ ok: true, value: { id: "state-1" } });
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/intents/intent%2Fa/tip`,
      authorization: "Bearer verified-token",
    });
  });

  it("uses the canonical owner URL as audience and attaches its bearer on semantic supersession", async () => {
    const calls: { audience?: string; url?: string; authorization?: string } = {};
    globalThis.fetch = async (input, init) => {
      calls.url = String(input);
      calls.authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const baseUrl = "https://intent-provenance.example.run.app";
    const client = new IntentProvenanceS2SClient(baseUrl, {
      getIdentityToken: async (audience) => {
        calls.audience = audience;
        return "verified-token";
      },
    });

    const result = await client.supersedeSemanticVerification("state-1", { readiness: "ACTIONABLE" });

    expect(result.ok).toBe(true);
    expect(calls).toEqual({
      audience: baseUrl,
      url: `${baseUrl}/internal/intent-states/state-1/semantic-supersession`,
      authorization: "Bearer verified-token",
    });
  });
});
