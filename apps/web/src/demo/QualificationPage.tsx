import { useState, type ReactNode } from "react";
import { ProductTruthBadge } from "./ProductTruth";
import { QUALIFICATION_READ_MODEL, type QualificationLevelRow } from "./qualification-readmodel";

/**
 * Production Qualification — the judge-facing benchmark surface.
 *
 * Every number rendered here comes from QUALIFICATION_READ_MODEL, which is
 * verified against committed evidence by qualification-readmodel.test.ts.
 * No authoritative value is inlined in this file.
 */

const RM = QUALIFICATION_READ_MODEL;

function ComparisonBar(props: {
  readonly label: string;
  readonly caption: string;
  readonly trueMandate: number;
  readonly baseline: number;
  readonly scale: number;
  readonly direction: "higher" | "lower";
}) {
  const width = (value: number) =>
    `${Math.max(value > 0 ? 2 : 0, Math.min(100, (value / props.scale) * 100))}%`;
  const better = props.direction === "higher" ? "Higher is better" : "Lower is better";
  return (
    <section className="tm-qual-bar" aria-label={`${props.label} comparison`}>
      <header>
        <div>
          <h4>{props.label}</h4>
          <p>{props.caption}</p>
        </div>
        <span>{better}</span>
      </header>
      <div className="tm-qual-measure">
        <span className="who">TrueMandate</span>
        <div className="track">
          <i className="truemandate" style={{ width: width(props.trueMandate) }} />
        </div>
        <b className="good">{props.trueMandate}</b>
      </div>
      <div className="tm-qual-measure">
        <span className="who">Baseline agent</span>
        <div className="track">
          <i className="baseline" style={{ width: width(props.baseline) }} />
        </div>
        <b className={props.baseline > 0 && props.direction === "lower" ? "bad" : undefined}>
          {props.baseline}
        </b>
      </div>
    </section>
  );
}

function SectionA() {
  const pc = RM.pairedCorrectness;
  return (
    <section className="tm-qual-section" aria-label="TrueMandate versus baseline">
      <header className="tm-qual-section-head">
        <h3>TrueMandate vs baseline</h3>
        <p>
          The same {pc.totalScenarios} economic scenarios run through TrueMandate and through a
          conventional single-agent baseline.
        </p>
      </header>

      <div className="tm-qual-headline">
        <article className="win">
          <span>TrueMandate</span>
          <strong>
            {pc.trueMandate.correct} / {pc.totalScenarios}
          </strong>
          <small>
            {pc.trueMandate.unauthorizedExecutions} unauthorized ·{" "}
            {pc.trueMandate.criticalFailures} critical
          </small>
        </article>
        <article className="lose">
          <span>Baseline single agent</span>
          <strong>
            {pc.baseline.correct} / {pc.totalScenarios}
          </strong>
          <small>
            {pc.baseline.unauthorizedExecutions} unauthorized · {pc.baseline.criticalFailures}{" "}
            critical
          </small>
        </article>
      </div>

      <div className="tm-qual-bars">
        <ComparisonBar
          label="Scenarios correct"
          caption="Correct authority decision and execution outcome."
          trueMandate={pc.trueMandate.correct}
          baseline={pc.baseline.correct}
          scale={pc.totalScenarios}
          direction="higher"
        />
        <ComparisonBar
          label="Unauthorized actions"
          caption="Economic action taken without valid authority."
          trueMandate={pc.trueMandate.unauthorizedExecutions}
          baseline={pc.baseline.unauthorizedExecutions}
          scale={pc.totalScenarios}
          direction="lower"
        />
        <ComparisonBar
          label="Critical failures"
          caption="A critical safety invariant was violated."
          trueMandate={pc.trueMandate.criticalFailures}
          baseline={pc.baseline.criticalFailures}
          scale={pc.totalScenarios}
          direction="lower"
        />
      </div>

      <h4 className="tm-qual-sub">Five DomainPacks, one governance path</h4>
      <div className="tm-qual-domains">
        {pc.domains.map((domain) => (
          <article key={domain.domainId}>
            <span className="dom">{domain.label}</span>
            <div className="pair">
              <span className="good">
                {domain.trueMandateCorrect} / {domain.total}
              </span>
              <small>TrueMandate</small>
            </div>
            <div className="pair">
              <span className="bad">
                {domain.baselineCorrect} / {domain.total}
              </span>
              <small>Baseline</small>
            </div>
          </article>
        ))}
      </div>

      <p className="tm-qual-repro">
        Reproducible with no cloud account: <code>{pc.reproduceCommand}</code>
      </p>
    </section>
  );
}

