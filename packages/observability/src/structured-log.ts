import { context, trace, type Context } from "@opentelemetry/api";

export type LogLevel = "info" | "warn" | "error";

export interface StructuredLogFields {
  readonly event: string;
  readonly service: string;
  readonly [key: string]: unknown;
}

/**
 * Emits a structured JSON log line stamped with Cloud Logging's trace/span
 * correlation fields (`logging.googleapis.com/trace`, `.../spanId`) when an
 * active OTel span exists, mirroring the `console.info(JSON.stringify(...))`
 * convention already used in packages/cloud-runtime/src/server.ts. This lets
 * Cloud Logging group log entries under the corresponding Cloud Trace trace
 * without any change to how logs are read elsewhere in the codebase.
 *
 * Fail-open: logging must never throw into calling code.
 */
export function logStructured(
  level: LogLevel,
  fields: StructuredLogFields,
  options: { readonly projectId?: string; readonly context?: Context } = {},
): void {
  try {
    const ctx = options.context ?? context.active();
    const spanContext = trace.getSpanContext(ctx);
    const projectId =
      options.projectId ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCP_PROJECT;

    const traceFields =
      spanContext && projectId
        ? {
            "logging.googleapis.com/trace": `projects/${projectId}/traces/${spanContext.traceId}`,
            "logging.googleapis.com/spanId": spanContext.spanId,
            "logging.googleapis.com/trace_sampled": (spanContext.traceFlags & 1) === 1,
          }
        : {};

    const line = JSON.stringify({ ...fields, ...traceFields });
    emit(level, line);
  } catch {
    try {
      emit(level, JSON.stringify(fields));
    } catch {
      // Logging must never throw into calling code.
    }
  }
}

function emit(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
