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
});
