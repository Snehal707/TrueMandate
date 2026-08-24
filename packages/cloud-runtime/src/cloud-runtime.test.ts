import { createEnvelope, InMemoryPubSubBus, PubSubTopics } from "@truemandate/cloud-pubsub";
import { ErrorCode, err } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  loadRuntimeConfig,
  requireIntentProvenanceUrl,
  RuntimeConfigError,
} from "./config.js";
import { eventHttpStatus } from "./event-status.js";
import { createCloudRunHttpServer } from "./server.js";

function pushBody(envelope: unknown, subscription: string): string {
  return JSON.stringify({
    message: {
      data: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
      messageId: "m-1",
    },
    subscription,
  });
}

describe("cloud-runtime HTTP", () => {
  it("fail-closes when GOOGLE_CLOUD_PROJECT is missing", () => {
    expect(() =>
      loadRuntimeConfig({
        TM_REQUIRE_CONFIG: "true",
        TM_SERVICE_NAME: "gateway",
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("requireIntentProvenanceUrl fails closed when unset", () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "public-bff",
      GOOGLE_CLOUD_PROJECT: "test-proj",
    });
    expect(() => requireIntentProvenanceUrl(config)).toThrow(RuntimeConfigError);
  });

  it("serves /healthz and rejects malformed /internal/events", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "gateway",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_PERSISTENCE: "memory",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const bus = new InMemoryPubSubBus();
    let handled = 0;
    bus.subscribe(PubSubTopics.AUTHORITY, () => {
      handled += 1;
    });
    const http = createCloudRunHttpServer({
      config,
      bus,
      acceptedTopics: [PubSubTopics.AUTHORITY, PubSubTopics.OUTCOME],
      health: { ready: true },
      enableEvents: true,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(200);

    const bad = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(bad.status).toBe(400);

    const envelope = createEnvelope({
      eventId: "evt-1",
      type: "authority.granted",
      aggregateId: "agg-1",
      aggregateVersion: 2,
      causationId: "c",
      correlationId: "corr",
      actorService: "authority",
      payloadHash: "h",
      idempotencyKey: "idem-1",
      provenanceRefs: [],
      payload: { ok: true },
    });
    const sub = "projects/p/subscriptions/tm-dev-gateway--authority.events-push";
    const okRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(envelope, sub),
    });
    expect(okRes.status).toBe(200);

    const dup = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(envelope, sub),
    });
    expect(dup.status).toBe(200);
    expect(handled).toBe(1);

    const stale = createEnvelope({
      ...envelope,
      eventId: "evt-0",
      aggregateVersion: 1,
      idempotencyKey: "idem-stale",
    });
    const staleRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(stale, sub),
    });
    expect(staleRes.status).toBe(400);

    const missing = createEnvelope({
      ...envelope,
      eventId: "evt-missing",
      idempotencyKey: "idem-missing-fields",
    });
    const missingBody = JSON.stringify({
      message: {
        data: Buffer.from(
          JSON.stringify({ ...missing, eventId: "" }),
          "utf8",
        ).toString("base64"),
        messageId: "m-missing",
      },
      subscription: sub,
    });
    const missingRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: missingBody,
    });
    expect(missingRes.status).toBe(400);

    await http.close();
  });

  it("rejects push without Authorization when TM_REQUIRE_PUSH_AUTH=true", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "gateway",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_REQUIRE_PUSH_AUTH: "true",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const http = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [PubSubTopics.AUTHORITY],
      health: { ready: true },
      enableEvents: true,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    await http.close();
  });

  it("returns 404 for /internal/events when the service is not a push consumer", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "benchmark-runner",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const http = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
    await http.close();
  });

  it("keeps /healthz up while /readyz reflects a failed persistence probe", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "gateway",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_PERSISTENCE: "firestore",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const http = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: false, reason: "firestore_probe_failed" },
      readinessProbe: async () => ({
        ready: false,
        reason: "firestore_probe_failed",
      }),
      enableEvents: false,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(200);
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(ready.status).toBe(503);
    const body = (await ready.json()) as { reason?: string };
    expect(body.reason).toBe("firestore_probe_failed");
    await http.close();
  });

  it("maps owner S2S failure to 5xx and does not consume idempotency", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "agent-runtime",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_PERSISTENCE: "memory",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const bus = new InMemoryPubSubBus();
    let handled = 0;
    bus.subscribe(PubSubTopics.INTENT, () => {
      handled += 1;
      return err(ErrorCode.VALIDATION_FAILED, "intent-provenance unreachable", {
        status: 503,
        retryable: true,
      });
    });
    const http = createCloudRunHttpServer({
      config,
      bus,
      acceptedTopics: [PubSubTopics.INTENT],
      health: { ready: true },
      enableEvents: true,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const envelope = createEnvelope({
      eventId: "evt-s2s",
      type: "intent.submitted",
      aggregateId: "agg-s2s",
      aggregateVersion: 1,
      causationId: "c",
      correlationId: "corr",
      actorService: "agent-runtime",
      payloadHash: "h",
      idempotencyKey: "idem-s2s-fail",
      provenanceRefs: [],
      payload: { rawText: "buy food grade", principalId: "p1" },
    });
    const sub = "projects/p/subscriptions/tm-dev-agent-runtime--intent.events-push";
    const first = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(envelope, sub),
    });
    expect(first.status).toBe(503);
    const retry = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(envelope, sub),
    });
    expect(retry.status).toBe(503);
    expect(handled).toBe(2);
    await http.close();
  });

  it("maps MODEL_UNAVAILABLE to 5xx so Pub/Sub can retry", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "agent-runtime",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const bus = new InMemoryPubSubBus();
    bus.subscribe(PubSubTopics.INTENT, () =>
      err(ErrorCode.MODEL_UNAVAILABLE, "Vertex unavailable"),
    );
    const http = createCloudRunHttpServer({
      config,
      bus,
      acceptedTopics: [PubSubTopics.INTENT],
      health: { ready: true },
      enableEvents: true,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const envelope = createEnvelope({
      eventId: "evt-model",
      type: "intent.submitted",
      aggregateId: "agg-model",
      aggregateVersion: 1,
      causationId: "c",
      correlationId: "corr",
      actorService: "agent-runtime",
      payloadHash: "h",
      idempotencyKey: "idem-model",
      provenanceRefs: [],
      payload: { rawText: "buy", principalId: "p1" },
    });
    const res = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(
        envelope,
        "projects/p/subscriptions/tm-dev-agent-runtime--intent.events-push",
      ),
    });
    expect(res.status).toBe(503);
    await http.close();
  });

  it("ACKs deterministic BLOCK after durable provenance without privileged state", async () => {
    expect(
      eventHttpStatus({
        ok: true,
        value: { intentState: undefined, verification: { criticalFailure: true } },
      }),
    ).toBe(200);
  });

  it("maps MODEL_OUTPUT_INVALID to retryable 503, not payload 400", () => {
    expect(
      eventHttpStatus({
        ok: false,
        code: ErrorCode.MODEL_OUTPUT_INVALID,
        message: "bad model json",
        details: { retryable: true },
      }),
    ).toBe(503);
    expect(
      eventHttpStatus({
        ok: false,
        code: ErrorCode.VALIDATION_FAILED,
        message: "missing rawText",
      }),
    ).toBe(400);
  });
});
