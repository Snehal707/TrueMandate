import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope.js";
import { decodePubSubPush, parseCloudEventEnvelope } from "./push-decode.js";
import { PubSubTopics } from "./topics.js";

function pushBody(envelope: unknown, subscription: string): unknown {
  return {
    message: {
      data: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
      messageId: "m-1",
    },
    subscription,
  };
}

describe("decodePubSubPush", () => {
  const envelope = createEnvelope({
    eventId: "evt-1",
    type: "intent.created",
    aggregateId: "agg-1",
    aggregateVersion: 1,
    causationId: "c-1",
    correlationId: "corr-1",
    actorService: "test",
    payloadHash: "h-1",
    idempotencyKey: "idem-1",
    provenanceRefs: [],
    payload: { n: 1 },
  });

  it("decodes a valid Pub/Sub push body", () => {
    const result = decodePubSubPush(
      pushBody(
        envelope,
        "projects/p/subscriptions/tm-dev-authority--intent.events-push",
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.topic).toBe(PubSubTopics.INTENT);
      expect(result.value.envelope.idempotencyKey).toBe("idem-1");
    }
  });

  it("rejects malformed JSON data", () => {
    const result = decodePubSubPush({
      message: { data: Buffer.from("not-json", "utf8").toString("base64") },
      subscription: "projects/p/subscriptions/tm-dev-authority--intent.events-push",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing envelope fields", () => {
    const result = parseCloudEventEnvelope({ eventId: "x" });
    expect(result.ok).toBe(false);
  });
});
