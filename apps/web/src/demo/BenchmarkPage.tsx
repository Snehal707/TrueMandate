import { useMemo, useState } from "react";
import { BENCHMARK_READ_MODEL } from "./benchmark-readmodel";
import { ProductTruthBadge } from "./ProductTruth";
import { STRESS_READ_MODEL } from "./stress-readmodel";
import { StressPage } from "./StressPage";
import { CurrentBenchmark } from "./CurrentBenchmark";

/** Canonical SAFE evidence. All headline values come from immutable read models. */
export function BenchmarkPage() {
  const [tab, setTab] = useState<"current" | "benchmark" | "stress">("current");
  return (
    <>
      <div className="tm-subtabs" role="tablist" aria-label="Benchmark sections">
        <button type="button" role="tab" aria-selected={tab === "current"} className={tab === "current" ? "active" : undefined} onClick={() => setTab("current")}>
          Current system
        </button>
        <button type="button" role="tab" aria-selected={tab === "benchmark"} className={tab === "benchmark" ? "active" : undefined} onClick={() => setTab("benchmark")}>
          Historical SAFE V1
        </button>
        <button type="button" role="tab" aria-selected={tab === "stress"} className={tab === "stress" ? "active" : undefined} onClick={() => setTab("stress")}>
          Corpus construction
        </button>
      </div>
      {tab === "current" ? <CurrentBenchmark /> : tab === "stress" ? <StressPage /> : <HistoricalSafeBenchmark />}
    </>
  );
}

