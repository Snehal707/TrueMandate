import { createSdkCore, type SdkWorkflowRequest, type SdkWorkflowView } from "@truemandate/sdk-core";
import {
  BENCHMARK_V2_DOMAINS,
  latencyPercentiles,
  type BenchmarkV2Domain,
  type BenchmarkV2LoadSample,
  type BenchmarkV2ScenarioResult,
} from "@truemandate/safe-benchmark";
import { buildBenchmarkWorkflowRequest } from "./v2-fixtures.js";

export interface BenchmarkV2LoadConfig {
  readonly baseUrl: string;
  readonly concurrencyLevels: readonly number[];
  readonly workflowsPerLevel: number;
  readonly timeoutMs: number;
  readonly readinessPollMs: number;
  readonly readinessAttempts: number;
  readonly now?: () => Date;
}

export interface BenchmarkV2ReadTarget {
  readonly workflowId: string;
  readonly intentId: string;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function submitWhenReady(
  baseUrl: string,
  request: SdkWorkflowRequest,
  config: Pick<BenchmarkV2LoadConfig, "timeoutMs" | "readinessPollMs" | "readinessAttempts">,
): Promise<{ result: Awaited<ReturnType<ReturnType<typeof createSdkCore>["submitWorkflow"]>>; attempts: number }> {
  const sdk = createSdkCore({ baseUrl, timeoutMs: config.timeoutMs });
  let result = await sdk.submitWorkflow(request);
  if (result.ok || result.code !== "INTENT_STATE_NOT_READY" || request.intent.kind !== "RAW" || !request.intent.id) return { result, attempts: 1 };
  let attempts = 1;
  let attemptedStateId: string | undefined;
  for (let index = 0; index < config.readinessAttempts; index += 1) {
    await wait(config.readinessPollMs);
    const workspace = await sdk.readWorkspace(request.intent.id);
    if (!workspace.ok) continue;
    const stateId = workspace.value.summary.intentStateId;
    const stateHash = workspace.value.summary.stateHash;
    if (!stateId || !stateHash || stateId === attemptedStateId) continue;
    attemptedStateId = stateId;
    const { workflowId: _rawWorkflowId, ...stateBound } = request;
    result = await sdk.submitWorkflow({
      ...stateBound,
      intent: { kind: "REFERENCE", intentId: request.intent.id, expectedIntentStateId: stateId, expectedIntentStateHash: stateHash },
      idempotencyKey: `${request.idempotencyKey}:finalized:${stateId}`,
    });
    attempts += 1;
    if (result.ok || !new Set(["INTENT_STATE_NOT_READY", "GUARDIAN_VERDICT_STALE", "PLAN_STALE"]).has(result.code)) break;
  }
  return { result, attempts };
}

async function pool<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]!);
    }
  }));
}

