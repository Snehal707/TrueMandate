import { beforeAll, describe, expect, it } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import {
  currentTraceIds,
  currentTraceParent,
  endSpan,
  extractContext,
  extractOrStartSpan,
  injectTraceParent,
  withSpan,
} from "./propagation.js";

// Production wiring registers these globally via initTracing() (NodeSDK).
// Tests register a lightweight equivalent so extract/inject/startSpan
// exercise real W3C trace-context behavior instead of API no-ops.
beforeAll(() => {
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new BasicTracerProvider());
});

describe("propagation extract/inject round-trip", () => {
  it("extracts a traceparent header into a context and re-injects an equivalent traceparent", () => {
    const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const extracted = extractContext({ traceparent });
    const reinjected: Record<string, string> = {};
    injectTraceParent(reinjected, extracted);
    expect(reinjected.traceparent).toBeDefined();
    expect(reinjected.traceparent).toContain("0af7651916cd43dd8448eb211c80319c");
  });

  it("returns the base context unchanged when headers carry no traceparent", () => {
    const base = context.active();
    const result = extractContext({});
    expect(result).toBe(base);
  });

  it("currentTraceParent returns undefined outside of any span", () => {
    expect(currentTraceParent(context.active())).toBeUndefined();
  });

  it("extractOrStartSpan links a new span to the inbound traceparent's trace id", () => {
    const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const { span, context: activeContext } = extractOrStartSpan("test span", { traceparent });
    const ids = currentTraceIds(activeContext);
    expect(ids.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    endSpan(span);
  });
});

describe("withSpan fail-open behavior", () => {
  it("propagates the return value of fn on success", async () => {
    const result = await withSpan("op", {}, () => 42);
    expect(result).toBe(42);
  });

  it("propagates errors thrown by fn (business errors are not swallowed)", async () => {
    await expect(
      withSpan("op", {}, () => {
        throw new Error("business failure");
      }),
    ).rejects.toThrow("business failure");
  });

  it("still runs fn and returns its result even if span creation fails", async () => {
    const tracer = trace.getTracer("@truemandate/observability");
    const originalStartSpan = tracer.startSpan;
    // Simulate the tracing machinery itself throwing; fn must still run.
    tracer.startSpan = () => {
      throw new Error("simulated span creation failure");
    };
    try {
      const result = await withSpan("op", {}, () => "ok");
      expect(result).toBe("ok");
    } finally {
      tracer.startSpan = originalStartSpan;
    }
  });
});
