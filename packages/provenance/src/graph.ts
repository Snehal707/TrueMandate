import {
  ErrorCode,
  SemanticRelation,
  TaintClass,
  TrustClass,
  err,
  ok,
  type ProvenanceEdge,
  type ProvenanceEdgeId,
  type ProvenanceNode,
  type ProvenanceNodeId,
  type Result,
  type SemanticRelation as SemanticRelationType,
  type TaintMetadata,
} from "@truemandate/protocol";

const TAINT_PROPAGATING_RELATIONS: ReadonlySet<SemanticRelationType> = new Set([
  SemanticRelation.DERIVED_FROM,
  SemanticRelation.INFLUENCED_BY,
  SemanticRelation.INTRODUCED_BY,
  SemanticRelation.SUMMARIZES,
  SemanticRelation.DELEGATES_TO,
  SemanticRelation.SUPPORTS,
  SemanticRelation.PARTIALLY_SUPPORTS,
  SemanticRelation.ASSUMES,
  SemanticRelation.RESULTED_IN,
  SemanticRelation.WEAKENS,
  SemanticRelation.STRENGTHENS,
  SemanticRelation.PRESERVES,
]);

function mergeTaint(a: TaintMetadata, b: TaintMetadata): TaintMetadata {
  const classes = new Set<TaintClass>([...a.classes, ...b.classes]);
  classes.delete(TaintClass.NONE);
  if (classes.size === 0) {
    classes.add(TaintClass.NONE);
  }
  const origins = new Set<ProvenanceNodeId>([...a.origins, ...b.origins]);
  return {
    classes: [...classes],
    origins: [...origins],
    reason: a.reason ?? b.reason,
  };
}

function hasExternalTaint(taint: TaintMetadata): boolean {
  return taint.classes.some(
    (c) =>
      c === TaintClass.EXTERNAL_CONTENT ||
      c === TaintClass.PROMPT_INJECTION_SUSPECTED ||
      c === TaintClass.UNVERIFIED_CLAIM,
  );
}

export interface PathTraceResult {
  readonly path: readonly ProvenanceNodeId[];
  readonly nodes: readonly ProvenanceNode[];
}

/**
 * In-memory provenance graph with transitive taint propagation.
 *
 * Edge polarity (canonical): every edge is an influence/derivation arrow
 * `from` = upstream source → `to` = downstream derivative.
 * Relation names are labels on that arrow; English grammar may be inverted
 * (e.g. DERIVED_FROM is stored source→derivative). See docs/architecture/provenance-edges.md.
 */
export class ProvenanceGraph {
  private readonly nodes = new Map<string, ProvenanceNode>();
  private readonly edges = new Map<string, ProvenanceEdge>();
  /** adjacency: from -> edges */
  private readonly out = new Map<string, ProvenanceEdge[]>();
  /** adjacency: to -> edges */
  private readonly inn = new Map<string, ProvenanceEdge[]>();

  addNode(node: ProvenanceNode): Result<ProvenanceNode> {
    if (this.nodes.has(node.id)) {
      return err(ErrorCode.VALIDATION_FAILED, "Provenance node already exists", {
        id: node.id,
      });
    }
    this.nodes.set(node.id, node);
    return ok(node);
  }

  getNode(id: ProvenanceNodeId | string): ProvenanceNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(): readonly ProvenanceNode[] {
    return [...this.nodes.values()];
  }

  listEdges(): readonly ProvenanceEdge[] {
    return [...this.edges.values()];
  }

  /**
   * Propagate external taint from a node to all descendants along taint-carrying edges.
   * Fixes out-of-order edge insertion (downstream edges added before upstream taint).
   */
  private repropagateTaintFrom(startId: string): void {
    const queue = [startId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const source = this.nodes.get(id);
      if (!source || !hasExternalTaint(source.taint)) continue;
      for (const edge of this.out.get(id) ?? []) {
        if (!TAINT_PROPAGATING_RELATIONS.has(edge.relation)) continue;
        const target = this.nodes.get(edge.to);
        if (!target) continue;
        const merged = mergeTaint(target.taint, {
          classes: source.taint.classes.filter((c) => c !== TaintClass.NONE),
          origins:
            source.taint.origins.length > 0 ? source.taint.origins : [source.id],
          reason: `propagated via ${edge.relation}`,
        });
        if (hasExternalTaint(source.taint) && !hasExternalTaint(merged)) {
          continue;
        }
        const before = JSON.stringify(target.taint);
        const after = JSON.stringify(merged);
        if (before !== after) {
          this.nodes.set(target.id, { ...target, taint: merged });
          queue.push(target.id);
        }
      }
    }
  }

