import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config.js";
import type { InternalCallerIdentityVerifier } from "./caller-identity.js";
import { createCloudRunHttpServer, matchInternalPattern } from "./server.js";

const audience = "https://intent-provenance.example.run.app";
const agentRuntime = "agent-runtime@test.iam.gserviceaccount.com";
const authority = "authority@test.iam.gserviceaccount.com";

function verifier(email?: string): InternalCallerIdentityVerifier {
  return { verify: async () => email ? { email } : undefined };
}

describe("internal routes", () => {
  it("matches parameterized internal paths", () => {
    expect(matchInternalPattern("/internal/intents/:id", "/internal/intents/abc")).toEqual({
      id: "abc",
    });
    expect(
      matchInternalPattern("/internal/intents/:id/tip", "/internal/intents/abc/tip"),
    ).toEqual({ id: "abc" });
    expect(matchInternalPattern("/internal/intents/:id", "/internal/intents/abc/tip")).toBeUndefined();
  });

  it("rejects missing Authorization when TM_REQUIRE_INTERNAL_AUTH=true", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "intent-provenance",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_REQUIRE_INTERNAL_AUTH: "true",
      TM_INTERNAL_AUTH_VERIFY: "true",
      TM_INTERNAL_AUTH_AUDIENCE: audience,
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const http = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(agentRuntime),
      internalRoutes: [
        {
          method: "POST",
          pattern: "/internal/intents",
          handler: async () => ({ status: 200, body: { ok: true } }),
        },
      ],
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const denied = await fetch(`http://127.0.0.1:${port}/internal/intents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/internal/intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer header.payload.signature",
      },
      body: "{}",
    });
    expect(allowed.status).toBe(200);
    await http.close();
  });

  it("allows a verified generic Agent Runtime caller and denies a different caller", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "intent-provenance",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_REQUIRE_INTERNAL_AUTH: "true",
      TM_INTERNAL_ALLOWED_CALLERS: agentRuntime,
      TM_INTERNAL_AUTH_VERIFY: "true",
      TM_INTERNAL_AUTH_AUDIENCE: audience,
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const http = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(authority),
      internalRoutes: [
        {
          method: "GET",
          pattern: "/internal/intents/:id/tip",
          handler: async () => ({ status: 200, body: { ok: true } }),
        },
      ],
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const denied = await fetch(`http://127.0.0.1:${port}/internal/intents/intent-a/tip`, {
      method: "GET",
      headers: {
        Authorization: "Bearer header.payload.signature",
      },
    });
    expect(denied.status).toBe(403);
    await http.close();

    const allowedHttp = createCloudRunHttpServer({
      config,
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(agentRuntime),
      internalRoutes: [{
        method: "GET",
        pattern: "/internal/intents/:id/tip",
        handler: async () => ({ status: 200, body: { ok: true } }),
      }],
    });
    await allowedHttp.listen();
    const allowedAddr = allowedHttp.server.address();
    const allowedPort = typeof allowedAddr === "object" && allowedAddr ? allowedAddr.port : 0;
    const allowed = await fetch(`http://127.0.0.1:${allowedPort}/internal/intents/intent-a/tip`, {
      method: "GET",
      headers: {
        Authorization: "Bearer header.payload.signature",
      },
    });
    expect(allowed.status).toBe(200);
    await allowedHttp.close();
  });

  it("enforces a verified Authority-only caller policy for a narrow route", async () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "intent-provenance",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_REQUIRE_INTERNAL_AUTH: "true",
      TM_INTERNAL_ALLOWED_CALLERS: agentRuntime,
      TM_INTERNAL_AUTH_VERIFY: "true",
      TM_INTERNAL_AUTH_AUDIENCE: audience,
      PORT: "0",
      HOST: "127.0.0.1",
    });
    let observedCaller: string | undefined;
    const route = {
      method: "POST",
      pattern: "/internal/provenance/authority-bindings",
      allowedCallers: [authority],
      handler: async (request: { caller?: { email: string } }) => {
        observedCaller = request.caller?.email;
        return { status: 200, body: { ok: true } };
      },
    };
    const authorityHttp = createCloudRunHttpServer({
      config, bus: new InMemoryPubSubBus(), acceptedTopics: [], health: { ready: true },
      enableEvents: false, identityVerifier: verifier(authority), internalRoutes: [route],
    });
    await authorityHttp.listen();
    const authorityAddress = authorityHttp.server.address();
    const authorityPort = typeof authorityAddress === "object" && authorityAddress ? authorityAddress.port : 0;
    const allowed = await fetch(`http://127.0.0.1:${authorityPort}/internal/provenance/authority-bindings`, {
      method: "POST", headers: { Authorization: "Bearer header.payload.signature" }, body: "{}",
    });
    expect(allowed.status).toBe(200);
    expect(observedCaller).toBe(authority);
    await authorityHttp.close();

    const agentHttp = createCloudRunHttpServer({
      config, bus: new InMemoryPubSubBus(), acceptedTopics: [], health: { ready: true },
      enableEvents: false, identityVerifier: verifier(agentRuntime), internalRoutes: [route],
    });
    await agentHttp.listen();
    const agentAddress = agentHttp.server.address();
    const agentPort = typeof agentAddress === "object" && agentAddress ? agentAddress.port : 0;
    const denied = await fetch(`http://127.0.0.1:${agentPort}/internal/provenance/authority-bindings`, {
      method: "POST", headers: { Authorization: "Bearer header.payload.signature" }, body: "{}",
    });
    expect(denied.status).toBe(403);
    await agentHttp.close();
  });
});
