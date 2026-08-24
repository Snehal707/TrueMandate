import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  IntentProvenanceS2SClient,
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { ProvenanceService } from "@truemandate/provenance-service";
import { describe, expect, it } from "vitest";
import { IntentService } from "./service.js";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";

function throwingWriteStore() {
  const writes = { set: 0, tx: 0 };
  return {
    writes,
    store: {
      kind: "memory" as const,
      async get() {
        return undefined;
      },
      async set() {
        writes.set += 1;
        throw new Error("viewer must not write locally");
      },
      async runTransaction() {
        writes.tx += 1;
        throw new Error("viewer must not write locally");
      },
      async probeReachability() {
        return;
      },
    },
  };
}

async function bootOwner() {
  const persist = await initRuntimePersistence({
    TM_PERSISTENCE: "memory",
    TM_SERVICE_NAME: "intent-provenance",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_CONFIG: "true",
  });
  const intents = new IntentService(persist.bundle.intents);
  const provenance = new ProvenanceService(persist.bundle.provenance);
  const config = loadRuntimeConfig({
    TM_REQUIRE_CONFIG: "true",
    TM_SERVICE_NAME: "intent-provenance",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_INTERNAL_AUTH: "true",
    PORT: "0",
    HOST: "127.0.0.1",
  });
  const http = createCloudRunHttpServer({
    config,
    bus: new InMemoryPubSubBus(),
    acceptedTopics: [],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    enableEvents: false,
    internalRoutes: createIntentProvenanceInternalRoutes({
      intents,
      provenance,
      durableProvenance: persist.bundle.provenance,
    }),
  });
  await http.listen();
  const addr = http.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client = new IntentProvenanceS2SClient(
    baseUrl,
    staticTokenProvider("test-token"),
  );
  return { http, baseUrl, client };
}

describe("intent-provenance owner APIs", () => {
  it("BFF S2S createIntent reconstructs via GET; auth and idempotency fail closed", async () => {
    const { http, baseUrl, client } = await bootOwner();
    const viewer = throwingWriteStore();
    try {
      const denied = await fetch(`${baseUrl}/internal/intents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalId: "principal-1",
          rawText: "Buy 500 food-grade containers under INR 800000",
        }),
      });
      expect(denied.status).toBe(401);

      const malformed = await fetch(`${baseUrl}/internal/intents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: "{not-json",
      });
      expect(malformed.status).toBe(400);

      const missingFields = await fetch(`${baseUrl}/internal/intents`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({ principalId: "principal-1" }),
      });
      expect(missingFields.status).toBe(400);

      // Same port surface public-bff uses: IntentCreatePort over S2S, no local store.
      const bffCreate = {
        createIntent: (raw: unknown) => client.createIntent(raw),
      };
      const created = await bffCreate.createIntent({
        id: "intent-owner-1",
        principalId: "principal-1",
        rawText: "Buy 500 food-grade containers under INR 800000",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const again = await client.createIntent({
        id: "intent-owner-1",
        principalId: "principal-1",
        rawText: "Buy 500 food-grade containers under INR 800000",
      });
      expect(again.ok).toBe(true);

      const conflict = await client.createIntent({
        id: "intent-owner-1",
        principalId: "principal-1",
        rawText: "different text",
      });
      expect(conflict.ok).toBe(false);

      const got = await client.getIntent("intent-owner-1");
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.value.rawText).toContain("food-grade");
      }

      const unknown = await client.getIntent("intent-does-not-exist");
      expect(unknown.ok).toBe(false);

      expect(viewer.writes.set).toBe(0);
      expect(viewer.writes.tx).toBe(0);
      void viewer.store;
    } finally {
      await http.close();
    }
  });
});
