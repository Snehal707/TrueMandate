import type { IntentProvenanceS2SClient } from "@truemandate/cloud-runtime";
import { ErrorCode, err, ok, type ProvenanceEdge, type ProvenanceNode, type Result } from "@truemandate/protocol";
import { parseWithSchema, ProvenanceEdgeSchema, ProvenanceNodeSchema } from "@truemandate/schemas";

/** Owner-only provenance port. Missing taint is never interpreted as clean. */
export class OwnerProvenanceAdapter {
  constructor(private readonly owner: IntentProvenanceS2SClient) {}

  private binding(raw: ProvenanceNode): Result<{ readonly intentStateId?: string; readonly workflowId?: string }> {
    const metadata = raw.metadata;
    if (metadata === undefined) return ok({});
    const values = metadata as Record<string, unknown>;
    const validate = (key: "intentStateId" | "workflowId") => {
      const value = values[key];
      return value === undefined || (typeof value === "string" && value.length > 0);
    };
    if (!validate("intentStateId") || !validate("workflowId")) {
      return err(ErrorCode.VALIDATION_FAILED, "Owner provenance binding metadata is malformed");
    }
    return ok({
      intentStateId: values.intentStateId as string | undefined,
      workflowId: values.workflowId as string | undefined,
    });
  }

  private node(raw: unknown): Result<ProvenanceNode> {
    const parsed = parseWithSchema(ProvenanceNodeSchema, raw, "OwnerProvenanceNode");
    if (!parsed.ok) return parsed;
    const node = parsed.value as unknown as ProvenanceNode;
    if (!node.taint || !Array.isArray(node.taint.classes) || !Array.isArray(node.taint.origins)) {
      return err(ErrorCode.VALIDATION_FAILED, "Owner provenance node lacks required taint metadata");
    }
    const binding = this.binding(node);
    if (!binding.ok) return binding;
    return ok(node);
  }

  private async validateEdgeBindings(edge: ProvenanceEdge): Promise<Result<void>> {
    const from = await this.getNode(edge.from);
    if (!from.ok) return from;
    const to = await this.getNode(edge.to);
    if (!to.ok) return to;
    const fromBinding = this.binding(from.value);
    if (!fromBinding.ok) return fromBinding;
    const toBinding = this.binding(to.value);
    if (!toBinding.ok) return toBinding;
    if (
      (fromBinding.value.intentStateId !== undefined && toBinding.value.intentStateId !== undefined && fromBinding.value.intentStateId !== toBinding.value.intentStateId) ||
      (fromBinding.value.workflowId !== undefined && toBinding.value.workflowId !== undefined && fromBinding.value.workflowId !== toBinding.value.workflowId)
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Provenance edge crosses declared immutable bindings");
    }
    return ok();
  }
  async getNode(id: string): Promise<Result<ProvenanceNode>> {
    const result = await this.owner.getNode(id);
    return result.ok ? this.node(result.value) : result;
  }
  async recordNode(raw: unknown): Promise<Result<ProvenanceNode>> {
    const local = this.node(raw);
    if (!local.ok) return local;
    const saved = await this.owner.recordNode(local.value);
    return saved.ok ? this.node(saved.value) : saved;
  }
  async getEdge(id: string): Promise<Result<ProvenanceEdge>> {
    const result = await this.owner.getEdge(id);
    if (!result.ok) return result;
    const edge = parseWithSchema(ProvenanceEdgeSchema, result.value, "OwnerProvenanceEdge") as Result<ProvenanceEdge>;
    if (!edge.ok) return edge;
    const bindings = await this.validateEdgeBindings(edge.value);
    return bindings.ok ? edge : bindings;
  }
  async recordEdge(raw: unknown): Promise<Result<ProvenanceEdge>> {
    const local = parseWithSchema(ProvenanceEdgeSchema, raw, "OwnerProvenanceEdge");
    if (!local.ok) return local as Result<ProvenanceEdge>;
    const bindings = await this.validateEdgeBindings(local.value as ProvenanceEdge);
    if (!bindings.ok) return bindings;
    const saved = await this.owner.recordEdge(local.value);
    if (!saved.ok) return saved;
    const edge = parseWithSchema(ProvenanceEdgeSchema, saved.value, "OwnerProvenanceEdge") as Result<ProvenanceEdge>;
    if (!edge.ok) return edge;
    const savedBindings = await this.validateEdgeBindings(edge.value);
    return savedBindings.ok ? edge : savedBindings;
  }
}