export async function runWorkflowLoadLevel(
  config: BenchmarkV2LoadConfig,
  concurrency: number,
  level: number,
): Promise<{ sample: BenchmarkV2LoadSample; results: BenchmarkV2ScenarioResult[]; readTargets: BenchmarkV2ReadTarget[] }> {
  const started = config.now?.() ?? new Date();
  const jobs = Array.from({ length: config.workflowsPerLevel }, (_, index) => ({
    index,
    domain: BENCHMARK_V2_DOMAINS[index % BENCHMARK_V2_DOMAINS.length] as BenchmarkV2Domain,
  }));
  const results: BenchmarkV2ScenarioResult[] = [];
  const readTargets: BenchmarkV2ReadTarget[] = [];
  await pool(jobs, concurrency, async ({ index, domain }) => {
    const request = buildBenchmarkWorkflowRequest(domain, level * 10_000 + index, started.toISOString());
    const before = performance.now();
    try {
      const submitted = await submitWhenReady(config.baseUrl, request, config);
      const latencyMs = performance.now() - before;
      const workflow = submitted.result.ok ? submitted.result.value as SdkWorkflowView : undefined;
      if (workflow) readTargets.push({ workflowId: workflow.workflowId, intentId: request.intent.kind === "RAW" ? request.intent.id! : request.intent.intentId });
      const failureReason = submitted.result.ok ? undefined : submitted.result.message;
      results.push({
        scenarioId: `load-${level}-${index}-${domain}`,
        domainId: domain,
        scenarioClass: "HAPPY_PATH",
        status: submitted.result.ok ? "PASS" : "FAIL",
        expectedStatus: "WORKFLOW_CREATED",
        actualStatus: submitted.result.ok ? workflow!.state : submitted.result.code,
        latencyMs,
        authorizationCorrect: submitted.result.ok,
        unauthorizedExecution: false,
        provenanceComplete: Boolean(workflow?.artifacts),
        sideEffectCount: workflow?.execution?.status ? 1 : 0,
        ...(workflow ? { workflowId: workflow.workflowId } : { reason: failureReason ?? "workflow submission failed" }),
      });
    } catch (error) {
      results.push({ scenarioId: `load-${level}-${index}-${domain}`, domainId: domain, scenarioClass: "HAPPY_PATH", status: "FAIL", expectedStatus: "WORKFLOW_CREATED", actualStatus: "TRANSPORT_ERROR", latencyMs: performance.now() - before, authorizationCorrect: false, unauthorizedExecution: false, provenanceComplete: false, sideEffectCount: 0, reason: error instanceof Error ? error.message : String(error) });
    }
  });
  const completed = config.now?.() ?? new Date();
  const durationMs = Math.max(1, completed.getTime() - started.getTime());
  const failures = results.filter((result) => result.status === "FAIL").length;
  const errorRate = failures / results.length;
  const latencies = results.map((result) => result.latencyMs);
  const p = latencyPercentiles(latencies);
  return {
    results,
    readTargets,
    sample: {
      lane: "WORKFLOW_WRITE",
      level,
      concurrency,
      requestCount: results.length,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs,
      successfulRequests: results.length - failures,
      failedRequests: failures,
      errorRate,
      throughputPerSecond: results.length / (durationMs / 1000),
      latencyMs: p,
      stopped: errorRate > 0.01 || p.p95 >= 270_000,
      ...(errorRate > 0.01 ? { stopReason: "ERROR_RATE_ABOVE_1_PERCENT" } : p.p95 >= 270_000 ? { stopReason: "P95_ABOVE_270_SECONDS" } : {}),
    },
  };
}

export async function runPublicReadLoadLevel(
  config: Pick<BenchmarkV2LoadConfig, "baseUrl" | "timeoutMs" | "now">,
  targets: readonly BenchmarkV2ReadTarget[],
  concurrency: number,
  requestCount: number,
  level: number,
): Promise<BenchmarkV2LoadSample> {
  if (targets.length === 0) throw new Error("public read load requires benchmark-owned workflow targets");
  const sdk = createSdkCore({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
  const started = config.now?.() ?? new Date();
  const latencies: number[] = [];
  let failures = 0;
  await pool(Array.from({ length: requestCount }, (_, index) => index), concurrency, async (index) => {
    const target = targets[index % targets.length]!;
    const before = performance.now();
    try {
      const result = index % 2 === 0
        ? await sdk.readWorkflow(target.workflowId)
        : await sdk.readWorkspace(target.intentId);
      if (!result.ok) failures += 1;
    } catch {
      failures += 1;
    } finally {
      latencies.push(performance.now() - before);
    }
  });
  const completed = config.now?.() ?? new Date();
  const durationMs = Math.max(1, completed.getTime() - started.getTime());
  const errorRate = failures / requestCount;
  const latencyMs = latencyPercentiles(latencies);
  return {
    lane: "PUBLIC_READ",
    level,
    concurrency,
    requestCount,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs,
    successfulRequests: requestCount - failures,
    failedRequests: failures,
    errorRate,
    throughputPerSecond: requestCount / (durationMs / 1000),
    latencyMs,
    stopped: errorRate > 0.01 || latencyMs.p95 >= 270_000,
    ...(errorRate > 0.01 ? { stopReason: "ERROR_RATE_ABOVE_1_PERCENT" } : latencyMs.p95 >= 270_000 ? { stopReason: "P95_ABOVE_270_SECONDS" } : {}),
  };
}
