import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_READ_MODEL } from "./benchmark-readmodel";

/**
 * The read model must equal the ACCEPTED benchmark artifacts exactly.
 * Re-reads the canonical summary file and compares field by field.
 */

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

interface SummaryShape {
  generatedAt: string;
  goldenByVariant: Record<
    string,
    {
      total: number;
      passed: number;
      composite: number;
      unauthorizedExecutionCount: number;
      criticalIncidents: number;
    }
  >;
  catalogFull: {
    variant: string;
    scenarioCount: number;
    total: number;
    passed: number;
    composite: number;
    unauthorizedExecutionCount: number;
    criticalIncidents: number;
    failedIds: string[];
  };
}

const SUMMARY_PATH = path.join(
  ROOT,
  "infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json",
);

describe("benchmark read model == accepted artifacts", () => {
  it("golden variants match the acceptance summary exactly", () => {
    const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8")) as SummaryShape;
    for (const row of BENCHMARK_READ_MODEL.golden) {
      const expected = summary.goldenByVariant[row.variant];
      expect(expected, `missing variant ${row.variant}`).toBeDefined();
      expect(row).toEqual({
        variant: row.variant,
        total: expected.total,
        passed: expected.passed,
        composite: expected.composite,
        unauthorizedExecutionCount: expected.unauthorizedExecutionCount,
        criticalIncidents: expected.criticalIncidents,
      });
    }
  });

  it("catalog totals match the acceptance summary exactly", () => {
    const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8")) as SummaryShape;
    const c = summary.catalogFull;
    expect(BENCHMARK_READ_MODEL.catalog).toMatchObject({
      variant: c.variant,
      scenarioCount: c.scenarioCount,
      total: c.total,
      passed: c.passed,
      composite: c.composite,
      unauthorizedExecutionCount: c.unauthorizedExecutionCount,
      criticalIncidents: c.criticalIncidents,
      failedIds: c.failedIds,
    });
    expect(BENCHMARK_READ_MODEL.catalog.failedIds).toHaveLength(10);
  });

  it("is deterministic SAFE evaluation with zero Gemini calls", () => {
    expect(BENCHMARK_READ_MODEL.evaluationMode).toBe("deterministic-memory");
    expect(BENCHMARK_READ_MODEL.geminiCallsDuringEvaluation).toBe(0);
  });
});

describe("no inline benchmark constants in the pages", () => {
  it("pages contain no repeated authoritative numbers", () => {
    for (const f of ["BenchmarkPage.tsx", "AttackLabPage.tsx"]) {
      const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), "utf8");
      expect(src, `${f} must not repeat benchmark numbers`).not.toMatch(
        /\b(0\.9717879712480144|0\.20397486177189145|23 \/ 23|223 \/ 233)\b/,
      );
    }
  });
});
