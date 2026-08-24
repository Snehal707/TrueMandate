import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BenchmarkV2AcceptedRunSchema, BenchmarkV2ManifestSchema, BenchmarkV2SummarySchema } from "../../packages/safe-benchmark/dist/index.js";
import { benchmarkV2InputHash } from "../benchmark/v2-input-hash.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const accepted = BenchmarkV2AcceptedRunSchema.parse(JSON.parse(readFileSync(resolve(root, "evals/benchmark/v2/accepted-run.json"), "utf8")));
const runDir = resolve(root, "evals/benchmark/v2/runs", accepted.runId);
const manifestText = readFileSync(resolve(runDir, "manifest.json"), "utf8");
const manifestHash = createHash("sha256").update(manifestText).digest("hex");
if (manifestHash !== accepted.manifestSha256) throw new Error("accepted BENCHMARK_V2 manifest hash mismatch");
const manifest = BenchmarkV2ManifestSchema.parse(JSON.parse(manifestText));
const summary = BenchmarkV2SummarySchema.parse(JSON.parse(readFileSync(resolve(runDir, "summary.json"), "utf8")));
const currentInputHash = benchmarkV2InputHash(root);
if (accepted.sourceInputHash !== currentInputHash || manifest.metadata.sourceInputHash !== currentInputHash) throw new Error("accepted BENCHMARK_V2 run is stale for current benchmark/runtime inputs");
if (accepted.commitSha !== manifest.metadata.commitSha || summary.metadata.commitSha !== accepted.commitSha) throw new Error("BENCHMARK_V2 source commit binding mismatch");

const model = {
  available: true,
  benchmarkVersion: "BENCHMARK_V2",
  runId: summary.metadata.runId,
  createdAt: summary.metadata.createdAt,
  environment: summary.metadata.environment,
  commitSha: summary.metadata.commitSha,
  sourceInputHash: summary.metadata.sourceInputHash,
  totalScenarios: summary.totalScenarios,
  passedScenarios: summary.passedScenarios,
  successRate: summary.successRate,
  authorizationCorrectnessRate: summary.authorizationCorrectnessRate,
  unauthorizedExecutionRejectionRate: summary.unauthorizedExecutionRejectionRate,
  provenanceCompletenessRate: summary.provenanceCompletenessRate,
  replayProtectionRate: summary.replayProtectionRate,
  latencyMs: summary.latencyMs,
  peakThroughputPerSecond: summary.peakThroughputPerSecond,
  configuredCeilingReached: summary.configuredCeilingReached,
  firstBottleneck: summary.firstBottleneck,
  domains: summary.domains,
  load: summary.load,
};
writeFileSync(resolve(root, "apps/web/src/demo/current-benchmark-readmodel.ts"), `/** Generated from accepted BENCHMARK_V2 artifact ${accepted.runId}. */\nexport const CURRENT_BENCHMARK_READ_MODEL = ${JSON.stringify(model, null, 2)} as const;\n`);
console.log(JSON.stringify({ runId: accepted.runId, sourceInputHash: currentInputHash }));
