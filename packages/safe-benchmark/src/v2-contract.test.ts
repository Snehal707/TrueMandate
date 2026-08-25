import { describe, expect, it } from "vitest";
import {
  BENCHMARK_V2_DOMAINS,
  BenchmarkV2AcceptedRunSchema,
  BenchmarkV2ScenarioResultSchema,
  latencyPercentiles,
} from "./v2-contract.js";
import { benchmarkV2CorrectnessCorpus, benchmarkV2CorpusHash } from "./v2-corpus.js";

describe("BENCHMARK_V2 contract", () => {
  it("pins the five current DomainPack identifiers", () => {
    expect(BENCHMARK_V2_DOMAINS).toEqual([
      "procurement",
      "travel",
      "saas_it_spend",
      "invoice_vendor_payment",
      "logistics_fulfillment",
    ]);
  });

  it("rejects legacy domains and incomplete result records", () => {
    expect(BenchmarkV2ScenarioResultSchema.safeParse({ domainId: "commerce" }).success).toBe(false);
  });

  it("requires provenance-bearing acceptance metadata", () => {
    expect(BenchmarkV2AcceptedRunSchema.safeParse({
      benchmarkVersion: "BENCHMARK_V2",
      runId: "run-1",
      manifestSha256: "a".repeat(64),
      sourceInputHash: "b".repeat(64),
      corpusHash: "c".repeat(64),
      configurationHash: "d".repeat(64),
      commitSha: "not-a-commit",
      acceptedAt: "2026-08-24T00:00:00.000Z",
    }).success).toBe(false);
  });

  it("calculates deterministic p50, p95, and p99", () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(latencyPercentiles(values)).toEqual({ p50: 50, p95: 95, p99: 99 });
  });

  it("defines one paired scenario for every current domain and scenario class", () => {
    const corpus = benchmarkV2CorrectnessCorpus();
    expect(corpus).toHaveLength(50);
    expect(new Set(corpus.map((row) => row.pairId)).size).toBe(50);
    expect(new Set(corpus.map((row) => row.inputHash)).size).toBe(50);
    expect(benchmarkV2CorpusHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});
