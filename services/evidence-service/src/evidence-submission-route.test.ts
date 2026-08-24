import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  loadRuntimeConfig,
  type InternalCallerIdentityVerifier,
} from "@truemandate/cloud-runtime";
import { describe, expect, it } from "vitest";
import {
  createEvidenceInternalRoutes,
  type AcceptanceFixtureWriter,
} from "./internal-routes.js";

const AUDIENCE = "https://evidence-service.example.run.app";
const PUBLIC_BFF = "public-bff@test.iam.gserviceaccount.com";
const FIXTURE_WRITER = "phase-a@test.iam.gserviceaccount.com";
const WRITER: AcceptanceFixtureWriter = {
  email: FIXTURE_WRITER,
  idPrefix: "phase-a-",
};

function verifier(email?: string): InternalCallerIdentityVerifier {
  return { verify: async () => (email ? { email } : undefined) };
}

function config() {
  return loadRuntimeConfig({
    TM_REQUIRE_CONFIG: "true",
    TM_SERVICE_NAME: "evidence-service",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_INTERNAL_AUTH: "true",
    TM_INTERNAL_ALLOWED_CALLERS: FIXTURE_WRITER,
    TM_INTERNAL_AUTH_VERIFY: "true",
    TM_INTERNAL_AUTH_AUDIENCE: AUDIENCE,
    PORT: "0",
    HOST: "127.0.0.1",
  });
}

const submissionBody = {
  envelopes: [{
    id: "ev-1",
    source: "merchant-portal",
    contentHash: "hash-1",
    captureTime: "2026-08-22T10:03:00.000Z",
  }],
  claims: [],
};

const durableEnvelope = {
  id: "ev-1",
  source: "merchant-portal",
  contentHash: "hash-1",
  trustClass: "UNTRUSTED_EXTERNAL",
  captureTime: "2026-08-22T10:03:00.000Z",
  eventTime: "2026-08-22T10:00:00.000Z",
  freshnessDeadline: "2026-08-23T10:03:00.000Z",
  mimeType: "application/json",
  taint: { classes: ["EXTERNAL_CONTENT"], origins: ["customer-upload"] },
};

