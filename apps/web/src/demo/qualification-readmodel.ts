/**
 * PRODUCTION QUALIFICATION READ MODEL.
 *
 * Every value here is transcribed from committed benchmark evidence under
 * `evals/benchmark/v2/runs/`. Each block records the exact run it came from.
 *
 * Nothing in this module may be edited by hand without the evidence changing:
 * `qualification-readmodel.test.ts` recomputes every field directly from the
 * evidence files and fails on any drift. The judge pages render only from this
 * module — they never inline authoritative numbers.
 *
 * THIS IS NOT AN ACCEPTED DATASET. SAFE Benchmark V2 full acceptance was not
 * achieved; no run directory is marked `acceptedDataset: true`. The accepted-run
 * gate in `current-benchmark-readmodel.ts` remains unavailable and untouched.
 */

export interface QualificationDomainRow {
  readonly domainId: string;
  readonly label: string;
  readonly trueMandateCorrect: number;
  readonly baselineCorrect: number;
  readonly total: number;
}

export interface QualificationLevelRow {
  readonly level: string;
  readonly concurrency: number;
  readonly runId: string;
  /** PASS only where the recorded verdict flag is true. C8 is never PASS. */
  readonly verdict: "PASS" | "PROVIDER_DEGRADATION_BOUNDARY";
  readonly passed: number;
  readonly total: number;
  readonly errorRate: number;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly p99: number };
  readonly throughputPerSecond: number;
  readonly peakCpu: number;
  readonly peakMemory: number;
  readonly peakInstances: number;
  readonly provider429s: number;
  readonly timedOutAttempts: number;
}

/** Source: evals/benchmark/v2/runs/benchmark-v2-20260825T172457Z/paired-correctness-records.jsonl */
const PAIRED_SOURCE_RUN_ID = "benchmark-v2-20260825T172457Z";

/** Source runs for each load level, one documented run per level. Never averaged. */
const LEVELS: readonly QualificationLevelRow[] = [
  {
    level: "C1",
    concurrency: 1,
    runId: "benchmark-v2-c1-20260826T191532Z",
    verdict: "PASS",
    passed: 50,
    total: 50,
    errorRate: 0,
    latencyMs: { p50: 64970.074616000056, p95: 85110.46245000022, p99: 107212.579467 },
    throughputPerSecond: 0.01474304784207483,
    peakCpu: 0.1395,
    peakMemory: 0.34950000000000003,
    peakInstances: 1,
    provider429s: 0,
    timedOutAttempts: 0,
  },
  {
    level: "C2",
    concurrency: 2,
    runId: "benchmark-v2-c2-20260827T042806Z",
    verdict: "PASS",
    passed: 50,
    total: 50,
    errorRate: 0,
    latencyMs: { p50: 60603.860832000035, p95: 91099.00929100001, p99: 105593.022838 },
    throughputPerSecond: 0.030747716828286916,
    peakCpu: 0.2095,
    peakMemory: 0.34950000000000003,
    peakInstances: 1,
    provider429s: 0,
    timedOutAttempts: 0,
  },
  {
    level: "C4",
    concurrency: 4,
    runId: "benchmark-v2-c4-20260827T051023Z",
    verdict: "PASS",
    passed: 50,
    total: 50,
    errorRate: 0,
    latencyMs: { p50: 72537.705326, p95: 105335.10535700002, p99: 108747.08501899999 },
    throughputPerSecond: 0.05079385719408638,
    peakCpu: 0.3385,
    peakMemory: 0.3795,
    peakInstances: 2,
    provider429s: 7,
    timedOutAttempts: 2,
  },
  {
    level: "C8",
    concurrency: 8,
    runId: "benchmark-v2-c8-20260827T053118Z",
    verdict: "PROVIDER_DEGRADATION_BOUNDARY",
    passed: 47,
    total: 50,
    errorRate: 0.06,
    latencyMs: { p50: 78848.832239, p95: 108501.568549, p99: 113889.39765599999 },
    throughputPerSecond: 0.08813958489781096,
    peakCpu: 0.1095,
    peakMemory: 0.4195,
    peakInstances: 1,
    provider429s: 14,
    timedOutAttempts: 4,
  },
];

const DOMAINS: readonly QualificationDomainRow[] = [
  { domainId: "procurement", label: "Procurement", trueMandateCorrect: 10, baselineCorrect: 2, total: 10 },
  { domainId: "travel", label: "Travel", trueMandateCorrect: 10, baselineCorrect: 2, total: 10 },
  { domainId: "saas_it_spend", label: "SaaS / IT Spend", trueMandateCorrect: 10, baselineCorrect: 2, total: 10 },
  { domainId: "invoice_vendor_payment", label: "Invoice / Vendor Payment", trueMandateCorrect: 10, baselineCorrect: 2, total: 10 },
  { domainId: "logistics_fulfillment", label: "Logistics / Fulfillment", trueMandateCorrect: 10, baselineCorrect: 0, total: 10 },
];

export const QUALIFICATION_READ_MODEL = {
  /** Section A — paired correctness, current system vs single-agent baseline. */
  pairedCorrectness: {
    sourceRunId: PAIRED_SOURCE_RUN_ID,
    sourcePath: `evals/benchmark/v2/runs/${PAIRED_SOURCE_RUN_ID}/paired-correctness-records.jsonl`,
    totalScenarios: 50,
    trueMandate: { correct: 50, unauthorizedExecutions: 0, criticalFailures: 0 },
    baseline: { correct: 8, unauthorizedExecutions: 28, criticalFailures: 40 },
    domains: DOMAINS,
    /** Reproducible with no cloud credentials. */
    reproduceCommand: "npm run benchmark:v2:local",
  },

  /** Section B — production load qualification. One documented run per level. */
  qualification: {
    levels: LEVELS,
    /** Levels beyond C8 were never attempted; each level gates on the previous. */
    notAttempted: ["C16", "C32", "public read load"],
    degradationSummary:
      "Vertex provider availability was the first observed production degradation boundary. "
      + "Throughput scaled with concurrency while application compute peaked at 33.9% CPU, "
      + "so the limit reached was provider capacity rather than TrueMandate compute saturation.",
  },

  /** Section C — safety invariants across every recorded run, passing and failing. */
  safety: {
    runsAggregated: 14,
    unauthorizedExecutions: 0,
    duplicateEffects: 0,
    unintendedEconomicSideEffects: 0,
    failClosedExplanation:
      "When required Guardian or model verification is unavailable, TrueMandate fails closed "
      + "rather than bypassing safety requirements.",
  },

  /** Acceptance status. Stated exactly, never softened. */
  acceptance: {
    fullAcceptanceAchieved: false,
    statement:
      "Benchmark V2 full acceptance was not achieved. Qualification evidence is presented exactly as observed.",
  },

  methodologyPath: "docs/BENCHMARK.md",
  methodologyUrl: "https://github.com/Snehal707/TrueMandate/blob/main/docs/BENCHMARK.md",
} as const;
