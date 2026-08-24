import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STRESS_READ_MODEL } from "./stress-readmodel";

/**
 * The stress read model must equal the IMMUTABLE stress artifacts exactly.
 * Re-reads the same runId's files from evals/safe/v1/stress and compares.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ARTIFACTS = path.join(ROOT, "evals/safe/v1/stress");

describe("stress read model == immutable stress artifacts", () => {
  const rm = STRESS_READ_MODEL;
  const runId = rm.runId;

  it("re-derives the same runId artifacts and matches exactly", () => {
    const summary = JSON.parse(
      readFileSync(path.join(ARTIFACTS, `stress-summary_${runId}.json`), "utf8"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(ARTIFACTS, `stress-manifest_${runId}.json`), "utf8"),
    );
    const integrity = JSON.parse(
      readFileSync(path.join(ARTIFACTS, `integrity-summary_${rm.integrityRunId}.json`), "utf8"),
    );

    expect(rm.productScenarios).toBe(500);
    expect(rm.baseCatalog.count).toBe(manifest.baseCatalogCount);
    expect(rm.baseCatalog.hash).toBe(manifest.baseCatalogHash);
    expect(rm.baseCatalog.unchanged).toBe(true);
    expect(rm.stress.totalEmitted).toBe(manifest.totalEmitted);
    expect(rm.stress.uniqueHashes).toBe(manifest.uniqueHashCount);

    const tm = summary.variants.find((v: { variant: string }) => v.variant === "TRUEMANDATE_FULL");
    const base = summary.variants.find((v: { variant: string }) => v.variant === "BASELINE_SINGLE_AGENT");
    expect(rm.trumandateFull).toMatchObject({
      total: tm.total,
      passed: tm.passed,
      composite: tm.composite,
      criticalIncidents: tm.criticalIncidents,
      unauthorizedExecutionCount: tm.unauthorizedExecutionCount,
    });
    expect(rm.baselineSingleAgent).toMatchObject({
      total: base.total,
      passed: base.passed,
      composite: base.composite,
      criticalIncidents: base.criticalIncidents,
      unauthorizedExecutionCount: base.unauthorizedExecutionCount,
    });
    expect(rm.integrity).toMatchObject({ total: integrity.total, detected: integrity.detected });
  });

  it("pins the real 500-suite outcome (never edited to improve the score)", () => {
    expect(rm.productScenarios).toBe(500);
    expect(rm.baseCatalog.count).toBe(233);
    expect(rm.stress.totalEmitted).toBe(267);
    expect(rm.stress.uniqueHashes).toBe(267);
    expect(rm.trumandateFull.passed).toBe(249);
    expect(rm.trumandateFull.criticalIncidents).toBe(0);
    expect(rm.trumandateFull.unauthorizedExecutionCount).toBe(0);
    expect(rm.baselineSingleAgent.passed).toBe(5);
    expect(rm.baselineSingleAgent.criticalIncidents).toBe(232);
    expect(rm.integrity.detected).toBe(70);
    expect(rm.integrity.total).toBe(70);
    expect(rm.integrity.separateFromProductCount).toBe(true);
  });

  it("bucket guards report zero invalid / no-op rows and 6 T1 substitutions", () => {
    for (const b of rm.stress.buckets) {
      expect(b.rejectedInvalid).toBe(0);
      expect(b.rejectedNoOp).toBe(0);
      expect(b.emitted).toBe(b.target);
    }
    const t1 = rm.stress.buckets.find((b) => b.bucket === "T1")!;
    expect(t1.rejectedDuplicate).toBe(6);
    expect(t1.substitutions).toBe(6);
  });

  it("the 500 claim is gated on the real combined artifact and matches it exactly", () => {
    const combined = rm.combined;
    const combinedDir = path.join(ARTIFACTS, "combined");
    const results = JSON.parse(
      readFileSync(path.join(combinedDir, `combined-results_${combined.runId}.json`), "utf8"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(combinedDir, `combined-manifest_${combined.runId}.json`), "utf8"),
    );

    expect(results.total).toBe(500);
    expect(results.uniqueHashCount).toBe(500);
    expect(manifest.combinedManifestHash).toBe(results.combinedManifestHash);
    expect(combined.total).toBe(500);
    expect(combined.uniqueHashCount).toBe(500);
    expect(combined.baseCatalogHash).toBe(results.baseCatalogHash);
    expect(combined.stressManifestHash).toBe(results.stressManifestHash);
    expect(combined.combinedManifestHash).toBe(results.combinedManifestHash);

    const tm = results.variants.find((v: { variant: string }) => v.variant === "TRUEMANDATE_FULL");
    const base = results.variants.find((v: { variant: string }) => v.variant === "BASELINE_SINGLE_AGENT");
    expect(combined.trumandateFull).toMatchObject({
      total: tm.total,
      passed: tm.passed,
      failed: tm.failed,
      composite: tm.composite,
      criticalIncidentCount: tm.criticalIncidentCount,
      unauthorizedExecutionCount: tm.unauthorizedExecutionCount,
    });
    expect(combined.baselineSingleAgent).toMatchObject({
      total: base.total,
      passed: base.passed,
      failed: base.failed,
      composite: base.composite,
      criticalIncidentCount: base.criticalIncidentCount,
      unauthorizedExecutionCount: base.unauthorizedExecutionCount,
    });

    // The REAL combined outcome, pinned:
    expect(combined.trumandateFull).toMatchObject({
      total: 500,
      passed: 472,
      failed: 28,
      criticalIncidentCount: 0,
      unauthorizedExecutionCount: 0,
    });
    expect(combined.baselineSingleAgent.total).toBe(500);
    expect(combined.baselineSingleAgent.passed).toBe(40);
  });
});

describe("no inline stress constants in the pages", () => {
  it("StressPage contains no repeated authoritative numbers", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "StressPage.tsx"), "utf8");
    expect(src, "StressPage must not repeat stress numbers").not.toMatch(/\b249 \/ 267\b|\b232\b/);
  });
});
