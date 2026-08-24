import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  IntentProvenanceS2SClient,
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { AuthorityService } from "@truemandate/authority-service";
import { AuthorityDecision, ProvenanceNodeKind } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { IntentService } from "@truemandate/intent-service";
import { createIntentProvenanceInternalRoutes } from "@truemandate/intent-service";
import { FakeModel } from "@truemandate/model";
import { VERIFIER_SCHEMA_ID } from "@truemandate/intent-verifier";
import { describe, expect, it } from "vitest";
import { compileAndVerify } from "./orchestrator.js";
import { COMPILER_SCHEMA_ID } from "./prompts/v1.js";
import { cleanCompilerOutput, cleanVerifierOutput } from "./test-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
    enableEvents: false,
    internalRoutes: createIntentProvenanceInternalRoutes({
      intents,
      provenance,
      durableProvenance: persist.bundle.provenance,
      semanticArtifacts: persist.bundle.semanticArtifacts,
    }),
  });
  await http.listen();
  const addr = http.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const client = new IntentProvenanceS2SClient(
    `http://127.0.0.1:${port}`,
    staticTokenProvider("test-token"),
  );
  return { http, client, intents };
}

describe("owner-routing flagship (no live payment)", () => {
  it("public path → intent-provenance → compile S2S → authority eval; gateway stays mock", async () => {
    const viewer = throwingWriteStore();
    const { http, client, intents } = await bootOwner();
    try {
      const rawText =
        "Buy 500 food-grade containers from an approved supplier for under INR 800000";
      const created = await client.createIntent({
        id: "intent-flagship-1",
        principalId: "principal-1",
        rawText,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const reconstructed = await client.getIntent("intent-flagship-1");
      expect(reconstructed.ok).toBe(true);

      const compilerModel = new FakeModel({
        handlers: {
          [COMPILER_SCHEMA_ID]: async (req) => {
            const payload = req.userPayload as { rawText: string };
            return cleanCompilerOutput(payload.rawText);
          },
        },
      });
      const verifierModel = new FakeModel({
        handlers: {
          [VERIFIER_SCHEMA_ID]: async () => cleanVerifierOutput(),
        },
      });
      const sessionProvenance = new ProvenanceService(client);
      const compiled = await compileAndVerify(
        {
          principalId: "principal-1",
          rawText,
          intentId: "intent-flagship-1",
          createdAt: "2026-06-01T12:00:00.000Z",
        },
        {
          intents: client,
          provenance: sessionProvenance,
          compilerModel,
          verifierModel,
        },
      );
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;

      const node = await client.getNode(compiled.value.intentNodeId);
      expect(node.ok).toBe(true);
      if (node.ok) {
        expect(node.value.kind).toBe(ProvenanceNodeKind.INTENT);
      }

      const tip = await intents.getCurrentIntentState("intent-flagship-1");
      expect(tip.ok).toBe(true);
      if (!tip.ok) return;

      const authority = new AuthorityService(intents);
      const evaluated = await authority.evaluateAuthorityRequest({
        id: "req-flagship-1",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: "intent-flagship-1",
        intentStateId: tip.value.id,
        actionId: "action-search-1",
        capability: "search",
        scope: {
          capabilities: { search: AuthorityDecision.ALLOW },
          maxAmount: 800000,
          currency: "INR",
          expiresAt: "2026-12-01T12:00:00.000Z",
        },
        createdAt: "2026-06-01T12:00:00.000Z",
      });
      expect(evaluated.ok).toBe(true);
      if (evaluated.ok) {
        expect(evaluated.value.decision).toBe(AuthorityDecision.ALLOW);
      }

      const gatewaySrc = readFileSync(
        path.join(root, "services/gateway-service/src/two-phase.ts"),
        "utf8",
      );
      expect(gatewaySrc).toContain("private readonly adapter = new MockPaymentAdapter()");
      expect(gatewaySrc).not.toMatch(/stripe|adyen|paypal/i);

      const agentStart = readFileSync(
        path.join(root, "services/agent-runtime/src/bin/start.ts"),
        "utf8",
      );
      expect(agentStart).not.toMatch(/createGrant|mintGrant/);
      expect(agentStart).not.toMatch(/persist\.bundle\.intents/);
      expect(agentStart).not.toMatch(/persist\.bundle\.provenance/);

      expect(viewer.writes.set).toBe(0);
      expect(viewer.writes.tx).toBe(0);
      void viewer.store;
    } finally {
      await http.close();
    }
  });
});