function LevelChart({ levels }: { readonly levels: readonly QualificationLevelRow[] }) {
  const width = 760;
  const height = 260;
  const left = 56;
  const right = 56;
  const top = 24;
  const bottom = 52;
  const maxThroughput = Math.max(...levels.map((l) => l.throughputPerSecond));
  const maxCpu = 1;
  const x = (index: number) =>
    left + (index / Math.max(1, levels.length - 1)) * (width - left - right);
  const yThroughput = (value: number) =>
    height - bottom - (value / maxThroughput) * (height - top - bottom);
  const yCpu = (value: number) => height - bottom - (value / maxCpu) * (height - top - bottom);

  return (
    <figure className="tm-qual-chart">
      <figcaption>
        Throughput rose with concurrency while application compute stayed low — the limit reached
        was provider capacity
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Throughput and peak CPU by concurrency level">
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} className="axis" />
        <line x1={left} y1={top} x2={left} y2={height - bottom} className="axis" />

        <polyline
          className="series-throughput"
          points={levels.map((l, i) => `${x(i)},${yThroughput(l.throughputPerSecond)}`).join(" ")}
        />
        <polyline
          className="series-cpu"
          points={levels.map((l, i) => `${x(i)},${yCpu(l.peakCpu)}`).join(" ")}
        />

        {levels.map((level, index) => (
          <g key={level.level}>
            <circle
              className={level.verdict === "PASS" ? "pt-throughput" : "pt-throughput boundary"}
              cx={x(index)}
              cy={yThroughput(level.throughputPerSecond)}
              r={5}
            />
            <circle className="pt-cpu" cx={x(index)} cy={yCpu(level.peakCpu)} r={4} />
            <text className="lvl" x={x(index)} y={height - 30} textAnchor="middle">
              {level.level}
            </text>
            <text className="lvl-sub" x={x(index)} y={height - 14} textAnchor="middle">
              {level.provider429s} × 429
            </text>
          </g>
        ))}
      </svg>
      <div className="tm-qual-chart-legend">
        <span className="k-throughput">Workflow throughput / s</span>
        <span className="k-cpu">Peak CPU utilization</span>
        <span className="k-boundary">Degradation boundary</span>
      </div>
    </figure>
  );
}

function SectionB() {
  const q = RM.qualification;
  return (
    <section className="tm-qual-section" aria-label="Production qualification">
      <header className="tm-qual-section-head">
        <h3>Production qualification</h3>
        <p>
          Five DomainPacks driven at increasing concurrency against the live deployment, with real
          model calls. One documented run per level — results are never averaged across runs.
        </p>
      </header>

      <div className="tm-qual-levels">
        {q.levels.map((level) => (
          <article
            key={level.level}
            className={level.verdict === "PASS" ? "lvl pass" : "lvl boundary"}
          >
            <span className="name">{level.level}</span>
            <strong>{level.verdict === "PASS" ? "PASS" : "Provider degradation boundary"}</strong>
            <small>
              {level.passed} / {level.total} scenarios · {(level.errorRate * 100).toFixed(1)}% error
            </small>
            <div className="lvl-meta">
              <span>p95 {(level.latencyMs.p95 / 1000).toFixed(1)} s</span>
              <span>{level.throughputPerSecond.toFixed(3)} wf/s</span>
              <span>CPU {(level.peakCpu * 100).toFixed(1)}%</span>
              <span className={level.provider429s > 0 ? "warn" : undefined}>
                {level.provider429s} × HTTP 429
              </span>
            </div>
            <code className="lvl-run">{level.runId}</code>
          </article>
        ))}
      </div>

      <LevelChart levels={q.levels} />

      <p className="tm-qual-note">{q.degradationSummary}</p>
      <p className="tm-qual-note muted">
        Not attempted: {q.notAttempted.join(" · ")} — each level gates on the previous one passing.
      </p>
    </section>
  );
}

function SectionC() {
  const safety = RM.safety;
  const cards = [
    { label: "Unauthorized executions", value: safety.unauthorizedExecutions },
    { label: "Duplicate effects", value: safety.duplicateEffects },
    { label: "Unintended economic side effects", value: safety.unintendedEconomicSideEffects },
  ];
  return (
    <section className="tm-qual-section tm-qual-safety" aria-label="Safety under degradation">
      <header className="tm-qual-section-head">
        <h3>Safety under degradation</h3>
        <p>
          Aggregated across all {safety.runsAggregated} recorded runs — the runs that failed their
          performance thresholds as well as the ones that passed.
        </p>
      </header>

      <div className="tm-qual-safety-cards">
        {cards.map((card) => (
          <article key={card.label}>
            <strong>{card.value}</strong>
            <span>{card.label}</span>
          </article>
        ))}
      </div>

      <p className="tm-qual-failclosed">{safety.failClosedExplanation}</p>
    </section>
  );
}

/**
 * The superseded corpus is mounted only once a judge deliberately opens it, so
 * its numbers never appear anywhere on the default judge path — not even hidden
 * in the DOM behind a collapsed disclosure.
 */
function HistoricalDisclosure(props: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="tm-qual-historical"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Historical benchmark — superseded procurement-era corpus</summary>
      <div className="body">
        <p className="tm-qual-historical-note">
          Retained for provenance. This is a deterministic procurement-era corpus from an earlier
          architecture. It is not current evidence and is not part of the qualification above.
        </p>
        {open ? props.children : null}
      </div>
    </details>
  );
}

export function QualificationPage(props: { readonly historical?: ReactNode }) {
  return (
    <section className="tm-view tm-qual" aria-label="Production Qualification">
      <header className="tm-qual-hero">
        <div>
          <ProductTruthBadge truthClass="CANONICAL_HISTORICAL" detail="OBSERVED EVIDENCE" />
          <p className="overline">Five DomainPacks · live Google Cloud deployment</p>
          <h2>Production Qualification</h2>
          <p className="lede">
            Measured through the shared governed workflow runtime. Every figure below is transcribed
            from committed run evidence and verified in CI against those files.
          </p>
        </div>
      </header>

      <SectionA />
      <SectionB />
      <SectionC />

      <footer className="tm-qual-footer">
        <p className="tm-qual-acceptance">{RM.acceptance.statement}</p>
        <p className="tm-qual-methodology">
          Full methodology, limitations, per-run provenance, threshold behaviour, and what this
          benchmark does and does not establish:{" "}
          <a href={RM.methodologyUrl} target="_blank" rel="noreferrer">
            {RM.methodologyPath}
          </a>
        </p>
        {props.historical ? <HistoricalDisclosure>{props.historical}</HistoricalDisclosure> : null}
      </footer>
    </section>
  );
}
