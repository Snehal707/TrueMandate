import { CURRENT_BENCHMARK_READ_MODEL } from "./current-benchmark-readmodel";
import { ProductTruthBadge } from "./ProductTruth";

type AcceptedModel = {
  readonly available: true;
  readonly benchmarkVersion: "BENCHMARK_V2";
  readonly runId: string;
  readonly createdAt: string;
  readonly environment: string;
  readonly commitSha: string;
  readonly sourceInputHash: string;
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly successRate: number;
  readonly authorizationCorrectnessRate: number;
  readonly unauthorizedExecutionRejectionRate: number;
  readonly provenanceCompletenessRate: number;
  readonly replayProtectionRate: number;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly peakThroughputPerSecond: number;
  readonly configuredCeilingReached: boolean;
  readonly firstBottleneck: null | { readonly service: string; readonly threshold: string; readonly observedValue: number };
  readonly domains: readonly { readonly domainId: string; readonly total: number; readonly passed: number; readonly failed: number; readonly unauthorizedExecutions: number }[];
  readonly load: readonly { readonly lane: "WORKFLOW_WRITE" | "PUBLIC_READ"; readonly concurrency: number; readonly throughputPerSecond: number; readonly errorRate: number; readonly latencyMs: { readonly p50: number; readonly p95: number; readonly p99: number } }[];
};

function LoadChart({ model }: { readonly model: AcceptedModel }) {
  const workflowLoad = model.load.filter((sample) => sample.lane === "WORKFLOW_WRITE");
  const width = 720;
  const height = 240;
  const inset = 34;
  const maxLatency = Math.max(1, ...workflowLoad.map((sample) => sample.latencyMs.p99));
  const point = (value: number, index: number) => {
    const x = workflowLoad.length === 1 ? width / 2 : inset + (index / (workflowLoad.length - 1)) * (width - inset * 2);
    const y = height - inset - (value / maxLatency) * (height - inset * 2);
    return `${x},${y}`;
  };
  const series = (key: "p50" | "p95" | "p99") => workflowLoad.map((sample, index) => point(sample.latencyMs[key], index)).join(" ");
  return (
    <figure className="tm-benchmark-chart">
      <figcaption>End-to-end workflow latency by concurrency</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Workflow latency p50, p95, and p99 by concurrency level">
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} className="axis" />
        <line x1={inset} y1={inset} x2={inset} y2={height - inset} className="axis" />
        <polyline points={series("p50")} className="p50" />
        <polyline points={series("p95")} className="p95" />
        <polyline points={series("p99")} className="p99" />
        {workflowLoad.map((sample, index) => {
          const [x] = point(0, index).split(",");
          return <text key={sample.concurrency} x={x} y={height - 10} textAnchor="middle">{sample.concurrency}</text>;
        })}
      </svg>
      <div className="tm-benchmark-legend"><span className="p50">p50</span><span className="p95">p95</span><span className="p99">p99</span></div>
    </figure>
  );
}

function IntegrityBars({ model }: { readonly model: AcceptedModel }) {
  const rows = [
    ["Scenario success", model.successRate],
    ["Authorization correctness", model.authorizationCorrectnessRate],
    ["Unauthorized rejection", model.unauthorizedExecutionRejectionRate],
    ["Provenance completeness", model.provenanceCompletenessRate],
    ["Replay protection", model.replayProtectionRate],
  ] as const;
  return <figure className="tm-benchmark-integrity"><figcaption>Correctness and integrity</figcaption>{rows.map(([label, value]) => <div className="tm-benchmark-integrity-row" key={label}><span>{label}</span><div className="track" aria-hidden="true"><i style={{ width: `${value * 100}%` }} /></div><strong>{(value * 100).toFixed(1)}%</strong></div>)}</figure>;
}

