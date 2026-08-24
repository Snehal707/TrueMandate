import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCombinedSuite,
  buildHarnessIntegritySuite,
  generateStressSuite,
  GroundTruthEvaluator,
  MetricCollector,
  SystemVariant,
  type StressBucket,
  type StressManifest,
} from "@truemandate/safe-benchmark";
import { ScenarioRunner } from "./runner.js";

/**
 * Deterministic 500-suite runner.
 *
 *   node dist/stress-cli.js            -> product stress run (267 x 2 SUTs)
 *   node dist/stress-cli.js --integrity -> harness integrity run (70 rows)
 *
 * Writes IMMUTABLE timestamped artifacts under evals/safe/v1/stress/ (flag
 * "wx" — a file is never overwritten; reruns produce a new stamped set).
 * Never touches evals/safe/v1/artifacts/ (the accepted 23/233 results) nor
 * the SAFE_V1 acceptance summary. Zero model calls: deterministic SUTs only.
 */

export interface StressRunLine {
  readonly scenarioId: string;
  readonly bucket: StressBucket;
  readonly variant: string;
  readonly authorityDecision: string;
  readonly executionResult: string;
  readonly outcomeState: string;
  readonly resolutionState: string;
  readonly passed: boolean;
  readonly unauthorizedExecution: boolean;
  readonly findings: readonly string[];
}

interface FailureGroup {
  readonly bucket: StressBucket;
  readonly code: string;
  readonly scenarioIds: string[];
}

export interface StressSummary {
  readonly schema: "TRUEMANDATE_STRESS_SUMMARY_V1";
  readonly runId: string;
  readonly createdAt: string;
  readonly kind: "product" | "integrity";
  readonly variants: readonly {
    readonly variant: string;
    readonly total: number;
    readonly passed: number;
    readonly composite: number;
    readonly criticalIncidents: number;
    readonly unauthorizedExecutionCount: number;
  }[];
  readonly bucketRollup: readonly {
    readonly bucket: StressBucket;
    readonly variant: string;
    readonly total: number;
    readonly passed: number;
  }[];
  readonly failureGroups: readonly FailureGroup[];
}

export function defaultStressArtifactsDir(root = process.cwd()): string {
  return path.join(root, "evals/safe/v1/stress");
}

