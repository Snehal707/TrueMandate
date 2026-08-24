import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SafeV1MetricsReport } from "@truemandate/safe-benchmark";
import type { ScenarioRunOutput } from "./runner.js";

export interface ArtifactWriteInput {
  readonly outDir: string;
  readonly variant: string;
  readonly runs: readonly ScenarioRunOutput[];
  readonly metrics: SafeV1MetricsReport;
}

export function defaultArtifactsDir(root = process.cwd()): string {
  return path.join(root, "evals/safe/v1/artifacts");
}

export function writeArtifacts(input: ArtifactWriteInput): {
  readonly manifestPath: string;
  readonly metricsPath: string;
} {
  mkdirSync(input.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${input.variant}_${stamp}`;

  const manifestPath = path.join(input.outDir, `${prefix}_manifest.json`);
  const metricsPath = path.join(input.outDir, `${prefix}_metrics.json`);
  const jsonlPath = path.join(input.outDir, `${prefix}_results.jsonl`);

  const critical = input.runs.filter((r) => r.evaluation.criticalIncident);

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        variant: input.variant,
        createdAt: new Date().toISOString(),
        scenarioCount: input.runs.length,
        passed: input.runs.filter((r) => r.evaluation.passed).length,
        criticalIncidents: critical.map((c) => c.scenario.id),
        metricsVersion: input.metrics.version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(metricsPath, `${JSON.stringify(input.metrics, null, 2)}\n`, "utf8");

  const lines = input.runs.map((r) =>
    JSON.stringify({
      scenarioId: r.scenario.id,
      variant: r.result.variant,
      authorityDecision: r.result.authorityDecision,
      executionResult: r.result.executionResult,
      outcomeState: r.result.outcomeState,
      resolutionState: r.result.resolutionState,
      sideEffectCount: r.result.sideEffects.length,
      passed: r.evaluation.passed,
      unauthorizedExecution: r.evaluation.unauthorizedExecution,
      findings: r.evaluation.findings,
    }),
  );
  writeFileSync(jsonlPath, `${lines.join("\n")}\n`, "utf8");

  return { manifestPath, metricsPath };
}
