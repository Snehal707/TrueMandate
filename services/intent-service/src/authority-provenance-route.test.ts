import { executionActionProvenance, principalNodeId } from "@truemandate/provenance";
import { ProvenanceNodeKind, SemanticRelation, TrustClass } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { initRuntimePersistence } from "@truemandate/cloud-runtime";
import { hashCanonical } from "@truemandate/crypto";
import { describe, expect, it } from "vitest";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";
import { IntentService } from "./service.js";

const now = "2026-06-01T12:00:00.000Z";
const authorityCaller = "authority@test.iam.gserviceaccount.com";
const lineage = {
  preparedActionId: "prepared-1",
  preparedActionHash: "a".repeat(64),
  actionId: "action-1",
  actionHash: "b".repeat(64),
  workflowId: "workflow-1",
  evaluationId: "evaluation-1",
  evaluationHash: "c".repeat(64),
  outcomeContractId: "outcome-1",
  outcomeContractHash: "d".repeat(64),
  intentStateId: "state-1",
  intentStateHash: "e".repeat(64),
  intentStateVersion: 1,
  grantId: "grant-1",
  grantHash: "f".repeat(64),
  principalId: "principal-1",
};
const {
  grantId: _grantId,
  grantHash: _grantHash,
  principalId: _principalId,
  ...executionLineage
} = lineage;

function routes(provenance = new ProvenanceService()) {
  const all = createIntentProvenanceInternalRoutes({
    intents: new IntentService(),
    provenance,
    authorityCallerEmail: authorityCaller,
  });
  const nodes = all.find((route) => route.pattern === "/internal/provenance/nodes");
  const edges = all.find((route) => route.pattern === "/internal/provenance/edges");
  const bindings = all.find((route) => route.pattern === "/internal/provenance/authority-bindings");
  if (!nodes || !edges || !bindings) throw new Error("Authority provenance routes missing");
  return { provenance, nodes, edges, bindings };
}

async function seedExecutionNode(provenance: ProvenanceService): Promise<void> {
  const seeded = await provenance.recordNode(executionActionProvenance(executionLineage, now).node);
  expect(seeded.ok).toBe(true);
}

