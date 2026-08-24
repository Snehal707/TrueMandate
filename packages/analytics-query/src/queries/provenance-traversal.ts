import { ok, type Result } from "@truemandate/protocol";
import {
  isMemoryQueryPort,
  type AnalyticsQuerySeed,
  type BigQueryQueryPort,
} from "../query-port.js";

export interface ProvenanceTraversalParams {
  readonly startNodeId: string;
  /** Max BFS depth (default 4, max 16). */
  readonly maxDepth?: number;
}

export interface ProvenanceTraversalNode {
  readonly nodeId: string;
  readonly kind: string;
  readonly label: string;
  readonly subjectRef: string | null;
  readonly depth: number;
  readonly crossedWorkflow: boolean;
}

export interface ProvenanceTraversalEdge {
  readonly edgeId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly relation: string;
  readonly depth: number;
}

export interface ProvenanceTraversalResult {
  readonly startNodeId: string;
  readonly startSubjectRef: string | null;
  readonly nodes: readonly ProvenanceTraversalNode[];
  readonly edges: readonly ProvenanceTraversalEdge[];
  readonly relatedWorkflowIds: readonly string[];
}

/**
 * Provenance traversal is graph-native and runs in-process against the seed
 * (memory) or a Google-fetched node/edge dump. SQL BFS is not used — BigQuery
 * Graph is deferred; this keeps results deterministic and bounded.
 */
export function aggregateProvenanceTraversal(
  seed: AnalyticsQuerySeed,
  params: ProvenanceTraversalParams,
): ProvenanceTraversalResult {
  const maxDepth = Math.max(
    0,
    Math.min(16, Math.floor(params.maxDepth ?? 4)),
  );
  const nodesById = new Map(seed.provenanceNodes.map((n) => [n.node_id, n]));
  const adj = new Map<
    string,
    { edgeId: string; other: string; relation: string; outbound: boolean }[]
  >();

  for (const e of seed.provenanceEdges) {
    const fromList = adj.get(e.from_node_id) ?? [];
    fromList.push({
      edgeId: e.edge_id,
      other: e.to_node_id,
      relation: e.relation,
      outbound: true,
    });
    adj.set(e.from_node_id, fromList);
    const toList = adj.get(e.to_node_id) ?? [];
    toList.push({
      edgeId: e.edge_id,
      other: e.from_node_id,
      relation: e.relation,
      outbound: false,
    });
    adj.set(e.to_node_id, toList);
  }

  const start = nodesById.get(params.startNodeId);
  const startSubjectRef = start?.subject_ref ?? null;
  const visited = new Set<string>();
  const edgeSeen = new Set<string>();
  const outNodes: ProvenanceTraversalNode[] = [];
  const outEdges: ProvenanceTraversalEdge[] = [];
  const relatedWorkflows = new Set<string>();

  if (!start) {
    return {
      startNodeId: params.startNodeId,
      startSubjectRef: null,
      nodes: [],
      edges: [],
      relatedWorkflowIds: [],
    };
  }

  type QueueItem = { id: string; depth: number };
  const queue: QueueItem[] = [{ id: start.node_id, depth: 0 }];
  visited.add(start.node_id);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const node = nodesById.get(cur.id);
    if (!node) continue;
    const crossed =
      startSubjectRef !== null &&
      node.subject_ref !== null &&
      node.subject_ref !== startSubjectRef;
    outNodes.push({
      nodeId: node.node_id,
      kind: node.kind,
      label: node.label,
      subjectRef: node.subject_ref,
      depth: cur.depth,
      crossedWorkflow: crossed,
    });
    if (node.subject_ref) relatedWorkflows.add(node.subject_ref);

    if (cur.depth >= maxDepth) continue;
    const neighbors = adj.get(cur.id) ?? [];
    // Deterministic neighbor order by edgeId.
    const ordered = [...neighbors].sort((a, b) =>
      a.edgeId.localeCompare(b.edgeId),
    );
    for (const n of ordered) {
      if (!edgeSeen.has(n.edgeId)) {
        edgeSeen.add(n.edgeId);
        outEdges.push({
          edgeId: n.edgeId,
          fromNodeId: n.outbound ? cur.id : n.other,
          toNodeId: n.outbound ? n.other : cur.id,
          relation: n.relation,
          depth: cur.depth + 1,
        });
      }
      if (!visited.has(n.other)) {
        visited.add(n.other);
        queue.push({ id: n.other, depth: cur.depth + 1 });
      }
    }
  }

  outNodes.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.nodeId.localeCompare(b.nodeId);
  });
  outEdges.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.edgeId.localeCompare(b.edgeId);
  });

  return {
    startNodeId: params.startNodeId,
    startSubjectRef,
    nodes: outNodes,
    edges: outEdges,
    relatedWorkflowIds: [...relatedWorkflows].sort(),
  };
}

export async function runProvenanceTraversal(
  port: BigQueryQueryPort,
  params: ProvenanceTraversalParams,
): Promise<Result<ProvenanceTraversalResult>> {
  if (isMemoryQueryPort(port)) {
    return ok(aggregateProvenanceTraversal(port.getSeed(), params));
  }
  // Google path: pull the full node/edge tables once (bounded analytics use),
  // then run the same deterministic BFS. Avoids non-portable recursive SQL.
  const nodesResult = await port.run<{
    node_id: string;
    kind: string;
    label: string;
    trust_class: string;
    taint: string | null;
    subject_ref: string | null;
    created_at: string;
    exported_at: string;
    schema_version: string;
    export_id: string;
  }>("SELECT * FROM `${dataset}.provenance_nodes`".replace("${dataset}", "tm_analytics"));
  if (!nodesResult.ok) return nodesResult;
  const edgesResult = await port.run<{
    edge_id: string;
    from_node_id: string;
    to_node_id: string;
    relation: string;
    created_at: string;
    exported_at: string;
    schema_version: string;
    export_id: string;
  }>("SELECT * FROM `${dataset}.provenance_edges`".replace("${dataset}", "tm_analytics"));
  if (!edgesResult.ok) return edgesResult;

  const seed: AnalyticsQuerySeed = {
    governanceEvents: [],
    provenanceNodes: nodesResult.value,
    provenanceEdges: edgesResult.value,
  };
  return ok(aggregateProvenanceTraversal(seed, params));
}
