import { createAuthorityInternalRoutes } from "../../../authority-service/src/internal-routes.js";
import { createGatewayInternalRoutes } from "../internal-routes.js";
import { FUTURE } from "./harness.js";
import { createPreExecutionLineage } from "./preexecution-lineage.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const PreparedActionResponseSchema = z
  .object({ id: z.string().min(1), preparedActionHash: z.string().regex(/^[a-f0-9]{64}$/i) })
  .passthrough();
const GrantResponseSchema = z.object({ id: z.string().min(1) }).passthrough();
const AuthorizeResponseSchema = z
  .object({ commitToken: z.object({ id: z.string().min(1), consumed: z.literal(false) }).passthrough() })
  .passthrough();

describe("pre-execution deterministic flow", () => {
  it("resolves owner references, binds authority, and stops at an unconsumed CommitToken", async () => {
    const lineage = await createPreExecutionLineage();
    const gatewayRoute = createGatewayInternalRoutes({
      gateway: lineage.rt.gateway,
      owners: lineage.owners,
    }).find((route) => route.pattern === "/internal/gateway/prepare-references");
    const authorityRoute = createAuthorityInternalRoutes({
      authority: lineage.rt.authority,
      evaluations: lineage.evaluations,
      preparedActions: { get: (id) => lineage.rt.gateway.getPreparedActionStore().get(id) },
      outcomeContracts: { get: (id) => lineage.outcomes.getContract(id) },
    }).find((route) => route.pattern === "/internal/authority/bind-and-mint");
    const authorizeRoute = createGatewayInternalRoutes({
      gateway: lineage.rt.gateway,
      owners: lineage.owners,
    }).find((route) => route.pattern === "/internal/gateway/authorize");

    expect(gatewayRoute).toBeDefined();
    expect(authorityRoute).toBeDefined();
    expect(authorizeRoute).toBeDefined();
    if (!gatewayRoute || !authorityRoute || !authorizeRoute) {
      throw new Error("Required pre-execution internal route is unavailable");
    }

    const preparedResponse = await gatewayRoute.handler({
      body: lineage.prepareBody,
      headers: {},
      params: {},
    });
    expect(preparedResponse.status).toBe(200);
    const prepared = PreparedActionResponseSchema.parse(preparedResponse.body);

    const preparedRead = await lineage.rt.gateway.getPreparedActionStore().get(prepared.id);
    expect(preparedRead.ok).toBe(true);
    if (!preparedRead.ok) return;
    expect(preparedRead.value).toBeDefined();
    if (!preparedRead.value) return;
    expect(preparedRead.value.preparedAction.preparedActionHash).toBe(prepared.preparedActionHash);

    // Fixture lineage setup only; Authority HTTP/S2S authentication is tested separately.
    const mintedResponse = await authorityRoute.handler({
      body: {
        evaluation: lineage.prepareBody.evaluation,
        preparedAction: { id: prepared.id, hash: prepared.preparedActionHash },
        outcomeContract: lineage.prepareBody.outcomeContract,
        idempotencyKey: lineage.prepareBody.idempotencyKey,
      },
      headers: {},
      params: {},
    });
    expect(mintedResponse.status).toBe(200);
    const grant = GrantResponseSchema.parse(mintedResponse.body);

    const grantRead = await lineage.rt.authority.getGrantStore().get(grant.id);
    expect(grantRead.ok).toBe(true);
    if (!grantRead.ok) return;
    expect(grantRead.value).toBeDefined();
    if (!grantRead.value) return;
    expect(grantRead.value.preparedActionHash).toBe(prepared.preparedActionHash);

    const authorizedResponse = await authorizeRoute.handler({
      body: { preparedActionId: prepared.id, grantId: grant.id, expiresAt: FUTURE },
      headers: {},
      params: {},
    });
    expect(authorizedResponse.status).toBe(200);
    const authorized = AuthorizeResponseSchema.parse(authorizedResponse.body);

    const tokenRead = await lineage.rt.gateway.getCommitTokenStore().get(authorized.commitToken.id);
    expect(tokenRead.ok).toBe(true);
    if (!tokenRead.ok) return;
    expect(tokenRead.value).toBeDefined();
    if (!tokenRead.value) return;
    expect(tokenRead.value.consumed).toBe(false);
    expect(await lineage.rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });
});
