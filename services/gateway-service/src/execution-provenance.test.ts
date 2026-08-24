import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { authorityExecutionProvenance, executionActionProvenance, semanticActionProvenance } from "@truemandate/provenance";
import { ProvenanceNodeKind, SemanticRelation, TrustClass, err, ok } from "@truemandate/protocol";
import { reconstructExecutionAuthorityPath } from "./execution-provenance.js";

const H = (c: string) => c.repeat(64);
const now = "2026-06-01T12:00:00.000Z";
const lineage = { preparedActionId: "prepared-1", preparedActionHash: H("a"), actionId: "action-1", actionHash: H("b"), workflowId: "wf-1", evaluationId: "eval-1", evaluationHash: H("c"), outcomeContractId: "outcome-1", outcomeContractHash: H("d"), intentStateId: "state-1", intentStateHash: H("e"), intentStateVersion: 1 };

function fixture() {
  const semantic = semanticActionProvenance(lineage, now);
  const execution = executionActionProvenance(lineage, now);
  const grant = { id: "grant-1", principalId: "principal-1", intentId: "intent-1", preparedActionId: lineage.preparedActionId, preparedActionHash: lineage.preparedActionHash, workflowId: lineage.workflowId, actionContentHash: lineage.actionHash, evaluationRecordId: lineage.evaluationId, evaluationRecordHash: lineage.evaluationHash, outcomeContractId: lineage.outcomeContractId, outcomeContractHash: lineage.outcomeContractHash, intentStateId: lineage.intentStateId, stateHash: lineage.intentStateHash, evaluatedIntentStateVersion: 1 } as never;
  const authority = authorityExecutionProvenance({ ...lineage, grantId: "grant-1", grantHash: hashCanonical(grant), principalId: "principal-1" }, now);
  const intent = { id: "intent-node-intent-1", kind: ProvenanceNodeKind.INTENT, label: "intent", createdAt: now, trustClass: TrustClass.TRUSTED_HUMAN, taint: { classes: ["NONE"], origins: [] } } as never;
  const semanticEdge = { id: "semantic-action-intent-wf-1", from: intent.id, to: semantic.id, relation: SemanticRelation.DERIVED_FROM, createdAt: now } as never;
  const nodes = new Map([[intent.id, intent], [semantic.id, semantic], [execution.node.id, execution.node], [authority.principal.id, authority.principal], [authority.authority.id, authority.authority]]);
  const edges = new Map([[semanticEdge.id, semanticEdge], [execution.edge.id, execution.edge], [authority.principalEdge.id, authority.principalEdge], [authority.authorizes.id, authority.authorizes]]);
  const owner = { getNode: async (id: string) => nodes.has(id) ? ok(nodes.get(id)!) : err("VALIDATION_FAILED" as never, "missing"), getEdge: async (id: string) => edges.has(id) ? ok(edges.get(id)!) : err("VALIDATION_FAILED" as never, "missing") };
  const prepared = { id: lineage.preparedActionId, preparedActionHash: lineage.preparedActionHash, actionProposalId: lineage.actionId, actionContentHash: lineage.actionHash, workflowId: lineage.workflowId, evaluationRecordId: lineage.evaluationId, evaluationRecordHash: lineage.evaluationHash, outcomeContractId: lineage.outcomeContractId, outcomeContractHash: lineage.outcomeContractHash, intentStateId: lineage.intentStateId, intentStateHash: lineage.intentStateHash, evaluatedIntentStateVersion: 1 } as never;
  const token = { id: "token-1", grantId: "grant-1", preparedActionId: lineage.preparedActionId, preparedActionHash: lineage.preparedActionHash } as never;
  return { owner, prepared, grant, token, nodes, edges };
}

