#!/usr/bin/env node
/**
 * Generates the 500 stress-suite read model for the judge UI from the REAL
 * immutable stress artifacts. Run:
 *
 *   node scripts/demo/build-stress-readmodel.mjs
 *
 * Inputs (canonical, immutable — timestamped runs under evals/safe/v1/stress/):
 *   stress-summary_<runId>.json  + stress-manifest_<runId>.json
 *   integrity-summary_<runId>.json
 * Output:
 *   apps/web/src/demo/stress-readmodel.ts
 *
 * Picks the LATEST run by filename (ISO stamp sort). The UI must never
 * repeat stress numbers as JSX constants; the verification test
 * (stress-readmodel.test.ts) re-reads the same runId's artifacts and
 * asserts the emitted module matches them exactly.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(root, "evals/safe/v1/stress");
if (!existsSync(dir)) {
  console.error("MISSING stress artifacts dir:", dir);
  process.exit(1);
}

function latest(prefix) {
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  if (files.length === 0) {
    console.error("MISSING artifacts with prefix:", prefix);
    process.exit(1);
  }
  return files.sort().at(-1);
}

const summaryFile = latest("stress-summary_");
const manifestFile = latest("stress-manifest_");
const integrityFile = latest("integrity-summary_");

// The "Evaluated across 500 deterministic adversarial scenarios" claim is
// GATED on the real combined run artifact. If it is missing or inconsistent,
// generation fails and the UI cannot claim 500.
const combinedDir = path.join(dir, "combined");
function latestCombined(prefix) {
  const files = existsSync(combinedDir)
    ? readdirSync(combinedDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    : [];
  if (files.length === 0) {
    console.error("MISSING combined artifacts — the 500 claim cannot be made");
    process.exit(1);
  }
  return files.sort().at(-1);
}
const combinedResultsFile = latestCombined("combined-results_");
const combinedManifestFile = latestCombined("combined-manifest_");
const combinedResults = JSON.parse(readFileSync(path.join(combinedDir, combinedResultsFile), "utf8"));
const combinedManifest = JSON.parse(readFileSync(path.join(combinedDir, combinedManifestFile), "utf8"));

if (combinedResults.schema !== "TRUEMANDATE_COMBINED_RESULTS_V1") {
  console.error("combined results schema mismatch");
  process.exit(1);
}
if (combinedResults.total !== 500 || combinedResults.uniqueHashCount !== 500) {
  console.error("combined run is not the 500 unique-scenario corpus");
  process.exit(1);
}
if (combinedManifest.combinedManifestHash !== combinedResults.combinedManifestHash) {
  console.error("combined manifest/results hash mismatch");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(path.join(dir, summaryFile), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(dir, manifestFile), "utf8"));
const integrity = JSON.parse(readFileSync(path.join(dir, integrityFile), "utf8"));

if (summary.kind !== "product") {
  console.error("summary is not a product run:", summaryFile);
  process.exit(1);
}
if (summary.runId !== manifest.runId) {
  console.error("summary/manifest runId mismatch");
  process.exit(1);
}
if (manifest.totalEmitted !== 267 || manifest.uniqueHashCount !== 267) {
  console.error("manifest does not describe 267 unique stress rows");
  process.exit(1);
}
if (integrity.total !== 70 || integrity.detected !== 70) {
  console.error("integrity suite must be 70/70 detected");
  process.exit(1);
}

const tm = summary.variants.find((v) => v.variant === "TRUEMANDATE_FULL");
const base = summary.variants.find((v) => v.variant === "BASELINE_SINGLE_AGENT");
if (!tm || !base) {
  console.error("missing variant reports");
  process.exit(1);
}

const out = `/**
 * 500 stress-suite read model — GENERATED. Do not edit.
 *
 * Derived by scripts/demo/build-stress-readmodel.mjs from the IMMUTABLE
 * stress artifacts (runId ${summary.runId}):
 *   evals/safe/v1/stress/${summaryFile}
 *   evals/safe/v1/stress/${manifestFile}
 *   evals/safe/v1/stress/${integrityFile}
 *
 * The 23 goldens and the 233 base catalog are untouched by this suite
 * (baseCatalogHash pinned below). verification test:
 * apps/web/src/demo/stress-readmodel.test.ts
 */

