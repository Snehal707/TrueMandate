/**
 * SAFE V1 acceptance: golden for all five variants + full 233-case catalog for TRUEMANDATE_FULL.
 */
import {
  generateBaseCatalog,
  goldenCore,
  ScenarioRegistry,
  SystemVariant,
} from "@truemandate/safe-benchmark";
import fs from "node:fs";
import path from "node:path";
import { writeArtifacts, defaultArtifactsDir } from "./artifacts.js";
import { ScenarioRunner } from "./runner.js";

const variants = [
  SystemVariant.BASELINE_SINGLE_AGENT,
  SystemVariant.BASELINE_MULTI_AGENT,
  SystemVariant.GUARDIAN_ONLY,
  SystemVariant.DETERMINISTIC_CORE,
  SystemVariant.TRUEMANDATE_FULL,
];

const outDir = defaultArtifactsDir();
fs.mkdirSync(outDir, { recursive: true });
const runner = new ScenarioRunner();
const registry = new ScenarioRegistry(generateBaseCatalog());
const golden = registry.list({ split: "golden" });
const goldenScenarios = golden.length > 0 ? golden : goldenCore();
const catalog = generateBaseCatalog();

function summarizeRuns(variant: string, scenarios: unknown[], runs: any[], metrics: any) {
  const byFamily: Record<string, { total: number; passed: number; unauthorized: number }> = {};
  for (const r of runs) {
    const fam = r.scenario.family || r.scenario.attackFamily || "unknown";
    byFamily[fam] = byFamily[fam] || { total: 0, passed: 0, unauthorized: 0 };
    byFamily[fam].total++;
    if (r.evaluation.passed) byFamily[fam].passed++;
    if (r.evaluation.unauthorizedExecution) byFamily[fam].unauthorized++;
  }

  const unauthorizedOnBlock = runs.filter(
    (r) =>
      r.scenario.expectedAuthority === "BLOCK" &&
      r.evaluation.unauthorizedExecution,
  );

  return {
    variant,
    scenarioCount: scenarios.length,
    total: metrics.totalScenarios,
    passed: metrics.passedScenarios,
    composite: metrics.composite,
    version: metrics.version,
    criticalIncidents: metrics.criticalIncidents,
    unauthorizedExecutionCount: metrics.unauthorizedExecutionCount,
    IntentFidelity: metrics.IntentFidelity,
    GovernanceSafety: metrics.GovernanceSafety,
    AttackResistance: metrics.AttackResistance,
    OutcomeReliability: metrics.OutcomeReliability,
    RecoveryCapability: metrics.RecoveryCapability,
    UsefulAutonomy: metrics.UsefulAutonomy,
    OperationalEfficiency: metrics.OperationalEfficiency,
    byFamily,
    unauthorizedOnBlockIds: unauthorizedOnBlock.map((r) => r.scenario.id),
    failedIds: runs.filter((r) => !r.evaluation.passed).map((r) => r.scenario.id).slice(0, 80),
  };
}

const summary: any = {
  generatedAt: new Date().toISOString(),
  goldenByVariant: {},
  catalogFull: null,
};

for (const variant of variants) {
  const { runs, metrics } = await runner.runAll(goldenScenarios, variant);
  const s = summarizeRuns(variant, goldenScenarios, runs, metrics);
  summary.goldenByVariant[variant] = s;
  writeArtifacts({ outDir, variant: `${variant}_golden`, runs, metrics });
  console.log("GOLDEN", variant, s.passed, "/", s.total, "composite", s.composite);
}

{
  const { runs, metrics } = await runner.runAll(catalog, SystemVariant.TRUEMANDATE_FULL);
  const s = summarizeRuns(SystemVariant.TRUEMANDATE_FULL, catalog, runs, metrics);
  summary.catalogFull = s;
  writeArtifacts({
    outDir,
    variant: "TRUEMANDATE_FULL_catalog233",
    runs,
    metrics,
  });
  console.log("CATALOG233", s.passed, "/", s.total, "composite", s.composite);
}

const summaryPath = path.resolve(
  "c:/Users/ASUS/TrueMandate/infrastructure/terraform/stages/runtime/_safe-v1-acceptance-summary.json",
);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log("SUMMARY", summaryPath);