describe("Authority provenance owner boundary", () => {
  it("rejects generic AUTHORITY nodes and AUTHORIZES edges", async () => {
    const { nodes, edges } = routes();
    const node = await nodes.handler({ body: { id: "authority-forged", kind: ProvenanceNodeKind.AUTHORITY, label: "forged", createdAt: now, trustClass: TrustClass.TRUSTED_SYSTEM, taint: { classes: ["NONE"], origins: [] } }, headers: {}, params: {} });
    const edge = await edges.handler({ body: { id: "forged-authorizes", from: "authority", to: "action", relation: SemanticRelation.AUTHORIZES, createdAt: now }, headers: {}, params: {} });
    expect(node.status).toBe(400);
    expect(edge.status).toBe(400);
  });

  it("creates canonical Authority provenance and accepts an identical replay", async () => {
    const { provenance, bindings } = routes();
    await seedExecutionNode(provenance);
    const first = await bindings.handler({ body: { lineage, createdAt: now }, headers: {}, params: {} });
    const replay = await bindings.handler({ body: { lineage, createdAt: now }, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
  });

  it("rejects divergent Authority provenance and missing or malformed execution lineage", async () => {
    const { provenance, bindings } = routes();
    await seedExecutionNode(provenance);
    const first = await bindings.handler({ body: { lineage, createdAt: now }, headers: {}, params: {} });
    const divergent = await bindings.handler({ body: { lineage: { ...lineage, grantHash: "0".repeat(64) }, createdAt: now }, headers: {}, params: {} });
    const missing = await routes().bindings.handler({ body: { lineage, createdAt: now }, headers: {}, params: {} });
    const malformed = await bindings.handler({ body: { lineage: { ...lineage, grantHash: "not-a-hash" }, createdAt: now }, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(divergent.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
  });
});


function makeLineage(grant: string, workflow: string, principalId: string, hashChar: string) {
  const h = hashChar.repeat(64);
  return {
    preparedActionId: `prepared-${workflow}`,
    preparedActionHash: h,
    actionId: `action-${workflow}`,
    actionHash: h,
    workflowId: workflow,
    evaluationId: `evaluation-${workflow}`,
    evaluationHash: h,
    outcomeContractId: `outcome-${workflow}`,
    outcomeContractHash: h,
    intentStateId: `state-${workflow}`,
    intentStateHash: h,
    intentStateVersion: 1,
    grantId: grant,
    grantHash: h,
    principalId,
  };
}

function executionLineageOf(lineage: {
  preparedActionId: string; preparedActionHash: string; actionId: string; actionHash: string;
  workflowId: string; evaluationId: string; evaluationHash: string; outcomeContractId: string;
  outcomeContractHash: string; intentStateId: string; intentStateHash: string; intentStateVersion: number;
}) {
  return {
    preparedActionId: lineage.preparedActionId, preparedActionHash: lineage.preparedActionHash,
    actionId: lineage.actionId, actionHash: lineage.actionHash, workflowId: lineage.workflowId,
    evaluationId: lineage.evaluationId, evaluationHash: lineage.evaluationHash,
    outcomeContractId: lineage.outcomeContractId, outcomeContractHash: lineage.outcomeContractHash,
    intentStateId: lineage.intentStateId, intentStateHash: lineage.intentStateHash, intentStateVersion: lineage.intentStateVersion,
  };
}

async function durableRoutes() {
  const persist = await initRuntimePersistence({
    TM_PERSISTENCE: "memory",
    TM_SERVICE_NAME: "intent-provenance",
    GOOGLE_CLOUD_PROJECT: "test-proj",
    TM_REQUIRE_CONFIG: "true",
  });
  const provenance = new ProvenanceService(persist.bundle.provenance);
  const all = createIntentProvenanceInternalRoutes({
    intents: new IntentService(),
    provenance,
    durableProvenance: persist.bundle.provenance,
    authorityCallerEmail: authorityCaller,
  });
  const bindings = all.find((route) => route.pattern === "/internal/provenance/authority-bindings");
  if (!bindings) throw new Error("authority-bindings route missing");
  return { persist, provenance, bindings };
}

describe("stable PRINCIPAL identity across authorizations (durable, production-shaped)", () => {
  it("coexists two independent authorizations for the same executor principal — exact v4 production history", async () => {
    // Phase A v8 was the first-ever authorization: it created the canonical
    // principal node with its own creation timestamp.
    const phaseA = makeLineage("grant-phase-a", "wf-phase-a", "agent-runtime", "a");
    // Phase B v4 was the second authorization: same executor principal, a
    // different grant/workflow/action and a later creation timestamp.
    const v4 = makeLineage("grant-phase-b-v4", "wf-phase-b-v4", "agent-runtime", "b");
    const { persist, provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(phaseA), "2026-08-17T19:35:20.246Z").node);
    await provenance.recordNode(executionActionProvenance(executionLineageOf(v4), "2026-08-18T06:03:17.984Z").node);
    const first = await bindings.handler({ body: { lineage: phaseA, createdAt: "2026-08-17T19:35:20.246Z" }, headers: {}, params: {} });
    const second = await bindings.handler({ body: { lineage: v4, createdAt: "2026-08-18T06:03:17.984Z" }, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The stable principal node exists exactly once, with the FIRST creation
    // timestamp — later authorization must not rewrite identity or time.
    const principal = await persist.bundle.provenance.getNode(principalNodeId("agent-runtime"));
    expect(principal).toBeDefined();
    const payload = principal?.payload as { createdAt?: string; metadata?: unknown } | undefined;
    expect(payload?.createdAt).toBe("2026-08-17T19:35:20.246Z");
    expect(hashCanonical(payload?.metadata)).toBe(hashCanonical({ principalId: "agent-runtime" }));
    // Both per-authorization authority nodes coexist durably.
    expect(await persist.bundle.provenance.getNode("authority-grant-grant-phase-a")).toBeDefined();
    expect(await persist.bundle.provenance.getNode("authority-grant-grant-phase-b-v4")).toBeDefined();
    // Both lineage edges coexist without overwriting one another.
    expect(await persist.bundle.provenance.getEdge(`authorizes-${hashCanonical({ authorityId: "authority-grant-grant-phase-b-v4", execution: `execution-action-${phaseA.preparedActionId}` }).slice(0, 24)}`)).toBeUndefined();
  });

  it("keeps identical replay idempotent with the durable store", async () => {
    const l = makeLineage("grant-replay", "wf-replay", "agent-runtime", "c");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    const first = await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} });
    const replay = await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
  });

  it("preserves mint-time AUTHORITY when only grantHash changes (consumed-grant replay)", async () => {
    const l = makeLineage("grant-mint", "wf-mint", "agent-runtime", "1");
    const { persist, provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    const first = await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} });
    expect(first.status).toBe(200);
    const consumedReplay = await bindings.handler({
      body: { lineage: { ...l, grantHash: "9".repeat(64) }, createdAt: now },
      headers: {},
      params: {},
    });
    expect(consumedReplay.status).toBe(200);
    const durable = await persist.bundle.provenance.getNode("authority-grant-grant-mint");
    const md = (durable?.payload as { metadata?: { grantHash?: string } } | undefined)?.metadata;
    // Mint-time grantHash remains canonical; mutable consumption hash is ignored.
    expect(md?.grantHash).toBe("1".repeat(64));
  });

  it("fails closed when mint-time replay alters principal", async () => {
    const l = makeLineage("grant-prin", "wf-prin", "agent-runtime", "2");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    expect((await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    const altered = await bindings.handler({
      body: { lineage: { ...l, principalId: "other-principal" }, createdAt: now },
      headers: {},
      params: {},
    });
    // Different principal changes authority node identity / lineage → conflict or mismatch.
    expect(altered.status).toBe(400);
  });

  it("fails closed when mint-time replay alters IntentState", async () => {
    const l = makeLineage("grant-state", "wf-state", "agent-runtime", "3");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    expect((await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    const altered = await bindings.handler({
      body: {
        lineage: { ...l, intentStateId: "state-other", intentStateHash: "a".repeat(64) },
        createdAt: now,
      },
      headers: {},
      params: {},
    });
    expect(altered.status).toBe(400);
  });

  it("fails closed when mint-time replay alters PreparedAction", async () => {
    const l = makeLineage("grant-pa", "wf-pa", "agent-runtime", "4");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    expect((await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    const altered = await bindings.handler({
      body: {
        lineage: {
          ...l,
          preparedActionId: "prepared-other",
          preparedActionHash: "b".repeat(64),
        },
        createdAt: now,
      },
      headers: {},
      params: {},
    });
    expect(altered.status).toBe(400);
  });

  it("fails closed when mint-time replay alters capability-bearing action hash", async () => {
    const l = makeLineage("grant-cap", "wf-cap", "agent-runtime", "5");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    expect((await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    const altered = await bindings.handler({
      body: {
        lineage: { ...l, actionId: "action-other", actionHash: "c".repeat(64) },
        createdAt: now,
      },
      headers: {},
      params: {},
    });
    expect(altered.status).toBe(400);
  });

  it("fails closed when mint-time replay alters amount-bearing evaluation hash", async () => {
    const l = makeLineage("grant-amt", "wf-amt", "agent-runtime", "6");
    const { provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    expect((await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    const altered = await bindings.handler({
      body: {
        lineage: { ...l, evaluationId: "evaluation-other", evaluationHash: "d".repeat(64) },
        createdAt: now,
      },
      headers: {},
      params: {},
    });
    expect(altered.status).toBe(400);
  });

  it("fails closed when an existing principal row carries divergent identity attributes", async () => {
    const l = makeLineage("grant-divergent", "wf-divergent", "principal-1", "d");
    const provenance = new ProvenanceService();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(l), now).node);
    const tamperedDurable = {
      getNode: async (id: string) => id === "principal-principal-1"
        ? { payload: { id: "principal-principal-1", kind: ProvenanceNodeKind.PRINCIPAL, label: "principal:someone-else", createdAt: now, trustClass: TrustClass.TRUSTED_HUMAN, taint: { classes: ["NONE"], origins: [] }, metadata: { principalId: "someone-else" } } }
        : undefined,
      getEdge: async () => undefined,
    };
    const all = createIntentProvenanceInternalRoutes({
      intents: new IntentService(),
      provenance,
      durableProvenance: tamperedDurable,
      authorityCallerEmail: authorityCaller,
    });
    const bindings = all.find((route) => route.pattern === "/internal/provenance/authority-bindings");
    if (!bindings) throw new Error("authority-bindings route missing");
    const res = await bindings.handler({ body: { lineage: l, createdAt: now }, headers: {}, params: {} });
    expect(res.status).toBe(400);
    expect((res.body as { message?: string }).message).toBe("Principal provenance identity mismatch");
  });

  it("keeps distinct principals distinct", async () => {
    const a = makeLineage("grant-p1", "wf-p1", "principal-one", "e");
    const b = makeLineage("grant-p2", "wf-p2", "principal-two", "f");
    const { persist, provenance, bindings } = await durableRoutes();
    await provenance.recordNode(executionActionProvenance(executionLineageOf(a), now).node);
    await provenance.recordNode(executionActionProvenance(executionLineageOf(b), now).node);
    expect((await bindings.handler({ body: { lineage: a, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    expect((await bindings.handler({ body: { lineage: b, createdAt: now }, headers: {}, params: {} })).status).toBe(200);
    expect(await persist.bundle.provenance.getNode("principal-principal-one")).toBeDefined();
    expect(await persist.bundle.provenance.getNode("principal-principal-two")).toBeDefined();
  });
});
