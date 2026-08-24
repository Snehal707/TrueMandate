import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GatewayS2SClient,
  createCloudRunHttpServer,
  loadRuntimeConfig,
  staticTokenProvider,
  type InternalCallerIdentityVerifier,
} from "@truemandate/cloud-runtime";
import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import { ErrorCode, err, ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createAuthorityInternalRoutes } from "../../authority-service/src/internal-routes.js";
import { createGatewayInternalRoutes } from "./internal-routes.js";
import { FUTURE } from "./integration/harness.js";
import { createPreExecutionLineage } from "./integration/preexecution-lineage.js";

const AUTHORITY_SA = "tm-dev-authority@test.iam.gserviceaccount.com";
const AGENT_RUNTIME_SA = "tm-dev-agent-runtime@test.iam.gserviceaccount.com";
const WRONG_SA = "tm-dev-untrusted@test.iam.gserviceaccount.com";
const AUTHORITY_BEARER = "authority.header.signature";
const AGENT_RUNTIME_BEARER = "agent-runtime.header.signature";
const WRONG_BEARER = "wrong.header.signature";
const GATEWAY_AUDIENCE = "https://gateway.example.run.app";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const verifier: InternalCallerIdentityVerifier = {
  verify: async (headers, audience) => {
    expect(audience).toBe(GATEWAY_AUDIENCE);
    const authorization = headers.authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    if (bearer === `Bearer ${AUTHORITY_BEARER}`) return { email: AUTHORITY_SA };
    if (bearer === `Bearer ${AGENT_RUNTIME_BEARER}`) return { email: AGENT_RUNTIME_SA };
    if (bearer === `Bearer ${WRONG_BEARER}`) return { email: WRONG_SA };
    return undefined;
  },
};

async function bootGatewayHttp() {
  const lineage = await createPreExecutionLineage();
  const config = loadRuntimeConfig({
    TM_REQUIRE_CONFIG: "true",
    TM_SERVICE_NAME: "gateway",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_INTERNAL_AUTH: "true",
    TM_INTERNAL_ALLOWED_CALLERS: `${AUTHORITY_SA},${AGENT_RUNTIME_SA}`,
    TM_INTERNAL_AUTH_VERIFY: "true",
    TM_INTERNAL_AUTH_AUDIENCE: GATEWAY_AUDIENCE,
    PORT: "0",
    HOST: "127.0.0.1",
  });
  const http = createCloudRunHttpServer({
    config,
    bus: new InMemoryPubSubBus(),
    acceptedTopics: [],
    health: { ready: true },
    enableEvents: false,
    identityVerifier: verifier,
    internalRoutes: createGatewayInternalRoutes({
      gateway: lineage.rt.gateway,
      owners: lineage.owners,
    }),
  });
  await http.listen();
  const address = http.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    lineage,
    http,
    baseUrl,
    client: new GatewayS2SClient(baseUrl, staticTokenProvider(AGENT_RUNTIME_BEARER)),
  };
}

