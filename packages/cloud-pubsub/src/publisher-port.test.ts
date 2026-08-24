import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope.js";
import {
  MemoryPubSubPublisherPort,
  NoopPubSubPublisherPort,
} from "./publisher-port.js";
import { PubSubTopics } from "./topics.js";

function sampleEnvelope() {
  return createEnvelope({
    eventId: "ev-1",
    type: "AUTHORITY_DECISION",
    aggregateId: "agg-1",
    aggregateVersion: 1,
    causationId: "c-1",
    correlationId: "corr-1",
    actorService: "test",
    payloadHash: "h1",
    idempotencyKey: "idem-1",
    provenanceRefs: [],
    payload: { decision: "ALLOW" },
  });
}

describe("PubSubPublisherPort", () => {
  it("Noop always succeeds without side effects", async () => {
    const port = new NoopPubSubPublisherPort();
    const result = await port.publish(PubSubTopics.AUTHORITY, sampleEnvelope());
    expect(result.ok).toBe(true);
  });

  it("Memory records published envelopes", async () => {
    const port = new MemoryPubSubPublisherPort();
    const envelope = sampleEnvelope();
    const result = await port.publish(PubSubTopics.AUTHORITY, envelope);
    expect(result.ok).toBe(true);
    expect(port.published).toHaveLength(1);
    expect(port.published[0]?.topic).toBe(PubSubTopics.AUTHORITY);
    expect(port.published[0]?.envelope.payload).toEqual({ decision: "ALLOW" });
  });

  it("Memory can soft-fail without throwing", async () => {
    const port = new MemoryPubSubPublisherPort();
    port.setFailPublishes(true);
    const result = await port.publish(PubSubTopics.AUTHORITY, sampleEnvelope());
    expect(result.ok).toBe(false);
    expect(port.published).toHaveLength(0);
  });
});
