import {
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ProvenanceGraph, emptyTaint, externalTaint } from "./graph.js";

describe("provenance edge polarity", () => {
  it("DERIVED_FROM is source → derivative; ancestors/descendants follow influence-flow", () => {
    const g = new ProvenanceGraph();
    const intent = asProvenanceNodeId("intent-1");
    const constraint = asProvenanceNodeId("constraint-1");
    g.addNode({
      id: intent,
      kind: ProvenanceNodeKind.INTENT,
      label: "raw",
      createdAt: "2026-06-01T00:00:00.000Z",
      trustClass: TrustClass.TRUSTED_HUMAN,
      taint: emptyTaint(),
    });
    g.addNode({
      id: constraint,
      kind: ProvenanceNodeKind.CONSTRAINT,
      label: "food_grade",
      createdAt: "2026-06-01T00:00:00.000Z",
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    g.addEdge({
      id: asProvenanceEdgeId("e1"),
      from: intent,
      to: constraint,
      relation: SemanticRelation.DERIVED_FROM,
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    expect(g.ancestors(constraint)).toContain(intent);
    expect(g.descendants(intent)).toContain(constraint);
    expect(g.ancestors(intent)).not.toContain(constraint);
    expect(g.descendants(constraint)).not.toContain(intent);
  });

  it("taint flows source → downstream along DERIVED_FROM", () => {
    const g = new ProvenanceGraph();
    const ext = asProvenanceNodeId("ext");
    const summary = asProvenanceNodeId("summary");
    g.addNode({
      id: ext,
      kind: ProvenanceNodeKind.EXTERNAL,
      label: "merchant",
      createdAt: "2026-06-01T00:00:00.000Z",
      trustClass: TrustClass.UNTRUSTED_EXTERNAL,
      taint: externalTaint(ext),
    });
    g.addNode({
      id: summary,
      kind: ProvenanceNodeKind.CLAIM,
      label: "summary",
      createdAt: "2026-06-01T00:00:00.000Z",
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    g.addEdge({
      id: asProvenanceEdgeId("e-taint"),
      from: ext,
      to: summary,
      relation: SemanticRelation.DERIVED_FROM,
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    const after = g.getNode(summary)!;
    expect(after.taint.classes).toContain("EXTERNAL_CONTENT");
  });
});
