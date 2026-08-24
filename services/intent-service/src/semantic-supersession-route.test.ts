import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  loadRuntimeConfig,
  type InternalCallerIdentityVerifier,
} from "@truemandate/cloud-runtime";
import { describe, expect, it } from "vitest";
import { IntentService } from "./service.js";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";
import { ProvenanceService } from "@truemandate/provenance-service";

const AGENT_RUNTIME = "agent-runtime@test.iam.gserviceaccount.com";
const AUDIENCE = "https://intent-provenance.example.run.app";

function verifier(email?: string): InternalCallerIdentityVerifier {
  return { verify: async () => (email ? { email } : undefined) };
}

describe("semantic supersession route auth", () => {
  it("restricts semantic supersession to the configured agent-runtime caller", async () => {
    const rows = new Map<string, unknown>();
    const route = createIntentProvenanceInternalRoutes({
      intents: new IntentService(),
      provenance: new ProvenanceService(),
      semanticArtifacts: {
        putIfAbsent: async (row: { id: string }) =>
          rows.has(row.id) ? false : (rows.set(row.id, row), true),
        get: async (id: string) => rows.get(id) as never,
        listWorkflow: async () => [],
      },
      semanticSupersessionCallers: [AGENT_RUNTIME],
    }).find((item) => item.pattern === "/internal/intent-states/:id/semantic-supersession");
    expect(route?.allowedCallers).toEqual([AGENT_RUNTIME]);

    const http = createCloudRunHttpServer({
      config: loadRuntimeConfig({
        TM_REQUIRE_CONFIG: "true",
        TM_SERVICE_NAME: "intent-provenance",
        GOOGLE_CLOUD_PROJECT: "test-proj",
        TM_REQUIRE_INTERNAL_AUTH: "true",
        TM_INTERNAL_ALLOWED_CALLERS: AGENT_RUNTIME,
        TM_INTERNAL_AUTH_VERIFY: "true",
        TM_INTERNAL_AUTH_AUDIENCE: AUDIENCE,
        PORT: "0",
        HOST: "127.0.0.1",
      }),
      bus: new InMemoryPubSubBus(),
      acceptedTopics: [],
      health: { ready: true },
      enableEvents: false,
      identityVerifier: verifier(AGENT_RUNTIME),
      internalRoutes: createIntentProvenanceInternalRoutes({
        intents: new IntentService(),
        provenance: new ProvenanceService(),
        semanticArtifacts: {
          putIfAbsent: async (row: { id: string }) =>
            rows.has(row.id) ? false : (rows.set(row.id, row), true),
          get: async (id: string) => rows.get(id) as never,
          listWorkflow: async () => [],
        },
        semanticSupersessionCallers: [AGENT_RUNTIME],
      }),
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const deniedMissingBearer = await fetch(`http://127.0.0.1:${port}/internal/intent-states/state-1/semantic-supersession`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(deniedMissingBearer.status).toBe(401);

    await http.close();
  });
});
