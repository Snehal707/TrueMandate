import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_V2_DOMAINS } from "@truemandate/safe-benchmark";
import { buildBenchmarkWorkflowRequest } from "./v2-fixtures.js";
import { runPublicReadLoadLevel, runWorkflowLoadLevel } from "./v2-runner.js";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

describe("current-system benchmark fixtures", () => {
  it("builds strict current DomainPack requests without legacy aliases", () => {
    for (const [index, domain] of BENCHMARK_V2_DOMAINS.entries()) {
      const request = buildBenchmarkWorkflowRequest(domain, index, "2026-08-24T00:00:00.000Z");
      expect(request.domain.packId).toBe(domain);
      expect(request.intent.kind).toBe("RAW");
      expect(request.workflowId).toContain(domain);
    }
  });

  it("measures concurrent public workflow responses", async () => {
    const server = createServer((request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url?.includes("/workspace/")) {
          response.end(JSON.stringify({ summary: { intentId: "intent-benchmark", intentStateId: "state-1", stateHash: "hash-1" }, evidence: [], approvals: [], monitoring: [], execution: null, outcome: null, resolution: null }));
        } else {
          response.end(JSON.stringify({ workflowId: "wf-derived", state: "BLOCKED", artifacts: [] }));
        }
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { workflowId?: string };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ workflowId: parsed.workflowId ?? "wf-derived", state: "BLOCKED", artifacts: [] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [2],
      workflowsPerLevel: 5,
      timeoutMs: 5_000,
      readinessPollMs: 1,
      readinessAttempts: 1,
    }, 2, 1);

    expect(run.results).toHaveLength(5);
    expect(new Set(run.results.map((result) => result.domainId))).toEqual(new Set(BENCHMARK_V2_DOMAINS));
    expect(run.sample.successfulRequests).toBe(5);
    expect(run.sample.lane).toBe("WORKFLOW_WRITE");
    expect(run.sample.failedRequests).toBe(0);
    expect(run.sample.latencyMs.p99).toBeGreaterThanOrEqual(run.sample.latencyMs.p50);
    const reads = await runPublicReadLoadLevel({ baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 5_000 }, run.readTargets, 2, 10, 1);
    expect(reads.lane).toBe("PUBLIC_READ");
    expect(reads.successfulRequests).toBe(10);
  });

  it("emits ordered public phase diagnostics without changing submission behavior", async () => {
    let workspaceReads = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspaceReads += 1;
        response.writeHead(200);
        response.end(JSON.stringify({
          summary: workspaceReads === 1
            ? { intentId: "intent-phase" }
            : { intentId: "intent-phase", intentStateId: "state-phase", stateHash: "hash-phase" },
          evidence: [], approvals: [], monitoring: [], execution: null, outcome: null, resolution: null,
        }));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(JSON.stringify({ error: { code: "INTENT_STATE_NOT_READY", message: "pending" } }));
          return;
        }
        response.writeHead(200);
        response.end(JSON.stringify({ workflowId: "wf-phase", state: "BLOCKED", artifacts: [] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");
    const phases: string[] = [];

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 3,
      domains: ["saas_it_spend"],
      diagnostic: (event) => phases.push(event.phase),
    }, 1, 1);

    expect(run.results[0]?.status).toBe("PASS");
    expect(phases).toEqual([
      "RAW_SUBMISSION",
      "WORKSPACE_POLL",
      "WORKSPACE_POLL",
      "STATE_BOUND_SUBMISSION",
      "RESPONSE_HANDOFF",
    ]);
  });

  it("polls RAW readiness after an unparseable retryable 503 without resubmitting RAW", async () => {
    let rawSubmissions = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        response.writeHead(200);
        response.end(JSON.stringify({
          summary: { intentId: "intent-retryable", intentStateId: "state-retryable", stateHash: "hash-retryable" },
          evidence: [], approvals: [], monitoring: [], execution: null, outcome: null, resolution: null,
        }));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string } };
        if (parsed.intent?.kind === "RAW") {
          rawSubmissions += 1;
          response.writeHead(503);
          response.end("truncated-json");
          return;
        }
        response.writeHead(200);
        response.end(JSON.stringify({ workflowId: "wf-retryable", state: "BLOCKED", artifacts: [] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 1,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    expect(run.results[0]?.status).toBe("PASS");
    expect(rawSubmissions).toBe(1);
  });

  const rawNotReadyResponse = () =>
    JSON.stringify({ error: { code: "INTENT_STATE_NOT_READY", message: "pending" } });
  const workspaceBody = (stateId: string) =>
    JSON.stringify({
      summary: { intentId: "intent-readiness", intentStateId: stateId, stateHash: `hash-${stateId}` },
      evidence: [], approvals: [], monitoring: [], execution: null, outcome: null, resolution: null,
    });
  const readinessInsufficientResponse = () =>
    JSON.stringify({ error: { code: "SEMANTIC_READINESS_INSUFFICIENT", message: "Readiness below PLANNABLE" } });

  it("continues polling past SEMANTIC_READINESS_INSUFFICIENT until a superseded state is PLANNABLE", async () => {
    let workspacePolls = 0;
    const stateBoundSubmissions: string[] = [];
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspacePolls += 1;
        response.writeHead(200);
        response.end(workspaceBody(workspacePolls === 1 ? "state-not-ready" : "state-superseded"));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string; expectedIntentStateId?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        const stateId = parsed.intent?.expectedIntentStateId ?? "";
        stateBoundSubmissions.push(stateId);
        if (stateId === "state-superseded") {
          response.writeHead(200);
          response.end(JSON.stringify({ workflowId: "wf-superseded", state: "BLOCKED", artifacts: [] }));
          return;
        }
        response.writeHead(409);
        response.end(readinessInsufficientResponse());
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");
    const phases: string[] = [];

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 2,
      domains: ["logistics_fulfillment"],
      diagnostic: (event) => phases.push(event.phase),
    }, 1, 1);

    expect(run.results[0]?.status).toBe("PASS");
    expect(run.results[0]?.workflowId).toBe("wf-superseded");
    expect(workspacePolls).toBe(2);
    expect(stateBoundSubmissions).toEqual(["state-not-ready", "state-superseded"]);
    expect(phases.filter((phase) => phase === "STATE_BOUND_SUBMISSION")).toHaveLength(2);
  });

  it("submits the state-bound request exactly once when the first observed state is already PLANNABLE", async () => {
    let workspacePolls = 0;
    let stateBoundSubmissions = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspacePolls += 1;
        response.writeHead(200);
        response.end(workspaceBody("state-ready"));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        stateBoundSubmissions += 1;
        response.writeHead(200);
        response.end(JSON.stringify({ workflowId: "wf-ready", state: "BLOCKED", artifacts: [] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 3,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    expect(run.results[0]?.status).toBe("PASS");
    expect(workspacePolls).toBe(1);
    expect(stateBoundSubmissions).toBe(1);
  });

  it("fails closed once the polling budget is exhausted when readiness never advances", async () => {
    let workspacePolls = 0;
    let stateBoundSubmissions = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspacePolls += 1;
        response.writeHead(200);
        response.end(workspaceBody("state-stuck"));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        stateBoundSubmissions += 1;
        response.writeHead(409);
        response.end(readinessInsufficientResponse());
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 3,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    expect(run.results[0]?.status).toBe("FAIL");
    expect(run.results[0]?.actualStatus).toBe("SEMANTIC_READINESS_INSUFFICIENT");
    expect(workspacePolls).toBe(3);
    expect(stateBoundSubmissions).toBe(1);
  });

  it("does not resubmit against a state it has already attempted (no duplicate submission)", async () => {
    let workspacePolls = 0;
    const stateBoundSubmissions: string[] = [];
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspacePolls += 1;
        const stateId = workspacePolls <= 2 ? "state-repeat" : "state-advanced";
        response.writeHead(200);
        response.end(workspaceBody(stateId));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string; expectedIntentStateId?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        const stateId = parsed.intent?.expectedIntentStateId ?? "";
        stateBoundSubmissions.push(stateId);
        if (stateId === "state-advanced") {
          response.writeHead(200);
          response.end(JSON.stringify({ workflowId: "wf-advanced", state: "BLOCKED", artifacts: [] }));
          return;
        }
        response.writeHead(409);
        response.end(readinessInsufficientResponse());
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 3,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    expect(run.results[0]?.status).toBe("PASS");
    expect(workspacePolls).toBe(3);
    expect(stateBoundSubmissions.filter((id) => id === "state-repeat")).toHaveLength(1);
    expect(stateBoundSubmissions).toEqual(["state-repeat", "state-advanced"]);
  });

  it("never surfaces more than one workflow for a scenario across retried submissions (no duplicate workflow)", async () => {
    let workspacePolls = 0;
    const createdWorkflowIds = new Set<string>();
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        workspacePolls += 1;
        response.writeHead(200);
        response.end(workspaceBody(workspacePolls === 1 ? "state-not-ready" : "state-superseded"));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string; expectedIntentStateId?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        if (parsed.intent?.expectedIntentStateId === "state-superseded") {
          createdWorkflowIds.add("wf-single");
          response.writeHead(200);
          response.end(JSON.stringify({ workflowId: "wf-single", state: "BLOCKED", artifacts: [] }));
          return;
        }
        response.writeHead(409);
        response.end(readinessInsufficientResponse());
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 2,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.status).toBe("PASS");
    expect(run.readTargets).toHaveLength(1);
    expect(createdWorkflowIds.size).toBe(1);
  });

  it("reports no authorization, side effects, or workflow before readiness reaches PLANNABLE (no authority advancement)", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url?.includes("/workspace/")) {
        response.writeHead(200);
        response.end(workspaceBody("state-stuck"));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += String(chunk); });
      request.on("end", () => {
        const parsed = JSON.parse(body) as { intent?: { kind?: string } };
        if (parsed.intent?.kind === "RAW") {
          response.writeHead(503);
          response.end(rawNotReadyResponse());
          return;
        }
        response.writeHead(409);
        response.end(readinessInsufficientResponse());
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing test server port");

    const run = await runWorkflowLoadLevel({
      baseUrl: `http://127.0.0.1:${address.port}`,
      concurrencyLevels: [1], workflowsPerLevel: 1, timeoutMs: 5_000,
      readinessPollMs: 1, readinessAttempts: 2,
      domains: ["logistics_fulfillment"],
    }, 1, 1);

    const scenario = run.results[0];
    expect(scenario?.status).toBe("FAIL");
    expect(scenario?.authorizationCorrect).toBe(false);
    expect(scenario?.unauthorizedExecution).toBe(false);
    expect(scenario?.sideEffectCount).toBe(0);
    expect(scenario?.workflowId).toBeUndefined();
  });
});
