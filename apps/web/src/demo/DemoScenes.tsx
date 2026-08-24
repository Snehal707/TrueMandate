import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { CanonicalProjection } from "@truemandate/read-model";
import { derivePresentation, type DerivedPresentation } from "./demoDerived";
import { DEMO_STAGES, RUN_STAGES, type DemoController } from "./demoMachine";

/* ------------------------------------------------------------------ */
/* small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Reveal(props: { readonly delay?: number; readonly children: ReactNode }) {
  return (
    <div className="tm-reveal" style={{ animationDelay: `${props.delay ?? 0}ms` }}>
      {props.children}
    </div>
  );
}

/** Subtle count-up for the large outcome numbers. */
function CountUp(props: { readonly value: number; readonly durationMs?: number }) {
  const [shown, setShown] = useState(0);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    const duration = props.durationMs ?? 700;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(props.value * t));
      if (t < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current !== null) cancelAnimationFrame(ref.current);
    };
  }, [props.value, props.durationMs]);
  return <>{shown}</>;
}

function SceneFrame(props: {
  readonly kicker: string;
  readonly title: string;
  readonly question?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="tm-scene" aria-label={props.title}>
      <div className="tm-act-head">
        <span className="tm-act-num">{props.kicker}</span>
        <h2>{props.title}</h2>
        {props.question ? <span className="q">{props.question}</span> : null}
      </div>
      {props.children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* scenes                                                              */
/* ------------------------------------------------------------------ */

function SceneIntent(props: { readonly d: DerivedPresentation }) {
  const d = props.d;
  const tiles: readonly { v: string; c: string }[] = [
    { v: `${d.intent.quantity} units`, c: "Quantity" },
    { v: d.intent.itemName, c: "Material" },
    { v: d.intent.supplierLabel, c: "Source" },
    { v: `under ₹${d.intent.budgetDisplay}`, c: "Budget" },
    { v: `Before ${d.intent.deadlineDisplay}`, c: "Deadline" },
  ];
  return (
    <SceneFrame kicker="Scene 1" title="Human intent" question="What did the human actually ask for?">
      <Reveal>
        <p className="tm-scene-intro">Platform thesis → the real deployed proof</p>
        <div className="tm-panel">
          <p className="panel-label">Human intent · summary</p>
          <blockquote className="tm-intent-raw">{d.intent.summarySentence}</blockquote>
        </div>
      </Reveal>
      <div className="tm-constraints" style={{ marginTop: "1rem" }}>
        {tiles.map((t, i) => (
          <Reveal key={t.c} delay={600 + i * 600}>
            <div className="tm-constraint">
              <div className="v">{t.v}</div>
              <div className="c">{t.c}</div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={3300}>
        <div className="tm-scene-badge">
          ✓ {d.intent.verifiedLabel} · anchored to the original request
        </div>
      </Reveal>
    </SceneFrame>
  );
}

function SceneAuthorization(props: { readonly d: DerivedPresentation }) {
  const d = props.d;
  return (
    <SceneFrame kicker="Scene 2" title="Authority" question="Can the agent act?">
      <div className="tm-scene-gate">
        <Reveal delay={300}>
          <div className="tm-verdict-cell warn">
            <div className="k">Guardian</div>
            <div className="v">{d.gate.guardianLabel}</div>
          </div>
        </Reveal>
        <Reveal delay={1800}>
          <div className="tm-gate-arrow">{d.gate.gateLabel} ↓</div>
        </Reveal>
        <Reveal delay={2600}>
          <div className="tm-verdict-cell blue">
            <div className="k">Authority</div>
            <div className="v">{d.gate.authorityLabel}</div>
          </div>
        </Reveal>
      </div>
      <Reveal delay={3800}>
        <div className="tm-scene-badge">
          Bounded to {d.gate.amountLabel} · one supplier · expires {d.gate.expiryLabel}
        </div>
      </Reveal>
      <Reveal delay={4800}>
        <p className="tm-takeaway">
          <strong>Authorization proves permission, not understanding.</strong>
        </p>
      </Reveal>
    </SceneFrame>
  );
}

function SceneExecution(props: { readonly d: DerivedPresentation }) {
  const d = props.d;
  return (
    <SceneFrame kicker="Scene 3" title="Controlled execution" question="Did it execute exactly what was authorized?">
      <div className="tm-act2">
        <Reveal delay={300}>
          <div className="tm-exec-card">
            <div className="who-label">Authorized</div>
            <div className="amount">{d.execution.authorized.amountLabel}</div>
            <div className="row"><span>Supplier</span><b>{d.execution.authorized.supplierLabel}</b></div>
            <div className="row"><span>Currency</span><b>{d.execution.authorized.currency}</b></div>
          </div>
        </Reveal>
        <Reveal delay={1600}>
          <div className="tm-exec-arrow">
            <span className="arrow">→</span>
            <span className="match">{d.execution.exactMatch ? "✓ EXACT MATCH" : "✗ MISMATCH"}</span>
          </div>
        </Reveal>
        <Reveal delay={2400}>
          <div className="tm-exec-card executed">
            <div className="who-label">Executed</div>
            <div className="amount">{d.execution.executed.amountLabel}</div>
            <div className="row"><span>Supplier</span><b>{d.execution.executed.supplierLabel}</b></div>
            <div className="row"><span>Currency</span><b>{d.execution.executed.currency}</b></div>
            <div className="row"><span>Result</span><b>{d.execution.paymentResult} <span className="tm-mock-tag">Mock payment</span></b></div>
          </div>
        </Reveal>
      </div>
      <Reveal delay={3800}>
        <p style={{ textAlign: "center", margin: "0.9rem 0 0" }}>
          <span className="tm-once">⚡ {d.execution.onceLabel}</span>
        </p>
      </Reveal>
    </SceneFrame>
  );
}

function ScenePaymentResult(props: { readonly d: DerivedPresentation }) {
  const d = props.d;
  return (
    <SceneFrame kicker="Scene 4" title="Payment result" question="The money moved.">
      <Reveal delay={300}>
        <div className="tm-state-card good" style={{ maxWidth: 460, margin: "0.4rem auto" }}>
          <div>
            <div className="kind">Payment</div>
            <div className="state">{d.execution.paymentResult}</div>
          </div>
          <span className="glyph">✓</span>
        </div>
      </Reveal>
      <Reveal delay={1600}>
        <p className="tm-takeaway" style={{ textAlign: "center" }}>
          The agent paid exactly the authorized amount — exactly once.
        </p>
      </Reveal>
      <Reveal delay={2600}>
        <p className="tm-scene-pause">…but did the payment achieve the goal?</p>
      </Reveal>
    </SceneFrame>
  );
}

function SceneOutcomeEvidence(props: { readonly projection: CanonicalProjection }) {
  const p = props.projection;
  const merchant = p.evidence.deliveryEnvelopes.find((e) => e.concept === "dispatched_quantity");
  const warehouse = p.evidence.deliveryEnvelopes.find((e) => e.concept === "quantity_received");
  return (
    <SceneFrame kicker="Scene 5" title="Real world evidence" question="What actually arrived?">
      <Reveal delay={300}>
        <div className="tm-witness merchant">
          <div className="who">Merchant says</div>
          <div className="say">“{merchant?.value ?? "—"} dispatched”</div>
        </div>
      </Reveal>
      <Reveal delay={2000}>
        <div className="tm-witness warehouse" style={{ marginTop: "0.8rem" }}>
          <div className="who">Warehouse verified</div>
          <div className="say">“{warehouse?.value ?? "—"} received”</div>
        </div>
      </Reveal>
      <Reveal delay={3800}>
        <div className="tm-witness carrier" style={{ marginTop: "0.8rem" }}>
          <div className="who">Carrier</div>
          <div className="say">Insufficient evidence to locate the loss</div>
        </div>
      </Reveal>
    </SceneFrame>
  );
}

function SceneOutcomeResult(props: { readonly d: DerivedPresentation }) {
  const d = props.d;
  return (
    <SceneFrame kicker="Scene 6" title="Outcome" question="Payment success is not outcome success.">
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
      <div className="tm-bignums">
        <div className="tm-bignum req">
          <div className="num"><CountUp value={d.outcome.required} /></div>
          <div className="cap">Required</div>
        </div>
        <div className="tm-bignum got">
          <div className="num"><CountUp value={d.outcome.verified} /></div>
          <div className="cap">Verified received</div>
        </div>
        <div className="tm-bignum miss">
          <div className="num"><CountUp value={d.outcome.missing} /></div>
          <div className="cap">Missing</div>
        </div>
      </div>
      <Reveal delay={1400}>
        <p className="tm-thesis-line">
          <span className="neq">≠</span> Payment success <em>is not</em> outcome success.
        </p>
      </Reveal>
    </SceneFrame>
  );
}

function SceneResolution(props: { readonly projection: CanonicalProjection; readonly d: DerivedPresentation }) {
  const p = props.projection;
  const d = props.d;
  const rootCauseLabel = d.resolution.rootCauseLabel;
  const humanRequests: readonly string[] = [
    "Supplier packing / count record",
    "Carrier pickup & acceptance count",
    "Warehouse receiving record",
  ];
  return (
    <SceneFrame kicker="Scene 7" title="Resolution" question="What should happen next?">
      <Reveal delay={200}>
        <div className="tm-findings">
          <div className="tm-finding warn">
            <div className="k">First confirmed divergence</div>
            <div className="v">{d.outcome.divergenceLabel}</div>
          </div>
          <div className="tm-finding">
            <div className="k">Root cause</div>
            <div className="v">{rootCauseLabel}</div>
          </div>
          <div className="tm-finding">
            <div className="k">Responsibility</div>
            <div className="v">{d.resolution.responsibilityLabel}</div>
          </div>
        </div>
      </Reveal>
      <div className="tm-requests" style={{ marginTop: "0.9rem" }}>
        {p.resolution.evidenceRequests.slice(0, 3).map((r, i) => (
          <Reveal key={r.id} delay={1400 + i * 600}>
            <div className="tm-request-item">
              <span className="icon">▸</span>
              {humanRequests[i]}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={3400}>
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
      </Reveal>
    </SceneFrame>
  );
}

function SceneComplete(props: { readonly d: DerivedPresentation; readonly onReplay: () => void }) {
  const { d, onReplay } = props;
  return (
    <section className="tm-scene tm-complete" aria-label="Demo complete">
      <div className="tm-complete-inner">
        <p className="overline">Demo complete</p>
        <h2>TrueMandate caught what payment infrastructure cannot.</h2>
        <p className="tm-takeaway" style={{ textAlign: "center" }}>
          Payment says success. Outcome says {d.outcome.stateLabel.toLowerCase()}.
          Responsibility stays {d.resolution.responsibilityLabel.toLowerCase()} — and no remedy ran.
        </p>
        <div className="tm-cta" style={{ marginTop: "1.2rem" }}>
          <button type="button" className="tm-button primary" onClick={onReplay}>Replay demo</button>
          <a className="tm-button ghost" href="#act1">Inspect technical proof</a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* walkthrough + controls                                              */
/* ------------------------------------------------------------------ */

function Controls(props: { readonly controller: DemoController; readonly onExit: () => void }) {
  const c = props.controller;
  const stagePos = RUN_STAGES.indexOf(c.stage);
  return (
    <div className="tm-controls" role="toolbar" aria-label="Demo controls">
      <button type="button" onClick={c.back} disabled={c.stage === "INTENT"}>← Back</button>
      <button type="button" onClick={c.paused ? c.resume : c.pause}>
        {c.paused ? "▶ Resume" : "❚❚ Pause"}
      </button>
      <button type="button" onClick={c.next} disabled={c.stage === "COMPLETE"}>Next →</button>
      <button type="button" onClick={c.restart}>↺ Restart</button>
      <button type="button" onClick={props.onExit}>View full proof</button>
      <span className="tm-dots" aria-label={`Stage ${stagePos + 1} of ${RUN_STAGES.length}`}>
        {RUN_STAGES.map((s, i) => (
          <span
            key={s}
            className={`tm-dot${i < stagePos ? " past" : ""}${i === stagePos ? " current" : ""}`}
          />
        ))}
      </span>
    </div>
  );
}

export function DemoWalkthrough(props: {
  readonly projection: CanonicalProjection;
  readonly controller: DemoController;
  readonly onExit: () => void;
  readonly onReplay?: () => void;
}) {
  const d = derivePresentation(props.projection);
  const c = props.controller;
  return (
    <div className="tm-demo-stage">
      {c.stage === "INTENT" ? <SceneIntent d={d} /> : null}
      {c.stage === "AUTHORIZATION" ? <SceneAuthorization d={d} /> : null}
      {c.stage === "EXECUTION" ? <SceneExecution d={d} /> : null}
      {c.stage === "PAYMENT_RESULT" ? <ScenePaymentResult d={d} /> : null}
      {c.stage === "OUTCOME_EVIDENCE" ? <SceneOutcomeEvidence projection={props.projection} /> : null}
      {c.stage === "OUTCOME_RESULT" ? <SceneOutcomeResult d={d} /> : null}
      {c.stage === "RESOLUTION" ? <SceneResolution projection={props.projection} d={d} /> : null}
      {c.stage === "COMPLETE" ? <SceneComplete d={d} onReplay={props.onReplay ?? (() => undefined)} /> : null}
      {c.stage !== "IDLE" ? <Controls controller={c} onExit={props.onExit} /> : null}
    </div>
  );
}

export { DEMO_STAGES };
