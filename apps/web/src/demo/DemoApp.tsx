import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CanonicalProjection } from "@truemandate/read-model";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";
import { loadDemoProjection, type DemoDataSource, type DemoLoadState } from "./demoData";
import { derivePresentation, type DerivedPresentation } from "./demoDerived";
import { DemoWalkthrough, DEMO_STAGES } from "./DemoScenes";
import { useDemoController } from "./demoMachine";
import { BenchmarkPage } from "./BenchmarkPage";
import { AttackLabPage } from "./AttackLabPage";
import { ProvenancePage } from "./ProvenancePage";
import { STRESS_READ_MODEL } from "./stress-readmodel";
import { LiveDemoPage } from "./LiveDemoPage";
import { ProductTruthBadge } from "./ProductTruth";
import {
  AdkA2aSection,
  AgentRegistrySection,
  DeveloperSdkSection,
} from "./DeveloperPage";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export type DemoView = "proof" | "benchmark" | "attack" | "architecture";
export type ProofSurface = "live-demo" | "canonical-proof";

export type ProofMode = "landing" | "full" | "demo";

const VIEWS: readonly { id: DemoView; label: string }[] = [
  { id: "proof", label: "Live Proof" },
  { id: "benchmark", label: "SAFE Benchmark" },
  { id: "attack", label: "Attack Lab" },
  { id: "architecture", label: "Architecture" },
];

function SubTabs(props: {
  readonly tabs: readonly { id: string; label: string }[];
  readonly active: string;
  readonly onChange: (id: string) => void;
}) {
  return (
    <div className="tm-subtabs" role="tablist" aria-label="Section navigation">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={props.active === t.id ? "true" : "false"}
          className={props.active === t.id ? "active" : undefined}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 19) + " UTC";
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10) + " " + d.toISOString().slice(11, 19) + " UTC";
}

function SourcePill(props: { readonly source: DemoDataSource | "runtime" }) {
  return (
    <span className="tm-source" data-source={props.source} role="status">
      <span className="dot">{props.source === "snapshot" ? "○" : "●"}</span>
      {props.source === "live"
        ? "LIVE PROOF DATA"
        : props.source === "runtime"
          ? "REAL BACKEND ROUTES"
          : "CANONICAL SNAPSHOT"}
    </span>
  );
}

function Freshness(props: { readonly d: DerivedPresentation; readonly source: DemoDataSource }) {
  return (
    <p className="tm-note">
      <SourcePill source={props.source} />{" "}
      Proof executed {fmtDateTime(props.d.freshness.executedAtIso)} · Loaded{" "}
      {fmtDateTime(props.d.freshness.loadedAtIso)}
    </p>
  );
}

function Details(props: { readonly label: string; readonly rows: readonly [string, ReactNode][] }) {
  return (
    <details className="tm-details">
      <summary>{props.label}</summary>
      <div className="body">
        {props.rows.map(([k, v]) => (
          <p key={k}>
            <strong>{k}:</strong> {v}
          </p>
        ))}
      </div>
    </details>
  );
}

