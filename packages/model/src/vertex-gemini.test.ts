import { ErrorCode } from "@truemandate/protocol";
import {
  CompilerModelOutputSchema,
  VerifierModelOutputSchema,
} from "@truemandate/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VertexGeminiModel, type TokenProvider } from "./vertex-gemini.js";
import { vertexObjectRequiredFields } from "./vertex-response-schema.js";
import type { ModelCallTelemetryEvent, ModelTelemetryPort } from "./types.js";

const SampleSchema = z.object({ answer: z.string() }).strict();

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  const raw = init?.body;
  if (typeof raw !== "string") throw new Error("expected string body");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("VertexGeminiModel token resolution", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("uses injected TokenProvider when env token is unset", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

    const provider: TokenProvider = {
      getAccessToken: vi.fn(async () => "injected-token"),
    };

    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      provider,
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] } }],
        }),
        { status: 200 },
      ),
    );

    const result = await model.generateStructured({
      modelId: "gemini-3.7-flash",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r-token",
    });

    expect(result.ok).toBe(true);
    expect(provider.getAccessToken).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("aiplatform.googleapis.com");
    expect(calledUrl).toContain("/locations/global/");
    expect(calledUrl).toContain("gemini-3.7-flash");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer injected-token",
    );
  });

  it("fail-closed when no token source is available", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => undefined },
    );

    const result = await model.generateStructured({
      modelId: "gemini-3.7-flash",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r-fail",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
    }
  });

  it("parses JSON from non-thought parts rather than parts[0]", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "hidden reasoning" },
                  { text: '{"answer":"from-second-part"}' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await model.generateStructured({
      modelId: "gemini-3.7-flash",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r-parts",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value.answer).toBe("from-second-part");
    }
  });

  it("sends responseMimeType application/json and compiler responseSchema", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      goal: "g",
                      constraints: [],
                      preferences: [],
                      assumptions: [],
                      ambiguities: [],
                      readiness: "SEARCHABLE",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await model.generateStructured({
      modelId: "intent-compiler",
      promptVersion: "v1",
      schemaId: "compiler.candidate.v1",
      schemaVersion: "1",
      schema: CompilerModelOutputSchema,
      systemInstruction: "compile",
      userPayload: { rawText: "Buy 500 food-grade containers" },
      requestId: "r-compiler-schema",
    });

    const body = parseBody(fetchMock.mock.calls[0]?.[1] as RequestInit);
    const generationConfig = body.generationConfig as Record<string, unknown>;
    expect(generationConfig.responseMimeType).toBe("application/json");
    const responseSchema = generationConfig.responseSchema as Record<
      string,
      unknown
    >;
    expect(responseSchema.type).toBe("object");
    for (const field of [
      "goal",
      "constraints",
      "preferences",
      "assumptions",
      "ambiguities",
      "readiness",
    ]) {
      expect(vertexObjectRequiredFields(responseSchema)).toContain(field);
    }
    const promptText = (
      (body.contents as Array<{ parts: Array<{ text: string }> }>)[0]!.parts[0]!
        .text
    );
    expect(promptText).not.toContain('"properties"');
  });

  it("sends verifier responseSchema for verifier calls", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      findings: [],
                      transformations: [],
                      criticalFailure: false,
                      readiness: "PLANNABLE",
                      ambiguityClass: "A1",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await model.generateStructured({
      modelId: "intent-verifier",
      promptVersion: "v1",
      schemaId: "verifier.result.v1",
      schemaVersion: "1",
      schema: VerifierModelOutputSchema,
      systemInstruction: "verify",
      userPayload: {},
      requestId: "r-verifier-schema",
    });

    const body = parseBody(fetchMock.mock.calls[0]?.[1] as RequestInit);
    const generationConfig = body.generationConfig as Record<string, unknown>;
    expect(generationConfig.responseMimeType).toBe("application/json");
    const responseSchema = generationConfig.responseSchema as Record<
      string,
      unknown
    >;
    for (const field of [
      "findings",
      "transformations",
      "criticalFailure",
      "readiness",
      "ambiguityClass",
    ]) {
      expect(vertexObjectRequiredFields(responseSchema)).toContain(field);
    }
  });

  it("maps invalid structured output to retryable MODEL_OUTPUT_INVALID", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"schemaVersion":"invented"}' }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await model.generateStructured({
      modelId: "intent-compiler",
      promptVersion: "v1",
      schemaId: "compiler.candidate.v1",
      schemaVersion: "1",
      schema: CompilerModelOutputSchema,
      systemInstruction: "compile",
      userPayload: {},
      requestId: "r-invalid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MODEL_OUTPUT_INVALID);
      expect(result.details?.retryable).toBe(true);
    }
  });
});

function collectingTelemetry(): {
  readonly port: ModelTelemetryPort;
  readonly events: ModelCallTelemetryEvent[];
} {
  const events: ModelCallTelemetryEvent[] = [];
  return {
    events,
    port: {
      record: (event) => {
        events.push(event);
      },
    },
  };
}