export const STRESS_READ_MODEL = {
  runId: ${JSON.stringify(summary.runId)},
  /** The integrity run is stamped separately from the product run. */
  integrityRunId: ${JSON.stringify(integrityFile.replace(/^integrity-summary_/, "").replace(/\.json$/, ""))},
  generatedAt: ${JSON.stringify(summary.createdAt)},
  /** Product scenarios: 233 untouched base catalog + 267 validated stress rows. */
  productScenarios: 500,
  baseCatalog: {
    count: ${manifest.baseCatalogCount},
    hash: ${JSON.stringify(manifest.baseCatalogHash)},
    goldenCount: ${manifest.goldenCount},
    unchanged: true,
  },
  stress: {
    totalEmitted: ${manifest.totalEmitted},
    uniqueHashes: ${manifest.uniqueHashCount},
    hashAlgorithm: ${JSON.stringify(manifest.scenarioHashAlgorithm)},
    holdoutCount: ${manifest.holdoutCount},
    developmentCount: ${manifest.developmentCount},
    buckets: ${JSON.stringify(
      manifest.buckets.map((b) => ({
        bucket: b.bucket,
        target: b.target,
        emitted: b.emitted,
        rejectedInvalid: b.rejectedInvalid,
        rejectedNoOp: b.rejectedNoOp,
        rejectedDuplicate: b.rejectedDuplicate,
        substitutions: b.substitutions.length,
      })),
      null,
      2,
    )},
    familyDistribution: ${JSON.stringify(manifest.familyDistribution, null, 2)},
    rejectedOperators: ${JSON.stringify(manifest.rejectedOps, null, 2)},
  },
  trumandateFull: {
    variant: ${JSON.stringify(tm.variant)},
    total: ${tm.total},
    passed: ${tm.passed},
    composite: ${tm.composite},
    criticalIncidents: ${tm.criticalIncidents},
    unauthorizedExecutionCount: ${tm.unauthorizedExecutionCount},
  },
  baselineSingleAgent: {
    variant: ${JSON.stringify(base.variant)},
    total: ${base.total},
    passed: ${base.passed},
    composite: ${base.composite},
    criticalIncidents: ${base.criticalIncidents},
    unauthorizedExecutionCount: ${base.unauthorizedExecutionCount},
  },
  /** The REAL combined 500-corpus run (233 base + 267 stress, one artifact). */
  combined: {
    runId: ${JSON.stringify(combinedResults.runId)},
    total: ${combinedResults.total},
    uniqueHashCount: ${combinedResults.uniqueHashCount},
    baseCatalogHash: ${JSON.stringify(combinedResults.baseCatalogHash)},
    stressManifestHash: ${JSON.stringify(combinedResults.stressManifestHash)},
    combinedManifestHash: ${JSON.stringify(combinedResults.combinedManifestHash)},
    trumandateFull: ${(() => {
      const v = combinedResults.variants.find((x) => x.variant === "TRUEMANDATE_FULL");
      return JSON.stringify({
        total: v.total,
        passed: v.passed,
        failed: v.failed,
        composite: v.composite,
        criticalIncidentCount: v.criticalIncidentCount,
        unauthorizedExecutionCount: v.unauthorizedExecutionCount,
      });
    })()},
    baselineSingleAgent: ${(() => {
      const v = combinedResults.variants.find((x) => x.variant === "BASELINE_SINGLE_AGENT");
      return JSON.stringify({
        total: v.total,
        passed: v.passed,
        failed: v.failed,
        composite: v.composite,
        criticalIncidentCount: v.criticalIncidentCount,
        unauthorizedExecutionCount: v.unauthorizedExecutionCount,
      });
    })()},
  },
  failureGroups: ${JSON.stringify(summary.failureGroups, null, 2)},
  integrity: {
    total: ${integrity.total},
    detected: ${integrity.detected},
    separateFromProductCount: true,
  },
} as const;
`;

const outPath = path.join(root, "apps/web/src/demo/stress-readmodel.ts");
writeFileSync(outPath, out);
console.log("Wrote", outPath);
console.log("runId:", summary.runId);
console.log("TRUEMANDATE_FULL:", `${tm.passed}/${tm.total}`, "composite", tm.composite.toFixed(4));
console.log("BASELINE:", `${base.passed}/${base.total}`, "critical", base.criticalIncidents);
console.log("integrity:", `${integrity.detected}/${integrity.total}`);
