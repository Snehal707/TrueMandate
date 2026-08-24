import {
  GroundTruthEvaluator,
  MetricCollector,
  type EvaluationResult,
  type SafeScenario,
  type SafeV1MetricsReport,
  type SutResult,
  SystemVariant,
} from "@truemandate/safe-benchmark";
import { createSut } from "./adapters.js";

export interface ScenarioRunOutput {
  readonly scenario: SafeScenario;
  readonly result: SutResult;
  readonly evaluation: EvaluationResult;
}

export class ScenarioRunner {
  private readonly evaluator = new GroundTruthEvaluator();

  async run(
    scenario: SafeScenario,
    variant: SystemVariant,
  ): Promise<ScenarioRunOutput> {
    const sut = createSut(variant);
    const started = Date.now();
    const result = await sut.run(scenario);
    const withLatency: SutResult = {
      ...result,
      latencyMs: Date.now() - started,
    };
    const evaluation = this.evaluator.evaluate(scenario, withLatency);
    return { scenario, result: withLatency, evaluation };
  }

  async runAll(
    scenarios: readonly SafeScenario[],
    variant: SystemVariant,
  ): Promise<{
    readonly runs: ScenarioRunOutput[];
    readonly metrics: SafeV1MetricsReport;
  }> {
    const collector = new MetricCollector();
    const runs: ScenarioRunOutput[] = [];
    for (const scenario of scenarios) {
      const out = await this.run(scenario, variant);
      runs.push(out);
      collector.add(out);
    }
    return { runs, metrics: collector.compute() };
  }
}
