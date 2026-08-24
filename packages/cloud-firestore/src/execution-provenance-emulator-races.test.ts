import { Firestore } from "@google-cloud/firestore";
import { authorityExecutionProvenance, executionActionProvenance, semanticActionProvenance } from "@truemandate/provenance";
import { GoogleFirestoreDocumentStore, COLLECTIONS, createFirestorePersistence, docPath } from "./index.js";
import { describe, expect, it } from "vitest";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const H = (char: string) => char.repeat(64);
const createdAt = "2026-06-01T12:00:00.000Z";

function persistence() {
  return createFirestorePersistence(new GoogleFirestoreDocumentStore(new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator" })));
}

function fixture(suffix: string) {
  const lineage = {
    preparedActionId: `prepared-${suffix}`, preparedActionHash: H("a"), actionId: `action-${suffix}`, actionHash: H("b"), workflowId: `workflow-${suffix}`,
    evaluationId: `evaluation-${suffix}`, evaluationHash: H("c"), outcomeContractId: `outcome-${suffix}`, outcomeContractHash: H("d"),
    intentStateId: `state-${suffix}`, intentStateHash: H("e"), intentStateVersion: 1,
  };
  const semantic = semanticActionProvenance(lineage, createdAt);
  const execution = executionActionProvenance(lineage, createdAt);
  const authority = authorityExecutionProvenance({ ...lineage, grantId: `grant-${suffix}`, grantHash: H("f"), principalId: `principal-${suffix}` }, createdAt);
  return { lineage, semantic, execution, authority };
}

describe.skipIf(!emulatorHost)("Firestore execution provenance immutable races", () => {
  it("replays identical semantic/execution nodes and relations across fresh repositories", async () => {
    const f = fixture(`identical-${Date.now()}`);
    const db1 = persistence();
    await Promise.all([
      db1.provenance.appendNode({ id: f.semantic.id, payload: f.semantic, createdAt }),
      db1.provenance.appendNode({ id: f.semantic.id, payload: f.semantic, createdAt }),
    ]);
    await Promise.all([
      db1.provenance.appendNode({ id: f.execution.node.id, payload: f.execution.node, createdAt }),
      db1.provenance.appendNode({ id: f.execution.node.id, payload: f.execution.node, createdAt }),
    ]);
    await Promise.all([
      db1.provenance.appendEdge({ id: f.execution.edge.id, fromId: f.execution.edge.from, toId: f.execution.edge.to, payload: f.execution.edge, createdAt }),
      db1.provenance.appendEdge({ id: f.execution.edge.id, fromId: f.execution.edge.from, toId: f.execution.edge.to, payload: f.execution.edge, createdAt }),
    ]);
    const db2 = persistence();
    expect((await db2.provenance.getNode(f.execution.node.id))?.payload).toEqual(f.execution.node);
    expect((await db2.provenance.getEdge(f.execution.edge.id))?.payload).toEqual(f.execution.edge);
  }, 20_000);

  it("permits one semantic meaning only for divergent nodes and AUTHORIZES relations", async () => {
    const f = fixture(`conflict-${Date.now()}`);
    const db = persistence();
    const divergentNode = { ...f.execution.node, metadata: { ...(f.execution.node.metadata ?? {}), workflowId: "workflow-other" } };
    const nodes = await Promise.allSettled([
      db.provenance.appendNode({ id: f.execution.node.id, payload: f.execution.node, createdAt }),
      db.provenance.appendNode({ id: f.execution.node.id, payload: divergentNode, createdAt }),
    ]);
    expect(nodes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(nodes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await db.provenance.appendNode({ id: f.authority.authority.id, payload: f.authority.authority, createdAt });
    const divergentEdge = { ...f.authority.authorizes, to: "execution-action-other" as never };
    const edges = await Promise.allSettled([
      db.provenance.appendEdge({ id: f.authority.authorizes.id, fromId: f.authority.authorizes.from, toId: f.authority.authorizes.to, payload: f.authority.authorizes, createdAt }),
      db.provenance.appendEdge({ id: f.authority.authorizes.id, fromId: divergentEdge.from, toId: divergentEdge.to, payload: divergentEdge, createdAt }),
    ]);
    expect(edges.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(edges.filter((result) => result.status === "rejected")).toHaveLength(1);
  }, 20_000);

  it("fails closed for hash-tampered durable provenance rows", async () => {
    const f = fixture(`tampered-${Date.now()}`);
    const db = persistence();
    await db.store.set(docPath(COLLECTIONS.provenanceNodes, f.execution.node.id), { id: f.execution.node.id, payload: { ...f.execution.node, metadata: { ...(f.execution.node.metadata ?? {}), workflowId: "workflow-other" } }, createdAt, recordHash: H("0") });
    await db.store.set(docPath(COLLECTIONS.provenanceEdges, f.execution.edge.id), { id: f.execution.edge.id, fromId: f.execution.edge.from, toId: f.execution.edge.to, payload: f.execution.edge, createdAt, recordHash: H("1") });
    await expect(db.provenance.getNode(f.execution.node.id)).rejects.toThrow("Invalid immutable provenance node row");
    await expect(db.provenance.getEdge(f.execution.edge.id)).rejects.toThrow("Invalid immutable provenance edge row");
  }, 20_000);

  it("fails closed for malformed durable provenance rows", async () => {
    const f = fixture(`malformed-${Date.now()}`);
    const db = persistence();
    await db.store.set(docPath(COLLECTIONS.provenanceNodes, f.execution.node.id), {
      id: f.execution.node.id,
      createdAt,
      recordHash: H("0"),
    });
    await db.store.set(docPath(COLLECTIONS.provenanceEdges, f.execution.edge.id), {
      id: f.execution.edge.id,
      fromId: f.execution.edge.from,
      toId: f.execution.edge.to,
      createdAt,
      recordHash: H("1"),
    });
    await expect(db.provenance.getNode(f.execution.node.id)).rejects.toThrow("Invalid immutable provenance node row");
    await expect(db.provenance.getEdge(f.execution.edge.id)).rejects.toThrow("Invalid immutable provenance edge row");
  }, 20_000);
});
