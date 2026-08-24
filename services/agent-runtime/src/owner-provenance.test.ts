import { describe, expect, it } from "vitest";
import { ProvenanceGraph, emptyTaint, externalTaint } from "@truemandate/provenance";
import { ErrorCode, ProvenanceNodeKind, SemanticRelation, TaintClass, TrustClass, err, type ProvenanceEdge, type ProvenanceNode, type Result } from "@truemandate/protocol";
import { OwnerProvenanceAdapter } from "./owner-provenance.js";

const createdAt = "2026-01-01T00:00:00.000Z";
type Binding = { intentStateId?: string; workflowId?: string };

function node(id: string, options: { kind?: string; trustClass?: string; taint?: unknown; binding?: Binding; label?: string } = {}): Record<string, unknown> {
  return {
    id, kind: options.kind ?? ProvenanceNodeKind.CLAIM, label: options.label ?? id, createdAt,
    trustClass: options.trustClass ?? TrustClass.TRUSTED_SYSTEM, taint: options.taint ?? emptyTaint(),
    metadata: options.binding
  };
}
function edge(id: string, from: string, to: string, relation = SemanticRelation.DERIVED_FROM): Record<string, unknown> {
  return { id, from, to, relation, createdAt };
}

class OwnerFake {
  readonly graph = new ProvenanceGraph();
  readonly calls = { getNode: 0, recordNode: 0, getEdge: 0, recordEdge: 0 };
  unavailable = false;
  malformedNode?: unknown;
  malformedRecordNode?: unknown;
  private readonly savedNodes = new Map<string, ProvenanceNode>();
  private readonly savedEdges = new Map<string, ProvenanceEdge>();

  async getNode(id: string): Promise<Result<ProvenanceNode>> {
    this.calls.getNode += 1;
    if (this.unavailable) return err(ErrorCode.MODEL_UNAVAILABLE, "owner unavailable", { retryable: true });
    if (this.malformedNode !== undefined) return { ok: true, value: this.malformedNode as ProvenanceNode };
    const saved = this.graph.getNode(id);
    return saved ? { ok: true, value: saved } : err(ErrorCode.VALIDATION_FAILED, "missing node");
  }
  async recordNode(raw: unknown): Promise<Result<ProvenanceNode>> {
    this.calls.recordNode += 1;
    if (this.unavailable) return err(ErrorCode.MODEL_UNAVAILABLE, "owner unavailable", { retryable: true });
    if (this.malformedRecordNode !== undefined) return { ok: true, value: this.malformedRecordNode as ProvenanceNode };
    const saved = this.graph.addNode(raw as ProvenanceNode);
    if (saved.ok) this.savedNodes.set(saved.value.id, saved.value);
    return saved;
  }
  async getEdge(id: string): Promise<Result<ProvenanceEdge>> {
    this.calls.getEdge += 1;
    if (this.unavailable) return err(ErrorCode.MODEL_UNAVAILABLE, "owner unavailable", { retryable: true });
    const saved = this.savedEdges.get(id);
    return saved ? { ok: true, value: saved } : err(ErrorCode.VALIDATION_FAILED, "missing edge");
  }
  async recordEdge(raw: unknown): Promise<Result<ProvenanceEdge>> {
    this.calls.recordEdge += 1;
    if (this.unavailable) return err(ErrorCode.MODEL_UNAVAILABLE, "owner unavailable", { retryable: true });
    const saved = this.graph.addEdge(raw as ProvenanceEdge);
    if (saved.ok) this.savedEdges.set(saved.value.id, saved.value);
    return saved;
  }
}

function adapter(owner = new OwnerFake()) { return { owner, value: new OwnerProvenanceAdapter(owner as never) }; }
async function store(adapterValue: OwnerProvenanceAdapter, ...records: Record<string, unknown>[]) {
  for (const record of records) expect((await adapterValue.recordNode(record)).ok).toBe(true);
}

