import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type ProvenanceEdge,
  type ProvenanceNode,
  type Result,
  type TaintMetadata,
} from "@truemandate/protocol";
import { ProvenanceGraph, emptyTaint } from "@truemandate/provenance";
import {
  ProvenanceEdgeSchema,
  ProvenanceNodeSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { z } from "zod";

const InvalidateClaimRequestSchema = z
  .object({
    claimNodeId: z.string().min(1),
    correctionNodeId: z.string().min(1).optional(),
    reason: z.string().min(1),
    createdAt: z.string().min(1).optional(),
  })
  .strict();

export class ProvenanceService {
  private readonly graph = new ProvenanceGraph();
  private readonly invalidated = new Set<string>();

  constructor(
    private readonly durable?: {
      appendNode(node: {
        readonly id: string;
        readonly payload: unknown;
        readonly createdAt: string;
      }): Promise<void>;
      appendEdge(edge: {
        readonly id: string;
        readonly fromId: string;
        readonly toId: string;
        readonly payload: unknown;
        readonly createdAt: string;
      }): Promise<void>;
      /** Durable reads — restart/cross-instance hydration (Wave 1). */
      getNode?(
        id: string,
      ): Promise<{ readonly payload: unknown; readonly createdAt: string } | undefined>;
      getEdge?(
        id: string,
      ): Promise<{ readonly payload: unknown; readonly createdAt: string } | undefined>;
    },
  ) {}

  /**
   * Hydrate an in-memory graph node from the durable store (cross-instance).
   * Durable store is authoritative: missing local memory may hydrate; a
   * genuinely missing or malformed durable endpoint fails closed.
   */
  private async ensureNodeInGraph(id: string): Promise<Result<void>> {
    if (this.graph.getNode(id)) return ok(undefined);
    if (!this.durable?.getNode) return ok(undefined);
    const row = await this.durable.getNode(id);
    if (!row) {
      return err(ErrorCode.VALIDATION_FAILED, "Provenance edge endpoint missing from durable store", {
        id,
      });
    }
    const parsed = parseWithSchema(ProvenanceNodeSchema, row.payload, "ProvenanceNode");
    if (!parsed.ok) {
      return err(ErrorCode.VALIDATION_FAILED, "Malformed durable provenance node", {
        id,
        cause: parsed.message,
      });
    }
    const added = this.graph.addNode(parsed.value as unknown as ProvenanceNode);
    if (!added.ok) return added;
    return ok(undefined);
  }

  async recordNode(raw: unknown): Promise<Result<ProvenanceNode>> {
    const parsed = parseWithSchema(ProvenanceNodeSchema, raw, "ProvenanceNode");
    if (!parsed.ok) return parsed;
    const node = parsed.value as unknown as ProvenanceNode;
    const existing = this.graph.getNode(node.id);
    if (this.durable) {
      try {
        await this.durable.appendNode({
          id: node.id,
          payload: node,
          createdAt: node.createdAt,
        });
      } catch (e) {
        return err(
          ErrorCode.MODEL_UNAVAILABLE,
          e instanceof Error ? e.message : "Durable provenance node append failed",
          { retryable: true, provenance: "node", id: node.id },
        );
      }
    }
    if (existing) return ok(existing);
    return this.graph.addNode(node);
  }

  async recordEdge(raw: unknown): Promise<Result<ProvenanceEdge>> {
    const parsed = parseWithSchema(ProvenanceEdgeSchema, raw, "ProvenanceEdge");
    if (!parsed.ok) return parsed;
    const edge = parsed.value as unknown as ProvenanceEdge;
    const existingEdge = this.graph.listEdges().find((item) => item.id === edge.id);
    if (existingEdge) return ok(existingEdge);
    // Cross-instance hydration before durable append: durable store is
    // authoritative; missing/malformed endpoints fail closed (no orphan edge).
    const fromHydrated = await this.ensureNodeInGraph(edge.from);
    if (!fromHydrated.ok) return fromHydrated;
    const toHydrated = await this.ensureNodeInGraph(edge.to);
    if (!toHydrated.ok) return toHydrated;
    // Endpoints must exist in-memory after hydration (or were already local).
    if (!this.graph.getNode(edge.from) || !this.graph.getNode(edge.to)) {
      return err(ErrorCode.VALIDATION_FAILED, "Edge endpoints must exist", {
        from: edge.from,
        to: edge.to,
      });
    }
    if (this.durable) {
      try {
        await this.durable.appendEdge({
          id: edge.id,
          fromId: edge.from,
          toId: edge.to,
          payload: edge,
          createdAt: edge.createdAt,
        });
      } catch (e) {
        return err(
          ErrorCode.MODEL_UNAVAILABLE,
          e instanceof Error ? e.message : "Durable provenance edge append failed",
          { retryable: true, provenance: "edge", id: edge.id },
        );
      }
    }
    return this.graph.addEdge(edge);
  }

  getNode(id: string): Result<ProvenanceNode> {
    const node = this.graph.getNode(id);
    if (!node) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown provenance node", { id });
    }
    return ok(node);
  }

  getEdge(id: string): Result<ProvenanceEdge> {
    const edge = this.graph.listEdges().find((item) => item.id === id);
    if (!edge) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown provenance edge", { id });
    }
    return ok(edge);
  }

  traceToIntent(nodeId: string) {
    return this.graph.traceToIntent(nodeId);
  }

  traceExternalInfluence(nodeId: string) {
    return this.graph.traceExternalInfluence(nodeId);
  }

  traceAuthorityToPrincipal(authorityNodeId: string) {
    return this.graph.traceAuthorityToPrincipal(authorityNodeId);
  }

  findFirstDivergence(nodeId: string) {
    return this.graph.findFirstDivergence(nodeId);
  }

  assertPrivilegedPath(actionNodeId: string) {
    return this.graph.assertPrivilegedPath(actionNodeId);
  }

  assertCanCreateAuthority(nodeId: string) {
    return this.graph.assertCanCreateAuthority(nodeId);
  }

  /**
   * Invalidate a claim without rewriting history: append CORRECTED_BY edge + correction node.
   */
  async invalidateClaim(raw: unknown): Promise<Result<{
    readonly correctionNode: ProvenanceNode;
    readonly edge: ProvenanceEdge;
  }>> {
    const parsed = parseWithSchema(
      InvalidateClaimRequestSchema,
      raw,
      "InvalidateClaimRequest",
    );
    if (!parsed.ok) return parsed;

    const claim = this.graph.getNode(parsed.value.claimNodeId);
    if (!claim) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown claim node", {
        claimNodeId: parsed.value.claimNodeId,
      });
    }

    const createdAt = parsed.value.createdAt ?? new Date().toISOString();
    const correctionId = asProvenanceNodeId(
      parsed.value.correctionNodeId ?? `correction-${claim.id}`,
    );

    const taint: TaintMetadata = emptyTaint();
    const correctionNode: ProvenanceNode = {
      id: correctionId,
      kind: ProvenanceNodeKind.CORRECTION,
      label: `invalidate:${claim.id}`,
      createdAt,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint,
      metadata: { reason: parsed.value.reason, invalidatedNodeId: claim.id },
    };

    const addNode = this.graph.addNode(correctionNode);
    if (!addNode.ok) return addNode;
    if (this.durable) {
      await this.durable.appendNode({
        id: correctionNode.id,
        payload: correctionNode,
        createdAt: correctionNode.createdAt,
      });
    }

    const edge: ProvenanceEdge = {
      id: asProvenanceEdgeId(`corrected-${claim.id}-${correctionId}`),
      from: claim.id,
      to: correctionId,
      relation: SemanticRelation.CORRECTED_BY,
      createdAt,
      metadata: { reason: parsed.value.reason },
    };
    const addEdge = this.graph.addEdge(edge);
    if (!addEdge.ok) return addEdge;
    if (this.durable) {
      await this.durable.appendEdge({
        id: edge.id,
        fromId: edge.from,
        toId: edge.to,
        payload: edge,
        createdAt: edge.createdAt,
      });
    }

    this.invalidated.add(claim.id);
    return ok({ correctionNode, edge });
  }

  isInvalidated(nodeId: string): boolean {
    return this.invalidated.has(nodeId);
  }

  /** Expose graph for tests / gateway path assembly. */
  getGraph(): ProvenanceGraph {
    return this.graph;
  }
}
