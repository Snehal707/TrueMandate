import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import {
  PROTOCOL_VERSION,
  type ModelPort,
  type StructuredGenerateRequest,
  type StructuredGenerateSuccess,
} from "./types.js";

export type FakeModelHandler = (
  request: StructuredGenerateRequest<unknown>,
) => unknown | Promise<unknown>;

export interface FakeModelOptions {
  readonly unavailable?: boolean;
  readonly handlers?: Readonly<Record<string, FakeModelHandler>>;
  readonly defaultHandler?: FakeModelHandler;
  readonly modelVersion?: string;
}

/**
 * Deterministic model for tests. Never calls Vertex AI.
 */
export class FakeModel implements ModelPort {
  private readonly handlers: Map<string, FakeModelHandler>;
  private readonly unavailable: boolean;
  private readonly defaultHandler?: FakeModelHandler;
  private readonly modelVersion?: string;
  private _generationCount = 0;

  constructor(options: FakeModelOptions = {}) {
    this.handlers = new Map(Object.entries(options.handlers ?? {}));
    this.unavailable = options.unavailable ?? false;
    this.defaultHandler = options.defaultHandler;
    this.modelVersion = options.modelVersion;
  }

  get generationCount(): number {
    return this._generationCount;
  }

  setHandler(schemaId: string, handler: FakeModelHandler): void {
    this.handlers.set(schemaId, handler);
  }

  async generateStructured<T>(
    request: StructuredGenerateRequest<T>,
  ): Promise<Result<StructuredGenerateSuccess<T>>> {
    const started = Date.now();
    this._generationCount += 1;
    if (this.unavailable) {
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        "Model unavailable; fail closed for authoritative verification",
        { requestId: request.requestId, schemaId: request.schemaId },
      );
    }

    const handler =
      this.handlers.get(request.schemaId) ?? this.defaultHandler;
    if (!handler) {
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        `No FakeModel handler for schemaId=${request.schemaId}`,
        { schemaId: request.schemaId },
      );
    }

    let raw: unknown;
    try {
      raw = await handler(request as StructuredGenerateRequest<unknown>);
    } catch (e) {
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        e instanceof Error ? e.message : "FakeModel handler failed",
      );
    }

    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      return err(
        ErrorCode.MODEL_OUTPUT_INVALID,
        "Model structured output failed schema validation",
        {
          retryable: true,
          schemaId: request.schemaId,
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      );
    }

    const timestamp = new Date().toISOString();
    return ok({
      value: parsed.data,
      modelId: request.modelId,
      modelVersion: this.modelVersion ?? "fake-1.0",
      promptVersion: request.promptVersion,
      schemaId: request.schemaId,
      schemaVersion: request.schemaVersion,
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      latencyMs: Date.now() - started,
      usage: { inputTokens: 10, outputTokens: 20 },
      providerMetadata: { provider: "fake" },
      timestamp,
    });
  }
}
