import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCombined, runIntegrity, runProduct } from "./stress-cli.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const acceptanceSummaryPath = path.join(
  repoRoot,
  "infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json",
);
const acceptedArtifactsDir = path.join(repoRoot, "evals/safe/v1/artifacts");

function dirFingerprint(dir: string): string {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return "(absent)";
  return readdirSync(dir)
    .map((f) => `${f}:${statSync(path.join(dir, f)).mtimeMs}:${statSync(path.join(dir, f)).size}`)
    .sort()
    .join("|");
}

describe("stress-cli — immutable 500-suite results", () => {
  it("product run is deterministic and pins the real 500-suite outcome", async () => {
    const before = {
      summary: readFileSync(acceptanceSummaryPath, "utf8"),
      artifacts: dirFingerprint(acceptedArtifactsDir),
    };

    const outDir = mkdtempSync(path.join(tmpdir(), "tm-stress-"));
    const code = await runProduct(outDir);
    expect(code).toBe(0);

    const files = readdirSync(outDir).sort();
    expect(files.length).toBe(3);
    const manifest = JSON.parse(
      readFileSync(path.join(outDir, files.find((f) => f.startsWith("stress-manifest_"))!), "utf8"),
    );
    const summary = JSON.parse(
      readFileSync(path.join(outDir, files.find((f) => f.startsWith("stress-summary_"))!), "utf8"),
    );
    const lines = readFileSync(
      path.join(outDir, files.find((f) => f.startsWith("stress-results_"))!),
      "utf8",
    )
      .trim()
      .split("\n");

    expect(manifest.totalEmitted).toBe(267);
    expect(manifest.uniqueHashCount).toBe(267);
    expect(lines.length).toBe(534); // 267 x 2 SUTs
    expect(summary.kind).toBe("product");

    const tm = summary.variants.find((v: { variant: string }) => v.variant === "TRUEMANDATE_FULL");
    const base = summary.variants.find(
      (v: { variant: string }) => v.variant === "BASELINE_SINGLE_AGENT",
    );
    expect(tm).toMatchObject({
      total: 267,
      passed: 249,
      criticalIncidents: 0,
      unauthorizedExecutionCount: 0,
    });
    expect(base).toMatchObject({ total: 267, passed: 5 });
    expect(base.criticalIncidents).toBe(232);
    expect(base.unauthorizedExecutionCount).toBe(205);

    // The accepted SAFE_V1 artifacts and summary are byte-untouched.
    expect(readFileSync(acceptanceSummaryPath, "utf8")).toBe(before.summary);
    expect(dirFingerprint(acceptedArtifactsDir)).toBe(before.artifacts);
  });

  it("integrity run detects all 70 injected faults", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "tm-integrity-"));
    const code = await runIntegrity(outDir);
    expect(code).toBe(0);
    const summary = JSON.parse(
      readFileSync(path.join(outDir, readdirSync(outDir).find((f) => f.startsWith("integrity-summary_"))!), "utf8"),
    );
    expect(summary.total).toBe(70);
    expect(summary.detected).toBe(70);
  });

  it("combined run: ONE immutable artifact over the exact 500 corpus (both SUTs)", async () => {
    const before = {
      summary: readFileSync(acceptanceSummaryPath, "utf8"),
      artifacts: dirFingerprint(acceptedArtifactsDir),
    };

    const outDir = mkdtempSync(path.join(tmpdir(), "tm-combined-"));
    const code = await runCombined(outDir);
    expect(code).toBe(0);

    const combinedDir = path.join(outDir, "combined");
    const files = readdirSync(combinedDir).sort();
    expect(files).toHaveLength(3);
    const results = JSON.parse(
      readFileSync(path.join(combinedDir, files.find((f) => f.startsWith("combined-results_") && f.endsWith(".json"))!), "utf8"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(combinedDir, files.find((f) => f.startsWith("combined-manifest_"))!), "utf8"),
    );

    // The ONE artifact carries every required field.
    expect(results.schema).toBe("TRUEMANDATE_COMBINED_RESULTS_V1");
    expect(results.total).toBe(500);
    expect(results.uniqueHashCount).toBe(500);
    expect(results.generatorVersion).toBe(manifest.generatorVersion);
    expect(results.baseCatalogHash).toBe(manifest.baseCatalogHash);
    expect(results.stressManifestHash).toBe(manifest.stressManifestHash);
    expect(results.combinedManifestHash).toBe(manifest.combinedManifestHash);
    expect(results.createdAt).toBeTruthy();

    for (const variant of results.variants) {
      expect(variant.total).toBe(500);
      expect(variant.passed + variant.failed).toBe(500);
      expect(variant.failedScenarios).toHaveLength(variant.failed);
      const familyTotal = variant.perFamily.reduce((a: number, f: { total: number }) => a + f.total, 0);
      expect(familyTotal).toBe(500);
      for (const f of variant.failedScenarios) {
        expect(f.reasons.length).toBeGreaterThan(0);
        expect(f.origin === "base" || f.origin === "stress").toBe(true);
      }
    }

    const tm = results.variants.find((v: { variant: string }) => v.variant === "TRUEMANDATE_FULL");
    const base = results.variants.find((v: { variant: string }) => v.variant === "BASELINE_SINGLE_AGENT");
    expect(tm.criticalIncidentCount).toBe(0);
    expect(tm.unauthorizedExecutionCount).toBe(0);
    expect(base.criticalIncidentCount).toBeGreaterThan(0); // baseline divergence is real

    // The base portion of the combined run reproduces the ACCEPTED catalog
    // result exactly (same deterministic SUT, same byte-identical fixtures).
    const acceptance = JSON.parse(readFileSync(acceptanceSummaryPath, "utf8")) as {
      catalogFull: { total: number; passed: number; failedIds: string[] };
    };
    const tmBaseFailed = tm.failedScenarios
      .filter((f: { origin: string }) => f.origin === "base")
      .map((f: { scenarioId: string }) => f.scenarioId)
      .sort();
    expect(tmBaseFailed).toEqual([...acceptance.catalogFull.failedIds].sort());
    expect(tmBaseFailed).toHaveLength(10);

    // Historical artifacts untouched.
    expect(readFileSync(acceptanceSummaryPath, "utf8")).toBe(before.summary);
    expect(dirFingerprint(acceptedArtifactsDir)).toBe(before.artifacts);
  });

  it("reruns never overwrite — a second run produces a new stamped artifact set", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "tm-immut-"));
    await runProduct(outDir);
    const first = readdirSync(outDir).sort();
    await runProduct(outDir);
    const second = readdirSync(outDir).sort();
    expect(second.length).toBe(first.length * 2);
    for (const f of first) {
      expect(readFileSync(path.join(outDir, f), "utf8")).toBe(
        readFileSync(path.join(outDir, f), "utf8"),
      );
    }
  });
});
