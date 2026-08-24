import { describe, expect, it } from "vitest";
import { IntentService } from "./service.js";
import { createIntentProvenanceInternalRoutes } from "./internal-routes.js";
import { ProvenanceService } from "@truemandate/provenance-service";

type Row = { id: string; intentId: string; workflowId: string; kind: "PLAN" | "PLAN_VERIFICATION" | "PROOF" | "ACTION" | "GUARDIAN" | "WORKFLOW" | "EXECUTION_AUTHORIZATION"; payload: unknown; predecessors: readonly { id: string; kind: string; contentHash: string }[]; contentHash: string; createdAt: string };
function routes(rows = new Map<string, Row>()) {
  const artifacts = { putIfAbsent: async (row: Row) => rows.has(row.id) ? false : (rows.set(row.id, row), true), get: async (id: string) => rows.get(id), listWorkflow: async (workflowId: string) => [...rows.values()].filter((row) => row.workflowId === workflowId) };
  return { route: createIntentProvenanceInternalRoutes({ intents: new IntentService(), provenance: new ProvenanceService(), semanticArtifacts: artifacts }).find((r) => r.pattern === "/internal/semantic-artifacts")!, rows };
}
const hash = "a".repeat(64);
const base = { id: "a", intentId: "intent", workflowId: "wf", createdAt: "2026-01-01T00:00:00.000Z" };
const action = (ids: string[] = []) => ({ ...base, kind: "ACTION" as const, payload: { intentStateId: "state", intentStateHash: hash, requiredProofObligationIds: ids } });
const proof = (status: string = "SATISFIED") => ({ ...base, id: "p", kind: "PROOF" as const, payload: { intentStateId: "state", intentStateHash: hash, schemaVersion: "1", proofId: "p", obligationId: hash, actionArtifactId: "a", actionPayloadHash: hash, status, evidenceRefs: [{ id: "evidence-1", hash }], evaluatedAt: "2026-01-01T00:00:00.000Z", method: "deterministic" } });
const guardian = (refs: unknown[] = []) => ({ ...base, id: "g", kind: "GUARDIAN" as const, payload: { intentStateId: "state", intentStateHash: hash, actionArtifactId: "a", actionArtifactHash: hash, evaluatedProofs: refs } });
const workflow = () => ({ ...base, id: "wf", kind: "WORKFLOW" as const, payload: { intentStateId: "state", intentStateHash: hash, packId: "travel", state: "AUTHORITY_EVALUATION" }, predecessors: [] });
const executionAuthorization = (workflowHash: string) => ({
  ...base,
  id: "execution-authorization-wf",
  kind: "EXECUTION_AUTHORIZATION" as const,
  predecessors: [{ id: "wf", kind: "WORKFLOW", contentHash: workflowHash }],
  payload: {
    intentStateId: "state",
    intentStateHash: hash,
    workflowId: "wf",
    packId: "travel",
    commitTokenId: "ct-internal",
    preparedActionId: "prep-1",
    preparedActionHash: hash,
    grantId: "grant-1",
    outcomeContractId: "outcome-1",
    outcomeContractHash: hash,
  },
});
describe("semantic artifact owner contracts", () => {
  it("accepts zero-obligation ACTION and assigns the canonical hash", async () => {
    const { route } = routes(); const out = await route.handler({ params: {}, headers: {}, body: action() });
    expect(out.status).toBe(200); expect((out.body as Row).contentHash).toBeTruthy(); expect((out.body as Row).contentHash).not.toBe(hash);
  });
  it("accepts every durable proof outcome structurally", async () => {
    for (const status of ["SATISFIED", "UNSATISFIED", "UNKNOWN"]) { const { route } = routes(); expect((await route.handler({ params: {}, headers: {}, body: proof(status) })).status).toBe(200); }
  });
  it("rejects duplicate valid ACTION obligation IDs", async () => {
    const { route } = routes();
    expect((await route.handler({ params: {}, headers: {}, body: action([hash, hash]) })).status).toBe(400);
  });
  it("rejects invalid PROOF status after changing only status", async () => {
    const { route } = routes();
    expect((await route.handler({ params: {}, headers: {}, body: proof("ALLOW") })).status).toBe(400);
  });
  it("rejects missing or malformed ACTION obligation declarations", async () => {
    for (const payload of [{ intentStateId: "state", intentStateHash: hash }, { ...action(["valid"]).payload, requiredProofObligationIds: [""] }]) {
      const { route } = routes(); expect((await route.handler({ params: {}, headers: {}, body: { ...action(), payload } })).status).toBe(400);
    }
  });
  it("accepts a nonzero ACTION obligation set", async () => {
    const { route } = routes(); expect((await route.handler({ params: {}, headers: {}, body: action([hash]) })).status).toBe(200);
  });
  it("rejects each required PROOF field when removed", async () => {
    for (const field of ["schemaVersion", "proofId", "obligationId", "actionArtifactId", "actionPayloadHash", "evidenceRefs", "evaluatedAt", "method"]) {
      const body = proof().payload as Record<string, unknown>; delete body[field];
      const { route } = routes(); expect((await route.handler({ params: {}, headers: {}, body: { ...proof(), payload: body } })).status).toBe(400);
    }
  });
  it("rejects empty or malformed immutable evidence references", async () => {
    for (const evidenceRefs of [[], [{ id: "", hash }], [{ id: "evidence-1" }]]) {
      const { route } = routes(); expect((await route.handler({ params: {}, headers: {}, body: { ...proof(), payload: { ...proof().payload, evidenceRefs } } })).status).toBe(400);
    }
  });
  it("normalizes semantically unordered Guardian proof references before hashing", async () => {
    const refs = ["a", "b", "c"].map((id, i) => ({ id, hash, obligationId: `o-${i}` }));
    const first = routes(); const second = routes();
    const a = await first.route.handler({ params: {}, headers: {}, body: guardian(refs) });
    const b = await second.route.handler({ params: {}, headers: {}, body: { ...guardian([...refs].reverse()), id: "g2" } });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect((a.body as Row).contentHash).toBe((b.body as Row).contentHash);
    expect(((a.body as Row).payload as { evaluatedProofs: unknown[] }).evaluatedProofs).toEqual(((b.body as Row).payload as { evaluatedProofs: unknown[] }).evaluatedProofs);
  });
  it("rejects caller-controlled semantic artifact hashes", async () => {
    const { route } = routes();
    expect((await route.handler({ params: {}, headers: {}, body: { ...action(), contentHash: "f".repeat(64) } })).status).toBe(400);
  });
  it.each([
    ["malformed action hash", { actionPayloadHash: "not-a-hash" }],
    ["malformed evaluation time", { evaluatedAt: "not-a-time" }],
    ["malformed method", { method: "" }],
  ])("rejects PROOF %s", async (_name, mutation) => {
    const { route } = routes();
    expect((await route.handler({ params: {}, headers: {}, body: { ...proof(), payload: { ...proof().payload, ...mutation } } })).status).toBe(400);
  });
  it("owner hashes equivalent ACTION payloads identically and semantic changes differently", async () => {
    const first = routes(); const second = routes(); const third = routes();
    const a = await first.route.handler({ params: {}, headers: {}, body: action([hash]) });
    const b = await second.route.handler({ params: {}, headers: {}, body: { ...action([hash]), id: "a2" } });
    const c = await third.route.handler({ params: {}, headers: {}, body: { ...action(["b".repeat(64)]), id: "a3" } });
    expect((a.body as Row).contentHash).toBe((b.body as Row).contentHash);
    expect((a.body as Row).contentHash).not.toBe((c.body as Row).contentHash);
  });

  it("replays identical immutable artifact content idempotently and rejects divergent same-ID content", async () => {
    const { route, rows } = routes();
    const artifact = action(["o1"]);
    const first = await route.handler({ body: artifact, headers: {}, params: {} });
    expect(first.status).toBe(200);
    const second = await route.handler({ body: artifact, headers: {}, params: {} });
    expect(second.status).toBe(200);
    expect(rows.size).toBe(1);
    expect((second.body as { contentHash?: string }).contentHash).toBe((first.body as { contentHash?: string }).contentHash);
    const divergent = await route.handler({ body: { ...artifact, payload: { ...artifact.payload, requiredProofObligationIds: ["o2"] } }, headers: {}, params: {} });
    expect(divergent.status).toBe(409);
    expect(rows.size).toBe(1);
  });

  it("persists an internal execution authorization handle with canonical workflow lineage", async () => {
    const { route, rows } = routes();
    const savedWorkflow = await route.handler({ body: workflow(), headers: {}, params: {} });
    expect(savedWorkflow.status).toBe(200);
    const workflowHash = (savedWorkflow.body as Row).contentHash;
    const artifact = executionAuthorization(workflowHash);
    const first = await route.handler({ body: artifact, headers: {}, params: {} });
    const replay = await route.handler({ body: artifact, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(rows.size).toBe(2);
    expect((first.body as Row).kind).toBe("EXECUTION_AUTHORIZATION");
  });

  it.each([
    ["wrong id", (artifact: ReturnType<typeof executionAuthorization>) => ({ ...artifact, id: "authorization-wrong" })],
    ["foreign payload workflow", (artifact: ReturnType<typeof executionAuthorization>) => ({ ...artifact, payload: { ...artifact.payload, workflowId: "wf-foreign" } })],
    ["missing workflow predecessor", (artifact: ReturnType<typeof executionAuthorization>) => ({ ...artifact, predecessors: [] })],
    ["foreign workflow predecessor", (artifact: ReturnType<typeof executionAuthorization>) => ({ ...artifact, predecessors: [{ ...artifact.predecessors[0]!, id: "wf-foreign" }] })],
    ["privileged extra payload", (artifact: ReturnType<typeof executionAuthorization>) => ({ ...artifact, payload: { ...artifact.payload, rawGatewayResponse: {} } })],
  ])("rejects EXECUTION_AUTHORIZATION with %s", async (_name, mutate) => {
    const { route } = routes();
    const savedWorkflow = await route.handler({ body: workflow(), headers: {}, params: {} });
    const artifact = executionAuthorization((savedWorkflow.body as Row).contentHash);
    expect((await route.handler({ body: mutate(artifact), headers: {}, params: {} })).status).toBe(400);
  });

  it("rejects divergent execution authorization replay without replacing the original", async () => {
    const { route, rows } = routes();
    const savedWorkflow = await route.handler({ body: workflow(), headers: {}, params: {} });
    const artifact = executionAuthorization((savedWorkflow.body as Row).contentHash);
    expect((await route.handler({ body: artifact, headers: {}, params: {} })).status).toBe(200);
    const divergent = {
      ...artifact,
      payload: { ...artifact.payload, commitTokenId: "ct-other" },
    };
    expect((await route.handler({ body: divergent, headers: {}, params: {} })).status).toBe(409);
    expect((rows.get(artifact.id)?.payload as { commitTokenId: string }).commitTokenId).toBe("ct-internal");
  });
});
