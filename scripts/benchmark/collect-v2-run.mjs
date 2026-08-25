import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  BENCHMARK_V2_DOMAINS,
  BenchmarkV2AcceptedRunSchema,
  benchmarkV2ConfigurationHash,
  benchmarkV2CorpusHash,
  BenchmarkV2LoadSampleSchema,
  BenchmarkV2ManifestSchema,
  BenchmarkV2ResourceSampleSchema,
  BenchmarkV2RunMetadataSchema,
  BenchmarkV2ScenarioResultSchema,
  BenchmarkV2SummarySchema,
  latencyPercentiles,
} from "../../packages/safe-benchmark/dist/index.js";
import { benchmarkV2InputHash } from "./v2-input-hash.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const index = entry.indexOf("=");
  return index < 0 ? [entry.replace(/^--/, ""), "true"] : [entry.slice(2, index), entry.slice(index + 1)];
}));
const required = (name) => {
  const value = args[name];
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const lines = (path) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const recordsPath = resolve(required("records"));
const resourcePath = resolve(required("resources"));
const outRoot = resolve(args.out ?? "evals/benchmark/v2/runs");
const records = [...lines(recordsPath), ...(args["local-records"] ? lines(resolve(args["local-records"])) : [])];
const started = records.find((record) => record.recordType === "RUN_STARTED")?.payload;
if (!started) throw new Error("RUN_STARTED record missing");
const metadata = BenchmarkV2RunMetadataSchema.parse(started.metadata);
const expectedInputHash = benchmarkV2InputHash();
if (metadata.sourceInputHash !== expectedInputHash) throw new Error("source input hash does not match current benchmark/runtime inputs");
if (metadata.corpusHash !== benchmarkV2CorpusHash()) throw new Error("benchmark corpus hash mismatch");
const configuration = { workflowConcurrencyLevels: started.levels, workflowsPerLevel: started.workflowsPerLevel, readConcurrencyLevels: started.readLevels, readsPerLevel: started.readsPerLevel, stopThresholds: { errorRate: 0.01, latencyMultiplier: 2, absoluteLatencyMs: 270000, cpuUtilization: 0.85, memoryUtilization: 0.85 } };
if (metadata.configurationHash !== benchmarkV2ConfigurationHash(configuration)) throw new Error("benchmark configuration hash mismatch");
const scenarioResults = records.filter((record) => record.recordType === "SCENARIO_RESULT").map((record) => BenchmarkV2ScenarioResultSchema.parse(record.payload));
const load = records.filter((record) => record.recordType === "LOAD_SAMPLE").map((record) => BenchmarkV2LoadSampleSchema.parse(record.payload));
const resources = lines(resourcePath).map((record) => BenchmarkV2ResourceSampleSchema.parse(record));
if (scenarioResults.length === 0 || load.length === 0 || resources.length === 0) throw new Error("benchmark records are incomplete");
if (!load.some((sample) => sample.lane === "WORKFLOW_WRITE") || !load.some((sample) => sample.lane === "PUBLIC_READ")) throw new Error("both workflow-write and public-read load lanes are required");
const correctness = scenarioResults.filter((result) => result.lane === "CORRECTNESS");
const workflowResults = scenarioResults.filter((result) => result.lane === "WORKFLOW_LOAD");
const variants = ["CURRENT_SYSTEM", "BASELINE_SINGLE_AGENT"];
const classes = ["HAPPY_PATH", "ACTION_MISMATCH", "STALE_STATE", "REPLAY", "EXPIRED_AUTHORIZATION", "MALFORMED_REQUEST", "UNAUTHORIZED_CALLER", "PARTIAL_FAILURE", "CONCURRENT_RACE", "MULTI_STEP"];
for (const domain of BENCHMARK_V2_DOMAINS) for (const systemVariant of variants) {
  if (!correctness.some((result) => result.domainId === domain && result.systemVariant === systemVariant)) throw new Error(`missing ${systemVariant} DomainPack coverage: ${domain}`);
}
for (const scenarioClass of classes) for (const systemVariant of variants) {
  if (!correctness.some((result) => result.scenarioClass === scenarioClass && result.systemVariant === systemVariant)) throw new Error(`missing ${systemVariant} BENCHMARK_V2 scenario class: ${scenarioClass}`);
}
const pairs = new Map();
for (const result of correctness) pairs.set(result.pairId, [...(pairs.get(result.pairId) ?? []), result]);
if (pairs.size !== BENCHMARK_V2_DOMAINS.length * classes.length) throw new Error(`expected 50 paired correctness scenarios, received ${pairs.size}`);
for (const [pairId, rows] of pairs) {
  if (rows.length !== 2 || !variants.every((variant) => rows.some((row) => row.systemVariant === variant))) throw new Error(`incomplete system pair: ${pairId}`);
  if (new Set(rows.map((row) => row.scenarioInputHash)).size !== 1 || new Set(rows.map((row) => row.domainId)).size !== 1 || new Set(rows.map((row) => row.scenarioClass)).size !== 1) throw new Error(`divergent paired scenario binding: ${pairId}`);
}
const current = correctness.filter((result) => result.systemVariant === "CURRENT_SYSTEM");
const baseline = correctness.filter((result) => result.systemVariant === "BASELINE_SINGLE_AGENT");
const unsafeCurrent = [...current, ...workflowResults].filter((result) => result.status === "FAIL" || result.unauthorizedExecution || result.criticalFailure || result.duplicateSideEffect);
if (unsafeCurrent.length > 0) throw new Error(`current-system benchmark contains ${unsafeCurrent.length} failing or unsafe result(s)`);
const expectedWorkflowLevels = started.levels;
const expectedReadLevels = started.readLevels;
if (!expectedWorkflowLevels.every((concurrency) => load.some((sample) => sample.lane === "WORKFLOW_WRITE" && sample.concurrency === concurrency))) throw new Error("workflow load lane is incomplete");
if (!expectedReadLevels.every((concurrency) => load.some((sample) => sample.lane === "PUBLIC_READ" && sample.concurrency === concurrency))) throw new Error("public read load lane is incomplete");
if (!records.some((record) => record.recordType === "RUN_COMPLETED") || load.some((sample) => sample.stopped || sample.failedRequests > 0)) throw new Error("configured load ceiling did not complete safely");
for (const service of new Set(resources.map((sample) => sample.service))) {
  const ordered = resources.filter((sample) => sample.service === service).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if ((previous.cpuUtilization ?? 0) > 0.85 && (current.cpuUtilization ?? 0) > 0.85) throw new Error(`sustained CPU saturation: ${service}`);
    if ((previous.memoryUtilization ?? 0) > 0.85 && (current.memoryUtilization ?? 0) > 0.85) throw new Error(`sustained memory saturation: ${service}`);
  }
}

