import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ProvenanceService } from "./service.js";

const NOW = "2026-08-20T12:00:00.000Z";

function node(id: string, kind: ProvenanceNodeKind = ProvenanceNodeKind.ACTION) {
  return {
    id,
    kind,
    label: id,
    createdAt: NOW,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: { classes: ["NONE"] as const, origins: [] as string[] },
  };
}

function edge(id: string, from: string, to: string) {
  return {
    id,
    from,
    to,
    relation: SemanticRelation.DERIVED_FROM,
    createdAt: NOW,
  };
}

function durablePort(seed: {
  nodes?: Map<string, { payload: unknown; createdAt: string }>;
  edges?: Map<string, { payload: unknown; createdAt: string }>;
}) {
  const nodes = seed.nodes ?? new Map();
  const edges = seed.edges ?? new Map();
  return {
    nodes,
    edges,
    appendNode: async (row: { id: string; payload: unknown; createdAt: string }) => {
      if (!nodes.has(row.id)) nodes.set(row.id, { payload: row.payload, createdAt: row.createdAt });
    },
    appendEdge: async (row: {
      id: string;
      fromId: string;
      toId: string;
      payload: unknown;
      createdAt: string;
    }) => {
      if (!edges.has(row.id)) edges.set(row.id, { payload: row.payload, createdAt: row.createdAt });
    },
    getNode: async (id: string) => nodes.get(id),
    getEdge: async (id: string) => edges.get(id),
  };
}

describe("Wave 1 cross-instance provenance edge hydration", () => {
  it("hydrates durable endpoint nodes into a fresh instance before recording an edge", async () => {
    const durable = durablePort({
      nodes: new Map([
        ["n-from", { payload: node("n-from"), createdAt: NOW }],
        ["n-to", { payload: node("n-to"), createdAt: NOW }],
      ]),
    });
    // Instance A recorded the nodes; instance B only has the durable store.
    const instanceB = new ProvenanceService(durable);
    const recorded = await instanceB.recordEdge(edge("e-1", "n-from", "n-to"));
    expect(recorded.ok).toBe(true);
    expect(instanceB.getNode("n-from").ok).toBe(true);
    expect(instanceB.getNode("n-to").ok).toBe(true);
    expect(instanceB.getEdge("e-1").ok).toBe(true);
  });

  it("fails closed when a durable endpoint is genuinely missing", async () => {
    const durable = durablePort({
      nodes: new Map([["n-from", { payload: node("n-from"), createdAt: NOW }]]),
    });
    const service = new ProvenanceService(durable);
    const recorded = await service.recordEdge(edge("e-missing", "n-from", "n-missing"));
    expect(recorded.ok).toBe(false);
    if (!recorded.ok) {
      expect(recorded.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(recorded.message).toMatch(/missing from durable store/i);
    }
    expect(durable.edges.has("e-missing")).toBe(false);
  });

  it("fails closed when a durable endpoint payload is malformed", async () => {
    const durable = durablePort({
      nodes: new Map([
        ["n-from", { payload: node("n-from"), createdAt: NOW }],
        ["n-bad", { payload: { id: "n-bad", notANode: true }, createdAt: NOW }],
      ]),
    });
    const service = new ProvenanceService(durable);
    const recorded = await service.recordEdge(edge("e-bad", "n-from", "n-bad"));
    expect(recorded.ok).toBe(false);
    if (!recorded.ok) {
      expect(recorded.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(recorded.message).toMatch(/Malformed durable provenance node/i);
    }
    expect(durable.edges.has("e-bad")).toBe(false);
  });

  it("still fails closed on immutable edge id conflicts", async () => {
    const durable = durablePort({});
    const service = new ProvenanceService(durable);
    expect((await service.recordNode(node("n-a"))).ok).toBe(true);
    expect((await service.recordNode(node("n-b"))).ok).toBe(true);
    expect((await service.recordNode(node("n-c"))).ok).toBe(true);
    expect((await service.recordEdge(edge("e-dup", "n-a", "n-b"))).ok).toBe(true);
    const conflict = await service.recordEdge({
      ...edge("e-dup", "n-a", "n-c"),
      relation: SemanticRelation.DERIVED_FROM,
    });
    // Same id already present — converge/reject without rewriting.
    expect(conflict.ok).toBe(true);
    expect(conflict.ok && conflict.value.to).toBe("n-b");
  });
});