  /**
   * Adds an influence-flow edge: `from` (upstream) → `to` (downstream).
   * Propagates taint along the arrow when the relation carries influence.
   * INV_004: summarization/delegation cannot erase taint.
   */
  addEdge(edge: ProvenanceEdge): Result<ProvenanceEdge> {
    if (this.edges.has(edge.id)) {
      return err(ErrorCode.VALIDATION_FAILED, "Provenance edge already exists", {
        id: edge.id,
      });
    }
    const from = this.nodes.get(edge.from);
    const to = this.nodes.get(edge.to);
    if (!from || !to) {
      return err(ErrorCode.VALIDATION_FAILED, "Edge endpoints must exist", {
        from: edge.from,
        to: edge.to,
      });
    }

    this.edges.set(edge.id, edge);
    const outs = this.out.get(edge.from) ?? [];
    outs.push(edge);
    this.out.set(edge.from, outs);
    const inns = this.inn.get(edge.to) ?? [];
    inns.push(edge);
    this.inn.set(edge.to, inns);

    if (TAINT_PROPAGATING_RELATIONS.has(edge.relation)) {
      if (hasExternalTaint(from.taint)) {
        this.repropagateTaintFrom(from.id);
      }
      // Also pull taint into `to` from all inbound taint-carrying parents (out-of-order fix).
      this.repropagateTaintInto(to.id);
    }

    const afterTo = this.nodes.get(to.id)!;
    if (hasExternalTaint(from.taint) && !hasExternalTaint(afterTo.taint)) {
      return err(
        ErrorCode.TAINT_ERASURE_FORBIDDEN,
        "Taint must survive summarization, transformation, and delegation",
      );
    }

    return ok(edge);
  }

  private repropagateTaintInto(nodeId: string): void {
    for (const edge of this.inn.get(nodeId) ?? []) {
      if (!TAINT_PROPAGATING_RELATIONS.has(edge.relation)) continue;
      this.repropagateTaintFrom(edge.from);
    }
  }

