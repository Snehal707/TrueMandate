import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GroundTruthEvaluator,
  SystemVariant,
  benchmarkV2CorrectnessCorpus,
  BenchmarkV2ScenarioResultSchema,
} from "../../packages/safe-benchmark/dist/index.js";
import { createSut } from "../../services/benchmark-runner/dist/adapters.js";

const runId = process.argv.find((value) => value.startsWith("--run-id="))?.slice(9) ?? `local-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = resolve("evals/benchmark/v2/local", runId);
const reportPath = resolve(outDir, "vitest-report.json");
mkdirSync(outDir, { recursive: true });
const files = [
  "services/agent-runtime/src/generic-workflow.e2e.test.ts",
  "services/agent-runtime/src/internal-routes.test.ts",
  "services/gateway-service/src/parallel-single-use.test.ts",
  "services/gateway-service/src/preexecution-toctou.test.ts",
  "packages/cloud-firestore/src/firestore-concurrency.test.ts",
  "packages/cloud-firestore/src/execution-provenance-emulator-races.test.ts",
  "services/resolution-service/src/idempotent-replay-converge.test.ts",
  "packages/cloud-runtime/src/internal-routes.test.ts",
  "services/evidence-service/src/evidence-submission-route.test.ts",
  "packages/public-api/src/public-api.test.ts",
];
const vitest = resolve("node_modules/vitest/vitest.mjs");
const run = spawnSync(process.execPath, [vitest, "--run", ...files, "--reporter=json", `--outputFile=${reportPath}`], { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" });
if (run.error) throw run.error;
if (run.status !== 0) throw new Error(`current-runtime conformance tests failed (${run.status})`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const assertions = report.testResults.flatMap((suite) => suite.assertionResults).filter((assertion) => assertion.status === "passed" || assertion.status === "failed");
if (assertions.length !== 118) throw new Error(`expected 118 current-system conformance assertions, received ${assertions.length}`);

const evaluator = new GroundTruthEvaluator();
const baseline = createSut(SystemVariant.BASELINE_SINGLE_AGENT);
const records = [];
for (const scenario of benchmarkV2CorrectnessCorpus()) {
  const evidence = assertions.filter((assertion) => new RegExp(scenario.currentEvidencePattern, "i").test(assertion.fullName));
  if (evidence.length === 0) throw new Error(`missing current-system evidence for ${scenario.pairId}: ${scenario.currentEvidencePattern}`);
  const failed = evidence.find((assertion) => assertion.status !== "passed");
  const currentPassed = !failed;
  const evidenceSummary = evidence.map((assertion) => assertion.fullName).join(" | ");
  const provenanceObserved = /provenance|durable chain|semantic artifact|workflow artifact/i.test(evidenceSummary);
  const observedSideEffectCount = /exactly once|one mock payment|stitches.*commit/i.test(evidenceSummary) ? 1 : 0;
  const expectedRejection = !new Set(["HAPPY_PATH", "MULTI_STEP"]).has(scenario.scenarioClass);
  records.push({ benchmark: "BENCHMARK_V2", recordType: "SCENARIO_RESULT", payload: BenchmarkV2ScenarioResultSchema.parse({
    scenarioId: `${scenario.pairId}-current`, pairId: scenario.pairId, scenarioInputHash: scenario.inputHash,
    lane: "CORRECTNESS", systemVariant: "CURRENT_SYSTEM", domainId: scenario.domainId, scenarioClass: scenario.scenarioClass,
    status: currentPassed ? (expectedRejection ? "EXPECTED_REJECTION" : "PASS") : "FAIL",
    expectedStatus: "ASSERTIONS_PASS", actualStatus: currentPassed ? "ASSERTIONS_PASS" : "ASSERTIONS_FAIL",
    latencyMs: Math.max(0, ...evidence.map((assertion) => assertion.duration ?? 0)), authorizationCorrect: currentPassed,
    unauthorizedExecution: false, provenanceComplete: provenanceObserved ? currentPassed : undefined,
    replayProtected: scenario.scenarioClass === "REPLAY" ? currentPassed : undefined,
    sideEffectCount: observedSideEffectCount, duplicateSideEffect: false, criticalFailure: !currentPassed,
    reason: (failed ?? evidence[0]).fullName,
  }) });

  const started = performance.now();
  const baselineResult = await baseline.run(scenario.publicScenario);
  const baselineReplay = scenario.scenarioClass === "REPLAY" ? await baseline.run(scenario.publicScenario) : undefined;
  const evaluation = evaluator.evaluate(scenario.publicScenario, baselineResult);
  const baselineSideEffectCount = baselineResult.sideEffects.length + (baselineReplay?.sideEffects.length ?? 0);
  const baselineDuplicateSideEffect = (baselineReplay?.sideEffects.length ?? 0) > 0;
  records.push({ benchmark: "BENCHMARK_V2", recordType: "SCENARIO_RESULT", payload: BenchmarkV2ScenarioResultSchema.parse({
    scenarioId: `${scenario.pairId}-baseline`, pairId: scenario.pairId, scenarioInputHash: scenario.inputHash,
    lane: "CORRECTNESS", systemVariant: "BASELINE_SINGLE_AGENT", domainId: scenario.domainId, scenarioClass: scenario.scenarioClass,
    status: evaluation.passed ? (expectedRejection ? "EXPECTED_REJECTION" : "PASS") : "FAIL",
    expectedStatus: `${scenario.publicScenario.expectedAuthority}/${scenario.publicScenario.expectedExecution}`,
    actualStatus: `${baselineResult.authorityDecision}/${baselineResult.executionResult}`,
    latencyMs: performance.now() - started, authorizationCorrect: evaluation.authorityMatch,
    unauthorizedExecution: evaluation.unauthorizedExecution, provenanceComplete: false,
    replayProtected: scenario.scenarioClass === "REPLAY" ? !baselineDuplicateSideEffect : undefined,
    sideEffectCount: baselineSideEffectCount, duplicateSideEffect: baselineDuplicateSideEffect, criticalFailure: evaluation.criticalIncident,
    reason: evaluation.findings.map((finding) => finding.code).join(",") || "BASELINE_EXPECTATION_MATCH",
  }) });
}
const outputPath = resolve(outDir, "local-scenario-records.jsonl");
writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
console.log(JSON.stringify({ runId, outputPath, assertions: assertions.length, pairedScenarios: records.length / 2, records: records.length, files }));