function bucketOf(manifest: StressManifest, scenarioId: string): StressBucket {
  for (const b of manifest.buckets) {
    if ((manifest.bucketIds[b.bucket] as readonly string[]).includes(scenarioId)) {
      return b.bucket;
    }
  }
  throw new Error(`scenario ${scenarioId} not attributed to any bucket`);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeImmutable(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
}

export async function runProduct(outDir: string): Promise<number> {
  const suite = generateStressSuite();
  const { manifest, scenarios } = suite;
  const runner = new ScenarioRunner();

  const variants = [SystemVariant.TRUEMANDATE_FULL, SystemVariant.BASELINE_SINGLE_AGENT] as const;
  const allLines: StressRunLine[] = [];
  const variantReports: { variant: string; total: number; passed: number; composite: number; criticalIncidents: number; unauthorizedExecutionCount: number }[] = [];
  const bucketRollup: { bucket: StressBucket; variant: string; total: number; passed: number }[] = [];
  const failureGroups: FailureGroup[] = [];

  for (const variant of variants) {
    const collector = new MetricCollector();
    for (const scenario of scenarios) {
      const out = await runner.run(scenario, variant);
      collector.add(out);
      allLines.push({
        scenarioId: scenario.id,
        bucket: bucketOf(manifest, scenario.id),
        variant: variant,
        authorityDecision: out.result.authorityDecision,
        executionResult: out.result.executionResult,
        outcomeState: out.result.outcomeState,
        resolutionState: out.result.resolutionState,
        passed: out.evaluation.passed,
        unauthorizedExecution: out.evaluation.unauthorizedExecution,
        findings: out.evaluation.findings.map((f) => f.code),
      });
    }
    const metrics = collector.compute();
    variantReports.push({
      variant,
      total: metrics.totalScenarios,
      passed: metrics.passedScenarios,
      composite: metrics.composite,
      criticalIncidents: metrics.criticalIncidents,
      unauthorizedExecutionCount: metrics.unauthorizedExecutionCount,
    });

    for (const bucket of manifest.buckets) {
      const ids = manifest.bucketIds[bucket.bucket];
      const lines = allLines.filter(
        (l) => l.variant === variant && ids.includes(l.scenarioId),
      );
      bucketRollup.push({
        bucket: bucket.bucket,
        variant,
        total: lines.length,
        passed: lines.filter((l) => l.passed).length,
      });
    }
  }

  // Failure taxonomy for TRUEMANDATE_FULL (the system under submission).
  for (const line of allLines.filter((l) => l.variant === SystemVariant.TRUEMANDATE_FULL && !l.passed)) {
    for (const code of line.findings) {
      let group = failureGroups.find((g) => g.bucket === line.bucket && g.code === code);
      if (!group) {
        group = { bucket: line.bucket, code, scenarioIds: [] };
        failureGroups.push(group);
      }
      group.scenarioIds.push(line.scenarioId);
    }
  }

  const runId = stamp();
  const createdAt = new Date().toISOString();
  const manifestPath = path.join(outDir, `stress-manifest_${runId}.json`);
  const resultsPath = path.join(outDir, `stress-results_${runId}.jsonl`);
  const summaryPath = path.join(outDir, `stress-summary_${runId}.json`);

  writeImmutable(
    manifestPath,
    `${JSON.stringify(
      { ...manifest, runId, createdAt, runner: "benchmark-runner stress-cli" },
      null,
      2,
    )}\n`,
  );
  writeImmutable(
    resultsPath,
    `${allLines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
  writeImmutable(
    summaryPath,
    `${JSON.stringify(
      {
        schema: "TRUEMANDATE_STRESS_SUMMARY_V1",
        runId,
        createdAt,
        kind: "product",
        variants: variantReports,
        bucketRollup,
        failureGroups,
      } satisfies StressSummary,
      null,
      2,
    )}\n`,
  );

  const tm = variantReports.find((v) => v.variant === SystemVariant.TRUEMANDATE_FULL)!;
  const base = variantReports.find((v) => v.variant === SystemVariant.BASELINE_SINGLE_AGENT)!;
  console.log(
    JSON.stringify(
      {
        runId,
        productScenarios: scenarios.length,
        uniqueHashes: manifest.uniqueHashCount,
        baseCatalogHash: manifest.baseCatalogHash.slice(0, 16),
        TRUEMANDATE_FULL: tm,
        BASELINE_SINGLE_AGENT: base,
        artifacts: { manifestPath, resultsPath, summaryPath },
      },
      null,
      2,
    ),
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Combined 500-scenario run (233 base + 267 stress, one corpus, one artifact)
// ---------------------------------------------------------------------------
export interface CombinedFailedScenario {
  readonly scenarioId: string;
  readonly family: string;
  readonly origin: "base" | "stress";
  readonly reasons: readonly string[];
}

export interface CombinedVariantReport {
  readonly variant: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly composite: number;
  readonly criticalIncidentCount: number;
  readonly unauthorizedExecutionCount: number;
  readonly perFamily: readonly {
    readonly family: string;
    readonly total: number;
    readonly passed: number;
    readonly unauthorizedExecutionCount: number;
    readonly criticalIncidents: number;
  }[];
  readonly failedScenarios: readonly CombinedFailedScenario[];
}

export async function runCombined(outDir: string): Promise<number> {
  const suite = buildCombinedSuite();
  const { scenarios, manifest } = suite;
  const runner = new ScenarioRunner();

  // Origin attribution: stress manifest bucketIds cover exactly the 267 stress rows.
  const stressIds = new Set<string>();
  const stressSuite = generateStressSuite();
  for (const bucket of stressSuite.manifest.buckets) {
    for (const id of stressSuite.manifest.bucketIds[bucket.bucket]) stressIds.add(id);
  }

  const variants = [SystemVariant.TRUEMANDATE_FULL, SystemVariant.BASELINE_SINGLE_AGENT] as const;
  const variantReports: CombinedVariantReport[] = [];
  const allLines: {
    scenarioId: string;
    origin: "base" | "stress";
    variant: string;
    authorityDecision: string;
    executionResult: string;
    outcomeState: string;
    resolutionState: string;
    passed: boolean;
    findings: readonly string[];
  }[] = [];

  for (const variant of variants) {
    const collector = new MetricCollector();
    const failedScenarios: CombinedFailedScenario[] = [];
    const perFamilyMap = new Map<
      string,
      { total: number; passed: number; unauthorizedExecutionCount: number; criticalIncidents: number }
    >();

    for (const scenario of scenarios) {
      const out = await runner.run(scenario, variant);
      collector.add(out);
      const origin: "base" | "stress" = stressIds.has(scenario.id) ? "stress" : "base";
      allLines.push({
        scenarioId: scenario.id,
        origin,
        variant,
        authorityDecision: out.result.authorityDecision,
        executionResult: out.result.executionResult,
        outcomeState: out.result.outcomeState,
        resolutionState: out.result.resolutionState,
        passed: out.evaluation.passed,
        findings: out.evaluation.findings.map((f) => f.code),
      });

      const fam = perFamilyMap.get(scenario.family) ?? {
        total: 0,
        passed: 0,
        unauthorizedExecutionCount: 0,
        criticalIncidents: 0,
      };
      fam.total += 1;
      if (out.evaluation.passed) fam.passed += 1;
      if (out.evaluation.unauthorizedExecution) fam.unauthorizedExecutionCount += 1;
      if (out.evaluation.criticalIncident) fam.criticalIncidents += 1;
      perFamilyMap.set(scenario.family, fam);

      if (!out.evaluation.passed) {
        failedScenarios.push({
          scenarioId: scenario.id,
          family: scenario.family,
          origin,
          reasons: out.evaluation.findings.map((f) => `${f.code}: ${f.message}`),
        });
      }
    }

    const metrics = collector.compute();
    variantReports.push({
      variant,
      total: metrics.totalScenarios,
      passed: metrics.passedScenarios,
      failed: metrics.totalScenarios - metrics.passedScenarios,
      composite: metrics.composite,
      criticalIncidentCount: metrics.criticalIncidents,
      unauthorizedExecutionCount: metrics.unauthorizedExecutionCount,
      perFamily: [...perFamilyMap.entries()]
        .map(([family, v]) => ({ family, ...v }))
        .sort((a, b) => a.family.localeCompare(b.family)),
      failedScenarios,
    });
  }

  const runId = stamp();
  const createdAt = new Date().toISOString();
  const outRoot = path.join(outDir, "combined");
  mkdirSync(outRoot, { recursive: true });
  const manifestPath = path.join(outRoot, `combined-manifest_${runId}.json`);
  const resultsPath = path.join(outRoot, `combined-results_${runId}.json`);
  const jsonlPath = path.join(outRoot, `combined-results_${runId}.jsonl`);

  writeImmutable(manifestPath, `${JSON.stringify({ ...manifest, runId, createdAt }, null, 2)}\n`);
  writeImmutable(
    resultsPath,
    `${JSON.stringify(
      {
        schema: "TRUEMANDATE_COMBINED_RESULTS_V1",
        runId,
        createdAt,
        generatorVersion: manifest.generatorVersion,
        total: manifest.total,
        uniqueHashCount: manifest.uniqueHashCount,
        baseCatalogHash: manifest.baseCatalogHash,
        stressManifestHash: manifest.stressManifestHash,
        combinedManifestHash: manifest.combinedManifestHash,
        familyDistribution: manifest.familyDistribution,
        variants: variantReports,
      },
      null,
      2,
    )}\n`,
  );
  writeImmutable(jsonlPath, `${allLines.map((l) => JSON.stringify(l)).join("\n")}\n`);

  const tm = variantReports.find((v) => v.variant === SystemVariant.TRUEMANDATE_FULL)!;
  const base = variantReports.find((v) => v.variant === SystemVariant.BASELINE_SINGLE_AGENT)!;
  console.log(
    JSON.stringify(
      {
        runId,
        total: manifest.total,
        uniqueHashes: manifest.uniqueHashCount,
        baseCatalogHash: manifest.baseCatalogHash.slice(0, 16),
        stressManifestHash: manifest.stressManifestHash.slice(0, 16),
        combinedManifestHash: manifest.combinedManifestHash.slice(0, 16),
        TRUEMANDATE_FULL: {
          total: tm.total,
          passed: tm.passed,
          failed: tm.failed,
          composite: tm.composite,
          criticalIncidentCount: tm.criticalIncidentCount,
          unauthorizedExecutionCount: tm.unauthorizedExecutionCount,
        },
        BASELINE_SINGLE_AGENT: {
          total: base.total,
          passed: base.passed,
          failed: base.failed,
          composite: base.composite,
          criticalIncidentCount: base.criticalIncidentCount,
          unauthorizedExecutionCount: base.unauthorizedExecutionCount,
        },
        artifacts: { manifestPath, resultsPath, jsonlPath },
      },
      null,
      2,
    ),
  );
  return 0;
}

export async function runIntegrity(outDir: string): Promise<number> {
  const { rows, total } = buildHarnessIntegritySuite();
  const runner = new ScenarioRunner();
  const evaluator = new GroundTruthEvaluator();
  const perFault = new Map<string, { detected: number; total: number }>();
  const lines: {
    scenarioId: string;
    fault: string;
    detected: boolean;
    details: string;
  }[] = [];
  let detectedTotal = 0;

  for (const { scenario, expectation } of rows) {
    const out = await runner.run(scenario, SystemVariant.TRUEMANDATE_FULL);
    const checks: { name: string; ok: boolean }[] = [
      {
        name: "authority",
        ok: out.result.authorityDecision === expectation.expectedAuthority,
      },
      ...(expectation.expectedOutcomeState
        ? [
            {
              name: "outcomeState",
              ok: out.result.outcomeState === expectation.expectedOutcomeState,
            },
          ]
        : []),
      ...(expectation.expectedResponsibilityState
        ? [
            {
              name: "responsibilityState",
              ok:
                out.result.responsibilityState === expectation.expectedResponsibilityState,
            },
          ]
        : []),
      ...(expectation.expectedFlag === "paymentOutcomeFalseCompletion"
        ? [
            {
              name: "paymentOutcomeFalseCompletion",
              ok:
                evaluator.evaluate(scenario, out.result).paymentOutcomeFalseCompletion ===
                expectation.expectedFlagValue,
            },
          ]
        : []),
    ];
    const detected = checks.every((c) => c.ok);
    if (detected) detectedTotal += 1;
    const entry = perFault.get(expectation.fault) ?? { detected: 0, total: 0 };
    entry.total += 1;
    if (detected) entry.detected += 1;
    perFault.set(expectation.fault, entry);
    lines.push({
      scenarioId: scenario.id,
      fault: expectation.fault,
      detected,
      details: checks.map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`).join(" "),
    });
  }

  const runId = stamp();
  const createdAt = new Date().toISOString();
  const resultsPath = path.join(outDir, `integrity-results_${runId}.jsonl`);
  const summaryPath = path.join(outDir, `integrity-summary_${runId}.json`);
  writeImmutable(resultsPath, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const summary = {
    schema: "TRUEMANDATE_STRESS_SUMMARY_V1",
    runId,
    createdAt,
    kind: "integrity",
    total,
    detected: detectedTotal,
    perFault: Object.fromEntries(perFault),
    artifacts: { resultsPath, summaryPath },
  };
  writeImmutable(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return detectedTotal === total ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const integrity = argv.includes("--integrity");
  const combined = argv.includes("--combined");
  const outDir = defaultStressArtifactsDir();
  mkdirSync(outDir, { recursive: true });
  if (combined) return runCombined(outDir);
  return integrity ? runIntegrity(outDir) : runProduct(outDir);
}

const isDirect =
  process.argv[1] !== undefined &&
  /benchmark-runner[\\/]+(?:src|dist)[\\/]+stress-cli\.(ts|js)$/.test(process.argv[1]);

if (isDirect) {
  main().then((code) => {
    process.exitCode = code;
  });
}
