import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { benchmarkV2InputHash } from "../../../scripts/benchmark/v2-input-hash.mjs";
import { BENCHMARK_V2_DOMAINS } from "./v2-contract";
import { benchmarkV2ConfigurationHash } from "./v2-contract";
import { benchmarkV2CorpusHash } from "./v2-corpus";

const classes = ["HAPPY_PATH", "ACTION_MISMATCH", "STALE_STATE", "REPLAY", "EXPIRED_AUTHORIZATION", "MALFORMED_REQUEST", "UNAUTHORIZED_CALLER", "PARTIAL_FAILURE", "CONCURRENT_RACE", "MULTI_STEP"] as const;
const createdAt = "2026-08-24T12:00:00.000Z";

function fixture(resourceRecords = true, sourceInputHash = benchmarkV2InputHash()) {
  const dir = mkdtempSync(join(tmpdir(), "truemandate-benchmark-v2-"));
  const records = join(dir, "records.jsonl");
  const resources = join(dir, "resources.jsonl");
  const out = join(dir, "runs");
  const configuration = { workflowConcurrencyLevels: [1], workflowsPerLevel: 10, readConcurrencyLevels: [1], readsPerLevel: 10, stopThresholds: { errorRate: 0.01, latencyMultiplier: 2, absoluteLatencyMs: 270000, cpuUtilization: 0.85, memoryUtilization: 0.85 } };
  const metadata = {
    benchmarkVersion: "BENCHMARK_V2", runId: "collector-test-run", createdAt, environment: "test",
    commitSha: "a".repeat(40), sourceInputHash, corpusHash: benchmarkV2CorpusHash(), configurationHash: benchmarkV2ConfigurationHash(configuration), jobExecutionId: "job-test",
    serviceRevisions: { web: "web-test" }, serviceDigests: { web: `sha256:${"b".repeat(64)}` },
  };
  const rows = [
    { benchmark: "BENCHMARK_V2", recordType: "RUN_STARTED", payload: { metadata, levels: [1], workflowsPerLevel: 10, readLevels: [1], readsPerLevel: 10 } },
    ...BENCHMARK_V2_DOMAINS.flatMap((domainId) => classes.flatMap((scenarioClass, index) => ["CURRENT_SYSTEM", "BASELINE_SINGLE_AGENT"].map((systemVariant) => ({ benchmark: "BENCHMARK_V2", recordType: "SCENARIO_RESULT", payload: {
      scenarioId: `scenario-${domainId}-${scenarioClass}-${systemVariant}`, pairId: `scenario-${domainId}-${scenarioClass}`, scenarioInputHash: "c".repeat(64), lane: "CORRECTNESS", systemVariant,
      domainId, scenarioClass, status: systemVariant === "BASELINE_SINGLE_AGENT" && scenarioClass === "ACTION_MISMATCH" ? "FAIL" : scenarioClass === "HAPPY_PATH" || scenarioClass === "MULTI_STEP" ? "PASS" : "EXPECTED_REJECTION",
      expectedStatus: "ASSERTIONS_PASS", actualStatus: "ASSERTIONS_PASS", latencyMs: index + 1,
      authorizationCorrect: systemVariant === "CURRENT_SYSTEM", unauthorizedExecution: systemVariant === "BASELINE_SINGLE_AGENT" && scenarioClass === "ACTION_MISMATCH", provenanceComplete: systemVariant === "CURRENT_SYSTEM",
      ...(scenarioClass === "REPLAY" ? { replayProtected: systemVariant === "CURRENT_SYSTEM" } : {}), sideEffectCount: systemVariant === "BASELINE_SINGLE_AGENT" ? 1 : 0, duplicateSideEffect: false, criticalFailure: systemVariant === "BASELINE_SINGLE_AGENT" && scenarioClass === "ACTION_MISMATCH",
    } })))),
    ...["WORKFLOW_WRITE", "PUBLIC_READ"].map((lane) => ({ benchmark: "BENCHMARK_V2", recordType: "LOAD_SAMPLE", payload: {
      lane, level: 1, concurrency: 1, requestCount: 10, startedAt: createdAt, completedAt: "2026-08-24T12:00:01.000Z", durationMs: 1000,
      successfulRequests: 10, failedRequests: 0, errorRate: 0, throughputPerSecond: 10, latencyMs: { p50: 10, p95: 20, p99: 25 }, stopped: false,
    } })),
    { benchmark: "BENCHMARK_V2", recordType: "RUN_COMPLETED", payload: { configuredCeilingReached: true } },
  ];
  writeFileSync(records, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(resources, resourceRecords ? JSON.stringify({ service: "web", observedAt: createdAt, requestCount: 10, errorCount: 0, instanceCount: 1, cpuUtilization: 0.2, memoryUtilization: 0.3, requestLatencyP95Ms: 20 }) + "\n" : "");
  return { records, resources, out };
}

function collect(input: ReturnType<typeof fixture>) {
  return spawnSync(process.execPath, [resolve("scripts/benchmark/collect-v2-run.mjs"), `--records=${input.records}`, `--resources=${input.resources}`, `--out=${input.out}`], { cwd: process.cwd(), encoding: "utf8" });
}

describe("BENCHMARK_V2 artifact collection", () => {
  it("creates one integrity-bound run from complete current-system evidence", () => {
    const input = fixture();
    const result = collect(input);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(join(input.out, "collector-test-run", "summary.json"), "utf8")) as { totalScenarios: number; configuredCeilingReached: boolean };
    expect(summary.totalScenarios).toBe(BENCHMARK_V2_DOMAINS.length * classes.length);
    expect(summary.configuredCeilingReached).toBe(true);
  });

  it("rejects missing resource evidence and stale source bindings", () => {
    const missingResources = collect(fixture(false));
    expect(missingResources.status).not.toBe(0);
    expect(missingResources.stderr).toContain("benchmark records are incomplete");
    const stale = collect(fixture(true, "0".repeat(64)));
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain("source input hash does not match");
  });
});
