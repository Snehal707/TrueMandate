import { z } from "zod";

export const BENCHMARK_V2 = "BENCHMARK_V2" as const;

export const BenchmarkV2DomainSchema = z.enum([
  "procurement",
  "travel",
  "saas_it_spend",
  "invoice_vendor_payment",
  "logistics_fulfillment",
]);
export type BenchmarkV2Domain = z.infer<typeof BenchmarkV2DomainSchema>;

export const BenchmarkV2ScenarioClassSchema = z.enum([
  "HAPPY_PATH",
  "ACTION_MISMATCH",
  "STALE_STATE",
  "REPLAY",
  "EXPIRED_AUTHORIZATION",
  "MALFORMED_REQUEST",
  "UNAUTHORIZED_CALLER",
  "PARTIAL_FAILURE",
  "CONCURRENT_RACE",
  "MULTI_STEP",
]);
export type BenchmarkV2ScenarioClass = z.infer<typeof BenchmarkV2ScenarioClassSchema>;

export const BenchmarkV2StatusSchema = z.enum(["PASS", "FAIL", "EXPECTED_REJECTION"]);

export const BenchmarkV2PercentilesSchema = z.object({
  p50: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
}).strict();

export const BenchmarkV2RunMetadataSchema = z.object({
  benchmarkVersion: z.literal(BENCHMARK_V2),
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  environment: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  sourceInputHash: z.string().regex(/^[0-9a-f]{64}$/),
  jobExecutionId: z.string().min(1),
  serviceRevisions: z.record(z.string().min(1)),
  serviceDigests: z.record(z.string().regex(/^sha256:[0-9a-f]{64}$/)),
}).strict();

export const BenchmarkV2ScenarioResultSchema = z.object({
  scenarioId: z.string().min(1),
  domainId: BenchmarkV2DomainSchema,
  scenarioClass: BenchmarkV2ScenarioClassSchema,
  status: BenchmarkV2StatusSchema,
  expectedStatus: z.string().min(1),
  actualStatus: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  authorizationCorrect: z.boolean().optional(),
  unauthorizedExecution: z.boolean(),
  provenanceComplete: z.boolean().optional(),
  replayProtected: z.boolean().optional(),
  sideEffectCount: z.number().int().nonnegative(),
  workflowId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).strict();
export type BenchmarkV2ScenarioResult = z.infer<typeof BenchmarkV2ScenarioResultSchema>;

export const BenchmarkV2LoadSampleSchema = z.object({
  lane: z.enum(["WORKFLOW_WRITE", "PUBLIC_READ"]),
  level: z.number().int().positive(),
  concurrency: z.number().int().positive(),
  requestCount: z.number().int().positive(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().positive(),
  successfulRequests: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  throughputPerSecond: z.number().nonnegative(),
  latencyMs: BenchmarkV2PercentilesSchema,
  stopped: z.boolean(),
  stopReason: z.string().min(1).optional(),
}).strict();
export type BenchmarkV2LoadSample = z.infer<typeof BenchmarkV2LoadSampleSchema>;

export const BenchmarkV2ResourceSampleSchema = z.object({
  service: z.string().min(1),
  observedAt: z.string().datetime(),
  requestCount: z.number().nonnegative(),
  errorCount: z.number().nonnegative(),
  instanceCount: z.number().nonnegative(),
  cpuUtilization: z.number().min(0).max(1).optional(),
  memoryUtilization: z.number().min(0).max(1).optional(),
  requestLatencyP95Ms: z.number().nonnegative().optional(),
}).strict();

export const BenchmarkV2DomainSummarySchema = z.object({
  domainId: BenchmarkV2DomainSchema,
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  authorizationCorrect: z.number().int().nonnegative(),
  unauthorizedExecutions: z.number().int().nonnegative(),
  provenanceComplete: z.number().int().nonnegative(),
}).strict();

export const BenchmarkV2SummarySchema = z.object({
  metadata: BenchmarkV2RunMetadataSchema,
  totalScenarios: z.number().int().positive(),
  passedScenarios: z.number().int().nonnegative(),
  failedScenarios: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  authorizationCorrectnessRate: z.number().min(0).max(1),
  unauthorizedExecutionRejectionRate: z.number().min(0).max(1),
  provenanceCompletenessRate: z.number().min(0).max(1),
  errorRate: z.number().min(0).max(1),
  replayProtectionRate: z.number().min(0).max(1),
  latencyMs: BenchmarkV2PercentilesSchema,
  peakThroughputPerSecond: z.number().nonnegative(),
  domains: z.array(BenchmarkV2DomainSummarySchema).length(5),
  load: z.array(BenchmarkV2LoadSampleSchema),
  firstBottleneck: z.object({
    observedAt: z.string().datetime(),
    service: z.string().min(1),
    threshold: z.string().min(1),
    observedValue: z.number(),
  }).strict().nullable(),
  configuredCeilingReached: z.boolean(),
}).strict();
export type BenchmarkV2Summary = z.infer<typeof BenchmarkV2SummarySchema>;

export const BenchmarkV2ManifestSchema = z.object({
  metadata: BenchmarkV2RunMetadataSchema,
  configuration: z.object({
    workflowConcurrencyLevels: z.array(z.number().int().positive()).nonempty(),
    workflowsPerLevel: z.number().int().positive(),
    readConcurrencyLevels: z.array(z.number().int().positive()).nonempty(),
    readsPerLevel: z.number().int().positive(),
    stopThresholds: z.object({
      errorRate: z.number().min(0).max(1),
      latencyMultiplier: z.number().positive(),
      absoluteLatencyMs: z.number().positive(),
      cpuUtilization: z.number().min(0).max(1),
      memoryUtilization: z.number().min(0).max(1),
    }).strict(),
  }).strict(),
  scenarioCount: z.number().int().positive(),
  requestCount: z.number().int().nonnegative(),
  files: z.record(z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    records: z.number().int().nonnegative(),
  }).strict()),
}).strict();

export const BenchmarkV2AcceptedRunSchema = z.object({
  benchmarkVersion: z.literal(BENCHMARK_V2),
  runId: z.string().min(1),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceInputHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  acceptedAt: z.string().datetime(),
}).strict();

export const BENCHMARK_V2_DOMAINS = BenchmarkV2DomainSchema.options;

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
}

export function latencyPercentiles(values: readonly number[]): z.infer<typeof BenchmarkV2PercentilesSchema> {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}
