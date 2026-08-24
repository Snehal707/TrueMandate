import {
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ProvenanceGraph, emptyTaint, externalTaint } from "./graph.js";

const NOW = "2026-06-01T12:00:00.000Z";

function node(
  id: string,
  kind: ProvenanceNodeKind,
  trustClass: TrustClass,
  taint = emptyTaint(),
) {
  return {
    id: asProvenanceNodeId(id),
    kind,
    label: id,
    createdAt: NOW,
    trustClass,
    taint,
  };
}

describe("INV_004 adversarial multi-hop taint", () => {
  it("survives external → summary → plan → decision → action", () => {
    const g = new ProvenanceGraph();
    const ext = asProvenanceNodeId("ext");
    g.addNode(
      node("ext", ProvenanceNodeKind.EXTERNAL, TrustClass.UNTRUSTED_EXTERNAL, externalTaint(ext)),
    );
    for (const [id, kind] of [
      ["summary", ProvenanceNodeKind.CLAIM],
      ["plan", ProvenanceNodeKind.PLAN],
      ["decision", ProvenanceNodeKind.DECISION],
      ["action", ProvenanceNodeKind.ACTION],
    ] as const) {
      g.addNode(node(id, kind, TrustClass.TRUSTED_SYSTEM));
    }
    const chain: Array<[string, string, SemanticRelation]> = [
      ["ext", "summary", SemanticRelation.SUMMARIZES],
      ["summary", "plan", SemanticRelation.DERIVED_FROM],
      ["plan", "decision", SemanticRelation.INFLUENCED_BY],
      ["decision", "action", SemanticRelation.RESULTED_IN],
    ];
    chain.forEach(([from, to, relation], i) => {
      expect(
        g.addEdge({
          id: asProvenanceEdgeId(`e${i}`),
          from: asProvenanceNodeId(from),
          to: asProvenanceNodeId(to),
          relation,
          createdAt: NOW,
        }).ok,
      ).toBe(true);
    });
    expect(g.getNode("action")?.taint.classes).toContain("EXTERNAL_CONTENT");
    expect(g.getNode("action")?.taint.origins).toContain(ext);
    expect(g.assertCanCreateAuthority("action").ok).toBe(false);
  });

  it("survives multi-hop DELEGATES_TO", () => {
    const g = new ProvenanceGraph();
    const ext = asProvenanceNodeId("mcp");
    g.addNode(
      node("mcp", ProvenanceNodeKind.EXTERNAL, TrustClass.UNTRUSTED_EXTERNAL, externalTaint(ext)),
    );
    g.addNode(node("agent-a", ProvenanceNodeKind.PLAN, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("agent-b", ProvenanceNodeKind.PLAN, TrustClass.TRUSTED_SYSTEM));
    g.addEdge({
      id: asProvenanceEdgeId("d1"),
      from: ext,
      to: asProvenanceNodeId("agent-a"),
      relation: SemanticRelation.DELEGATES_TO,
      createdAt: NOW,
    });
    g.addEdge({
      id: asProvenanceEdgeId("d2"),
      from: asProvenanceNodeId("agent-a"),
      to: asProvenanceNodeId("agent-b"),
      relation: SemanticRelation.DELEGATES_TO,
      createdAt: NOW,
    });
    expect(g.getNode("agent-b")?.taint.origins).toContain(ext);
  });

  it("repropagates when downstream edges are created before upstream taint edge", () => {
    const g = new ProvenanceGraph();
    const ext = asProvenanceNodeId("merchant");
    g.addNode(node("merchant", ProvenanceNodeKind.EXTERNAL, TrustClass.UNTRUSTED_EXTERNAL, externalTaint(ext)));
    g.addNode(node("summary", ProvenanceNodeKind.CLAIM, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("action", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));

    // Downstream first (clean)
    expect(
      g.addEdge({
        id: asProvenanceEdgeId("down"),
        from: asProvenanceNodeId("summary"),
        to: asProvenanceNodeId("action"),
        relation: SemanticRelation.DERIVED_FROM,
        createdAt: NOW,
      }).ok,
    ).toBe(true);
    expect(g.getNode("action")?.taint.classes).toEqual(["NONE"]);

    // Upstream taint later
    expect(
      g.addEdge({
        id: asProvenanceEdgeId("up"),
        from: ext,
        to: asProvenanceNodeId("summary"),
        relation: SemanticRelation.SUMMARIZES,
        createdAt: NOW,
      }).ok,
    ).toBe(true);

    expect(g.getNode("summary")?.taint.classes).toContain("EXTERNAL_CONTENT");
    expect(g.getNode("action")?.taint.classes).toContain("EXTERNAL_CONTENT");
    expect(g.getNode("action")?.taint.origins).toContain(ext);
  });
});
