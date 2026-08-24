import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBaseCatalog, goldenCore } from "./generate-catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(root, "evals/safe/v1");

function main(): void {
  const catalog = generateBaseCatalog();
  const golden = goldenCore();
  const goldenDir = path.join(outDir, "golden");
  mkdirSync(goldenDir, { recursive: true });
  mkdirSync(path.join(outDir, "development"), { recursive: true });
  mkdirSync(path.join(outDir, "validation"), { recursive: true });
  mkdirSync(path.join(outDir, "holdout"), { recursive: true });
  mkdirSync(path.join(outDir, "generated"), { recursive: true });

  for (const s of golden) {
    writeFileSync(
      path.join(goldenDir, `${s.id}.json`),
      `${JSON.stringify(s, null, 2)}\n`,
      "utf8",
    );
  }

  const bySplit = {
    golden: golden.length,
    development: catalog.filter((s) => s.split === "development").length,
    validation: catalog.filter((s) => s.split === "validation").length,
    holdout: catalog.filter((s) => s.split === "holdout").length,
  };

  const domains = [...new Set(catalog.map((s) => s.domain))];
  const families = [...new Set(catalog.map((s) => s.family))];

  writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(
      {
        version: "SAFE_V1",
        totalBaseScenarios: catalog.length,
        goldenCount: golden.length,
        splits: bySplit,
        domains,
        families,
        note: ">=1000 mutated variants proven in-memory by tests; golden JSON on disk.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `Wrote ${golden.length} golden scenarios and manifest (${catalog.length} base catalog).`,
  );
}

main();
