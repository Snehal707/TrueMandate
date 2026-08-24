import { describe, expect, it } from "vitest";
import { authorityExecutionProvenance, executionActionProvenance, semanticActionNodeId, semanticActionProvenance } from "./execution-provenance.js";

const lineage = {
  preparedActionId: "prepared-1", preparedActionHash: "a".repeat(64),
  actionId: "action-1", actionHash: "b".repeat(64), workflowId: "wf-1",
  evaluationId: "evaluation-1", evaluationHash: "c".repeat(64),
  outcomeContractId: "outcome-1", outcomeContractHash: "d".repeat(64),
  intentStateId: "state-1", intentStateHash: "e".repeat(64), intentStateVersion: 1,
};
const now = "2026-06-01T12:00:00.000Z";

describe("execution provenance builders", () => {
  it("derives deterministic semantic and execution records from canonical lineage", () => {
    const semantic = semanticActionProvenance(lineage, now);
    const first = executionActionProvenance(lineage, now);
    const replay = executionActionProvenance(lineage, now);
    expect(semantic.id).toBe(semanticActionNodeId(lineage));
    expect(first.edge.from).toBe(semantic.id);
    expect(first).toEqual(replay);
    expect(first.node.metadata).toMatchObject(lineage);
  });

  it("changes deterministic authorization identity when immutable grant lineage changes", () => {
    const first = authorityExecutionProvenance({ ...lineage, grantId: "grant-1", grantHash: "f".repeat(64), principalId: "principal-1" }, now);
    const changed = authorityExecutionProvenance({ ...lineage, grantId: "grant-2", grantHash: "f".repeat(64), principalId: "principal-1" }, now);
    expect(first.authority.id).not.toBe(changed.authority.id);
    expect(first.authorizes.id).not.toBe(changed.authorizes.id);
  });

  it("rejects malformed authority-bearing hashes", () => {
    expect(() => executionActionProvenance({ ...lineage, actionHash: "not-a-hash" }, now)).toThrow();
  });
});