function BenchmarkMetric(props: {
  readonly label: string;
  readonly description: string;
  readonly truemandate: number;
  readonly baseline: number;
  readonly total: number;
  readonly direction: "higher" | "lower";
}) {
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / props.total) * 100))}%`;
  return (
    <section className="tm-safe-metric" aria-label={`${props.label} comparison`}>
      <header>
        <div><h3>{props.label}</h3><p>{props.description}</p></div>
        <span>{props.direction === "higher" ? "Higher is better" : "Lower is better"}</span>
      </header>
      <div className="tm-safe-measure">
        <div className="tm-safe-measure-label"><strong>TrueMandate</strong><b>{props.truemandate}</b></div>
        <div className="tm-safe-track" role="img" aria-label={`TrueMandate ${props.truemandate} of ${props.total}`}>
          <i className="truemandate" style={{ width: width(props.truemandate) }} />
        </div>
      </div>
      <div className="tm-safe-measure">
        <div className="tm-safe-measure-label"><strong>Baseline</strong><b>{props.baseline}</b></div>
        <div className="tm-safe-track" role="img" aria-label={`Baseline ${props.baseline} of ${props.total}`}>
          <i className="baseline" style={{ width: width(props.baseline) }} />
        </div>
      </div>
    </section>
  );
}

export function HistoricalSafeBenchmark() {
  const rm = BENCHMARK_READ_MODEL;
  const combined = STRESS_READ_MODEL.combined;
  const truemandate = rm.golden.find((row) => row.variant === "TRUEMANDATE_FULL");
  const baselines = useMemo(() => rm.golden.filter((row) => row.variant !== "TRUEMANDATE_FULL"), [rm.golden]);

  return (
    <section className="tm-view" aria-label="SAFE Benchmark">
      <header className="tm-safe-hero">
        <div>
          <ProductTruthBadge truthClass="CANONICAL_HISTORICAL" detail={`RUN ${combined.runId}`} />
          <p className="overline">Fixed reproducible evaluation</p>
          <h2>SAFE Benchmark</h2>
          <p>
            This procurement-era deterministic security corpus compares its historical TrueMandate adapter with
            <code>BASELINE_SINGLE_AGENT</code>. It is canonical evidence, not a current-system load result.
          </p>
        </div>
        <div className="tm-safe-thesis">
          <strong>SAFE Benchmark</strong><span>fixed, reproducible evaluation</span>
          <i>versus</i>
          <strong>Attack Lab</strong><span>interactive adversarial testing</span>
        </div>
      </header>

      <div className="tm-safe-scoreboard" aria-label="Canonical 500 scenario comparison">
        <article className="tm-safe-total truemandate">
          <span>TrueMandate</span>
          <strong>{combined.trumandateFull.passed} / {combined.trumandateFull.total}</strong>
          <small>{combined.trumandateFull.failed} failed · {combined.trumandateFull.criticalIncidentCount} critical · {combined.trumandateFull.unauthorizedExecutionCount} unauthorized</small>
        </article>
        <article className="tm-safe-total baseline">
          <span>Baseline single agent</span>
          <strong>{combined.baselineSingleAgent.passed} / {combined.baselineSingleAgent.total}</strong>
          <small>{combined.baselineSingleAgent.failed} failed · {combined.baselineSingleAgent.criticalIncidentCount} critical · {combined.baselineSingleAgent.unauthorizedExecutionCount} unauthorized</small>
        </article>
      </div>

      <div className="tm-safe-metrics">
        <BenchmarkMetric label="Scenarios passed" description="All required assertions passed." truemandate={combined.trumandateFull.passed} baseline={combined.baselineSingleAgent.passed} total={combined.total} direction="higher" />
        <BenchmarkMetric label="Critical failures" description="A critical safety invariant failed." truemandate={combined.trumandateFull.criticalIncidentCount} baseline={combined.baselineSingleAgent.criticalIncidentCount} total={combined.total} direction="lower" />
        <BenchmarkMetric label="Unauthorized actions" description="Execution occurred without valid authority." truemandate={combined.trumandateFull.unauthorizedExecutionCount} baseline={combined.baselineSingleAgent.unauthorizedExecutionCount} total={combined.total} direction="lower" />
      </div>

      <p className="tm-safe-honesty">
        <strong>{combined.trumandateFull.failed} TrueMandate scenarios failed benchmark assertions.</strong>{" "}
        None produced a critical failure or unauthorized action. The result is not presented as {combined.total} / {combined.total}.
      </p>

      <h3 className="tm-safe-detail-title">Canonical corpus detail</h3>
      <div className="tm-bm-cards">
        <div className="tm-bm-card ok"><div className="k">Golden scenarios</div><div className="v">{truemandate?.passed ?? "—"} / {truemandate?.total ?? "—"}</div><div className="m">TRUEMANDATE_FULL · manually authored</div></div>
        <div className="tm-bm-card warn"><div className="k">Base catalog</div><div className="v">{rm.catalog.passed} / {rm.catalog.total}</div><div className="m">Immutable generated catalog</div></div>
        <div className="tm-bm-card ok"><div className="k">Catalog composite</div><div className="v">{rm.catalog.composite.toFixed(4)}</div><div className="m">TRUEMANDATE_FULL catalog233</div></div>
      </div>

      <h3 className="tm-safe-detail-title">Golden baseline comparison</h3>
      <div className="tm-bm-table" role="table" aria-label="Golden baseline comparison">
        <div className="tm-bm-row head" role="row"><span role="columnheader">Variant</span><span role="columnheader">Passed</span><span role="columnheader">Composite</span><span role="columnheader">Unauthorized</span><span role="columnheader">Critical</span></div>
        {baselines.map((row) => (
          <div className="tm-bm-row" role="row" key={row.variant}>
            <span role="cell" className="name">{row.variant}</span><span role="cell">{row.passed} / {row.total}</span><span role="cell">{row.composite.toFixed(4)}</span>
            <span role="cell" className={row.unauthorizedExecutionCount > 0 ? "bad" : "good"}>{row.unauthorizedExecutionCount}</span>
            <span role="cell" className={row.criticalIncidents > 0 ? "bad" : "good"}>{row.criticalIncidents}</span>
          </div>
        ))}
        <div className="tm-bm-row hero" role="row"><span role="cell" className="name">TRUEMANDATE_FULL</span><span role="cell">{truemandate?.passed} / {truemandate?.total}</span><span role="cell">{truemandate?.composite.toFixed(4)}</span><span role="cell" className="good">{truemandate?.unauthorizedExecutionCount}</span><span role="cell" className="good">{truemandate?.criticalIncidents}</span></div>
      </div>

      <details className="tm-details tm-safe-failure-detail">
        <summary>The base catalog failures, explained honestly</summary>
        <div className="body">
          <p>{rm.failureAnalysis.summary}</p>
          <p>Failed ids: {rm.catalog.failedIds.join(", ")}</p>
          <p>Source: {rm.failureAnalysis.source}. Fixtures and scoring remain immutable.</p>
        </div>
      </details>

      <div className="tm-chips tm-safe-provenance">
        <span className="tm-chip"><b>Evaluation</b> deterministic memory adapters</span>
        <span className="tm-chip"><b>Gemini calls during SAFE evaluation</b> {rm.geminiCallsDuringEvaluation}</span>
        <span className="tm-chip"><b>Accepted</b> {rm.generatedAt} · SAFE_V1</span>
      </div>
    </section>
  );
}