function LoadHealth({ model }: { readonly model: AcceptedModel }) {
  return <figure className="tm-benchmark-load-health"><figcaption>Throughput and errors from the same accepted run</figcaption><div className="tm-benchmark-load-grid">{model.load.map((sample) => <article key={`${sample.lane}-${sample.concurrency}`}><span>{sample.lane === "WORKFLOW_WRITE" ? "Workflow" : "Read"} c{sample.concurrency}</span><strong>{sample.throughputPerSecond.toFixed(2)} req/s</strong><small>{(sample.errorRate * 100).toFixed(2)}% errors</small></article>)}</div></figure>;
}

export function CurrentBenchmark() {
  if (!CURRENT_BENCHMARK_READ_MODEL.available) {
    return (
      <section className="tm-view" aria-label="Current System Benchmark">
        <header className="tm-safe-hero"><div><ProductTruthBadge truthClass="PRESENTATION_DERIVED" detail="BENCHMARK_V2" /><p className="overline">Current architecture benchmark</p><h2>Current System Benchmark</h2><p>Results remain unavailable until a complete run is bound to the current benchmark inputs and a real source commit.</p></div></header>
        <div className="tm-benchmark-unavailable" role="status"><strong>No accepted current-system run</strong><p>{CURRENT_BENCHMARK_READ_MODEL.reason}</p><p>The historical SAFE evidence remains available in the next tab; it is not substituted here.</p></div>
      </section>
    );
  }
  const model = CURRENT_BENCHMARK_READ_MODEL as unknown as AcceptedModel;
  return (
    <section className="tm-view" aria-label="Current System Benchmark">
      <header className="tm-safe-hero"><div><ProductTruthBadge truthClass="CANONICAL_HISTORICAL" detail={`RUN ${model.runId}`} /><p className="overline">Current five-domain architecture</p><h2>Current System Benchmark</h2><p>Measured through the shared governed workflow runtime. Procurement is one DomainPack among five.</p></div></header>
      <div className="tm-bm-cards"><div className="tm-bm-card ok"><div className="k">Scenarios passed</div><div className="v">{model.passedScenarios} / {model.totalScenarios}</div></div><div className="tm-bm-card ok"><div className="k">Authorization correctness</div><div className="v">{(model.authorizationCorrectnessRate * 100).toFixed(1)}%</div></div><div className="tm-bm-card ok"><div className="k">Provenance completeness</div><div className="v">{(model.provenanceCompletenessRate * 100).toFixed(1)}%</div></div></div>
      <div className="tm-benchmark-visual-grid"><IntegrityBars model={model} /><LoadChart model={model} /></div>
      <LoadHealth model={model} />
      <div className="tm-benchmark-charts"><article><h3>Latency</h3><strong>p50 {model.latencyMs.p50.toFixed(0)} ms</strong><span>p95 {model.latencyMs.p95.toFixed(0)} ms · p99 {model.latencyMs.p99.toFixed(0)} ms</span></article><article><h3>Peak throughput</h3><strong>{model.peakThroughputPerSecond.toFixed(2)} workflows/s</strong><span>{model.firstBottleneck ? `${model.firstBottleneck.service}: ${model.firstBottleneck.threshold}` : "No threshold reached"}</span></article></div>
      <div className="tm-bm-table" role="table" aria-label="DomainPack benchmark coverage"><div className="tm-bm-row head" role="row"><span>DomainPack</span><span>Passed</span><span>Failed</span><span>Unauthorized</span><span>Coverage</span></div>{model.domains.map((domain) => <div className="tm-bm-row" role="row" key={domain.domainId}><span className="name">{domain.domainId}</span><span>{domain.passed}</span><span>{domain.failed}</span><span>{domain.unauthorizedExecutions}</span><span>{domain.total}</span></div>)}</div>
      <div className="tm-chips tm-safe-provenance"><span className="tm-chip"><b>Commit</b> {model.commitSha.slice(0, 12)}</span><span className="tm-chip"><b>Environment</b> {model.environment}</span><span className="tm-chip"><b>Accepted</b> {model.createdAt}</span></div>
    </section>
  );
}
