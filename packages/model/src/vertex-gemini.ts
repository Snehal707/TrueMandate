import { randomUUID } from "node:crypto";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import {
  PROTOCOL_VERSION,
  type ModelCallStatus,
  type ModelCallTelemetryEvent,
  type ModelPort,
  type ModelTelemetryPort,
  type StructuredGenerateRequest,
  type StructuredGenerateSuccess,
} from "./types.js";
import { zodToVertexResponseSchema } from "./vertex-response-schema.js";

export interface VertexGeminiConfig {
  readonly project: string;
  readonly location: string;
  readonly model: string;
  /** Max additional attempts after an HTTP 429 (default 2). */
  readonly maxRateLimitRetries?: number;
  /** Base backoff in ms between 429 retries (default 200); doubles each attempt. */
  readonly rateLimitBackoffMs?: number;
}

const DEFAULT_MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Injectable token source for tests and ADC resolution. */
export interface TokenProvider {
  getAccessToken(): Promise<string | undefined>;
}

async function resolveAdcAccessToken(): Promise<string | undefined> {
  try {
    const mod = await import("google-auth-library");
    const GoogleAuth =
      "GoogleAuth" in mod
        ? (mod as { GoogleAuth: new (opts?: { scopes?: string[] }) => GoogleAuthLike }).GoogleAuth
        : undefined;
    if (!GoogleAuth) return undefined;
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token ?? undefined;
  } catch {
    return undefined;
  }
}

interface GoogleAuthLike {
  getClient(): Promise<{ getAccessToken(): Promise<{ token?: string | null }> }>;
}

interface VertexPart {
  readonly text?: string;
  readonly thought?: boolean;
}

export function vertexGenerateContentUrl(
  project: string,
  location: string,
  model: string,
): string {
  if (location === "global") {
    return (
      `https://aiplatform.googleapis.com/v1/projects/${project}/` +
      `locations/global/publishers/google/models/${model}:generateContent`
    );
  }
  return (
    `https://${location}-aiplatform.googleapis.com/v1/` +
    `projects/${project}/locations/${location}/` +
    `publishers/google/models/${model}:generateContent`
  );
}

/** Collect JSON text from all non-thought parts. Do not assume parts[0].text. */
export function extractStructuredTextFromParts(
  parts: readonly VertexPart[] | undefined,
): string | undefined {
  if (!parts?.length) return undefined;
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === "string" && part.text.trim()) {
      chunks.push(part.text);
    }
  }
  const joined = chunks.join("").trim();
  return joined.length > 0 ? joined : undefined;
}