const passed = current.filter((result) => result.status !== "FAIL").length;
const authorizationRelevant = current.filter((result) => result.authorizationCorrect !== undefined);
const replayRelevant = current.filter((result) => result.replayProtected !== undefined);
const provenanceRelevant = current.filter((result) => result.provenanceComplete !== undefined);
if (authorizationRelevant.length === 0 || replayRelevant.length === 0 || provenanceRelevant.length === 0) throw new Error("authorization, replay, and provenance evidence are required");
const summarizeVariant = (systemVariant) => {
  const rows = correctness.filter((result) => result.systemVariant === systemVariant);
  return { systemVariant, total: rows.length, passed: rows.filter((result) => result.status !== "FAIL").length, failed: rows.filter((result) => result.status === "FAIL").length, expectedRejections: rows.filter((result) => result.status === "EXPECTED_REJECTION").length, criticalFailures: rows.filter((result) => result.criticalFailure).length, unauthorizedExecutions: rows.filter((result) => result.unauthorizedExecution).length, duplicateSideEffects: rows.filter((result) => result.duplicateSideEffect).length, latencyMs: latencyPercentiles(rows.map((result) => result.latencyMs)) };
};
const bottlenecks = [
  ...load.filter((sample) => sample.stopped).map((sample) => ({
    observedAt: sample.completedAt,
    service: sample.lane === "WORKFLOW_WRITE" ? "public-workflow-path" : "public-read-path",
    threshold: sample.stopReason ?? "LOAD_THRESHOLD",
    observedValue: sample.stopReason === "ERROR_RATE_ABOVE_1_PERCENT" ? sample.errorRate : sample.latencyMs.p95,
  })),
  ...resources.flatMap((sample) => [
    ...(sample.cpuUtilization !== undefined && sample.cpuUtilization > 0.85 ? [{ observedAt: sample.observedAt, service: sample.service, threshold: "CPU_ABOVE_85_PERCENT", observedValue: sample.cpuUtilization }] : []),
    ...(sample.memoryUtilization !== undefined && sample.memoryUtilization > 0.85 ? [{ observedAt: sample.observedAt, service: sample.service, threshold: "MEMORY_ABOVE_85_PERCENT", observedValue: sample.memoryUtilization }] : []),
  ]),
].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
const summary = BenchmarkV2SummarySchema.parse({
  metadata,
  totalScenarios: current.length,
  passedScenarios: passed,
  failedScenarios: current.length - passed,
  successRate: passed / current.length,
  authorizationCorrectnessRate: authorizationRelevant.length === 0 ? 0 : authorizationRelevant.filter((result) => result.authorizationCorrect).length / authorizationRelevant.length,
  unauthorizedExecutionRejectionRate: authorizationRelevant.length === 0 ? 0 : authorizationRelevant.filter((result) => !result.unauthorizedExecution).length / authorizationRelevant.length,
  provenanceCompletenessRate: provenanceRelevant.length === 0 ? 0 : provenanceRelevant.filter((result) => result.provenanceComplete).length / provenanceRelevant.length,
  errorRate: current.filter((result) => result.status === "FAIL").length / current.length,
  replayProtectionRate: replayRelevant.length === 0 ? 0 : replayRelevant.filter((result) => result.replayProtected).length / replayRelevant.length,
  latencyMs: latencyPercentiles(current.map((result) => result.latencyMs)),
  peakThroughputPerSecond: Math.max(...load.map((sample) => sample.throughputPerSecond)),
  variants: variants.map(summarizeVariant),
  domains: variants.flatMap((systemVariant) => BENCHMARK_V2_DOMAINS.map((domainId) => {
    const rows = correctness.filter((result) => result.domainId === domainId && result.systemVariant === systemVariant);
    return { systemVariant, domainId, total: rows.length, passed: rows.filter((result) => result.status !== "FAIL").length, failed: rows.filter((result) => result.status === "FAIL").length, authorizationCorrect: rows.filter((result) => result.authorizationCorrect === true).length, unauthorizedExecutions: rows.filter((result) => result.unauthorizedExecution).length, provenanceComplete: rows.filter((result) => result.provenanceComplete === true).length };
  })),
  scenarioClasses: variants.flatMap((systemVariant) => classes.map((scenarioClass) => {
    const rows = correctness.filter((result) => result.scenarioClass === scenarioClass && result.systemVariant === systemVariant);
    return { systemVariant, scenarioClass, total: rows.length, passed: rows.filter((result) => result.status !== "FAIL").length, failed: rows.filter((result) => result.status === "FAIL").length, expectedRejections: rows.filter((result) => result.status === "EXPECTED_REJECTION").length, criticalFailures: rows.filter((result) => result.criticalFailure).length, unauthorizedExecutions: rows.filter((result) => result.unauthorizedExecution).length, latencyMs: latencyPercentiles(rows.map((result) => result.latencyMs)) };
  })),
  load,
  resources,
  firstBottleneck: bottlenecks[0] ?? null,
  configuredCeilingReached: true,
});
const runDir = join(outRoot, metadata.runId);
mkdirSync(runDir, { recursive: true });
const scenarioText = scenarioResults.map((record) => JSON.stringify(record)).join("\n") + "\n";
const loadText = load.map((record) => JSON.stringify(record)).join("\n") + "\n";
const resourceText = resources.map((record) => JSON.stringify(record)).join("\n") + "\n";
const summaryText = JSON.stringify(summary, null, 2) + "\n";
const outputs = { "scenario-results.jsonl": scenarioText, "load-results.jsonl": loadText, "resource-metrics.jsonl": resourceText, "summary.json": summaryText };
for (const [name, content] of Object.entries(outputs)) writeFileSync(join(runDir, name), content);
const manifest = BenchmarkV2ManifestSchema.parse({
  metadata,
  configuration,
  scenarioCount: scenarioResults.length,
  requestCount: load.reduce((sum, sample) => sum + sample.requestCount, 0),
  files: Object.fromEntries(Object.entries(outputs).map(([name, content]) => [name, { sha256: sha256(content), records: name.endsWith(".jsonl") ? content.trim().split(/\r?\n/).length : 1 }])),
});
const manifestText = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(join(runDir, "manifest.json"), manifestText);

if (args.accept === "true") {
  if (summary.failedScenarios !== 0 || current.some((result) => result.unauthorizedExecution || result.criticalFailure || result.duplicateSideEffect)) throw new Error("failing or unsafe current-system run cannot be accepted");
  const accepted = BenchmarkV2AcceptedRunSchema.parse({ benchmarkVersion: "BENCHMARK_V2", runId: metadata.runId, manifestSha256: sha256(manifestText), sourceInputHash: metadata.sourceInputHash, corpusHash: metadata.corpusHash, configurationHash: metadata.configurationHash, commitSha: metadata.commitSha, acceptedAt: new Date().toISOString() });
  const acceptedPath = resolve("evals/benchmark/v2/accepted-run.json");
  mkdirSync(resolve("evals/benchmark/v2"), { recursive: true });
  writeFileSync(acceptedPath, JSON.stringify(accepted, null, 2) + "\n");
}
console.log(JSON.stringify({ runId: metadata.runId, runDir, inputHash: expectedInputHash, scenarios: scenarioResults.length, source: basename(recordsPath) }));