describe("Gateway execution provenance reconstruction", () => {
  it("reconstructs the privileged path from durable token, prepared action, and grant only", async () => {
    const f = fixture();
    const result = await reconstructExecutionAuthorityPath({ token: f.token, preparedAction: f.prepared, grant: f.grant, provenance: f.owner });
    expect(result.ok).toBe(true);
  });
  it("fails closed when the durable AUTHORIZES relation is absent", async () => {
    const f = fixture();
    for (const [id, edge] of f.edges) if (edge.relation === SemanticRelation.AUTHORIZES) f.edges.delete(id);
    const result = await reconstructExecutionAuthorityPath({ token: f.token, preparedAction: f.prepared, grant: f.grant, provenance: f.owner });
    expect(result.ok).toBe(false);
  });
  it.each([
    ["execution action", "node", "execution-action-prepared-1"],
    ["semantic action", "node", "action-provenance-wf-1"],
    ["semantic derivation", "edge", "execution-action-derived-"],
    ["principal authority", "edge", "principal-authority-"],
    ["authorization", "edge", "authorizes-"],
  ])("fails closed when %s provenance is missing", async (_label, kind, prefix) => {
    const f = fixture();
    const records = kind === "node" ? f.nodes : f.edges;
    for (const id of records.keys()) if (id.startsWith(prefix)) records.delete(id);
    const result = await reconstructExecutionAuthorityPath({ token: f.token, preparedAction: f.prepared, grant: f.grant, provenance: f.owner });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["grant", (f: ReturnType<typeof fixture>) => ({ ...f.grant, workflowId: "wf-other" })],
    ["prepared action", (f: ReturnType<typeof fixture>) => ({ ...f.prepared, actionContentHash: H("f") })],
    ["token", (f: ReturnType<typeof fixture>) => ({ ...f.token, preparedActionHash: H("f") })],
  ])("fails closed on substituted %s", async (_label, mutate) => {
    const f = fixture();
    const changed = mutate(f);
    const result = await reconstructExecutionAuthorityPath({ token: _label === "token" ? changed : f.token, preparedAction: _label === "prepared action" ? changed : f.prepared, grant: _label === "grant" ? changed : f.grant, provenance: f.owner });
    expect(result.ok).toBe(false);
  });

  it("fails closed on canonically shaped but wrong Authority metadata", async () => {
    const f = fixture();
    for (const [id, node] of f.nodes) if (String(id).startsWith("authority-grant-")) f.nodes.set(id, { ...node, metadata: { ...(node.metadata as object), workflowId: "wf-other" } });
    const result = await reconstructExecutionAuthorityPath({ token: f.token, preparedAction: f.prepared, grant: f.grant, provenance: f.owner });
    expect(result.ok).toBe(false);
  });

  it.each([
    ["authorization grant", "grantId", "grant-other"],
    ["authorization prepared action", "preparedActionHash", H("f")],
    ["authorization execution target", "to", "execution-action-other"],
    ["semantic action hash", "actionHash", H("f")],
    ["workflow", "workflowId", "wf-other"],
    ["evaluation", "evaluationHash", H("f")],
    ["outcome", "outcomeContractHash", H("f")],
    ["intent state id", "intentStateId", "state-other"],
    ["intent state hash", "intentStateHash", H("f")],
    ["intent state version", "intentStateVersion", 2],
  ])("fails closed on one-field %s provenance substitution", async (_label, field, value) => {
    const f = fixture();
    if (field === "to") {
      for (const [id, edge] of f.edges) if (edge.relation === SemanticRelation.AUTHORIZES) f.edges.set(id, { ...edge, to: value as never });
    } else if (field === "actionHash") {
      for (const [id, node] of f.nodes) if (String(id).startsWith("action-provenance-")) f.nodes.set(id, { ...node, metadata: { ...(node.metadata as object), [field]: value } });
    } else {
      for (const [id, edge] of f.edges) if (edge.relation === SemanticRelation.AUTHORIZES) f.edges.set(id, { ...edge, metadata: { ...(edge.metadata as object), [field]: value } });
    }
    const result = await reconstructExecutionAuthorityPath({ token: f.token, preparedAction: f.prepared, grant: f.grant, provenance: f.owner });
    expect(result.ok).toBe(false);
  });
});
