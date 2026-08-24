import {
  ErrorCode,
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
  label = id,
) {
  return {
    id: asProvenanceNodeId(id),
    kind,
    label,
    createdAt: NOW,
    trustClass,
    taint,
  };
}

describe("INV_003 untrusted external content cannot create authority", () => {
  it("allows trusted system authority node to authorize", () => {
    const g = new ProvenanceGraph();
    g.addNode(node("auth-1", ProvenanceNodeKind.AUTHORITY, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("action-1", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));
    const result = g.authorize(
      asProvenanceEdgeId("e-auth"),
      asProvenanceNodeId("auth-1"),
      asProvenanceNodeId("action-1"),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("blocks authority creation from tainted external node", () => {
    const g = new ProvenanceGraph();
    const extId = asProvenanceNodeId("ext-1");
    g.addNode(
      node(
        "ext-1",
        ProvenanceNodeKind.EXTERNAL,
        TrustClass.UNTRUSTED_EXTERNAL,
        externalTaint(extId),
        "merchant-page",
      ),
    );
    g.addNode(node("action-1", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));
    const result = g.authorize(
      asProvenanceEdgeId("e-bad"),
      extId,
      asProvenanceNodeId("action-1"),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.UNTRUSTED_CANNOT_CREATE_AUTHORITY);
    }
  });
});

describe("INV_004 taint survives summarization and delegation", () => {
  it("propagates taint through summary and ranking to proposal", () => {
    const g = new ProvenanceGraph();
    const extId = asProvenanceNodeId("merchant");
    g.addNode(
      node(
        "merchant",
        ProvenanceNodeKind.EXTERNAL,
        TrustClass.UNTRUSTED_EXTERNAL,
        externalTaint(extId),
      ),
    );
    g.addNode(node("summary", ProvenanceNodeKind.CLAIM, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("ranking", ProvenanceNodeKind.DECISION, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("proposal", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));

    expect(
      g.addEdge({
        id: asProvenanceEdgeId("e1"),
        from: extId,
        to: asProvenanceNodeId("summary"),
        relation: SemanticRelation.SUMMARIZES,
        createdAt: NOW,
      }).ok,
    ).toBe(true);

    expect(
      g.addEdge({
        id: asProvenanceEdgeId("e2"),
        from: asProvenanceNodeId("summary"),
        to: asProvenanceNodeId("ranking"),
        relation: SemanticRelation.INFLUENCED_BY,
        createdAt: NOW,
      }).ok,
    ).toBe(true);

    expect(
      g.addEdge({
        id: asProvenanceEdgeId("e3"),
        from: asProvenanceNodeId("ranking"),
        to: asProvenanceNodeId("proposal"),
        relation: SemanticRelation.DERIVED_FROM,
        createdAt: NOW,
      }).ok,
    ).toBe(true);

    const proposal = g.getNode("proposal");
    expect(proposal?.taint.classes).toContain("EXTERNAL_CONTENT");
    expect(proposal?.taint.origins).toContain(extId);

    // Still cannot create authority from the tainted proposal chain source
    const authAttempt = g.assertCanCreateAuthority(asProvenanceNodeId("proposal"));
    expect(authAttempt.ok).toBe(false);
  });

  it("propagates taint across delegation", () => {
    const g = new ProvenanceGraph();
    const extId = asProvenanceNodeId("mcp");
    g.addNode(
      node("mcp", ProvenanceNodeKind.EXTERNAL, TrustClass.UNTRUSTED_EXTERNAL, externalTaint(extId)),
    );
    g.addNode(node("child-plan", ProvenanceNodeKind.PLAN, TrustClass.TRUSTED_SYSTEM));
    g.addEdge({
      id: asProvenanceEdgeId("d1"),
      from: extId,
      to: asProvenanceNodeId("child-plan"),
      relation: SemanticRelation.DELEGATES_TO,
      createdAt: NOW,
    });
    expect(g.getNode("child-plan")?.taint.classes).toContain("EXTERNAL_CONTENT");
  });
});

describe("INV_012 / INV_013 privileged path and reconstructable provenance", () => {
  it("allows action with Principal → Intent → Authority → Action", () => {
    const g = new ProvenanceGraph();
    g.addNode(node("principal", ProvenanceNodeKind.PRINCIPAL, TrustClass.TRUSTED_HUMAN));
    g.addNode(node("intent", ProvenanceNodeKind.INTENT, TrustClass.TRUSTED_HUMAN));
    g.addNode(node("authority", ProvenanceNodeKind.AUTHORITY, TrustClass.TRUSTED_SYSTEM));
    g.addNode(node("action", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));

    g.addEdge({
      id: asProvenanceEdgeId("p-i"),
      from: asProvenanceNodeId("principal"),
      to: asProvenanceNodeId("intent"),
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    g.addEdge({
      id: asProvenanceEdgeId("i-a"),
      from: asProvenanceNodeId("intent"),
      to: asProvenanceNodeId("authority"),
      relation: SemanticRelation.AUTHORIZES,
      createdAt: NOW,
    });
    // Reverse mental model: AUTHORIZES from authority to action
    g.addEdge({
      id: asProvenanceEdgeId("a-act"),
      from: asProvenanceNodeId("authority"),
      to: asProvenanceNodeId("action"),
      relation: SemanticRelation.AUTHORIZES,
      createdAt: NOW,
    });
    // Link authority back to principal for authority→principal trace
    g.addEdge({
      id: asProvenanceEdgeId("p-auth"),
      from: asProvenanceNodeId("principal"),
      to: asProvenanceNodeId("authority"),
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    // Link intent to action for intent trace
    g.addEdge({
      id: asProvenanceEdgeId("i-act"),
      from: asProvenanceNodeId("intent"),
      to: asProvenanceNodeId("action"),
      relation: SemanticRelation.RESULTED_IN,
      createdAt: NOW,
    });

    const result = g.assertPrivilegedPath(asProvenanceNodeId("action"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path.map(String)).toEqual([
        "principal",
        "intent",
        "authority",
        "action",
      ]);
    }
  });

  it("blocks privileged action without reconstructable path", () => {
    const g = new ProvenanceGraph();
    g.addNode(node("action", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));
    const result = g.assertPrivilegedPath(asProvenanceNodeId("action"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.PRIVILEGED_PATH_INCOMPLETE);
    }
  });

  it("finds first divergence on WEAKENS edge", () => {
    const g = new ProvenanceGraph();
    g.addNode(node("intent", ProvenanceNodeKind.INTENT, TrustClass.TRUSTED_HUMAN, emptyTaint(), "food grade"));
    g.addNode(
      node("weak", ProvenanceNodeKind.CONSTRAINT, TrustClass.TRUSTED_SYSTEM, emptyTaint(), "industrial grade"),
    );
    g.addNode(node("action", ProvenanceNodeKind.ACTION, TrustClass.TRUSTED_SYSTEM));
    g.addEdge({
      id: asProvenanceEdgeId("w1"),
      from: asProvenanceNodeId("intent"),
      to: asProvenanceNodeId("weak"),
      relation: SemanticRelation.WEAKENS,
      createdAt: NOW,
    });
    g.addEdge({
      id: asProvenanceEdgeId("w2"),
      from: asProvenanceNodeId("weak"),
      to: asProvenanceNodeId("action"),
      relation: SemanticRelation.DERIVED_FROM,
      createdAt: NOW,
    });
    const div = g.findFirstDivergence(asProvenanceNodeId("action"));
    expect(div.ok).toBe(true);
    if (div.ok) {
      expect(div.value.edge.relation).toBe(SemanticRelation.WEAKENS);
      expect(div.value.node.label).toBe("industrial grade");
    }
  });
});
