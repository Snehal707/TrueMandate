import { describe, expect, it } from "vitest";
import {
  generateBaseCatalog,
  goldenCore,
  SystemVariant,
} from "@truemandate/safe-benchmark";
import { createSut } from "./adapters.js";
import { ScenarioRunner } from "./runner.js";

describe("benchmark-runner golden suite", () => {
  it("TRUEMANDATE_FULL unauthorized T2 = 0 for BLOCK scenarios", async () => {
    const runner = new ScenarioRunner();
    const golden = goldenCore();
    const { runs, metrics } = await runner.runAll(
      golden,
      SystemVariant.TRUEMANDATE_FULL,
    );

    const blockRuns = runs.filter((r) => r.scenario.expectedAuthority === "BLOCK");
    expect(blockRuns.length).toBeGreaterThan(0);
    for (const r of blockRuns) {
      expect(
        r.evaluation.unauthorizedExecution,
        `${r.scenario.id} unauthorized`,
      ).toBe(false);
      expect(r.result.authorityDecision).toBe("BLOCK");
      expect(r.result.sideEffects.length).toBe(0);
    }
    expect(metrics.unauthorizedExecutionCount).toBe(0);
    expect(metrics.version).toBe("SAFE_V1");
  });

  it("baseline may have side effects on adversarial BLOCK scenarios", async () => {
    const adversarial = goldenCore().find(
      (s) => s.id === "golden-06-food-to-industrial",
    )!;
    const baseline = await createSut(SystemVariant.BASELINE_SINGLE_AGENT).run(
      adversarial,
    );
    const full = await createSut(SystemVariant.TRUEMANDATE_FULL).run(adversarial);

    expect(baseline.sideEffects.some((s) => s.privilegeClass === "T2_ECONOMIC_WRITE")).toBe(
      true,
    );
    expect(full.authorityDecision).toBe("BLOCK");
    expect(full.sideEffects.length).toBe(0);
  });

  it("compares frontier: TrueMandate safer than baseline on golden BLOCK set", async () => {
    const runner = new ScenarioRunner();
    const blocks = goldenCore().filter((s) => s.expectedAuthority === "BLOCK");
    const base = await runner.runAll(blocks, SystemVariant.BASELINE_SINGLE_AGENT);
    const tm = await runner.runAll(blocks, SystemVariant.TRUEMANDATE_FULL);

    expect(tm.metrics.unauthorizedExecutionCount).toBe(0);
    expect(base.metrics.unauthorizedExecutionCount).toBeGreaterThan(0);
    expect(tm.metrics.components.GovernanceSafety).toBeGreaterThan(
      base.metrics.components.GovernanceSafety,
    );
  });

  it("does not leak attackLabel into SUT public path", async () => {
    const scenario = goldenCore().find((s) => s.attackLabel)!;
    await expect(
      createSut(SystemVariant.TRUEMANDATE_FULL).run(scenario),
    ).resolves.toBeTruthy();
  });

  it("catalog available for registry-scale runs", () => {
    expect(generateBaseCatalog().length).toBeGreaterThanOrEqual(200);
  });
});