  /**
   * INV_003: Untrusted external content cannot create authority.
   */
  assertCanCreateAuthority(sourceNodeId: ProvenanceNodeId | string): Result<void> {
    const node = this.nodes.get(sourceNodeId);
    if (!node) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown provenance node", {
        id: sourceNodeId,
      });
    }
    if (
      node.trustClass === TrustClass.UNTRUSTED_EXTERNAL ||
      hasExternalTaint(node.taint)
    ) {
      return err(
        ErrorCode.UNTRUSTED_CANNOT_CREATE_AUTHORITY,
        "Untrusted external content cannot create authority",
        { nodeId: node.id, trustClass: node.trustClass, taint: node.taint },
      );
    }
    return ok();
  }

  /**
   * Attempt to record an AUTHORIZES edge; fails if source is tainted/untrusted.
   */
  authorize(
    edgeId: ProvenanceEdgeId | string,
    fromAuthorityNodeId: ProvenanceNodeId | string,
    toActionNodeId: ProvenanceNodeId | string,
    createdAt: string,
  ): Result<ProvenanceEdge> {
    const can = this.assertCanCreateAuthority(fromAuthorityNodeId);
    if (!can.ok) {
      return can;
    }
    return this.addEdge({
      id: edgeId as ProvenanceEdgeId,
      from: fromAuthorityNodeId as ProvenanceNodeId,
      to: toActionNodeId as ProvenanceNodeId,
      relation: SemanticRelation.AUTHORIZES,
      createdAt,
    });
  }

  /**
   * Upstream nodes reachable by walking edges backward (to → from).
   * Includes `startId` itself.
   */
  ancestors(startId: ProvenanceNodeId | string): readonly ProvenanceNodeId[] {
    const seen = new Set<string>();
    const order: ProvenanceNodeId[] = [];
    const stack = [String(startId)];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id as ProvenanceNodeId);
      for (const edge of this.inn.get(id) ?? []) {
        stack.push(edge.from);
      }
    }
    return order;
  }

  /**
   * Downstream nodes reachable by walking edges forward (from → to).
   * Includes `startId` itself.
   */
  descendants(startId: ProvenanceNodeId | string): readonly ProvenanceNodeId[] {
    const seen = new Set<string>();
    const order: ProvenanceNodeId[] = [];
    const stack = [String(startId)];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id as ProvenanceNodeId);
      for (const edge of this.out.get(id) ?? []) {
        stack.push(edge.to);
      }
    }
    return order;
  }

  traceToIntent(nodeId: ProvenanceNodeId | string): Result<PathTraceResult> {
    const path = this.ancestors(String(nodeId));
    const intentNode = path
      .map((id) => this.nodes.get(id))
      .find((n) => n?.kind === "INTENT");
    if (!intentNode) {
      return err(
        ErrorCode.PROVENANCE_NOT_RECONSTRUCTABLE,
        "No path to original human intent",
        { nodeId },
      );
    }
    const intentPath = this.shortestPath(intentNode.id, String(nodeId));
    if (!intentPath) {
      return err(
        ErrorCode.PROVENANCE_NOT_RECONSTRUCTABLE,
        "Intent path not reconstructable",
        { nodeId },
      );
    }
    return ok({
      path: intentPath,
      nodes: intentPath.map((id) => this.nodes.get(id)!),
    });
  }

  findFirstDivergence(
    nodeId: ProvenanceNodeId | string,
  ): Result<{ readonly edge: ProvenanceEdge; readonly node: ProvenanceNode }> {
    const pathToIntent = this.traceToIntent(nodeId);
    if (!pathToIntent.ok) {
      return pathToIntent;
    }
    // Walk forward along path looking for WEAKENS / CONTRADICTS edges.
    for (let i = 0; i < pathToIntent.value.path.length - 1; i += 1) {
      const from = pathToIntent.value.path[i]!;
      const to = pathToIntent.value.path[i + 1]!;
      const edge = (this.out.get(from) ?? []).find(
        (e) =>
          e.to === to &&
          (e.relation === SemanticRelation.WEAKENS ||
            e.relation === SemanticRelation.CONTRADICTS),
      );
      if (edge) {
        return ok({ edge, node: this.nodes.get(to)! });
      }
    }
    return err(ErrorCode.VALIDATION_FAILED, "No divergence found on path", {
      nodeId,
    });
  }

  traceAuthorityToPrincipal(
    authorityNodeId: ProvenanceNodeId | string,
  ): Result<PathTraceResult> {
    const path = this.ancestors(String(authorityNodeId));
    const principal = path
      .map((id) => this.nodes.get(id))
      .find((n) => n?.kind === "PRINCIPAL");
    if (!principal) {
      return err(
        ErrorCode.PRIVILEGED_PATH_INCOMPLETE,
        "Authority does not trace to a principal",
        { authorityNodeId },
      );
    }
    const shortest = this.shortestPath(principal.id, String(authorityNodeId));
    if (!shortest) {
      return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Principal path missing");
    }
    return ok({
      path: shortest,
      nodes: shortest.map((id) => this.nodes.get(id)!),
    });
  }

  traceExternalInfluence(
    nodeId: ProvenanceNodeId | string,
  ): Result<readonly ProvenanceNode[]> {
    const ancestors = this.ancestors(String(nodeId))
      .map((id) => this.nodes.get(id)!)
      .filter(
        (n) =>
          n.kind === "EXTERNAL" ||
          n.trustClass === TrustClass.UNTRUSTED_EXTERNAL ||
          hasExternalTaint(n.taint),
      );
    return ok(ancestors);
  }

  /**
   * INV_012 / INV_013: Privileged action must reconstruct Principal → Intent → Authority → Action.
   */
  assertPrivilegedPath(actionNodeId: ProvenanceNodeId | string): Result<PathTraceResult> {
    const action = this.nodes.get(String(actionNodeId));
    if (!action || action.kind !== "ACTION") {
      return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Action node required", {
        actionNodeId,
      });
    }

    const authorizing = (this.inn.get(action.id) ?? []).filter(
      (e) => e.relation === SemanticRelation.AUTHORIZES,
    );
    if (authorizing.length === 0) {
      return err(
        ErrorCode.PRIVILEGED_PATH_INCOMPLETE,
        "Action lacks AUTHORIZES edge from authority",
      );
    }

    const authorityNode = this.nodes.get(authorizing[0]!.from);
    if (!authorityNode || authorityNode.kind !== "AUTHORITY") {
      return err(
        ErrorCode.PRIVILEGED_PATH_INCOMPLETE,
        "AUTHORIZES source must be AUTHORITY node",
      );
    }

    const toPrincipal = this.traceAuthorityToPrincipal(authorityNode.id);
    if (!toPrincipal.ok) {
      return toPrincipal;
    }

    const toIntent = this.traceToIntent(action.id);
    if (!toIntent.ok) {
      return toIntent;
    }

    const principal = toPrincipal.value.nodes.find((n) => n.kind === "PRINCIPAL");
    const intent = toIntent.value.nodes.find((n) => n.kind === "INTENT");
    if (!principal || !intent) {
      return err(
        ErrorCode.PROVENANCE_NOT_RECONSTRUCTABLE,
        "Every irreversible action requires reconstructable provenance",
      );
    }

    const path = [
      principal.id,
      intent.id,
      authorityNode.id,
      action.id,
    ] as ProvenanceNodeId[];

    return ok({
      path,
      nodes: path.map((id) => this.nodes.get(id)!),
    });
  }

  private shortestPath(
    fromId: string,
    toId: string,
  ): ProvenanceNodeId[] | null {
    if (fromId === toId) {
      return [fromId as ProvenanceNodeId];
    }
    const queue: string[] = [fromId];
    const prev = new Map<string, string | null>([[fromId, null]]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.out.get(current) ?? []) {
        if (!prev.has(edge.to)) {
          prev.set(edge.to, current);
          if (edge.to === toId) {
            const path: ProvenanceNodeId[] = [toId as ProvenanceNodeId];
            let cursor: string | null = current;
            while (cursor) {
              path.unshift(cursor as ProvenanceNodeId);
              cursor = prev.get(cursor) ?? null;
            }
            return path;
          }
          queue.push(edge.to);
        }
      }
    }
    return null;
  }
}

export function emptyTaint(): TaintMetadata {
  return { classes: [TaintClass.NONE], origins: [] };
}

export function externalTaint(origin: ProvenanceNodeId): TaintMetadata {
  return {
    classes: [TaintClass.EXTERNAL_CONTENT],
    origins: [origin],
    reason: "untrusted external content",
  };
}
