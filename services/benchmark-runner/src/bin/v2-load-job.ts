import {
  BENCHMARK_V2,
  BENCHMARK_V2_DOMAINS,
  benchmarkV2ConfigurationHash,
  BenchmarkV2ConfigurationSchema,
  BenchmarkV2RunMetadataSchema,
  BenchmarkV2ScenarioResultSchema,
} from "@truemandate/safe-benchmark";
import { runPublicReadLoadLevel, runWorkflowLoadLevel, type BenchmarkV2ReadTarget } from "../v2-runner.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonEnv(name: string): Record<string, string> {
  const parsed = JSON.parse(required(name)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`);
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function emit(recordType: string, payload: unknown): void {
  console.log(JSON.stringify({ benchmark: BENCHMARK_V2, recordType, payload }));
}

async function main(): Promise<void> {
  const runId = required("TM_BENCHMARK_RUN_ID");
  const sourceCommit = required("TM_SOURCE_COMMIT");
  if (sourceCommit !== required("TM_BENCHMARK_COMMIT_SHA")) throw new Error("benchmark image/source commit mismatch");
  const levels = (process.env.TM_BENCHMARK_CONCURRENCY_LEVELS ?? "1,2,4,8,16,32")
    .split(",").map(Number);
  const workflowsPerLevel = Number(process.env.TM_BENCHMARK_WORKFLOWS_PER_LEVEL ?? "50");
  const domainFilter = process.env.TM_BENCHMARK_DOMAIN_FILTER?.trim();
  const domains = domainFilter
    ? domainFilter.split(",").map((value) => value.trim())
    : undefined;
  const readLevels = (process.env.TM_BENCHMARK_READ_CONCURRENCY_LEVELS ?? "1,10,25,50").split(",").map(Number);
  const readsPerLevel = Number(process.env.TM_BENCHMARK_READS_PER_LEVEL ?? "200");
  if (levels.some((value) => !Number.isInteger(value) || value < 1)) throw new Error("invalid concurrency levels");
  if (domains?.some((value) => !BENCHMARK_V2_DOMAINS.includes(value as never))) throw new Error("invalid benchmark domain filter");
  if (!Number.isInteger(workflowsPerLevel) || workflowsPerLevel < (domains?.length ?? BENCHMARK_V2_DOMAINS.length)) throw new Error("invalid workflows per level");
  if (readLevels.some((value) => !Number.isInteger(value) || value < 1) || !Number.isInteger(readsPerLevel) || readsPerLevel < 1) throw new Error("invalid read load configuration");
  const configuration = BenchmarkV2ConfigurationSchema.parse({
    workflowConcurrencyLevels: levels,
    workflowsPerLevel,
    readConcurrencyLevels: readLevels,
    readsPerLevel,
    stopThresholds: { errorRate: 0.01, latencyMultiplier: 2, absoluteLatencyMs: 270000, cpuUtilization: 0.85, memoryUtilization: 0.85 },
  });
  const configurationHash = benchmarkV2ConfigurationHash(configuration);
  if (configurationHash !== required("TM_BENCHMARK_CONFIG_HASH")) throw new Error("benchmark configuration hash mismatch");
  const metadata = BenchmarkV2RunMetadataSchema.parse({
    benchmarkVersion: BENCHMARK_V2,
    runId,
    createdAt: required("TM_BENCHMARK_CREATED_AT"),
    environment: required("TM_BENCHMARK_ENVIRONMENT"),
    commitSha: sourceCommit,
    sourceInputHash: required("TM_BENCHMARK_SOURCE_INPUT_HASH"),
    corpusHash: required("TM_BENCHMARK_CORPUS_HASH"),
    configurationHash,
    jobExecutionId: process.env.CLOUD_RUN_EXECUTION ?? required("TM_BENCHMARK_JOB_EXECUTION_ID"),
    serviceRevisions: jsonEnv("TM_BENCHMARK_SERVICE_REVISIONS"),
    serviceDigests: jsonEnv("TM_BENCHMARK_SERVICE_DIGESTS"),
  });
  emit("RUN_STARTED", { metadata, levels, workflowsPerLevel, readLevels, readsPerLevel });

  let baselineP95: number | undefined;
  const readTargets: BenchmarkV2ReadTarget[] = [];
  for (const [index, concurrency] of levels.entries()) {
    const run = await runWorkflowLoadLevel({
      baseUrl: required("TM_BENCHMARK_PUBLIC_URL"),
      concurrencyLevels: levels,
      workflowsPerLevel,
      timeoutMs: 310_000,
      readinessPollMs: 3_000,
      readinessAttempts: 60,
      ...(domains ? { domains: domains as typeof BENCHMARK_V2_DOMAINS } : {}),
      diagnostic: (payload) => emit("PHASE_DIAGNOSTIC", payload),
    }, concurrency, index + 1);
    for (const result of run.results) emit("SCENARIO_RESULT", BenchmarkV2ScenarioResultSchema.parse(result));
    readTargets.push(...run.readTargets);
    if (baselineP95 === undefined) baselineP95 = run.sample.latencyMs.p95;
    const latencyDegraded = run.sample.latencyMs.p95 > baselineP95 * 2;
    const sample = latencyDegraded && !run.sample.stopped
      ? { ...run.sample, stopped: true, stopReason: "P95_ABOVE_2X_BASELINE" }
      : run.sample;
    emit("LOAD_SAMPLE", sample);
    if (sample.stopped) {
      emit("RUN_STOPPED", { level: sample.level, reason: sample.stopReason });
      return;
    }
  }
  if (process.env.TM_BENCHMARK_WORKFLOW_ONLY === "true") {
    emit("RUN_COMPLETED", { configuredWorkflowCeilingReached: true, readLoadSkipped: true });
    return;
  }
  for (const [index, concurrency] of readLevels.entries()) {
    const sample = await runPublicReadLoadLevel({ baseUrl: required("TM_BENCHMARK_PUBLIC_URL"), timeoutMs: 310_000 }, readTargets, concurrency, readsPerLevel, index + 1);
    emit("LOAD_SAMPLE", sample);
    if (sample.stopped) {
      emit("RUN_STOPPED", { level: sample.level, lane: sample.lane, reason: sample.stopReason });
      return;
    }
  }
  emit("RUN_COMPLETED", { configuredCeilingReached: true });
}

main().catch((error) => {
  console.error(JSON.stringify({ benchmark: BENCHMARK_V2, recordType: "RUN_FAILED", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