function modelOutputInvalid(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Result<never> {
  return err(ErrorCode.MODEL_OUTPUT_INVALID, message, {
    retryable: true,
    ...details,
  });
}

/**
 * Env-gated Vertex Gemini adapter.
 * Default model: gemini-3.7-flash. Default location: global (model is not
 * served from us-central1).
 */
export class VertexGeminiModel implements ModelPort {
  constructor(
    private readonly config: VertexGeminiConfig,
    private readonly tokenProvider?: TokenProvider,
    private readonly telemetry?: ModelTelemetryPort,
  ) {}

  static fromEnv(
    tokenProvider?: TokenProvider,
    telemetry?: ModelTelemetryPort,
  ): Result<VertexGeminiModel> {
    const project = process.env.VERTEX_PROJECT;
    if (!project) {
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        "VERTEX_PROJECT not set; Vertex Gemini adapter inactive",
      );
    }
    return ok(
      new VertexGeminiModel(
        {
          project,
          location: process.env.VERTEX_LOCATION ?? "global",
          model: process.env.GEMINI_MODEL ?? "gemini-3.7-flash",
        },
        tokenProvider,
        telemetry,
      ),
    );
  }

  /**
   * Fail-open, best-effort telemetry emission. A telemetry write must never
   * throw into or delay the generateStructured() result — every call site
   * awaits this so events are recorded in order, but this method itself
   * swallows all errors.
   */
  private async recordTelemetry(
    request: StructuredGenerateRequest<unknown>,
    started: number,
    status: ModelCallStatus,
    extra?: Partial<
      Pick<
        ModelCallTelemetryEvent,
        | "httpStatus"
        | "inputTokens"
        | "outputTokens"
        | "errorCode"
        | "errorMessage"
        | "modelVersion"
        | "retryCount"
      >
    >,
  ): Promise<void> {
    if (!this.telemetry) return;
    try {
      await this.telemetry.record({
        id: randomUUID(),
        service: "vertex-gemini",
        operation: "generateStructured",
        schemaId: request.schemaId,
        modelId: request.modelId || this.config.model,
        promptVersion: request.promptVersion,
        workflowId: request.workflowId,
        intentId: request.intentId,
        status,
        latencyMs: Date.now() - started,
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
        retryCount: extra?.retryCount ?? 0,
        ...extra,
      });
    } catch {
      // Fail-open: telemetry must never affect the model call result.
    }
  }

  get endpoint(): string {
    return vertexGenerateContentUrl(
      this.config.project,
      this.config.location,
      this.config.model,
    );
  }

  get modelId(): string {
    return this.config.model;
  }

  get location(): string {
    return this.config.location;
  }

  private async resolveAccessToken(): Promise<string | undefined> {
    const envToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    if (envToken) return envToken;
    if (this.tokenProvider) {
      return this.tokenProvider.getAccessToken();
    }
    return resolveAdcAccessToken();
  }

  async generateStructured<T>(
    request: StructuredGenerateRequest<T>,
  ): Promise<Result<StructuredGenerateSuccess<T>>> {
    const started = Date.now();
    const endpoint = this.endpoint;

    const accessToken = await this.resolveAccessToken();
    if (!accessToken) {
      const message =
        "No access token available for VertexGeminiModel (env, TokenProvider, or ADC)";
      await this.recordTelemetry(request, started, "MODEL_UNAVAILABLE", {
        errorCode: ErrorCode.MODEL_UNAVAILABLE,
        errorMessage: message,
      });
      return err(ErrorCode.MODEL_UNAVAILABLE, message);
    }

    let responseSchema: Record<string, unknown>;
    let strippedKeywords: readonly string[];
    try {
      const converted = zodToVertexResponseSchema(
        request.schema,
        request.schemaId,
      );
      responseSchema = converted.responseSchema;
      strippedKeywords = converted.strippedKeywords;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Failed to derive Vertex responseSchema from Zod";
      await this.recordTelemetry(request, started, "MODEL_UNAVAILABLE", {
        errorCode: ErrorCode.MODEL_UNAVAILABLE,
        errorMessage: message,
      });
      return err(ErrorCode.MODEL_UNAVAILABLE, message, {
        schemaId: request.schemaId,
      });
    }

    let response: Response;
    let retryCount = 0;
    const maxRetries =
      this.config.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    const backoffBase =
      this.config.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
    const requestBody = JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `${request.systemInstruction}\n\n` +
                `Return JSON only that conforms to the response schema.\n\n` +
                JSON.stringify(request.userPayload),
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0,
      },
    });

    // Bounded 429 retry loop. Non-429 failures exit immediately.
    for (;;) {
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: requestBody,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Vertex fetch failed";
        await this.recordTelemetry(request, started, "MODEL_UNAVAILABLE", {
          errorCode: ErrorCode.MODEL_UNAVAILABLE,
          errorMessage: message,
          retryCount,
        });
        return err(ErrorCode.MODEL_UNAVAILABLE, message);
      }

      if (response.ok) break;

      if (response.status === 429 && retryCount < maxRetries) {
        const delay = backoffBase * 2 ** retryCount;
        retryCount += 1;
        await sleep(delay);
        continue;
      }

      if (response.status === 429) {
        const message = `Vertex HTTP 429 (rate limited after ${retryCount} retries)`;
        await this.recordTelemetry(request, started, "RATE_LIMITED", {
          httpStatus: 429,
          errorCode: ErrorCode.MODEL_UNAVAILABLE,
          errorMessage: message,
          retryCount,
        });
        return err(ErrorCode.MODEL_UNAVAILABLE, message, {
          status: 429,
          retryCount,
          location: this.config.location,
          model: this.config.model,
        });
      }

      const message = `Vertex HTTP ${response.status}`;
      await this.recordTelemetry(request, started, "MODEL_UNAVAILABLE", {
        httpStatus: response.status,
        errorCode: ErrorCode.MODEL_UNAVAILABLE,
        errorMessage: message,
        retryCount,
      });
      return err(ErrorCode.MODEL_UNAVAILABLE, message, {
        status: response.status,
        location: this.config.location,
        model: this.config.model,
      });
    }

    const body = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: VertexPart[] };
      }>;
      modelVersion?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = extractStructuredTextFromParts(body.candidates?.[0]?.content?.parts);
    if (!text) {
      const message = "Empty Vertex structured response";
      await this.recordTelemetry(request, started, "OUTPUT_INVALID", {
        modelVersion: body.modelVersion,
        errorCode: ErrorCode.MODEL_OUTPUT_INVALID,
        errorMessage: message,
        retryCount,
      });
      return modelOutputInvalid(message, { schemaId: request.schemaId });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      const message = "Vertex response was not valid JSON";
      await this.recordTelemetry(request, started, "SCHEMA_PARSE_FAILED", {
        modelVersion: body.modelVersion,
        errorCode: ErrorCode.SCHEMA_PARSE_FAILED,
        errorMessage: message,
        retryCount,
      });
      return err(ErrorCode.SCHEMA_PARSE_FAILED, message, {
        schemaId: request.schemaId,
      });
    }

    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      const message = "Vertex structured output failed schema validation";
      await this.recordTelemetry(request, started, "OUTPUT_INVALID", {
        modelVersion: body.modelVersion,
        errorCode: ErrorCode.MODEL_OUTPUT_INVALID,
        errorMessage: message,
        retryCount,
      });
      return modelOutputInvalid(message, {
        schemaId: request.schemaId,
        issues: parsed.error.issues,
      });
    }

    await this.recordTelemetry(request, started, "SUCCESS", {
      modelVersion: body.modelVersion,
      inputTokens: body.usageMetadata?.promptTokenCount,
      outputTokens: body.usageMetadata?.candidatesTokenCount,
      retryCount,
    });

    return ok({
      value: parsed.data,
      modelId: request.modelId || this.config.model,
      modelVersion: body.modelVersion,
      promptVersion: request.promptVersion,
      schemaId: request.schemaId,
      schemaVersion: request.schemaVersion,
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount,
        outputTokens: body.usageMetadata?.candidatesTokenCount,
      },
      providerMetadata: {
        provider: "vertex-gemini",
        location: this.config.location,
        strippedKeywords: [...strippedKeywords],
      },
      timestamp: new Date().toISOString(),
    });
  }
}