/** Highlights grounded constraint spans inside the raw human sentence. */
function IntentQuote(props: { readonly rawText: string; readonly spans: readonly { start: number; end: number }[] }) {
  const sorted = [...props.spans].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((span, i) => {
    if (span.start > cursor) parts.push(props.rawText.slice(cursor, span.start));
    parts.push(<mark key={i}>{props.rawText.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  });
  if (cursor < props.rawText.length) parts.push(props.rawText.slice(cursor));
  return <blockquote className="tm-intent-raw">{parts}</blockquote>;
}

/* ------------------------------------------------------------------ */
/* hero                                                                */
/* ------------------------------------------------------------------ */

function Hero(props: {
  readonly projection: CanonicalProjection;
  readonly d: DerivedPresentation;
  readonly source: DemoDataSource;
  readonly mode: "landing" | "full";
  readonly onStartDemo?: () => void;
  readonly onViewFullProof?: () => void;
  readonly onExploreArchitecture?: () => void;
  readonly demoLoading?: boolean;
}) {
  const { projection: p, d, source, mode } = props;
  return (
    <header className="tm-hero" id="top">
      <p className="overline">Semantic trust for autonomous agents</p>
      <h1>
        Autonomous agents can execute correctly — and still <em>violate human intent</em>.
      </h1>
      <p className="sub">
        TrueMandate <strong>verifies both</strong>: the execution you authorized, and the
        outcome you actually wanted.
      </p>
      {mode === "full" ? (
        <>
          <div className="tm-request">
            “{d.intent.summarySentence}”
          </div>
          <div className="tm-punchline">
            <div className="tm-punch ok">
              <div className="label">Authorized</div>
              <div className="value">✓ {d.gate.amountLabel}</div>
              <div className="meta">Authority decision · ALLOW</div>
            </div>
            <div className="tm-punch ok">
              <div className="label">Executed</div>
              <div className="value">✓ {d.execution.paymentResult}</div>
              <div className="meta">Exactly once · mock payment</div>
            </div>
            <div className="tm-punch warn">
              <div className="label">Outcome</div>
              <div className="value">⚠ {d.outcome.stateLabel}</div>
              <div className="meta">{d.outcome.verified} / {d.outcome.required} received</div>
            </div>
          </div>
          <p className="tm-missing">{d.outcome.missingHeadline}</p>
          <div className="tm-cta">
            <a className="tm-button primary" href="#act1">Explore the live proof</a>
            <a className="tm-button ghost" href="#act3">See what went wrong</a>
          </div>
          <Freshness d={d} source={source} />
        </>
      ) : (
        <>
          <div className="tm-trust-steps" aria-label="What TrueMandate does">
            <div className="tm-step">
              <div className="tm-step-num">1</div>
              <div className="tm-step-title">Understand intent</div>
              <div className="tm-step-body">Preserve what the human actually meant.</div>
            </div>
            <div className="tm-step">
              <div className="tm-step-num">2</div>
              <div className="tm-step-title">Bound authority</div>
              <div className="tm-step-body">Agents act only within proven constraints.</div>
            </div>
            <div className="tm-step">
              <div className="tm-step-num">3</div>
              <div className="tm-step-title">Verify outcomes</div>
              <div className="tm-step-body">Payment success is not the same as goal success.</div>
            </div>
          </div>
          <div className="tm-cta">
            <button
              type="button"
              className="tm-button primary start"
              onClick={props.onStartDemo}
              disabled={props.demoLoading}
            >
              {props.demoLoading ? "Loading live proof…" : "▶ Start Demo"}
            </button>
            <button type="button" className="tm-button ghost" onClick={props.onExploreArchitecture}>
              Explore Architecture
            </button>
          </div>
          <button type="button" className="tm-tertiary" onClick={props.onViewFullProof}>
            View full proof
          </button>
          <p className="tm-proof-line">
            Verified deployed proof · Read-only canonical evidence
          </p>
        </>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* act I — intent                                                      */
/* ------------------------------------------------------------------ */

function ActI(props: { readonly projection: CanonicalProjection; readonly d: DerivedPresentation }) {
  const { projection: p, d } = props;
  return (
    <section className="tm-act" id="act1" aria-label="Act I — Intent">
      <div className="tm-act-head">
        <span className="tm-act-num">ACT I</span>
        <h2>Intent</h2>
        <span className="q">Can the agent act?</span>
      </div>
      <div className="tm-act1-grid">
        <div className="tm-panel">
          <p className="panel-label">Human intent · summary</p>
          <blockquote className="tm-intent-raw">{d.intent.summarySentence}</blockquote>
          <p className="tm-takeaway" style={{ margin: "0.5rem 0 0", fontSize: "0.82rem" }}>
            Derived from the immutable constraints at right; the exact original
            request is preserved behind the disclosure below.
          </p>
          <details className="tm-details">
            <summary>View original canonical request</summary>
            <div className="body">
              <IntentQuote rawText={p.intent.rawText} spans={p.constraints.map((c) => c.sourceSpan)} />
              <p><strong>Intent:</strong> {p.intent.id} ({fmtTime(p.intent.createdAt)})</p>
              <p><strong>Content hash:</strong> {p.intent.contentHash}</p>
            </div>
          </details>
        </div>
        <div className="tm-panel">
          <p className="panel-label">Extracted constraints</p>
          <div className="tm-constraints">
            <div className="tm-constraint"><div className="v">{d.intent.quantity} units</div><div className="c">Quantity</div></div>
            <div className="tm-constraint"><div className="v">{d.intent.itemName}</div><div className="c">Material</div></div>
            <div className="tm-constraint"><div className="v">{d.intent.supplierLabel}</div><div className="c">Source</div></div>
            <div className="tm-constraint"><div className="v">&lt; ₹{d.intent.budgetDisplay}</div><div className="c">Budget</div></div>
            <div className="tm-constraint span2"><div className="v">Before {d.intent.deadlineDisplay}</div><div className="c">Deadline</div></div>
          </div>
        </div>
      </div>
      <div className="tm-verdict-row">
        <div className="tm-verdict-cell ok">
          <div className="k">Requirements</div>
          <div className="v">{d.intent.verifiedLabel}</div>
        </div>
        <div className="tm-verdict-cell warn">
          <div className="k">Guardian</div>
          <div className="v">{d.gate.guardianLabel}</div>
        </div>
        <div className="tm-gate-arrow">{d.gate.gateLabel} ↓</div>
        <div className="tm-verdict-cell blue">
          <div className="k">Authority</div>
          <div className="v">{d.gate.authorityLabel} · {d.gate.amountLabel}</div>
        </div>
      </div>
      <p className="tm-takeaway">
        <strong>Authorization proves permission, not understanding.</strong>{" "}
        The Guardian recorded HUMAN REVIEW REQUIRED; the Authority then issued the
        bounded grant under its durable ALLOW decision. No human approval artifact
        exists in the canonical records — the UI claims none.
      </p>
      <Details
        label="View verification details"
        rows={[
          ["Guardian verdict", `${p.guardian.decision} (${p.guardian.verdictId})`],
          ["Guardian judges", p.guardian.judges.map((j) => `${j.judgeId} ${j.status}`).join(" · ")],
          ["Fidelity", p.guardian.overallFidelity.toFixed(2)],
          ["Authority", `${p.authority.decision} · ${p.authority.capability} · expires ${d.gate.expiryLabel}`],
          ["Intent", `${p.intent.id} (${fmtTime(p.intent.createdAt)})`],
          ["IntentState", p.intent.intentStateId],
          ["Evidence", p.evidence.authorizationEnvelopes.map((e) => e.id).join(", ")],
        ]}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* act II — execution                                                  */
/* ------------------------------------------------------------------ */

function ActII(props: { readonly projection: CanonicalProjection; readonly d: DerivedPresentation }) {
  const { projection: p, d } = props;
  return (
    <section className="tm-act" id="act2" aria-label="Act II — Execution">
      <div className="tm-act-head">
        <span className="tm-act-num">ACT II</span>
        <h2>Execution</h2>
        <span className="q">Did it execute exactly what was authorized?</span>
      </div>
      <div className="tm-act2">
        <div className="tm-exec-card">
          <div className="who-label">Authorized</div>
          <div className="amount">{d.execution.authorized.amountLabel}</div>
          <div className="row"><span>Supplier</span><b>{d.execution.authorized.supplierLabel}</b></div>
          <div className="row"><span>Currency</span><b>{d.execution.authorized.currency}</b></div>
        </div>
        <div className="tm-exec-arrow">
          <span className="arrow">→</span>
          <span className="match">{d.execution.exactMatch ? "✓ EXACT MATCH" : "✗ MISMATCH"}</span>
        </div>
        <div className="tm-exec-card executed">
          <div className="who-label">Executed</div>
          <div className="amount">{d.execution.executed.amountLabel}</div>
          <div className="row"><span>Supplier</span><b>{d.execution.executed.supplierLabel}</b></div>
          <div className="row"><span>Currency</span><b>{d.execution.executed.currency}</b></div>
          <div className="row"><span>Result</span><b>{d.execution.paymentResult} <span className="tm-mock-tag">Mock payment</span></b></div>
        </div>
      </div>
      <p style={{ textAlign: "center", margin: "1.1rem 0 0" }}>
        <span className="tm-once">⚡ {d.execution.onceLabel}</span>
      </p>
      <p className="tm-takeaway" style={{ textAlign: "center" }}>
        <strong>The caller could not change amount, supplier or currency at COMMIT.</strong>
      </p>
      <Details
        label="View execution proof"
        rows={[
          ["Authorization lifecycle", p.execution.commitTokenConsumed ? "Authorized handle consumed exactly once" : "Authorization not consumed"],
          ["Counterparty", p.execution.counterparty],
          ["External reference", p.execution.externalReference],
          ["Replay", `${p.execution.replayStatus} · same result: ${p.execution.replaySameResultRef}`],
          ["At", fmtDateTime(p.execution.requestTimestamp)],
        ]}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* act III — outcome                                                   */
/* ------------------------------------------------------------------ */

function ActIII(props: { readonly projection: CanonicalProjection; readonly d: DerivedPresentation }) {
  const { projection: p, d } = props;
  const pct = Math.round((d.outcome.verified / d.outcome.required) * 100);
  return (
    <section className="tm-act" id="act3" aria-label="Act III — Outcome">
      <div className="tm-act-head">
        <span className="tm-act-num">ACT III</span>
        <h2>Outcome</h2>
        <span className="q">Did successful execution fulfill the human goal?</span>
      </div>
      <div className="tm-act3-top">
        <div className="tm-versus">
          <div className="tm-state-card good">
            <div>
              <div className="kind">Payment</div>
              <div className="state">{d.execution.paymentResult}</div>
            </div>
            <span className="glyph">✓</span>
          </div>
          <div className="tm-neq">≠</div>
          <div className="tm-state-card bad">
            <div>
              <div className="kind">Outcome</div>
              <div className="state">{d.outcome.stateLabel}</div>
            </div>
            <span className="glyph">⚠</span>
          </div>
        </div>
        <div className="tm-quantities">
          <p className="panel-label">{d.intent.quantity} {d.intent.itemName}</p>
          <div className="tm-bignums">
            <div className="tm-bignum req">
              <div className="num">{d.outcome.required}</div>
              <div className="cap">Required</div>
            </div>
            <div className="tm-bignum got">
              <div className="num">{d.outcome.verified}</div>
              <div className="cap">Verified received</div>
            </div>
            <div className="tm-bignum miss">
              <div className="num">{d.outcome.missing}</div>
              <div className="cap">Missing</div>
            </div>
          </div>
          <div className="tm-track" role="img" aria-label={`${d.outcome.verified} of ${d.outcome.required} received`}>
            <span className="fill-got" style={{ width: `${pct}%` }} />
            <span className="fill-miss" style={{ width: `${100 - pct}%` }} />
          </div>
          <div className="tm-track-scale"><span>{`${d.outcome.verified} received`}</span><span>{`${d.outcome.missing} missing`}</span></div>
        </div>
      </div>
      <p className="tm-thesis-line">
        <span className="neq">≠</span> Payment success <em>is not</em> outcome success.
      </p>
      <EvidenceContradiction projection={p} />
      <ResolutionPanel projection={p} d={d} />
    </section>
  );
}

function EvidenceContradiction(props: { readonly projection: CanonicalProjection }) {
  const p = props.projection;
  const d = derivePresentation(p);
  const merchant = p.evidence.deliveryEnvelopes.find((e) => e.concept === "dispatched_quantity");
  const warehouse = p.evidence.deliveryEnvelopes.find((e) => e.concept === "quantity_received");
  return (
    <div id="evidence" aria-label="Contradictory evidence">
      <div className="tm-contradiction">
        <div className="tm-witness merchant">
          <div className="who">Merchant says</div>
          <div className="say">“{merchant?.value ?? "—"} dispatched”</div>
        </div>
        <span className="tm-versus-word">versus</span>
        <div className="tm-witness warehouse">
          <div className="who">Warehouse verified</div>
          <div className="say">“{warehouse?.value ?? "—"} received”</div>
        </div>
      </div>
      <div className="tm-witness carrier" style={{ marginTop: "1rem" }}>
        <div className="who">Carrier</div>
        <div className="say">Insufficient evidence to locate the loss</div>
      </div>
      <div className="tm-findings">
        <div className="tm-finding warn">
          <div className="k">First confirmed divergence</div>
          <div className="v">{d.outcome.divergenceLabel}</div>
        </div>
        <div className="tm-finding">
          <div className="k">Root cause</div>
          <div className="v">{d.resolution.rootCauseLabel}</div>
        </div>
        <div className="tm-finding">
          <div className="k">Responsibility</div>
          <div className="v">{p.resolution.responsibilityState}</div>
        </div>
      </div>
      <p className="tm-takeaway">
        <strong>TrueMandate preserves the contradiction instead of inventing blame.</strong>
      </p>
      <Details
        label="Inspect accepted evidence"
        rows={p.evidence.deliveryEnvelopes.map((e) => [e.concept, `${e.id} · ${e.source} · value ${String(e.value)}`])}
      />
    </div>
  );
}

function ResolutionPanel(props: { readonly projection: CanonicalProjection; readonly d: DerivedPresentation }) {
  const { projection: p, d } = props;
  const humanRequests: readonly string[] = [
    "Supplier packing / count record",
    "Carrier pickup & acceptance count",
    "Warehouse receiving record",
  ];
  return (
    <div className="tm-resolve" id="resolution" aria-label="Resolution">
      <h3>What should happen next?</h3>
      <p className="lead">{d.outcome.missingLead}</p>
      <div className="tm-requests">
        {p.resolution.evidenceRequests.slice(0, 3).map((r, i) => (
          <div className="tm-request-item" key={r.id}>
            <span className="icon">▸</span>
            {humanRequests[i]}
          </div>
        ))}
      </div>
      <div className="tm-boundary">
        <div className="title"><span className="lock">🔒</span> No new economic authority</div>
        <div className="tm-remedies">
          {["Refund", "Replacement", "Compensation"].map((r) => (
            <div className="tm-remedy" key={r}>
              <span>{r}</span>
              <span className="no">{d.resolution.remediesNotExecuted ? "NOT EXECUTED" : `EXECUTIONS: ${p.resolution.remedyExecutions}`}</span>
            </div>
          ))}
        </div>
        <p className="sentence">Reasoning can recommend a remedy. It cannot authorize one.</p>
      </div>
      <Details
        label="View case proof"
        rows={[
          ["ResolutionCase", p.resolution.caseId],
          ["State / responsibility", `${p.resolution.state} / ${p.resolution.responsibilityState}`],
          ["Opened", fmtDateTime(p.resolution.openedAt)],
          ["Remediation mandates", String(p.resolution.remedyExecutions)],
        ]}
      />
    </div>
  );
}

function ArchitectureView() {
  const [tab, setTab] = useState<"architecture" | "sdk" | "adk" | "registry">("architecture");
  return (
    <section className="tm-view" aria-label="Architecture">
      <p className="overline">Secondary</p>
      <h2>TrueMandate Trust Architecture</h2>
      <p className="tm-lede">
        LLMs reason. Infrastructure authorizes. Outcomes are verified.
      </p>
      <SubTabs
        tabs={[
          { id: "architecture", label: "Trust architecture" },
          { id: "sdk", label: "Developer SDK" },
          { id: "adk", label: "Google ADK · A2A" },
          { id: "registry", label: "Agent Registry" },
        ]}
        active={tab}
        onChange={(id) => setTab(id as "architecture" | "sdk" | "adk" | "registry")}
      />

      {tab === "sdk" ? (
        <DeveloperSdkSection />
      ) : tab === "adk" ? (
        <AdkA2aSection />
      ) : tab === "registry" ? (
        <AgentRegistrySection />
      ) : (
        <div className="tm-arch-pres">
          <div className="tm-surface-classification">
            <ProductTruthBadge truthClass="PRESENTATION_DERIVED" detail="VERIFIED SYSTEM MAP" />
          </div>
          <div className="tm-arch-layer l1">
            <div className="tm-layer-label">
              <span className="k">REASONING PLANE</span> Agents and interoperability
            </div>
            <div className="tm-layer-items">
              <div className="tm-layer-item"><b>Google ADK</b><small>agent reasoning</small></div>
              <div className="tm-layer-item"><b>A2A 1.0</b><small>agent interoperability</small></div>
              <div className="tm-layer-item"><b>TypeScript SDK</b><small>record · verify · read</small></div>
              <div className="tm-layer-item discovery"><b>Agent Registry</b><small>DISCOVERY — not authority</small></div>
            </div>
          </div>

          <div className="tm-trust-band">
            <div className="tm-trust-band-rule" aria-hidden="true" />
            <span className="tm-trust-band-text">Trust boundary — data can cross. Authority cannot.</span>
            <div className="tm-trust-band-rule" aria-hidden="true" />
          </div>

          <div className="tm-arch-layer l2">
            <div className="tm-layer-label">
              <span className="k">LAYER 2</span> TrueMandate Semantic Trust Runtime
              <small>the core — where authority lives</small>
            </div>
            <div className="tm-runtime-flow">
              {[
                ["Human Intent", "the immutable mandate"],
                ["Intent Provenance", "trace every semantic transformation"],
                ["Semantic Readiness / Guardian", "prove constraints and fidelity"],
                ["Adaptive Authority", "bound capability, scope and time"],
                ["Governed Execution", "prepare · authorize · commit"],
                ["Outcome Verification", "goal success ≠ payment success"],
                ["Resolution / Learning", "restore intent · propose, never grant"],
              ].map(([title, sub], i) => (
                <span className="tm-flow-cell" key={title}>
                  <span className="tm-flow-node">
                    <b>{title}</b>
                    <small>{sub}</small>
                  </span>
                  {i < 6 ? <span className="tm-flow-arrow" aria-hidden="true">↓</span> : null}
                </span>
              ))}
            </div>
          </div>

          <div className="tm-arch-layer l3">
            <div className="tm-layer-label">
              <span className="k">LAYER 3</span> Google Cloud
            </div>
            <div className="tm-gcp-clusters">
              <div className="tm-gcp-cluster">
                <div className="cluster-k">AI</div>
                <span>Gemini · Vertex AI</span>
                <span>Google ADK · A2A</span>
                <span>Agent Registry</span>
                <span>Model Armor</span>
              </div>
              <div className="tm-gcp-cluster">
                <div className="cluster-k">Runtime</div>
                <span>Cloud Run</span>
              </div>
              <div className="tm-gcp-cluster">
                <div className="cluster-k">State + Events</div>
                <span>Firestore</span>
                <span>Pub/Sub</span>
                <span>BigQuery analytics</span>
              </div>
              <div className="tm-gcp-cluster">
                <div className="cluster-k">Observability</div>
                <span>OpenTelemetry</span>
                <span>Cloud Trace</span>
              </div>
              <div className="tm-gcp-cluster">
                <div className="cluster-k">Security + Network</div>
                <span>IAM · service identities</span>
                <span>VPC · PSC</span>
                <span>Artifact Registry</span>
              </div>
            </div>
          </div>

          <div className="tm-arch-layer l4">
            <div className="tm-layer-label">
              <span className="k">LAYER 4</span> Proof &amp; Evaluation
            </div>
            <div className="tm-layer-items">
              <div className="tm-layer-item"><b>Live canonical proof</b><small>one governed action, end to end</small></div>
              <div className="tm-layer-item">
                <b>SAFE evaluation</b>
                <small>
                  {STRESS_READ_MODEL.combined.trumandateFull.passed} / {STRESS_READ_MODEL.combined.trumandateFull.total}
                  {" · "}{STRESS_READ_MODEL.combined.trumandateFull.unauthorizedExecutionCount} unauthorized
                  {" · "}{STRESS_READ_MODEL.combined.trumandateFull.criticalIncidentCount} critical
                </small>
              </div>
              <div className="tm-layer-item"><b>Attack Lab</b><small>deterministic adversarial runs</small></div>
            </div>
          </div>

          <div className="tm-trust-statements" aria-label="Trust boundary">
            <div className="stmt"><b>ADK</b> reasons.</div>
            <div className="stmt"><b>A2A</b> interoperates.</div>
            <div className="stmt"><b>Agent Registry</b> discovers.</div>
            <div className="stmt strong"><b>TrueMandate</b> authorizes.</div>
          </div>
          <p className="tm-trust-caption">
            Data can cross the boundary. <strong>Authority cannot.</strong>
          </p>

          <p className="tm-architecture-ownership">
            <strong>LLMs reason.</strong> Deterministic infrastructure owns authorization,
            execution eligibility, replay safety, outcome state, and resolution authority.
          </p>
        </div>
      )}
    </section>
  );
}

function FooterPanel(props: {
  readonly projection: CanonicalProjection;
  readonly source: DemoDataSource;
  readonly proofSurface?: ProofSurface;
}) {
  if (props.proofSurface === "live-demo") {
    return (
      <footer className="tm-footer">
        <p>
          <strong>Live Demo foundation.</strong> Fresh workflows are created through the real public
          workflow route, and the page renders only public-safe workflow, approval, evidence, outcome,
          and resolution state returned by the deployed backend.
        </p>
      </footer>
    );
  }
  return (
    <footer className="tm-footer">
      <p>
        <strong>Read-only demo evidence.</strong>{" "}
        {props.source === "live"
          ? "Served live by the Public BFF read route."
          : "Embedded frozen canonical snapshot (offline fallback)."}{" "}
        Never re-runs the scenario and never mutates Phase A / B / C proof records.
        Privileged authorization handles remain private.
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export function DemoPage(props: {
  readonly projection: CanonicalProjection;
  readonly source?: DemoDataSource;
  readonly view?: DemoView;
  readonly proofSurface?: ProofSurface;
  readonly onNavigate?: (view: DemoView) => void;
  readonly onProofSurfaceChange?: (surface: ProofSurface) => void;
  readonly notice?: string;
  readonly mode?: ProofMode;
  readonly onStartDemo?: () => void;
  readonly onViewFullProof?: () => void;
  readonly demoLoading?: boolean;
  readonly controller?: ReturnType<typeof useDemoController>;
}) {
  const {
    projection,
    source = "snapshot",
    view = "proof",
    proofSurface = "live-demo",
    onNavigate,
    onProofSurfaceChange,
    notice,
    mode = "full",
    onStartDemo,
    onViewFullProof,
    demoLoading,
    controller,
  } = props;
  const d = derivePresentation(projection);
  const [proofTab, setProofTab] = useState<"walkthrough" | "provenance">("walkthrough");

  const effectiveHeroMode: "landing" | "full" =
    mode === "landing" || (mode === "demo" && controller?.stage === "IDLE")
      ? "landing"
      : "full";

  return (
    <div className="tm-v2">
      <nav className="tm-topbar" aria-label="Demo navigation">
        <span className="tm-wordmark">True<span className="tick">Mandate</span></span>
        <span className="tm-nav">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? "true" : undefined}
              onClick={() => onNavigate?.(v.id)}
            >
              {v.label}
            </button>
          ))}
        </span>
        <SourcePill source={view === "proof" && proofSurface === "live-demo" ? "runtime" : source} />
      </nav>
      {view === "attack" ? (
        <AttackLabPage />
      ) : view === "benchmark" ? (
        <BenchmarkPage />
      ) : view === "architecture" ? (
        <ArchitectureView />
      ) : (
        <>
          <SubTabs
            tabs={[
              { id: "live-demo", label: "Live Demo" },
              { id: "canonical-proof", label: "Canonical Proof" },
            ]}
            active={proofSurface}
            onChange={(id) => onProofSurfaceChange?.(id as ProofSurface)}
          />
          {proofSurface === "live-demo" ? (
            <LiveDemoPage />
          ) : (
            <>
              <SubTabs
                tabs={[
                  { id: "walkthrough", label: "Canonical walkthrough" },
                  { id: "provenance", label: "Canonical provenance graph" },
                ]}
                active={proofTab}
                onChange={(id) => setProofTab(id as "walkthrough" | "provenance")}
              />
              <p className="tm-canonical-history-label">
                <ProductTruthBadge truthClass="CANONICAL_HISTORICAL" />
                Canonical Proof <span>Historical immutable evidence</span>
              </p>
              {proofTab === "provenance" ? (
                <ProvenancePage projection={projection} />
              ) : mode === "demo" && controller && controller.stage !== "IDLE" ? (
                <>
                  {notice && view === "proof" ? <p className="tm-note" role="status">{notice}</p> : null}
                  <DemoWalkthrough
                    projection={projection}
                    controller={controller}
                    onExit={() => onViewFullProof?.()}
                    onReplay={() => {
                      controller.restart();
                      onStartDemo?.();
                    }}
                  />
                </>
              ) : (
                <>
                  {notice && view === "proof" ? <p className="tm-note" role="status">{notice}</p> : null}
                  <Hero
                    projection={projection}
                    d={d}
                    source={source}
                    mode={effectiveHeroMode}
                    onStartDemo={onStartDemo}
                    onViewFullProof={onViewFullProof}
                    onExploreArchitecture={() => onNavigate?.("architecture")}
                    demoLoading={demoLoading}
                  />
                  {effectiveHeroMode === "landing" ? null : (
                    <>
                      <ActI projection={projection} d={d} />
                      <ActII projection={projection} d={d} />
                      <ActIII projection={projection} d={d} />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      <FooterPanel projection={projection} source={source} proofSurface={proofSurface} />
    </div>
  );
}

export function DemoApp(props: { readonly load?: (signal?: AbortSignal) => Promise<DemoLoadState> }) {
  const load = props.load ?? loadDemoProjection;
  const [state, setState] = useState<DemoLoadState>({ status: "loading" });
  const [view, setView] = useState<DemoView>("proof");
  const [proofSurface, setProofSurface] = useState<ProofSurface>("live-demo");
  const [proofMode, setProofMode] = useState<ProofMode>("landing");
  const [demoLoading, setDemoLoading] = useState(false);
  const controller = useDemoController();

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState({ status: "loading" });
    void load(controller.signal).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [load]);

  /**
   * Start Demo is READ-ONLY: it fetches the canonical projection from the
   * live read route (GET), validates it, stores it in frontend state, resets
   * presentation state, and starts the staged walkthrough. It never invokes
   * Agent Runtime / Gateway, never creates intents, mints grants, executes
   * payments, mutates Firestore, or re-runs Phase C.
   */
  const startDemo = () => {
    setDemoLoading(true);
    void load().then((result) => {
      setState(result);
      setDemoLoading(false);
      setProofMode("demo");
      controller.start();
    });
  };

  const viewFullProof = () => {
    controller.exit();
    setProofMode("full");
  };

  const navigate = (v: DemoView) => {
    if (v === "proof") {
      controller.exit();
      if (proofSurface === "canonical-proof") {
        setProofMode(proofMode === "landing" ? "landing" : "full");
      }
    }
    setView(v);
  };

  if (state.status === "loading") {
    return (
      <div className="tm-v2">
        <p className="tm-loading" role="status">Loading canonical proof…</p>
      </div>
    );
  }
  if (state.status === "unavailable") {
    return (
      <DemoPage
        projection={state.fallback}
        source={state.source}
        view={view}
        proofSurface={proofSurface}
        onNavigate={navigate}
        onProofSurfaceChange={setProofSurface}
        notice={state.detail}
        mode={proofMode}
        onStartDemo={startDemo}
        onViewFullProof={viewFullProof}
        demoLoading={demoLoading}
        controller={controller}
      />
    );
  }
  return (
    <DemoPage
      projection={state.projection}
      source={state.source}
      view={view}
      proofSurface={proofSurface}
      onNavigate={navigate}
      onProofSurfaceChange={setProofSurface}
      mode={proofMode}
      onStartDemo={startDemo}
      onViewFullProof={viewFullProof}
      demoLoading={demoLoading}
      controller={controller}
    />
  );
}

export { CANONICAL_PHASE_C_V5, DEMO_STAGES };
