#!/usr/bin/env node
/**
 * Generates the SAFE benchmark read model for the judge UI from the ACTUAL
 * accepted benchmark artifacts. Run:
 *
 *   node scripts/demo/build-benchmark-readmodel.mjs
 *
 * Inputs (canonical, committed):
 *   infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json
 * Output:
 *   apps/web/src/demo/benchmark-readmodel.ts
 *
 * The UI must never repeat benchmark numbers as JSX constants; the
 * verification test (benchmark-readmodel.test.ts) re-reads the summary file
 * and asserts the emitted module matches it exactly.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const summaryPath = path.join(
  root,
  "infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json",
);
if (!existsSync(summaryPath)) {
  console.error("MISSING acceptance summary:", summaryPath);
  process.exit(1);
}
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));

const VARIANTS = [
  "BASELINE_SINGLE_AGENT",
  "BASELINE_MULTI_AGENT",
  "GUARDIAN_ONLY",
  "DETERMINISTIC_CORE",
  "TRUEMANDATE_FULL",
];

const golden = VARIANTS.map((variant) => {
  const v = summary.goldenByVariant?.[variant];
  if (!v) {
    console.error("MISSING golden variant:", variant);
    process.exit(1);
  }
  return {
    variant,
    total: v.total,
    passed: v.passed,
    composite: v.composite,
    unauthorizedExecutionCount: v.unauthorizedExecutionCount,
    criticalIncidents: v.criticalIncidents,
  };
});

const catalog = summary.catalogFull;
if (!catalog) {
  console.error("MISSING catalogFull");
  process.exit(1);
}

// Deterministic evaluation fact: verify the runner packages import no model
// package (memory adapters only). Comments are stripped first — the adapters
// doc comment explicitly says "CI adapters are deterministic".
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const runnerSrc = stripComments(
  readFileSync(
    path.join(root, "services/benchmark-runner/src/adapters.ts"),
    "utf8",
  ),
);
const safeSrc = stripComments(
  readFileSync(
    path.join(root, "packages/safe-benchmark/src/index.ts"),
    "utf8",
  ),
);
const deterministic = !/@truemandate\/model/.test(runnerSrc + safeSrc);

// Known-failure analysis (documented in final-safe-demo-acceptance-report.md
// blocker #6): every failed id must be a generated execution row k∈{02,05}.
const failedIds = catalog.failedIds ?? [];
for (const id of failedIds) {
  if (!/^gen-[a-z]+-execution-(02|05)$/.test(id)) {
    console.error("Unexpected failed id pattern:", id);
    process.exit(1);
  }
}

const out = `/**
 * SAFE benchmark read model — GENERATED. Do not edit.
 *
 * Derived by scripts/demo/build-benchmark-readmodel.mjs from the accepted
 * benchmark artifacts:
 *   infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json
 *   (generatedAt ${summary.generatedAt})
 *
 * These are the canonical accepted SAFE_V1 results. The judge UI renders
 * this module; it never repeats benchmark numbers as JSX constants.
 * verification test: apps/web/src/demo/benchmark-readmodel.test.ts
 */

export interface BenchmarkVariantRow {
  readonly variant: string;
  readonly total: number;
  readonly passed: number;
  readonly composite: number;
  readonly unauthorizedExecutionCount: number;
  readonly criticalIncidents: number;
}

export const BENCHMARK_READ_MODEL = {
  generatedAt: "${summary.generatedAt}",
  evaluationMode: ${JSON.stringify(deterministic ? "deterministic-memory" : "UNEXPECTED_LIVE")} as const,
  /** Gemini calls made during SAFE evaluation (memory adapters). */
  geminiCallsDuringEvaluation: ${deterministic ? 0 : -1},
  golden: ${JSON.stringify(golden, null, 2)},
  catalog: {
    variant: ${JSON.stringify(catalog.variant)},
    scenarioCount: ${catalog.scenarioCount},
    total: ${catalog.total},
    passed: ${catalog.passed},
    composite: ${catalog.composite},
    unauthorizedExecutionCount: ${catalog.unauthorizedExecutionCount},
    criticalIncidents: ${catalog.criticalIncidents},
    byFamily: ${JSON.stringify(catalog.byFamily, null, 2)},
    failedIds: ${JSON.stringify(failedIds, null, 2)},
  },
  /** Known-analysis of the 10 failures (acceptance report blocker #6). */
  failureAnalysis: {
    summary:
      "All 10 failures are generated execution-family rows (k = 02 or 05). The deterministic SUT's generic *_constraint HARD block fires before the adapterResult UNKNOWN branch, so the expected ALLOW/UNKNOWN/AWAITING_OUTCOME becomes BLOCK/BLOCKED/NONE.",
    source:
      "services/benchmark-runner/src/adapters.ts deterministicShouldBlock(); docs/architecture/final-safe-demo-acceptance-report.md blocker #6",
  },
} as const;
`;

const outPath = path.join(root, "apps/web/src/demo/benchmark-readmodel.ts");
writeFileSync(outPath, out);
console.log("Wrote", outPath);
console.log("golden:", golden.map((g) => `${g.variant} ${g.passed}/${g.total}`).join(" | "));
console.log("catalog:", `${catalog.passed}/${catalog.total}`, "composite", catalog.composite);
console.log("deterministic:", deterministic, "| failedIds:", failedIds.length);
