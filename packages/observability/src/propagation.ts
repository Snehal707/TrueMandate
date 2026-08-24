import {
  context,
  propagation,
  trace,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";

const TRACER_NAME = "@truemandate/observability";

/** A minimal HTTP-headers-shaped carrier, compatible with Node's IncomingHttpHeaders and plain outbound header records. */
export type HeaderCarrier = Record<string, string | string[] | undefined>;

/** Extracts an OTel Context (parent span link) from inbound request headers carrying a W3C `traceparent`. Fail-open: returns `base` unchanged on any error. */
export function extractContext(
  headers: HeaderCarrier,
  base: Context = ROOT_CONTEXT,
): Context {
  try {
    return propagation.extract(base, headers);
  } catch {
    return base;
  }
}

/** Injects the given (or active) trace context's W3C `traceparent`/`tracestate` into outbound headers, mutating in place. Fail-open: never throws. */
export function injectTraceParent(
  headers: Record<string, string>,
  ctx: Context = context.active(),
): void {
  try {
    propagation.inject(ctx, headers);
  } catch {
    // Telemetry propagation must never block or fail the outbound call.
  }
}

/** Convenience: reads just the raw `traceparent` header string for a context, e.g. to stamp onto a Pub/Sub envelope or a telemetry record. */
export function currentTraceParent(ctx: Context = context.active()): string | undefined {
  const carrier: Record<string, string> = {};
  injectTraceParent(carrier, ctx);
  return carrier["traceparent"];
}

export interface TraceIds {
  readonly traceId?: string;
  readonly spanId?: string;
}

/** Reads the traceId/spanId of the current (or given) span context, for stamping onto telemetry/log records. */
export function currentTraceIds(ctx: Context = context.active()): TraceIds {
  try {
    const spanContext = trace.getSpanContext(ctx);
    if (!spanContext) return {};
    return { traceId: spanContext.traceId, spanId: spanContext.spanId };
  } catch {
    return {};
  }
}

/**
 * Runs `fn` inside a new active span named `name`. The span is always ended
 * and its status reflects whether `fn` threw.
 *
 * Fail-open for the *tracing machinery itself*: if span creation/ending
 * throws, `fn` still runs and its result/error still propagates normally.
 * This does NOT swallow errors thrown by `fn` — those are real business
 * errors and must propagate.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span | undefined) => Promise<T> | T,
  parentContext: Context = context.active(),
): Promise<T> {
  let span: Span | undefined;
  try {
    span = trace
      .getTracer(TRACER_NAME)
      .startSpan(name, { kind: SpanKind.INTERNAL, attributes: attrs }, parentContext);
  } catch {
    span = undefined;
  }

  const runContext = span ? trace.setSpan(parentContext, span) : parentContext;

  try {
    const result = await context.with(runContext, () => fn(span));
    safeEnd(span, undefined);
    return result;
  } catch (error) {
    safeEnd(span, error);
    throw error;
  }
}

function safeEnd(span: Span | undefined, error: unknown): void {
  if (!span) return;
  try {
    if (error !== undefined) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  } catch {
    // Ending/annotating a span must never throw into calling code.
  }
}

/**
 * Extracts a parent context from inbound headers and starts a new SERVER
 * span linked to it. Intended for use at the single shared inbound choke
 * point (createCloudRunHttpServer). Fail-open: returns `span: undefined`
 * on any tracing failure while still returning a usable context.
 */
export function extractOrStartSpan(
  name: string,
  headers: HeaderCarrier,
  attrs: Attributes = {},
): { readonly span: Span | undefined; readonly context: Context } {
  const parentContext = extractContext(headers);
  let span: Span | undefined;
  try {
    span = trace
      .getTracer(TRACER_NAME)
      .startSpan(name, { kind: SpanKind.SERVER, attributes: attrs }, parentContext);
  } catch {
    span = undefined;
  }
  const activeContext = span ? trace.setSpan(parentContext, span) : parentContext;
  return { span, context: activeContext };
}

/** Ends a span started via extractOrStartSpan, recording status/error. Fail-open. */
export function endSpan(span: Span | undefined, error?: unknown): void {
  safeEnd(span, error);
}

/** Sets a single attribute on a possibly-undefined span. Fail-open: never throws. */
export function setSpanAttribute(
  span: Span | undefined,
  key: string,
  value: string | number | boolean,
): void {
  try {
    span?.setAttribute(key, value);
  } catch {
    // Span annotation must never affect the caller.
  }
}
