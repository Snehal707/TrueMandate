import type {
  AuthorityView,
  ExecutionView,
  GuardianView,
  IntentWorkspaceView,
  OutcomeView,
  PlanView,
  ProvenanceGraphView,
  ResolutionView,
  SemanticStateView,
  TimelineView,
} from "@truemandate/read-model";
import { sliceSourceGrounding } from "@truemandate/read-model";
import type { ReactNode } from "react";

function Panel(props: {
  readonly title: string;
  readonly children: ReactNode;
  readonly tone?: "default" | "warn" | "critical";
}): ReactNode {
  return (
    <section
      aria-label={props.title}
      data-tone={props.tone ?? "default"}
      style={{
        borderTop: "1px solid #2a3340",
        padding: "1rem 0",
      }}
    >
      <h2 style={{ fontSize: "0.95rem", letterSpacing: "0.04em", margin: "0 0 0.5rem" }}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function StateLabel(props: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <p style={{ margin: "0.25rem 0" }}>
      <span style={{ opacity: 0.7 }}>{props.label}: </span>
      <strong aria-label={`${props.label} ${props.value}`}>{props.value}</strong>
    </p>
  );
}

export function IntentSummaryPanel(props: {
  readonly workspace: IntentWorkspaceView;
}): ReactNode {
  const s = props.workspace.summary;
  return (
    <Panel title="Original human mandate">
      <blockquote style={{ margin: 0, fontSize: "1.15rem" }}>{s.rawIntent}</blockquote>
      <StateLabel label="Intent ID" value={s.intentId} />
      <StateLabel label="IntentState" value={s.intentStateId ?? "n/a"} />
      <StateLabel label="Version" value={String(s.intentStateVersion ?? "")} />
      <StateLabel label="Readiness" value={s.readiness ?? "n/a"} />
      <StateLabel label="State hash" value={s.stateHash ?? "n/a"} />
      <StateLabel label="Created" value={s.createdAt} />
    </Panel>
  );
}

export function ConstraintInspector(props: {
  readonly semantic: SemanticStateView;
  readonly selectedConstraintId?: string;
}): ReactNode {
  const selected = props.semantic.constraints.find(
    (c) => c.id === props.selectedConstraintId,
  );
  return (
    <Panel title="Constraints">
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {props.semantic.constraints.map((c) => (
          <li
            key={c.id}
            data-critical={c.criticalFailure ? "true" : "false"}
            style={{
              marginBottom: "0.5rem",
              outline: c.criticalFailure ? "2px solid #b33" : undefined,
              padding: c.criticalFailure ? "0.35rem" : undefined,
            }}
          >
            <StateLabel label="Concept" value={c.concept} />
            <StateLabel label="Operator" value={c.operator} />
            <StateLabel label="Criticality" value={c.criticality} />
            <StateLabel label="Meaning" value={c.meaningClass} />
            <StateLabel label="Transformation" value={c.transformation ?? "PRESERVED"} />
            {c.criticalFailure ? (
              <p role="status">Critical failure — constraint compromised</p>
            ) : null}
          </li>
        ))}
      </ul>
      {selected?.sourceSpan ? (
        <Panel title="Source grounding">
          <p>
            Highlighted:{" "}
            <mark>
              {sliceSourceGrounding(props.semantic.rawIntent, selected.sourceSpan)}
            </mark>
          </p>
          <StateLabel
            label="Offsets"
            value={`${selected.sourceSpan.start}–${selected.sourceSpan.end}`}
          />
          <StateLabel label="Grounding" value={selected.groundingStatus ?? "n/a"} />
        </Panel>
      ) : null}
    </Panel>
  );
}

export function PlanGraphPanel(props: { readonly plan: PlanView }): ReactNode {
  return (
    <Panel title="Plan">
      {props.plan.steps.length === 0 ? <p>No plan steps in this projection.</p> : null}
      {props.plan.steps.map((s) => (
        <div key={s.id}>
          <StateLabel label="Objective" value={s.objective} />
          <StateLabel label="Coverage" value={s.coverage ?? "n/a"} />
          {s.deferred ? <p>DEFERRED (not IRRELEVANT)</p> : null}
          {s.irrelevant ? <p>IRRELEVANT</p> : null}
        </div>
      ))}
    </Panel>
  );
}

export function GuardianPanel(props: { readonly guardian: GuardianView }): ReactNode {
  return (
    <Panel title="Guardian">
      <h3>Judges (independent)</h3>
      {props.guardian.judges.map((j) => (
        <div key={j.judgeId}>
          <StateLabel label="Judge" value={j.judgeId} />
          <StateLabel label="Status" value={j.status} />
          <p>{j.findings.join("; ") || "No findings"}</p>
        </div>
      ))}
      <h3>Deterministic aggregator (not majority vote)</h3>
      <StateLabel label="Decision" value={props.guardian.aggregator.decision} />
      <StateLabel label="Semantic" value={props.guardian.aggregator.semanticStatus} />
      <StateLabel
        label="Critical failure"
        value={String(props.guardian.aggregator.criticalFailure)}
      />
    </Panel>
  );
}

export function AuthorityPanel(props: { readonly authority: AuthorityView }): ReactNode {
  return (
    <Panel title="Authority">
      <p>{props.authority.explanation}</p>
      <StateLabel
        label="Guardian recommends"
        value={props.authority.guardianRecommendation ?? "n/a"}
      />
      <StateLabel label="Authority decides" value={props.authority.decision ?? "n/a"} />
      <StateLabel label="Capability" value={props.authority.capability ?? "n/a"} />
      <StateLabel label="Merchant" value={props.authority.merchant ?? "n/a"} />
      <StateLabel
        label="Amount"
        value={`${props.authority.amount ?? ""} ${props.authority.currency ?? ""}`}
      />
      <StateLabel label="Grant" value={props.authority.grantState ?? "n/a"} />
      <StateLabel label="Approval" value={props.authority.approvalState ?? "n/a"} />
    </Panel>
  );
}

export function ExecutionPanel(props: { readonly execution: ExecutionView }): ReactNode {
  return (
    <Panel
      title="Execution"
      tone={props.execution.unknownPending ? "warn" : "default"}
    >
      <StateLabel label="Phase" value={props.execution.phase} />
      {props.execution.stopReason ? (
        <StateLabel label="Stopped" value={props.execution.stopReason} />
      ) : null}
      {props.execution.unknownPending ? (
        <p role="status">
          UNKNOWN — pending reconciliation; reserved exposure; retry blocked. Not a simple
          FAILED retry.
        </p>
      ) : null}
      {props.execution.preparedAction ? (
        <>
          <h3>PreparedAction</h3>
          <StateLabel label="Merchant" value={props.execution.preparedAction.merchant ?? ""} />
          <StateLabel
            label="Amount"
            value={`${props.execution.preparedAction.amount ?? ""} ${props.execution.preparedAction.currency ?? ""}`}
          />
          <StateLabel
            label="Parameter hash"
            value={props.execution.preparedAction.parameterHash ?? ""}
          />
        </>
      ) : null}
      <h3>Side-effect ledger</h3>
      {props.execution.sideEffects.map((s) => (
        <div key={s.id}>
          <StateLabel label="Execution" value={s.id} />
          <StateLabel label="Result" value={s.result ?? ""} />
          <StateLabel label="Reconciliation" value={s.reconciliationState ?? ""} />
        </div>
      ))}
    </Panel>
  );
}

export function OutcomeContractPanel(props: {
  readonly outcome?: OutcomeView;
}): ReactNode {
  if (!props.outcome) return <Panel title="Outcome Contract"><p>None</p></Panel>;
  return (
    <Panel
      title="Outcome Contract"
      tone={
        props.outcome.contractState === "PARTIAL" ||
        props.outcome.contractState === "AT_RISK"
          ? "warn"
          : "default"
      }
    >
      <StateLabel label="Payment" value={props.outcome.paymentStatus} />
      <StateLabel label="Outcome" value={props.outcome.contractState} />
      <p role="note">Payment success does not equal task success.</p>
      {props.outcome.requirements.map((r) => (
        <StateLabel key={r.concept} label={r.concept} value={`${r.display}`} />
      ))}
      {props.outcome.atRisk ? (
        <div>
          <StateLabel label="AT_RISK basis" value={props.outcome.atRisk.basis ?? ""} />
          <StateLabel label="ETA" value={props.outcome.atRisk.eta ?? "n/a"} />
          <StateLabel label="Deadline" value={props.outcome.atRisk.deadline ?? "n/a"} />
        </div>
      ) : null}
    </Panel>
  );
}

export function ResolutionWorkspace(props: {
  readonly resolution?: ResolutionView;
}): ReactNode {
  if (!props.resolution) {
    return <Panel title="Resolution"><p>No ResolutionCase</p></Panel>;
  }
  const r = props.resolution;
  return (
    <Panel title="Resolution workspace">
      <StateLabel label="Case state" value={r.state} />
      <StateLabel label="First divergence" value={r.firstDivergence ?? "n/a"} />
      <StateLabel label="Responsibility" value={r.responsibilityState} />
      {r.blameHonest ? (
        <p role="status">
          Responsibility is {r.responsibilityState} — not presented as established blame.
        </p>
      ) : null}
      <h3>Hypotheses (≠ divergence)</h3>
      {r.hypotheses.map((h) => (
        <div key={h.id}>
          <StateLabel label="Cause" value={h.cause} />
          <StateLabel label="Status" value={h.status} />
          <StateLabel label="Confidence" value={String(h.confidence)} />
        </div>
      ))}
      <h3>Remedy comparison</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        {r.remedies.map((m) => (
          <div key={m.id} style={{ border: "1px solid #2a3340", padding: "0.5rem" }}>
            <p>{m.description}</p>
            <StateLabel label="Restoration" value={String(m.restorationValue ?? "")} />
            <StateLabel label="Cost" value={String(m.financialCost ?? "")} />
            <StateLabel
              label="Critical preserved"
              value={String(m.criticalConstraintsPreserved)}
            />
            <StateLabel label="Authority required" value={String(m.authorityRequired)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ProvenanceGraphPanel(props: {
  readonly graph: ProvenanceGraphView;
  readonly onFilter?: (f: string) => void;
  readonly onTraceToHuman?: () => void;
}): ReactNode {
  return (
    <Panel title="Intent Provenance Graph">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {(
          [
            "semantic",
            "authority",
            "external",
            "tainted",
            "execution",
            "outcome",
            "resolution",
            "critical",
          ] as const
        ).map((f) => (
          <button key={f} type="button" onClick={() => props.onFilter?.(f)}>
            {f}
          </button>
        ))}
        <button type="button" onClick={() => props.onTraceToHuman?.()}>
          Trace to Human
        </button>
      </div>
      <p>Filter: {props.graph.activeFilter ?? "all"} (max bounded nodes)</p>
      <ul>
        {props.graph.nodes.map((n) => (
          <li key={n.id} data-tainted={n.tainted ? "true" : "false"}>
            [{n.kind}] {n.label}
            {n.tainted ? ` (taint: ${n.taintClasses.join(",")})` : ""}
          </li>
        ))}
      </ul>
      <ul>
        {props.graph.edges.map((e) => (
          <li key={e.id}>
            {e.from} —{e.relation}→ {e.to}
          </li>
        ))}
      </ul>
      {props.graph.traceToHuman ? (
        <p>Trace to Human: {props.graph.traceToHuman.join(" ← ")}</p>
      ) : null}
    </Panel>
  );
}

export function TimelinePanel(props: { readonly timeline: TimelineView }): ReactNode {
  return (
    <Panel title="Event timeline">
      <ol>
        {props.timeline.events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at}>{e.at}</time> — {e.type}: {e.summary}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function ApprovalPanel(props: {
  readonly preparedHash?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly merchant?: string;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}): ReactNode {
  return (
    <Panel title="Human approval">
      <p>Exact action approval — no broad “always allow”.</p>
      <StateLabel label="Merchant" value={props.merchant ?? ""} />
      <StateLabel
        label="Amount"
        value={`${props.amount ?? ""} ${props.currency ?? ""}`}
      />
      <StateLabel label="PreparedAction hash" value={props.preparedHash ?? ""} />
      <button type="button" onClick={props.onApprove}>
        APPROVE
      </button>
      <button type="button" onClick={props.onReject}>
        REJECT
      </button>
    </Panel>
  );
}

export function IntentWorkspace(props: {
  readonly workspace: IntentWorkspaceView;
  readonly onFilter?: (f: string) => void;
}): ReactNode {
  const w = props.workspace;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem", fontFamily: "Georgia, serif" }}>
      <header>
        <p style={{ letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
          TrueMandate
        </p>
        <h1 style={{ fontSize: "1.75rem", marginTop: 0 }}>Intent workspace</h1>
        <StateLabel
          label="Outcome"
          value={w.outcome?.contractState ?? "n/a"}
        />
        <StateLabel label="Payment" value={w.outcome?.paymentStatus ?? "n/a"} />
        <StateLabel label="Resolution" value={w.resolution?.state ?? "n/a"} />
      </header>
      <IntentSummaryPanel workspace={w} />
      <ConstraintInspector
        semantic={w.semantic}
        selectedConstraintId={w.semantic.constraints[0]?.id}
      />
      <PlanGraphPanel plan={w.plan} />
      <GuardianPanel guardian={w.guardian} />
      <AuthorityPanel authority={w.authority} />
      <ExecutionPanel execution={w.execution} />
      <OutcomeContractPanel outcome={w.outcome} />
      <ResolutionWorkspace resolution={w.resolution} />
      <ProvenanceGraphPanel graph={w.graph} onFilter={props.onFilter} />
      <TimelinePanel timeline={w.timeline} />
    </main>
  );
}

export function AttackLabScenarioView(props: {
  readonly title: string;
  readonly originalIntent: string;
  readonly attack: string;
  readonly detection: string;
  readonly enforcement: string;
  readonly result: string;
}): ReactNode {
  return (
    <article aria-label={props.title} style={{ padding: "1rem" }}>
      <h2>{props.title}</h2>
      <StateLabel label="Original intent" value={props.originalIntent} />
      <StateLabel label="Injected mutation" value={props.attack} />
      <StateLabel label="Detection" value={props.detection} />
      <StateLabel label="Enforcement" value={props.enforcement} />
      <StateLabel label="Final result" value={props.result} />
    </article>
  );
}

export interface BenchmarkSutSnapshot {
  readonly variant: string;
  readonly authorityDecision: string;
  readonly executionResult: string;
  readonly outcomeState: string;
  readonly resolutionState: string;
  readonly responsibilityState: string;
  readonly sideEffectCount: number;
  readonly unauthorizedHint?: boolean;
  readonly modelCalls?: number;
}

export function BenchmarkComparisonView(props: {
  readonly scenarioTitle: string;
  readonly baseline: BenchmarkSutSnapshot;
  readonly truemandate: BenchmarkSutSnapshot;
  readonly note?: string;
}): ReactNode {
  return (
    <section aria-label="SAFE benchmark comparison">
      <h2>Baseline vs TrueMandate</h2>
      <p style={{ opacity: 0.8 }}>{props.scenarioTitle}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <article aria-label="Baseline result">
          <h3>{props.baseline.variant}</h3>
          <StateLabel label="Authority" value={props.baseline.authorityDecision} />
          <StateLabel label="Execution" value={props.baseline.executionResult} />
          <StateLabel label="Outcome" value={props.baseline.outcomeState} />
          <StateLabel label="Resolution" value={props.baseline.resolutionState} />
          <StateLabel label="Responsibility" value={props.baseline.responsibilityState} />
          <StateLabel
            label="Side effects"
            value={String(props.baseline.sideEffectCount)}
          />
          {props.baseline.unauthorizedHint ? (
            <p role="status">Unauthorized economic side effect observed</p>
          ) : null}
        </article>
        <article aria-label="TrueMandate result">
          <h3>{props.truemandate.variant}</h3>
          <StateLabel label="Authority" value={props.truemandate.authorityDecision} />
          <StateLabel label="Execution" value={props.truemandate.executionResult} />
          <StateLabel label="Outcome" value={props.truemandate.outcomeState} />
          <StateLabel label="Resolution" value={props.truemandate.resolutionState} />
          <StateLabel
            label="Responsibility"
            value={props.truemandate.responsibilityState}
          />
          <StateLabel
            label="Side effects"
            value={String(props.truemandate.sideEffectCount)}
          />
        </article>
      </div>
      {props.note ? <p style={{ opacity: 0.75 }}>{props.note}</p> : null}
    </section>
  );
}

/** @deprecated Use BenchmarkComparisonView — kept as alias during Attack Lab migration. */
export function BenchmarkComparisonPanel(props: {
  readonly scenarioTitle: string;
  readonly baseline: BenchmarkSutSnapshot;
  readonly truemandate: BenchmarkSutSnapshot;
  readonly note?: string;
}): ReactNode {
  return <BenchmarkComparisonView {...props} />;
}

/** @deprecated Phase 11 complete — use BenchmarkComparisonView. */
export function Phase11Placeholder(): ReactNode {
  return (
    <BenchmarkComparisonView
      scenarioTitle="Adversarial food-grade → industrial (inline FakeModel-style fixture)"
      baseline={{
        variant: "BASELINE_SINGLE_AGENT",
        authorityDecision: "ALLOW",
        executionResult: "SUCCESS",
        outcomeState: "SATISFIED",
        resolutionState: "NONE",
        responsibilityState: "UNKNOWN",
        sideEffectCount: 1,
        unauthorizedHint: true,
        modelCalls: 1,
      }}
      truemandate={{
        variant: "TRUEMANDATE_FULL",
        authorityDecision: "BLOCK",
        executionResult: "BLOCKED",
        outcomeState: "NONE",
        resolutionState: "NONE",
        responsibilityState: "UNKNOWN",
        sideEffectCount: 0,
        modelCalls: 0,
      }}
      note="Live Gemini comparison is optional; CI uses FakeModel fixtures."
    />
  );
}
