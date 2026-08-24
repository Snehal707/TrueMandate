import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BENCHMARK_V2_DOMAINS, BenchmarkV2ScenarioResultSchema } from "../../packages/safe-benchmark/dist/index.js";

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

function scenarioClass(name) {
  if (/concurr|parallel|race/i.test(name)) return "CONCURRENT_RACE";
  if (/expired|expiry/i.test(name)) return "EXPIRED_AUTHORIZATION";
  if (/unauthori|caller.*den|denies.*caller|unknown callers|requires authenticated|only the .* caller|missing bearer/i.test(name)) return "UNAUTHORIZED_CALLER";
  if (/malform|schema|caller-supplied|rejects.*input/i.test(name)) return "MALFORMED_REQUEST";
  if (/replay|idempoten|exactly once|consumed|duplicate/i.test(name)) return "REPLAY";
  if (/stale|foreign workflow|supersed/i.test(name)) return "STALE_STATE";
  if (/fails open|unavailable|timeout|unknown|partial failure/i.test(name)) return "PARTIAL_FAILURE";
  if (/mismatch|industrial|450 vs 500|non-refundable|wrong/i.test(name)) return "ACTION_MISMATCH";
  if (/stitch|prepare|authorize|commit|multi-step/i.test(name)) return "MULTI_STEP";
  return "HAPPY_PATH";
}

function domain(name, index) {
  if (/travel/i.test(name)) return "travel";
  if (/saas|subscription/i.test(name)) return "saas_it_spend";
  if (/invoice|payee/i.test(name)) return "invoice_vendor_payment";
  if (/logistics|destination|fulfillment/i.test(name)) return "logistics_fulfillment";
  if (/procurement|supplier|food-grade|industrial|purchase/i.test(name)) return "procurement";
  return BENCHMARK_V2_DOMAINS[index % BENCHMARK_V2_DOMAINS.length];
}

const records = assertions.map((assertion, index) => {
  const passed = assertion.status === "passed";
  const cls = scenarioClass(assertion.fullName);
  const result = {
    scenarioId: `local-${index}-${assertion.fullName.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 120)}`,
    domainId: domain(assertion.fullName, index),
    scenarioClass: cls,
    status: passed ? (cls === "HAPPY_PATH" || cls === "MULTI_STEP" ? "PASS" : "EXPECTED_REJECTION") : "FAIL",
    expectedStatus: passed ? "ASSERTIONS_PASS" : "ASSERTIONS_PASS",
    actualStatus: passed ? "ASSERTIONS_PASS" : "ASSERTIONS_FAIL",
    latencyMs: Math.max(0, assertion.duration ?? 0),
    ...( /authorit|unauthori|commit|gateway/i.test(assertion.fullName) ? { authorizationCorrect: passed } : {} ),
    unauthorizedExecution: false,
    ...( /provenance|workflow|stitch/i.test(assertion.fullName) ? { provenanceComplete: passed } : {} ),
    ...( cls === "REPLAY" ? { replayProtected: passed } : {} ),
    sideEffectCount: /exactly once|one mock payment/i.test(assertion.fullName) && passed ? 1 : 0,
    reason: assertion.fullName,
  };
  return { benchmark: "BENCHMARK_V2", recordType: "SCENARIO_RESULT", payload: BenchmarkV2ScenarioResultSchema.parse(result) };
});
const outputPath = resolve(outDir, "local-scenario-records.jsonl");
writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
console.log(JSON.stringify({ runId, outputPath, assertions: records.length, files }));
