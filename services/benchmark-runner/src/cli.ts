import {
  generateBaseCatalog,
  goldenCore,
  ScenarioRegistry,
  SystemVariant,
} from "@truemandate/safe-benchmark";
import { writeArtifacts, defaultArtifactsDir } from "./artifacts.js";
import { ScenarioRunner } from "./runner.js";

function parseArgs(argv: string[]): {
  golden: boolean;
  scenarioId?: string;
  variant: SystemVariant;
  write: boolean;
} {
  let golden = false;
  let scenarioId: string | undefined;
  let variant = SystemVariant.TRUEMANDATE_FULL;
  let write = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--golden") golden = true;
    else if (a === "--scenario") scenarioId = argv[++i];
    else if (a === "--variant") {
      const v = argv[++i];
      if (!v || !(Object.values(SystemVariant) as string[]).includes(v)) {
        throw new Error(`Unknown variant: ${v}`);
      }
      variant = v as SystemVariant;
    } else if (a === "--no-write") write = false;
  }
  return { golden, scenarioId, variant, write };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const registry = new ScenarioRegistry(generateBaseCatalog());
  let scenarios = args.golden
    ? registry.list({ split: "golden" })
    : args.scenarioId
      ? []
      : registry.list({ split: "development" }).slice(0, 50);

  if (args.scenarioId) {
    const one = registry.get(args.scenarioId);
    if (!one) {
      console.error(`Scenario not found: ${args.scenarioId}`);
      return 1;
    }
    scenarios = [one];
  }
  if (args.golden && scenarios.length === 0) {
    scenarios = goldenCore();
  }

  const runner = new ScenarioRunner();
  const { runs, metrics } = await runner.runAll(scenarios, args.variant);

  console.log(
    JSON.stringify(
      {
        variant: args.variant,
        total: metrics.totalScenarios,
        passed: metrics.passedScenarios,
        composite: metrics.composite,
        version: metrics.version,
        criticalIncidents: metrics.criticalIncidents,
        unauthorizedExecutionCount: metrics.unauthorizedExecutionCount,
      },
      null,
      2,
    ),
  );

  if (args.write) {
    const paths = writeArtifacts({
      outDir: defaultArtifactsDir(),
      variant: args.variant,
      runs,
      metrics,
    });
    console.log(`artifacts: ${paths.manifestPath}`);
  }

  const unauthorizedOnBlock = runs.filter(
    (r) =>
      r.scenario.expectedAuthority === "BLOCK" &&
      r.evaluation.unauthorizedExecution,
  );
  if (
    args.variant === SystemVariant.TRUEMANDATE_FULL &&
    unauthorizedOnBlock.length > 0
  ) {
    console.error(
      `TRUEMANDATE_FULL unauthorized T2 on BLOCK: ${unauthorizedOnBlock
        .map((r) => r.scenario.id)
        .join(", ")}`,
    );
    return 1;
  }
  return 0;
}

const isDirect =
  process.argv[1] !== undefined &&
  /benchmark-runner[\\/]+src[\\/]+cli\.(ts|js)$/.test(process.argv[1]);

if (isDirect) {
  main().then((code) => {
    process.exitCode = code;
  });
}
