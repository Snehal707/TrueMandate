import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUALIFICATION_READ_MODEL } from "./qualification-readmodel";

/**
 * The qualification read model must never drift from committed evidence.
 *
 * Every rendered number is recomputed here directly from
 * `evals/benchmark/v2/runs/`. If a value is edited by hand without the evidence
 * changing, this fails. This is the guardrail that makes the judge-facing
 * qualification numbers un-fabricatable.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUNS = path.join(REPO_ROOT, "evals/benchmark/v2/runs");

function readResult(runId: string) {
  return JSON.parse(readFileSync(path.join(RUNS, runId, "result.json"), "utf8"));
}

describe("paired correctness matches committed evidence", () => {
  const pc = QUALIFICATION_READ_MODEL.pairedCorrectness;
  const records = readFileSync(path.join(REPO_ROOT, pc.sourcePath), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .map((row) => row.payload ?? row);

  const correct = (row: { status: string }) =>
    row.status === "PASS" || row.status === "EXPECTED_REJECTION";
  const of = (variant: string) => records.filter((r) => r.systemVariant === variant);

  it("covers exactly 50 paired scenarios", () => {
    expect(records).toHaveLength(pc.totalScenarios * 2);
    expect(of("CURRENT_SYSTEM")).toHaveLength(pc.totalScenarios);
    expect(of("BASELINE_SINGLE_AGENT")).toHaveLength(pc.totalScenarios);
  });

  it("current-system totals match the evidence", () => {
    const rows = of("CURRENT_SYSTEM");
    expect(rows.filter(correct)).toHaveLength(pc.trueMandate.correct);
    expect(rows.filter((r) => r.unauthorizedExecution)).toHaveLength(pc.trueMandate.unauthorizedExecutions);
    expect(rows.filter((r) => r.criticalFailure)).toHaveLength(pc.trueMandate.criticalFailures);
  });

  it("baseline totals match the evidence", () => {
    const rows = of("BASELINE_SINGLE_AGENT");
    expect(rows.filter(correct)).toHaveLength(pc.baseline.correct);
    expect(rows.filter((r) => r.unauthorizedExecution)).toHaveLength(pc.baseline.unauthorizedExecutions);
    expect(rows.filter((r) => r.criticalFailure)).toHaveLength(pc.baseline.criticalFailures);
  });

  it("every per-domain row matches the evidence", () => {
    for (const domain of pc.domains) {
      const inDomain = (variant: string) =>
        records.filter((r) => r.domainId === domain.domainId && r.systemVariant === variant);
      const current = inDomain("CURRENT_SYSTEM");
      const baseline = inDomain("BASELINE_SINGLE_AGENT");
      expect(current, `${domain.domainId} current total`).toHaveLength(domain.total);
      expect(baseline, `${domain.domainId} baseline total`).toHaveLength(domain.total);
      expect(current.filter(correct), `${domain.domainId} current correct`).toHaveLength(domain.trueMandateCorrect);
      expect(baseline.filter(correct), `${domain.domainId} baseline correct`).toHaveLength(domain.baselineCorrect);
    }
  });

  it("domain rows sum to the reported totals", () => {
    const sum = (pick: (d: (typeof pc.domains)[number]) => number) =>
      pc.domains.reduce((total, d) => total + pick(d), 0);
    expect(sum((d) => d.trueMandateCorrect)).toBe(pc.trueMandate.correct);
    expect(sum((d) => d.baselineCorrect)).toBe(pc.baseline.correct);
    expect(sum((d) => d.total)).toBe(pc.totalScenarios);
  });

  it("covers all five DomainPacks", () => {
    expect(pc.domains.map((d) => d.domainId).sort()).toEqual([
      "invoice_vendor_payment",
      "logistics_fulfillment",
      "procurement",
      "saas_it_spend",
      "travel",
    ]);
  });
});

describe("load qualification matches committed evidence", () => {
  for (const level of QUALIFICATION_READ_MODEL.qualification.levels) {
    it(`${level.level} matches ${level.runId}`, () => {
      const result = readResult(level.runId);
      const sample = result.loadSample;
      expect(level.passed).toBe(result.passed);
      expect(level.total).toBe(result.scenarioCount);
      expect(level.errorRate).toBe(sample.errorRate);
      expect(level.latencyMs.p50).toBe(sample.latencyMs.p50);
      expect(level.latencyMs.p95).toBe(sample.latencyMs.p95);
      expect(level.latencyMs.p99).toBe(sample.latencyMs.p99);
      expect(level.throughputPerSecond).toBe(sample.throughputPerSecond);
      expect(level.peakCpu).toBe(result.resources.peakCpu);
      expect(level.peakMemory).toBe(result.resources.peakMemory);
      expect(level.peakInstances).toBe(result.resources.peakInstances);
      expect(level.provider429s).toBe(result.model.provider429s);
      expect(level.timedOutAttempts).toBe(result.model.timedOutAttempts);
      expect(level.concurrency).toBe(sample.concurrency);
    });

    it(`${level.level} verdict reflects the recorded pass flag`, () => {
      const result = readResult(level.runId);
      const flag = Object.keys(result).find((key) => /Passed$/.test(key));
      expect(flag, `${level.runId} must record a verdict flag`).toBeDefined();
      const recordedPass = result[flag as string] === true;
      expect(level.verdict === "PASS").toBe(recordedPass);
    });
  }

  it("C8 is never presented as PASS", () => {
    const c8 = QUALIFICATION_READ_MODEL.qualification.levels.find((l) => l.level === "C8");
    expect(c8?.verdict).toBe("PROVIDER_DEGRADATION_BOUNDARY");
    expect(readResult(c8!.runId).c8Passed).toBe(false);
  });

  it("the degradation claim holds: no level saturated application compute", () => {
    for (const level of QUALIFICATION_READ_MODEL.qualification.levels) {
      expect(level.peakCpu, `${level.level} peak CPU`).toBeLessThan(0.85);
      expect(level.peakMemory, `${level.level} peak memory`).toBeLessThan(0.85);
    }
    // Provider pressure, not compute, is what rises into the failing level.
    const byLevel = Object.fromEntries(
      QUALIFICATION_READ_MODEL.qualification.levels.map((l) => [l.level, l]),
    );
    expect(byLevel.C8!.provider429s).toBeGreaterThan(byLevel.C4!.provider429s);
    expect(byLevel.C4!.provider429s).toBeGreaterThan(byLevel.C2!.provider429s);
  });
});

describe("safety invariants match every recorded run", () => {
  it("aggregates to zero across all runs carrying a result", () => {
    let runs = 0;
    let unauthorized = 0;
    let duplicates = 0;
    let sideEffects = 0;
    for (const dir of readdirSync(RUNS)) {
      if (!existsSync(path.join(RUNS, dir, "result.json"))) continue;
      const result = readResult(dir);
      runs += 1;
      unauthorized += result.unauthorizedExecutions ?? 0;
      duplicates += result.duplicates ?? 0;
      sideEffects += result.sideEffects ?? 0;
    }
    const safety = QUALIFICATION_READ_MODEL.safety;
    expect(runs).toBe(safety.runsAggregated);
    expect(unauthorized).toBe(safety.unauthorizedExecutions);
    expect(duplicates).toBe(safety.duplicateEffects);
    expect(sideEffects).toBe(safety.unintendedEconomicSideEffects);
  });
});

describe("acceptance is never overstated", () => {
  it("reports full acceptance as not achieved", () => {
    expect(QUALIFICATION_READ_MODEL.acceptance.fullAcceptanceAchieved).toBe(false);
    expect(QUALIFICATION_READ_MODEL.acceptance.statement).toBe(
      "Benchmark V2 full acceptance was not achieved. Qualification evidence is presented exactly as observed.",
    );
  });

  it("no run in the repository is marked as an accepted dataset", () => {
    for (const dir of readdirSync(RUNS)) {
      if (!existsSync(path.join(RUNS, dir, "result.json"))) continue;
      expect(readResult(dir).acceptedDataset, `${dir} must not be accepted`).not.toBe(true);
    }
  });
});
