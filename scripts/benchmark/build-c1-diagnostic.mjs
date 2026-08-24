import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runDirectory = process.argv[2];
if (!runDirectory) throw new Error("usage: node build-c1-diagnostic.mjs <failed-run-directory>");

const lines = readFileSync(join(runDirectory, "cloud-job-records.jsonl"), "utf8")
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const modelCalls = JSON.parse(readFileSync(join(runDirectory, "modelCalls.json"), "utf8"));
const stageEvents = JSON.parse(readFileSync(join(runDirectory, "workflowStageEvents.json"), "utf8"));
const started = lines.find((record) => record.recordType === "RUN_STARTED")?.payload;
const loadSample = lines.find((record) => record.recordType === "LOAD_SAMPLE")?.payload;
const scenarios = lines.filter((record) => record.recordType === "SCENARIO_RESULT").map((record) => record.payload);
if (!started || !loadSample || scenarios.length !== 50) throw new Error("failed C1 evidence is incomplete");

const runStamp = new Date(loadSample.startedAt).toISOString().replace(/\D/g, "");
const category = (call) => {
  if (call.schemaId === "compiler.candidate.v1") return "compilation";
  if (call.schemaId === "verifier.result.v1") return "semanticVerification";
  if (call.schemaId === "planner.plan.v1") return "planning";
  if (call.schemaId === "plan-verifier.result.v1") return "planVerification";
  if (String(call.schemaId).startsWith("judge.")) return "guardian";
  if (/authority/i.test(String(call.schemaId))) return "authority";
  return "other";
};
const percentileScenario = (percentile) => {
  const target = loadSample.latencyMs[percentile];
  return scenarios.reduce((best, item) =>
    Math.abs(item.latencyMs - target) < Math.abs(best.latencyMs - target) ? item : best,
  );
};

const rows = scenarios.map((scenario) => {
  const match = /^load-1-(\d+)-(.+)$/.exec(scenario.scenarioId);
  if (!match) throw new Error(`unexpected scenario id ${scenario.scenarioId}`);
  const index = Number(match[1]);
  const intentId = `intent-benchmark-v2-${scenario.domainId}-${10_000 + index}-${runStamp}`;
  const workflowId = scenario.workflowId ?? stageEvents.find((event) => event.intentId === intentId && event.stage === "GUARDIAN")?.workflowId;
  const calls = modelCalls.filter((call) =>
    String(call.requestId).includes(intentId) ||
    (workflowId && String(call.requestId).includes(workflowId)),
  ).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const stages = stageEvents.filter((event) => event.intentId === intentId || (workflowId && event.workflowId === workflowId));
  const groups = Object.groupBy(calls, category);
  const sum = (name) => (groups[name] ?? []).reduce((total, call) => total + call.latencyMs, 0);
  const guardianCalls = groups.guardian ?? [];
  const guardianWall = stages.find((event) => event.stage === "GUARDIAN" && event.status === "COMPLETED")?.durationMs
    ?? Math.max(0, ...guardianCalls.map((call) => call.latencyMs));
  const measuredCriticalPathMs =
    sum("compilation") + sum("semanticVerification") + sum("planning") +
    sum("planVerification") + guardianWall + sum("authority");
  return {
    rank: 0,
    scenarioId: scenario.scenarioId,
    domainId: scenario.domainId,
    intentId,
    workflowId: workflowId ?? null,
    status: scenario.status,
    actualStatus: scenario.actualStatus,
    totalLatencyMs: scenario.latencyMs,
    rawSubmissionMs: null,
    workspacePollingMs: null,
    stateBoundSubmissionMs: null,
    responseSerializationMs: null,
    modelCallCount: calls.length,
    modelRetryCount: calls.reduce((total, call) => total + (call.retryCount ?? 0), 0),
    modelLatencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
    compilationModelMs: sum("compilation"),
    semanticVerificationModelMs: sum("semanticVerification"),
    planningModelMs: sum("planning"),
    planVerificationModelMs: sum("planVerification"),
    guardianWallMs: guardianWall,
    guardianJudges: guardianCalls.map((call) => ({
      requestId: call.requestId,
      schemaId: call.schemaId,
      latencyMs: call.latencyMs,
      retryCount: call.retryCount ?? 0,
      status: call.status,
    })),
    authorityModelMs: sum("authority"),
    measuredCriticalPathMs,
    residualUnattributedMs: Math.max(0, scenario.latencyMs - measuredCriticalPathMs),
    toolCalls: null,
    databaseCalls: null,
    networkCalls: null,
    note: "Historical runner did not emit phase/tool/database spans; null fields are intentionally not inferred.",
  };
}).sort((a, b) => b.totalLatencyMs - a.totalLatencyMs);
rows.forEach((row, index) => { row.rank = index + 1; });