describe("Gateway reference-only internal routes", () => {
  it("rejects a missing bearer before reading owner references", async () => {
    const { http, baseUrl } = await bootGatewayHttp();
    try {
      const response = await fetch(`${baseUrl}/internal/gateway/prepare-references`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(401);
    } finally {
      await http.close();
    }
  });

  it("rejects unknown fields on the current prepare and authorize DTOs", async () => {
    const { lineage, http, client } = await bootGatewayHttp();
    try {
      const prepared = await client.prepareFromReferences({
        ...lineage.prepareBody,
        amount: 700001,
      });
      expect(prepared.ok).toBe(false);
      if (!prepared.ok) expect(prepared.code).toBe(ErrorCode.SCHEMA_PARSE_FAILED);

      const authorized = await client.authorize({
        preparedActionId: "prepared-unknown",
        grantId: "grant-unknown",
        expiresAt: FUTURE,
        adapterMode: "success",
      });
      expect(authorized.ok).toBe(false);
      if (!authorized.ok) expect(authorized.code).toBe(ErrorCode.SCHEMA_PARSE_FAILED);
    } finally {
      await http.close();
    }
  });

  it("does not accept a raw ActionProposal in place of a durable ACTION reference", async () => {
    const { lineage, http, client } = await bootGatewayHttp();
    try {
      const result = await client.prepareFromReferences({
        ...lineage.prepareBody,
        action: lineage.rt.action,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(ErrorCode.SCHEMA_PARSE_FAILED);
    } finally {
      await http.close();
    }
  });

  it("rejects a verified but non-allowlisted caller", async () => {
    const { http, baseUrl } = await bootGatewayHttp();
    try {
      const response = await fetch(`${baseUrl}/internal/gateway/prepare-references`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${WRONG_BEARER}`,
        },
        body: "{}",
      });
      expect(response.status).toBe(403);
    } finally {
      await http.close();
    }
  });

  it("accepts Agent Runtime for reference preparation and Authority for prepared-action reads", async () => {
    const { lineage, http, baseUrl, client } = await bootGatewayHttp();
    try {
      const prepared = await client.prepareFromReferences(lineage.prepareBody);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      const response = await fetch(`${baseUrl}/internal/gateway/prepared-actions/${encodeURIComponent(prepared.value.id)}`, {
        headers: { Authorization: `Bearer ${AUTHORITY_BEARER}` },
      });
      expect(response.status).toBe(200);
    } finally {
      await http.close();
    }
  });

  it("prepares, binds, and authorizes to an unconsumed CommitToken only", async () => {
    const { lineage, http, client } = await bootGatewayHttp();
    try {
      const prepared = await client.prepareFromReferences(lineage.prepareBody);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      const authorityRoute = createAuthorityInternalRoutes({
        authority: lineage.rt.authority,
        evaluations: lineage.evaluations,
        preparedActions: { get: (id) => lineage.rt.gateway.getPreparedActionStore().get(id) },
        outcomeContracts: { get: (id) => lineage.outcomes.getContract(id) },
      }).find((route) => route.pattern === "/internal/authority/bind-and-mint");
      expect(authorityRoute).toBeTruthy();
      if (!authorityRoute) return;
      const minted = await authorityRoute.handler({
        body: {
          evaluation: lineage.prepareBody.evaluation,
          preparedAction: {
            id: prepared.value.id,
            hash: prepared.value.preparedActionHash,
          },
          outcomeContract: lineage.prepareBody.outcomeContract,
          idempotencyKey: lineage.prepareBody.idempotencyKey,
        },
        headers: {},
        params: {},
      });
      expect(minted.status).toBe(200);
      if (minted.status !== 200) return;
      const grant = minted.body as { id: string };

      const authorized = await client.authorize({
        preparedActionId: prepared.value.id,
        grantId: grant.id,
        expiresAt: FUTURE,
      });
      expect(authorized.ok).toBe(true);
      if (!authorized.ok) return;
      expect(authorized.value).toMatchObject({
        commitToken: { consumed: false },
      });
      const token = authorized.value as { commitToken?: { id: string } };
      expect(token.commitToken?.id).toBeTruthy();
      if (!token.commitToken) return;
      const stored = await lineage.rt.gateway.getCommitTokenStore().get(token.commitToken.id);
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;
      expect(stored.value?.consumed).toBe(false);
      expect(await lineage.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
    } finally {
      await http.close();
    }

    const runtimeTf = readFileSync(
      path.join(root, "infrastructure/terraform/modules/runtime/variables.tf"),
      "utf8",
    );
    const runtimeMainTf = readFileSync(
      path.join(root, "infrastructure/terraform/modules/runtime/main.tf"),
      "utf8",
    );
    expect(runtimeTf).toContain('"authority->gateway"');
    expect(runtimeTf).toContain('"agent-runtime->gateway"');
    expect(runtimeMainTf).toContain('TM_INTERNAL_AUTH_VERIFY');
    expect(runtimeMainTf).toContain('TM_INTERNAL_AUTH_AUDIENCE');
    expect(runtimeTf).toContain("INGRESS_TRAFFIC_INTERNAL_ONLY");
  });
});
