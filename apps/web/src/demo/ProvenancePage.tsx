import { useState } from "react";
import type { CanonicalProjection } from "@truemandate/read-model";
import {
  deriveProvenanceNodes,
  PROVENANCE_GROUPS,
  type ProvenanceNode,
} from "./provenance-nodes";

/**
 * Canonical provenance — a real staged flow over the 10 durable canonical
 * records, not a database listing. Locked layout: staged graph (left) +
 * record inspector (right). Friendly meaning first, raw id as metadata.
 * No dragging, no editing — judge mode.
 */

const STATUS_LABEL: Readonly<Record<ProvenanceNode["status"], string>> = {
  green: "VERIFIED",
  amber: "REVIEW",
  blue: "RECORDED",
};

export function ProvenancePage(props: { readonly projection: CanonicalProjection }) {
  const nodes = deriveProvenanceNodes(props.projection);
  const [selectedId, setSelectedId] = useState<string>("authority-evaluation");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const selected = nodes[selectedId] ?? nodes["authority-evaluation"]!;

  return (
    <section className="tm-view" aria-label="Canonical provenance">
      <p className="overline">Live Proof · Canonical provenance</p>
      <h2>The canonical journey of one governed action</h2>
      <p className="tm-lede">
        Ten durable records, five stages — from a human's words to an honest resolution.
        Select any record to inspect what happened, what it proved, and what came next.
      </p>

      <div className="tm-prov-layout">
        <div className="tm-prov-graph" role="list" aria-label="Provenance stages">
          {PROVENANCE_GROUPS.map((group) => (
            <div
              className={`tm-prov-group${hoveredId && nodes[hoveredId]?.groupId === group.id ? " hovered" : ""}`}
              key={group.id}
            >
              <div className="tm-prov-group-label">
                <span className="num">{group.num}</span>
                <span className="title">{group.title}</span>
              </div>
              <div className="tm-prov-nodes">
                {group.nodeIds.map((id) => {
                  const node = nodes[id]!;
                  const isSelected = selectedId === node.id;
                  const isHovered = hoveredId === node.id;
                  const inHoverPath = hoveredId !== null && nodes[hoveredId]?.groupId === group.id;
                  return (
                    <button
                      type="button"
                      role="listitem"
                      key={node.id}
                      className={[
                        "tm-prov-node",
                        `st-${node.status}`,
                        isSelected ? "selected" : "",
                        isHovered || inHoverPath ? "hover-path" : "",
                      ].join(" ")}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="step">{node.step}</span>
                      <span className="meaning">{node.meaning}</span>
                      <span className="decision">{node.decision}</span>
                      <code className="raw-id">{node.privateDetail ? "Private internal record" : node.canonicalId}</code>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <aside className="tm-prov-inspector" aria-label="Record inspector">
          <div className="tm-prov-insp-head">
            <div className="kicker">RECORD INSPECTOR</div>
            <h3>{selected.step}</h3>
            <p className="meaning">{selected.meaning}</p>
            <span className={`tm-status-chip st-${selected.status}`}>
              {selected.decision}
            </span>
          </div>

          <div className="tm-prov-insp-section">
            <div className="k">What happened</div>
            <p>{selected.inspector.whatHappened}</p>
          </div>
          <div className="tm-prov-insp-section">
            <div className="k">What came in</div>
            <p>{selected.inspector.cameIn}</p>
          </div>
          <div className="tm-prov-insp-section">
            <div className="k">Key values</div>
            <div className="tm-prov-kv">
              {selected.inspector.keyValues.map(([k, v]) => (
                <div className="row" key={k}>
                  <span className="key">{k}</span>
                  <span className={`value${/^[a-z]+-[a-z0-9]|^(intent|state|gv|grant|prep|ct|exec|outcome|rc)-/i.test(v) ? " mono" : ""}`}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="tm-prov-insp-section">
            <div className="k">Why it matters</div>
            <p>{selected.inspector.proves}</p>
          </div>
          <div className="tm-prov-insp-section">
            <div className="k">Downstream</div>
            <p>{selected.inspector.downstream}</p>
          </div>

          <div className="tm-prov-durable">
            <div className="k">Durable record</div>
            <div className="row">
              <span className="key">Kind</span>
              <span className="value">{selected.recordKind}</span>
            </div>
            <div className="row">
              <span className="key">Canonical id</span>
              <code className="value mono">{selected.privateDetail ? "Private internal identifier" : selected.canonicalId}</code>
            </div>
            {selected.timestamp ? (
              <div className="row">
                <span className="key">Timestamp</span>
                <code className="value mono">{selected.timestamp}</code>
              </div>
            ) : null}
          </div>
          <div className="tm-prov-legend">
            <span className="dot green" /> verified <span className="dot amber" /> review{" "}
            <span className="dot blue" /> recorded
          </div>
        </aside>
      </div>
    </section>
  );
}