const output = {
  reportVersion: "BENCHMARK_V2_C1_DIAGNOSTIC_V1",
  generatedAt: new Date().toISOString(),
  immutableSource: {
    runId: started.metadata.runId,
    commitSha: started.metadata.commitSha,
    sourceInputHash: started.metadata.sourceInputHash,
    jobExecutionId: started.metadata.jobExecutionId,
    originalStopReason: loadSample.stopReason,
    originalArtifactFilesModified: false,
  },
  summary: {
    requests: loadSample.requestCount,
    successful: loadSample.successfulRequests,
    failed: loadSample.failedRequests,
    errorRate: loadSample.errorRate,
    p50Ms: loadSample.latencyMs.p50,
    p95Ms: loadSample.latencyMs.p95,
    p99Ms: loadSample.latencyMs.p99,
    p50Scenario: percentileScenario("p50").scenarioId,
    p95Scenario: percentileScenario("p95").scenarioId,
    p99Scenario: percentileScenario("p99").scenarioId,
    timeoutOwner: "public-bff deadline expired first; agent-runtime work exceeded the shared 300-second deadline",
  },
  workflows: rows,
};

writeFileSync(join(runDirectory, "c1-diagnostic-report.json"), `${JSON.stringify(output, null, 2)}\n`);
const markdown = [
  "# Benchmark V2 Failed C1 Diagnostic",
  "",
  `- Run: \`${started.metadata.runId}\``,
  `- Commit: \`${started.metadata.commitSha}\``,
  `- Corpus hash: \`${started.metadata.sourceInputHash}\``,
  `- Original result: ${loadSample.successfulRequests}/${loadSample.requestCount}, ${(loadSample.errorRate * 100).toFixed(2)}% errors, stop \`${loadSample.stopReason}\``,
  `- Percentiles: p50 ${loadSample.latencyMs.p50.toFixed(3)}ms (${percentileScenario("p50").scenarioId}), p95 ${loadSample.latencyMs.p95.toFixed(3)}ms (${percentileScenario("p95").scenarioId}), p99 ${loadSample.latencyMs.p99.toFixed(3)}ms (${percentileScenario("p99").scenarioId})`,
  "- Historical limitation: RAW/poll/finalized, tool, Firestore, and network spans were not emitted; residual time is reported but not guessed.",
  "",
  "| Rank | Scenario | Result | Total ms | Calls | Retries | Compile | Verify | Plan | Plan verify | Guardian wall | Residual |",
  "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map((row) => `| ${row.rank} | ${row.scenarioId} | ${row.status}/${row.actualStatus} | ${row.totalLatencyMs.toFixed(3)} | ${row.modelCallCount} | ${row.modelRetryCount} | ${row.compilationModelMs} | ${row.semanticVerificationModelMs} | ${row.planningModelMs} | ${row.planVerificationModelMs} | ${row.guardianWallMs} | ${row.residualUnattributedMs.toFixed(3)} |`),
  "",
  "The JSON companion contains every judge request ID, status, retry count, and latency.",
].join("\n");
writeFileSync(join(runDirectory, "c1-diagnostic-report.md"), `${markdown}\n`);
console.log(JSON.stringify({ json: join(runDirectory, "c1-diagnostic-report.json"), markdown: join(runDirectory, "c1-diagnostic-report.md"), workflows: rows.length }));
