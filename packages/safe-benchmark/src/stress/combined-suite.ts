import { hashCanonical } from "@truemandate/crypto";
import { generateBaseCatalog, goldenCore } from "../generate-catalog.js";
import type { SafeScenario } from "../scenario-schema.js";
import { contentHash } from "./validity.js";
import { generateStressSuite } from "./stress-generator.js";

/**
 * Combined 500-scenario product corpus — deterministic manifest over:
 *   233 base catalog scenarios (23 goldens + 210 generated; BYTE-IDENTICAL
 *   to the accepted SAFE_V1 fixtures — regenerated labels are never edited)
 * + 267 accepted stress scenarios (the generation-guarded stress layer)
 * = 500 unique product scenarios.
 *
 * The 70 harness-integrity rows remain a SEPARATE suite and are never
 * counted here. All 500 rows carry unique canonical content hashes.
 */

export interface CombinedManifest {
  readonly schema: "TRUEMANDATE_COMBINED_MANIFEST_V1";
  readonly generatorVersion: "1.0.0";
  readonly baseCatalogCount: 233;
  readonly baseCatalogHash: string;
  readonly goldenCount: 23;
  readonly stressCount: 267;
  readonly stressManifestHash: string;
  readonly total: 500;
  /** Content hashes in scenario order (identity fields; see validity.ts). */
  readonly scenarioHashes: readonly string[];
  readonly uniqueHashCount: number;
  readonly familyDistribution: Readonly<Record<string, number>>;
  /** Hash over every manifest field EXCEPT this one. */
  readonly combinedManifestHash: string;
}

export interface CombinedSuite {
  readonly scenarios: readonly SafeScenario[];
  readonly baseScenarios: readonly SafeScenario[];
  readonly stressScenarios: readonly SafeScenario[];
  readonly manifest: CombinedManifest;
}

export function buildCombinedSuite(): CombinedSuite {
  const catalog = generateBaseCatalog();
  const goldens = goldenCore();
  if (catalog.length !== 233) throw new Error(`base catalog drifted: ${catalog.length}`);
  if (goldens.length !== 23) throw new Error(`golden core drifted: ${goldens.length}`);

  const stress = generateStressSuite();
  if (stress.scenarios.length !== 267) throw new Error(`stress layer drifted: ${stress.scenarios.length}`);

  const baseCatalogHash = hashCanonical(catalog) as string;
  const stressManifestHash = hashCanonical(stress.manifest) as string;

  const scenarios = [...catalog, ...stress.scenarios];
  if (scenarios.length !== 500) throw new Error(`combined corpus drifted: ${scenarios.length}`);

  const scenarioHashes = scenarios.map(contentHash);
  const uniqueHashCount = new Set(scenarioHashes).size;
  if (uniqueHashCount !== 500) {
    throw new Error(
      `combined corpus hash collision: 500 rows but ${uniqueHashCount} unique hashes`,
    );
  }

  const familyDistribution: Record<string, number> = {};
  for (const s of scenarios) {
    familyDistribution[s.family] = (familyDistribution[s.family] ?? 0) + 1;
  }

  const combinedManifestHash = hashCanonical({
    schema: "TRUEMANDATE_COMBINED_MANIFEST_V1",
    generatorVersion: "1.0.0",
    baseCatalogCount: 233,
    baseCatalogHash,
    goldenCount: 23,
    stressCount: 267,
    stressManifestHash,
    total: 500,
    scenarioHashes,
    uniqueHashCount,
    familyDistribution,
  }) as string;

  const manifest: CombinedManifest = {
    schema: "TRUEMANDATE_COMBINED_MANIFEST_V1",
    generatorVersion: "1.0.0",
    baseCatalogCount: 233,
    baseCatalogHash,
    goldenCount: 23,
    stressCount: 267,
    stressManifestHash,
    total: 500,
    scenarioHashes,
    uniqueHashCount,
    familyDistribution,
    combinedManifestHash,
  };

  return {
    scenarios,
    baseScenarios: catalog,
    stressScenarios: [...stress.scenarios],
    manifest,
  };
}
