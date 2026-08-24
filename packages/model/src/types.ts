import type { Result } from "@truemandate/protocol";
import type { z } from "zod";

export const PROTOCOL_VERSION = "0.1.0";

export interface StructuredGenerateRequest<T = unknown> {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly schema: z.ZodType<T>;
  readonly systemInstruction: string;
  readonly userPayload: unknown;
  readonly requestId: string;
  /** Optional workflow/intent correlation, forwarded into telemetry when present. */
  readonly workflowId?: string;
  readonly intentId?: string;
}

/**
 * Duplicated locally (rather than depending on @truemandate/observability)
 * per AGENTS.md: model-provider packages must stay independent of the
 * observability/protocol trusted-core stack. Structurally identical to
 * @truemandate/observability's ModelTelemetryPort/ModelCallTelemetryEvent.
 */
export type ModelCallStatus =
  | "SUCCESS"
  | "MODEL_UNAVAILABLE"
  | "OUTPUT_INVALID"
  | "SCHEMA_PARSE_FAILED"
  | "RATE_LIMITED"
  | "OTHER_ERROR";

export interface ModelCallTelemetryEvent {
  readonly id: string;
  readonly service: string;
  readonly operation: string;
  readonly schemaId?: string;
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  readonly workflowId?: string;
  readonly intentId?: string;
  readonly status: ModelCallStatus;
  readonly httpStatus?: number;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Number of 429 retries attempted before this terminal status (0 = no retry). */
  readonly retryCount?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly requestId: string;
  readonly timestamp: string;
}

/**
 * Best-effort telemetry sink. Implementations (e.g. the Firestore-backed
 * store in @truemandate/observability, wired at the composition root) must
 * never let a `record` failure propagate — callers here still wrap every
 * invocation in try/catch as defense in depth.
 */
export interface ModelTelemetryPort {
  record(event: ModelCallTelemetryEvent): Promise<void> | void;
}

export interface StructuredGenerateSuccess<T> {
  readonly value: T;
  readonly modelId: string;
  readonly modelVersion?: string;
  readonly promptVersion: string;
  readonly schemaId: string;
  readonly schemaVersion: string;
  readonly protocolVersion: string;
  readonly requestId: string;
  readonly latencyMs: number;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly providerMetadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}

export interface ModelPort {
  generateStructured<T>(
    request: StructuredGenerateRequest<T>,
  ): Promise<Result<StructuredGenerateSuccess<T>>>;
}
