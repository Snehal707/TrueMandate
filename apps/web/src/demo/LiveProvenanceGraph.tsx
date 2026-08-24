import { useEffect, useState } from "react";
import type {
  LiveGraphNode,
  LiveGraphStage,
  LiveProvenanceModel,
  TruthSource,
} from "./liveWorkflowTruth";
import type { AttackProvenanceOverlay } from "./attackLabCore";
import { ProductTruthBadge } from "./ProductTruth";

const STAGE_LABELS: Readonly<Record<LiveGraphStage, string>> = {
  intent: "Intent",
  semantic: "Semantic state",
  evidence: "Evidence & proofs",
  plan: "Plan",
  "plan-verification": "Plan verification",
  guardian: "Guardian",
  authority: "Authority",
  "approval-monitoring": "Approval / Monitoring",
  execution: "Execution",
  outcome: "Outcome",
  resolution: "Resolution",
  other: "Other recorded artifacts",
};

const STAGE_ORDER: readonly LiveGraphStage[] = [
  "intent",
  "semantic",
  "evidence",
  "plan",
  "plan-verification",
  "guardian",
  "authority",
  "approval-monitoring",
  "execution",
  "outcome",
  "resolution",
  "other",
];

function sourceLabel(source: TruthSource): string {
  return source === "PUBLIC_API" ? "PUBLIC SDK / API" : "DERIVED PRESENTATION";
}

function InspectorRow(props: { readonly label: string; readonly value?: string }) {
  if (!props.value) return null;
  return (
    <div className="tm-live-inspector-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function NodeInspector(props: { readonly node: LiveGraphNode }) {
  const node = props.node;
  return (
    <aside className="tm-live-graph-inspector" aria-label={`Artifact inspector: ${node.label}`}>
      <div className="tm-live-inspector-head">
        <div>
          <p className="tm-live-kicker">Selected public-safe record</p>
          <h4>{node.label}</h4>
        </div>
        <span className="tm-live-truth-source">{sourceLabel(node.source)}</span>
      </div>
      <InspectorRow label="Artifact / stage type" value={node.kind} />
      <InspectorRow label="ID" value={node.id} />
      <InspectorRow label="State / status" value={node.state} />
      <InspectorRow label="Timestamp" value={node.timestamp} />
      <InspectorRow label="Workflow" value={node.workflowId} />
      <InspectorRow label="Intent" value={node.intentId} />
      <InspectorRow label="IntentState" value={node.intentStateId} />
      <InspectorRow label="Decision" value={node.decision} />
      <InspectorRow label="Trust class" value={node.trustClass} />
      <InspectorRow
        label="Predecessors"
        value={node.predecessorIds.length ? node.predecessorIds.join(" · ") : undefined}
      />
      <InspectorRow
        label="Safe evidence refs"
        value={node.evidenceRefs.length ? node.evidenceRefs.join(" · ") : undefined}
      />
      <InspectorRow
        label="Findings"
        value={node.findings.length ? node.findings.join(" · ") : undefined}
      />
      {node.tainted ? (
        <p className="tm-live-inspector-warning">External or tainted data remains visibly marked and does not create authority.</p>
      ) : null}
      <p className="tm-live-inspector-note">
        Privileged authorization handles, CommitTokens, raw grants, credentials, and verifier-only data are not part of this inspector.
      </p>
    </aside>
  );
}

export function LiveProvenanceGraph(props: {
  readonly model: LiveProvenanceModel;
  readonly overlays?: readonly AttackProvenanceOverlay[];
}) {
  const [selectedId, setSelectedId] = useState(props.model.nodes[0]?.id);
  useEffect(() => {
    if (!props.model.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(props.model.nodes[0]?.id);
    }
  }, [props.model.nodes, selectedId]);

  if (!props.model.nodes.length) {
    return (
      <div className="tm-live-unavailable">
        No public provenance or durable stage references are available for this workflow yet.
      </div>
    );
  }

  const selected = props.model.nodes.find((node) => node.id === selectedId) ?? props.model.nodes[0]!;
  const incomingByNode = new Map<string, typeof props.model.edges>();
  for (const edge of props.model.edges) {
    incomingByNode.set(edge.to, [...(incomingByNode.get(edge.to) ?? []), edge]);
  }

  return (
    <div className="tm-live-graph-layout">
      <div>
        <div className="tm-live-graph-legend" aria-label="Relationship legend">
          <span><i className="recorded" /> Recorded relationship</span>
          <span><i className="fallback" /> Public stage-order fallback</span>
        </div>
        <div className="tm-live-graph-canvas" role="group" aria-label="Interactive live workflow provenance graph">
          {STAGE_ORDER.map((stage) => {
            const stageNodes = props.model.nodes.filter((node) => node.stage === stage);
            if (!stageNodes.length) return null;
            return (
              <section className={`tm-live-graph-stage stage-${stage}`} key={stage}>
                <h4>{STAGE_LABELS[stage]}</h4>
                <div className="tm-live-graph-node-list">
                  {stageNodes.map((node) => {
                    const incoming = incomingByNode.get(node.id) ?? [];
                    return (
                      <div className="tm-live-graph-node-wrap" key={node.id}>
                        {(props.overlays ?? []).filter((overlay) => overlay.relatedNodeIds.includes(node.id)).length ? (
                          <div className="tm-live-overlay-labels" aria-label="Attack vector markers">
                            {(props.overlays ?? [])
                              .filter((overlay) => overlay.relatedNodeIds.includes(node.id))
                              .map((overlay) => (
                                <span key={overlay.vectorId}>
                                  V{overlay.order} · {overlay.relation}
                                </span>
                              ))}
                          </div>
                        ) : null}
                        {incoming.length ? (
                          <div className="tm-live-edge-labels" aria-label="Incoming relationships">
                            {incoming.map((edge) => (
                              <span
                                key={edge.id}
                                className={edge.source === "PUBLIC_API" ? "recorded" : "fallback"}
                              >
                                {edge.relation}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className={`tm-live-graph-node${selected.id === node.id ? " selected" : ""}`}
                          aria-pressed={selected.id === node.id}
                          onClick={() => setSelectedId(node.id)}
                        >
                          <span className="tm-live-graph-kind">{node.kind.replaceAll("_", " ")}</span>
                          <strong>{node.label}</strong>
                          <small>{node.state ?? "Recorded"}</small>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <p className="tm-live-graph-footnote">
          {props.model.recordedEdgeCount} relationship(s) came from the public provenance graph or submitted public lineage. {props.model.fallbackEdgeCount} ordering link(s) are presentation-only and do not claim semantic provenance.
        </p>
        {(props.overlays ?? []).length ? (
          <div className="tm-live-overlay-truth">
            <ProductTruthBadge truthClass="PRESENTATION_DERIVED" detail="ATTACK MARKERS" />
            <p className="tm-live-graph-footnote">
              {(props.overlays ?? []).length} attack marker(s) are presentation overlays only. They are not durable provenance edges.
            </p>
          </div>
        ) : null}
      </div>
      <NodeInspector node={selected} />
    </div>
  );
}