describe("VertexGeminiModel telemetry", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  const baseRequest = {
    modelId: "gemini-3.7-flash",
    promptVersion: "v1",
    schemaId: "sample",
    schemaVersion: "1",
    schema: SampleSchema,
    systemInstruction: "test",
    userPayload: {},
  };

  it("records SUCCESS with usage on a successful call", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] } }],
          modelVersion: "gemini-3.7-flash-001",
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
        }),
        { status: 200 },
      ),
    );

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-success",
      workflowId: "wf-1",
      intentId: "intent-1",
    });

    expect(result.ok).toBe(true);
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]).toMatchObject({
      status: "SUCCESS",
      requestId: "r-success",
      schemaId: "sample",
      workflowId: "wf-1",
      intentId: "intent-1",
      inputTokens: 5,
      outputTokens: 7,
      modelVersion: "gemini-3.7-flash-001",
    });
  });

  it("records MODEL_UNAVAILABLE when no access token is available", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => undefined },
      telemetry.port,
    );

    await model.generateStructured({ ...baseRequest, requestId: "r-no-token" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("MODEL_UNAVAILABLE");
    expect(telemetry.events[0]?.errorCode).toBe(ErrorCode.MODEL_UNAVAILABLE);
  });

  it("records MODEL_UNAVAILABLE when the Zod schema cannot be converted", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );

    await model.generateStructured({
      ...baseRequest,
      schema: z.string(),
      requestId: "r-schema-throw",
    });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("MODEL_UNAVAILABLE");
  });

  it("records MODEL_UNAVAILABLE when the fetch call throws", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await model.generateStructured({ ...baseRequest, requestId: "r-fetch-throw" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("MODEL_UNAVAILABLE");
    expect(telemetry.events[0]?.errorMessage).toBe("network down");
  });

  it("records MODEL_UNAVAILABLE with httpStatus on a non-2xx response", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 503 }),
    );

    await model.generateStructured({ ...baseRequest, requestId: "r-http-503" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("MODEL_UNAVAILABLE");
    expect(telemetry.events[0]?.httpStatus).toBe(503);
  });

  it("records OUTPUT_INVALID on an empty structured response", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    await model.generateStructured({ ...baseRequest, requestId: "r-empty" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("OUTPUT_INVALID");
  });

  it("records SCHEMA_PARSE_FAILED on invalid JSON text", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "not json" }] } }],
        }),
        { status: 200 },
      ),
    );

    await model.generateStructured({ ...baseRequest, requestId: "r-bad-json" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("SCHEMA_PARSE_FAILED");
  });

  it("records OUTPUT_INVALID when structured output fails schema validation", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"wrong":"shape"}' }] } }],
        }),
        { status: 200 },
      ),
    );

    await model.generateStructured({ ...baseRequest, requestId: "r-bad-shape" });

    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("OUTPUT_INVALID");
  });

  it("is fail-open: a throwing ModelTelemetryPort never fails generateStructured", async () => {
    const throwingTelemetry: ModelTelemetryPort = {
      record: () => {
        throw new Error("telemetry sink is down");
      },
    };
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
      throwingTelemetry,
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] } }],
        }),
        { status: 200 },
      ),
    );

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-telemetry-throws",
    });

    expect(result.ok).toBe(true);
  });

  it("is fail-open: a rejecting ModelTelemetryPort never fails a failure path", async () => {
    const rejectingTelemetry: ModelTelemetryPort = {
      record: () => Promise.reject(new Error("telemetry sink is down")),
    };
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => undefined },
      rejectingTelemetry,
    );

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-telemetry-rejects",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
    }
  });

  it("retries on HTTP 429 then records SUCCESS with retryCount", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      {
        project: "p",
        location: "global",
        model: "gemini-3.7-flash",
        maxRateLimitRetries: 2,
        rateLimitBackoffMs: 1,
      },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
          { status: 200 },
        ),
      );

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-429-retry-ok",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("SUCCESS");
    expect(telemetry.events[0]?.retryCount).toBe(1);
  });

  it("logs attempt timing and retry metadata without model content", async () => {
    delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash", maxRateLimitRetries: 1, rateLimitBackoffMs: 1 },
      { getAccessToken: async () => "t" },
    );
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"private-response"}' }] } }] }), { status: 200 }));

    const result = await model.generateStructured({
      modelId: "gemini-3.7-flash", promptVersion: "v1", schemaId: "sample",
      schemaVersion: "1", schema: SampleSchema, systemInstruction: "private-prompt",
      userPayload: { secret: "private-payload" }, requestId: "r-safe-attempt-log",
    });

    expect(result.ok).toBe(true);
    const logs = [...info.mock.calls, ...warn.mock.calls].flat().join("\n");
    expect(logs).toContain('"requestId":"r-safe-attempt-log"');
    expect(logs).toContain('"httpStatus":429');
    expect(logs).toContain('"retryDelayMs":1');
    expect(logs).not.toContain("private-prompt");
    expect(logs).not.toContain("private-payload");
    expect(logs).not.toContain("private-response");
  });

  it("records RATE_LIMITED when 429 retries are exhausted", async () => {
    const telemetry = collectingTelemetry();
    const model = new VertexGeminiModel(
      {
        project: "p",
        location: "global",
        model: "gemini-3.7-flash",
        maxRateLimitRetries: 2,
        rateLimitBackoffMs: 1,
      },
      { getAccessToken: async () => "t" },
      telemetry.port,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-429-exhausted",
    });

    expect(result.ok).toBe(false);
    // Initial attempt + 2 retries = 3 fetch calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(telemetry.events).toHaveLength(1);
    expect(telemetry.events[0]?.status).toBe("RATE_LIMITED");
    expect(telemetry.events[0]?.httpStatus).toBe(429);
    expect(telemetry.events[0]?.retryCount).toBe(2);
  });

  it("aborts a slow provider attempt at the internal model deadline", async () => {
    const model = new VertexGeminiModel(
      { project: "p", location: "global", model: "gemini-3.7-flash" },
      { getAccessToken: async () => "t" },
    );
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );

    const result = await model.generateStructured({
      ...baseRequest,
      requestId: "r-budget-timeout",
      deadlineAtMs: Date.now() + 50,
      attemptTimeoutMs: 10,
      maxAttempts: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
      expect(result.details?.reason).toBe("MODEL_DEADLINE_EXCEEDED");
    }
  });
});
