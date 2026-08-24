import { describe, expect, it } from "vitest";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runProvenanceTraversal } from "./provenance-traversal.js";
import { provEdge, provNode } from "../test-fixtures.js";

describe("provenanceTraversal", () => {
  it("BFS-traverses across related workflows with deterministic ordering", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [],
      provenanceNodes: [
        provNode({
          id: "n-intent-a",
          kind: "INTENT",
          label: "wf-a intent",
          subjectRef: "wf-a",
        }),
        provNode({
          id: "n-shared",
          kind: "PRINCIPAL",
          label: "principal-1",
          subjectRef: "wf-a",
        }),
        provNode({
          id: "n-intent-b",
          kind: "INTENT",
          label: "wf-b intent",
          subjectRef: "wf-b",
        }),
      ],
      provenanceEdges: [
        provEdge({
          id: "e-a-shared",
          from: "n-shared",
          to: "n-intent-a",
          relation: "INTRODUCED_BY",
        }),
        provEdge({
          id: "e-b-shared",
          from: "n-shared",
          to: "n-intent-b",
          relation: "INTRODUCED_BY",
        }),
      ],
    });

    const result = await runProvenanceTraversal(port, {
      startNodeId: "n-intent-a",
      maxDepth: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.startSubjectRef).toBe("wf-a");
    expect(result.value.relatedWorkflowIds).toEqual(["wf-a", "wf-b"]);
    expect(result.value.nodes.some((n) => n.nodeId === "n-intent-b")).toBe(
      true,
    );
    expect(
      result.value.nodes.find((n) => n.nodeId === "n-intent-b")?.crossedWorkflow,
    ).toBe(true);

    const again = await runProvenanceTraversal(port, {
      startNodeId: "n-intent-a",
      maxDepth: 2,
    });
    expect(again.ok && again.value).toEqual(result.value);
  });
});