describe("OwnerProvenanceAdapter", () => {
  it("round-trips explicit clean provenance identity, source, bindings, and edges through the owner", async () => {
    const { owner, value } = adapter();
    const human = node("human", { kind: ProvenanceNodeKind.INTENT, trustClass: TrustClass.TRUSTED_HUMAN, binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    const derived = node("derived", { binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    await store(value, human, derived);
    expect((await value.recordEdge(edge("derive", "human", "derived"))).ok).toBe(true);
    const loaded = await value.getNode("human"); const loadedEdge = await value.getEdge("derive");
    expect(loaded).toMatchObject({ ok: true, value: { id: "human", kind: ProvenanceNodeKind.INTENT, trustClass: TrustClass.TRUSTED_HUMAN, taint: { classes: [TaintClass.NONE], origins: [] }, metadata: { intentStateId: "state-a", workflowId: "workflow-a" } } });
    expect(loadedEdge).toMatchObject({ ok: true, value: { id: "derive", from: "human", to: "derived", relation: SemanticRelation.DERIVED_FROM } });
    expect(owner.calls.recordNode).toBe(2); expect(owner.calls.recordEdge).toBe(1);
  });

  it("preserves external taint through summary, delegation, mixed inputs, and a CLEAN Model Armor result", async () => {
    const { owner, value } = adapter();
    const external = node("external", { kind: ProvenanceNodeKind.EXTERNAL, trustClass: TrustClass.UNTRUSTED_EXTERNAL, taint: externalTaint("external"), binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    const clean = node("clean", { binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    const summary = node("summary", { label: "summary after Model Armor CLEAN", binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    const delegated = node("delegated", { binding: { intentStateId: "state-a", workflowId: "workflow-a" } });
    await store(value, external, clean, summary, delegated);
    expect((await value.recordEdge(edge("summary-edge", "external", "summary", SemanticRelation.SUMMARIZES))).ok).toBe(true);
    expect((await value.recordEdge(edge("mixed-edge", "clean", "summary", SemanticRelation.INFLUENCED_BY))).ok).toBe(true);
    expect((await value.recordEdge(edge("delegate-edge", "summary", "delegated", SemanticRelation.DELEGATES_TO))).ok).toBe(true);
    for (const id of ["summary", "delegated"]) {
      const loaded = await value.getNode(id); expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.taint.classes).toContain(TaintClass.EXTERNAL_CONTENT);
    }
  });

  it.each([
    ["missing taint", (raw: Record<string, unknown>) => { delete raw.taint; }],
    ["malformed taint", (raw: Record<string, unknown>) => { raw.taint = { classes: "NONE", origins: [] }; }],
    ["unknown node kind", (raw: Record<string, unknown>) => { raw.kind = "UNKNOWN_KIND"; }],
    ["malformed binding metadata", (raw: Record<string, unknown>) => { raw.metadata = { intentStateId: 42 }; }]
  ])("fails closed for %s before owner append", async (_name, mutate) => {
    const { owner, value } = adapter(); const raw = node(`bad-${_name}`); mutate(raw);
    const result = await value.recordNode(raw); expect(result.ok).toBe(false); expect(owner.calls.recordNode).toBe(0);
  });

  it("fails closed for malformed owner node success and preserves unavailable retry errors", async () => {
    const malformed = adapter(); malformed.owner.malformedNode = { id: "only-id" };
    expect((await malformed.value.getNode("only-id")).ok).toBe(false);
    const unavailable = adapter(); unavailable.owner.unavailable = true;
    const result = await unavailable.value.getNode("anything"); expect(result).toMatchObject({ ok: false, code: ErrorCode.MODEL_UNAVAILABLE, details: { retryable: true } });
  });

  it("validates an owner append response before returning it to the runtime", async () => {
    const { owner, value } = adapter(); owner.malformedRecordNode = { id: "fabricated" };
    const result = await value.recordNode(node("outgoing"));
    expect(result.ok).toBe(false); expect(owner.calls.recordNode).toBe(1);
  });

  it("rejects malformed edges and edges whose predecessor endpoint is missing", async () => {
    const { owner, value } = adapter();
    expect((await value.recordEdge({ id: "bad", from: "a", relation: SemanticRelation.DERIVED_FROM, createdAt })).ok).toBe(false);
    expect(owner.calls.recordEdge).toBe(0);
    expect((await value.recordEdge(edge("missing", "absent", "also-absent"))).ok).toBe(false);
  });

  it("rejects declared cross-IntentState and cross-workflow predecessor bindings", async () => {
    const { value } = adapter();
    await store(value,
      node("from", { binding: { intentStateId: "state-a", workflowId: "workflow-a" } }),
      node("to", { binding: { intentStateId: "state-b", workflowId: "workflow-b" } })
    );
    const result = await value.recordEdge(edge("cross-binding", "from", "to"));
    expect(result.ok).toBe(false);
  });
});
