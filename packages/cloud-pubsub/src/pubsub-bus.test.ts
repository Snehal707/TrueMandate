import { ErrorCode, err } from "@truemandate/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { extractContext, currentTraceIds } from "@truemandate/observability";
import { createEnvelope } from "./envelope.js";
import { InMemoryPubSubBus } from "./in-memory-bus.js";
import { PubSubTopics } from "./topics.js";

function sampleEnvelope(
  overrides: Partial<ReturnType<typeof createEnvelope>> & {
    aggregateId?: string;
    aggregateVersion?: number;
    idempotencyKey?: string;
  } = {},
) {
  return createEnvelope({
    eventId: overrides.eventId ?? "evt-1",
    type: overrides.type ?? "test.event",
    aggregateId: overrides.aggregateId ?? "agg-1",
    aggregateVersion: overrides.aggregateVersion ?? 1,
    causationId: overrides.causationId ?? "cause-1",
    correlationId: overrides.correlationId ?? "corr-1",
    actorService: overrides.actorService ?? "test-service",
    payloadHash: overrides.payloadHash ?? "hash-1",
    idempotencyKey: overrides.idempotencyKey ?? "idem-1",
    provenanceRefs: overrides.provenanceRefs ?? [],
    payload: overrides.payload ?? { value: 1 },
    ...overrides,
  });
}

describe("InMemoryPubSubBus", () => {
  it("dedupes duplicate delivery by idempotencyKey", async () => {
    const bus = new InMemoryPubSubBus();
    let deliveries = 0;
    bus.subscribe(PubSubTopics.INTENT, () => {
      deliveries += 1;
    });

    const envelope = sampleEnvelope({ idempotencyKey: "dup-key" });
    expect((await bus.publish(PubSubTopics.INTENT, envelope)).ok).toBe(true);
    expect((await bus.publish(PubSubTopics.INTENT, envelope)).ok).toBe(true);

    expect(deliveries).toBe(1);
    expect(bus.publishRejections.some((r) => r.reason === "DUPLICATE")).toBe(true);
  });

  it("rejects out-of-order aggregate versions", async () => {
    const bus = new InMemoryPubSubBus();
    let deliveries = 0;
    bus.subscribe(PubSubTopics.PLAN, () => {
      deliveries += 1;
    });

    const v2 = sampleEnvelope({
      aggregateId: "plan-1",
      aggregateVersion: 2,
      idempotencyKey: "idem-v2",
      eventId: "evt-v2",
    });
    const v1 = sampleEnvelope({
      aggregateId: "plan-1",
      aggregateVersion: 1,
      idempotencyKey: "idem-v1",
      eventId: "evt-v1",
    });

    expect((await bus.publish(PubSubTopics.PLAN, v2)).ok).toBe(true);
    const rejected = await bus.publish(PubSubTopics.PLAN, v1);
    expect(rejected.ok).toBe(false);
    expect(deliveries).toBe(1);
    expect(bus.publishRejections.some((r) => r.reason === "OUT_OF_ORDER")).toBe(true);
  });

  it("routes failed security-critical handlers to DLQ", async () => {
    const bus = new InMemoryPubSubBus();
    bus.subscribe(
      PubSubTopics.SECURITY,
      () => {
        throw new Error("handler exploded");
      },
      { securityCritical: true },
    );

    const envelope = sampleEnvelope({
      idempotencyKey: "sec-1",
      eventId: "sec-evt",
    });
    const result = await bus.publish(PubSubTopics.SECURITY, envelope);
    expect(result.ok).toBe(true);
    expect(bus.dlq).toHaveLength(1);
    expect(bus.dlq[0]?.eventId).toBe("sec-evt");
  });

  it("does not consume idempotency when a handler throws", async () => {
    const bus = new InMemoryPubSubBus();
    let deliveries = 0;
    bus.subscribe(PubSubTopics.INTENT, () => {
      deliveries += 1;
      throw new Error("owner S2S failed");
    });

    const envelope = sampleEnvelope({ idempotencyKey: "retry-key" });
    const first = await bus.publish(PubSubTopics.INTENT, envelope);
    expect(first.ok).toBe(false);
    expect(deliveries).toBe(1);

    const second = await bus.publish(PubSubTopics.INTENT, envelope);
    expect(second.ok).toBe(false);
    expect(deliveries).toBe(2);
  });

  it("does not consume idempotency when a handler returns a structured err", async () => {
    const bus = new InMemoryPubSubBus();
    let deliveries = 0;
    bus.subscribe(PubSubTopics.INTENT, () => {
      deliveries += 1;
      return err(ErrorCode.MODEL_UNAVAILABLE, "Vertex unavailable", {
        retryable: true,
      });
    });

    const envelope = sampleEnvelope({ idempotencyKey: "model-retry" });
    const first = await bus.publish(PubSubTopics.INTENT, envelope);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("MODEL_UNAVAILABLE");

    const second = await bus.publish(PubSubTopics.INTENT, envelope);
    expect(second.ok).toBe(false);
    expect(deliveries).toBe(2);
  });

  it("ACKs duplicates after success without re-running the handler", async () => {
    const bus = new InMemoryPubSubBus();
    let deliveries = 0;
    bus.subscribe(PubSubTopics.INTENT, () => {
      deliveries += 1;
    });

    const envelope = sampleEnvelope({ idempotencyKey: "success-key" });
    expect((await bus.publish(PubSubTopics.INTENT, envelope)).ok).toBe(true);
    expect((await bus.publish(PubSubTopics.INTENT, envelope)).ok).toBe(true);
    expect(deliveries).toBe(1);
  });
});

describe("InMemoryPubSubBus trace propagation", () => {
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(new BasicTracerProvider());
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  it("captures the active traceparent on createEnvelope and links the consumer's handler span to it", async () => {
    const inboundTraceparent =
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const inboundContext = extractContext({ traceparent: inboundTraceparent });

    const envelope = await context.with(inboundContext, async () =>
      sampleEnvelope({ idempotencyKey: "trace-key", eventId: "trace-evt" }),
    );
    expect(envelope.traceContext).toContain("0af7651916cd43dd8448eb211c80319c");

    let observedTraceId: string | undefined;
    const bus = new InMemoryPubSubBus();
    bus.subscribe(PubSubTopics.INTENT, () => {
      observedTraceId = currentTraceIds().traceId;
    });

    const result = await bus.publish(PubSubTopics.INTENT, envelope);
    expect(result.ok).toBe(true);
    expect(observedTraceId).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("does not set traceContext when there is no active trace", () => {
    const envelope = sampleEnvelope({ idempotencyKey: "no-trace-key", eventId: "no-trace-evt" });
    expect(envelope.traceContext).toBeUndefined();
  });
});