describe("governed evidence submission route", () => {
  it("registers a separate submission route with route-specific caller allowlist", () => {
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => undefined,
        getClaim: async () => undefined,
        persistSubmission: async () => ({ ok: true, value: { envelopeIds: [], claimIds: [] } }),
      },
      [WRITER],
      [],
      [PUBLIC_BFF],
    );
    const route = routes.find((item) => item.pattern === "/internal/evidence/submissions");
    expect(route).toBeDefined();
    expect(route?.allowedCallers).toEqual([PUBLIC_BFF]);
  });

  it("requires authenticated public-bff caller for the governed submission seam", async () => {
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => undefined,
        getClaim: async () => undefined,
        persistSubmission: async () => ({
          ok: true,
          value: { envelopeIds: ["ev-1"], claimIds: [] },
        }),
      },
      [WRITER],
      [],
      [PUBLIC_BFF],
    );
    const http = createCloudRunHttpServer({
      config: config(),
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(PUBLIC_BFF),
      internalRoutes: routes,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const deniedMissingBearer = await fetch(`http://127.0.0.1:${port}/internal/evidence/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionBody),
    });
    expect(deniedMissingBearer.status).toBe(401);

    const allowed = await fetch(`http://127.0.0.1:${port}/internal/evidence/submissions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer header.payload.signature",
        "content-type": "application/json",
      },
      body: JSON.stringify(submissionBody),
    });
    expect(allowed.status).toBe(200);
    await http.close();
  });

  it("allows authenticated public-bff reads on the owner envelope seam while unauthenticated reads fail", async () => {
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => durableEnvelope,
        getClaim: async () => undefined,
        persistSubmission: async () => ({
          ok: true,
          value: { envelopeIds: ["ev-1"], claimIds: [] },
        }),
      },
      [WRITER],
      [PUBLIC_BFF],
      [PUBLIC_BFF],
    );
    const http = createCloudRunHttpServer({
      config: config(),
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(PUBLIC_BFF),
      internalRoutes: routes,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const deniedMissingBearer = await fetch(`http://127.0.0.1:${port}/internal/evidence/envelopes/ev-1`, {
      method: "GET",
    });
    expect(deniedMissingBearer.status).toBe(401);

    const allowed = await fetch(`http://127.0.0.1:${port}/internal/evidence/envelopes/ev-1`, {
      method: "GET",
      headers: {
        Authorization: "Bearer header.payload.signature",
      },
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "ev-1",
      source: "merchant-portal",
      contentHash: "hash-1",
      trustClass: "UNTRUSTED_EXTERNAL",
      mimeType: "application/json",
    });
    await http.close();
  });

  it("still denies public-bff on the verifier-only acceptance fixture seam", async () => {
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => undefined,
        getClaim: async () => undefined,
        persistFixture: async () => ({ ok: true, value: { ok: true } }),
        persistSubmission: async () => ({ ok: true, value: { envelopeIds: ["ev-1"], claimIds: [] } }),
      },
      [WRITER],
      [],
      [PUBLIC_BFF],
    );
    const http = createCloudRunHttpServer({
      config: config(),
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(PUBLIC_BFF),
      internalRoutes: routes,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const denied = await fetch(`http://127.0.0.1:${port}/internal/evidence/acceptance-fixtures`, {
      method: "POST",
      headers: {
        Authorization: "Bearer header.payload.signature",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        envelopes: [{
          id: "phase-a-evidence-1",
          source: "fixture",
          contentHash: "hash-1",
          trustClass: "UNTRUSTED_EXTERNAL",
          captureTime: "2026-08-22T10:03:00.000Z",
          taint: { classes: ["EXTERNAL_CONTENT"], origins: ["fixture"] },
        }],
        claims: [],
      }),
    });
    expect(denied.status).toBe(403);
    await http.close();
  });

  it("does not expose any public-bff verifier access beyond submit/read while keeping fixture/verify restricted", () => {
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => durableEnvelope,
        getClaim: async () => undefined,
        persistFixture: async () => ({ ok: true, value: { ok: true } }),
        persistSubmission: async () => ({ ok: true, value: { envelopeIds: ["ev-1"], claimIds: [] } }),
        persistVerification: async () => ({ ok: true, value: { envelopeIds: ["ev-1-verified"], claimIds: [], verificationId: "verify-1" } }),
      },
      [WRITER],
      [PUBLIC_BFF],
      [PUBLIC_BFF],
      [FIXTURE_WRITER],
    );
    expect(routes.find((route) => route.pattern === "/internal/evidence/verifications")?.allowedCallers).toEqual([FIXTURE_WRITER]);
    expect(routes.find((route) => route.pattern === "/internal/evidence/submissions")?.allowedCallers).toEqual([PUBLIC_BFF]);
  });

  it("allows only the verifier identity on the dedicated evidence verification seam", async () => {
    const VERIFY_CALLER = "phase-c@test.iam.gserviceaccount.com";
    const routes = createEvidenceInternalRoutes(
      {
        getEnvelope: async () => durableEnvelope,
        getClaim: async () => undefined,
        persistSubmission: async () => ({ ok: true, value: { envelopeIds: ["ev-1"], claimIds: [] } }),
        persistVerification: async () => ({
          ok: true,
          value: { envelopeIds: ["ev-1-verified"], claimIds: [], verificationId: "verify-1" },
        }),
      },
      [WRITER],
      [PUBLIC_BFF],
      [PUBLIC_BFF],
      [VERIFY_CALLER],
    );
    const route = routes.find((item) => item.pattern === "/internal/evidence/verifications");
    expect(route?.allowedCallers).toEqual([VERIFY_CALLER]);

    const http = createCloudRunHttpServer({
      config: loadRuntimeConfig({
        TM_REQUIRE_CONFIG: "true",
        TM_SERVICE_NAME: "evidence-service",
        GOOGLE_CLOUD_PROJECT: "test-proj",
        TM_REQUIRE_INTERNAL_AUTH: "true",
        TM_INTERNAL_ALLOWED_CALLERS: `${FIXTURE_WRITER},${VERIFY_CALLER}`,
        TM_INTERNAL_AUTH_VERIFY: "true",
        TM_INTERNAL_AUTH_AUDIENCE: AUDIENCE,
        PORT: "0",
        HOST: "127.0.0.1",
      }),
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(VERIFY_CALLER),
      internalRoutes: routes,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const deniedMissingBearer = await fetch(`http://127.0.0.1:${port}/internal/evidence/verifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verificationId: "verify-1", envelopeId: "ev-1" }),
    });
    expect(deniedMissingBearer.status).toBe(401);

    const allowed = await fetch(`http://127.0.0.1:${port}/internal/evidence/verifications`, {
      method: "POST",
      headers: {
        Authorization: "Bearer header.payload.signature",
        "content-type": "application/json",
      },
      body: JSON.stringify({ verificationId: "verify-1", envelopeId: "ev-1" }),
    });
    expect(allowed.status).toBe(200);
    await http.close();
  });
});
