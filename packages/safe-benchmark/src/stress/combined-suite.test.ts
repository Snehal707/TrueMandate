import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { generateBaseCatalog, goldenCore } from "../generate-catalog.js";
import { contentHash } from "./validity.js";
import { generateStressSuite } from "./stress-generator.js";
import { buildCombinedSuite } from "./combined-suite.js";
import { buildHarnessIntegritySuite } from "./harness-integrity.js";

describe("combined 500-scenario corpus", () => {
  const suite = buildCombinedSuite();
  const { manifest, scenarios } = suite;

  it("is exactly 233 unchanged base + 267 accepted stress = 500", () => {
    expect(scenarios.length).toBe(500);
    expect(manifest.total).toBe(500);
    expect(manifest.baseCatalogCount).toBe(233);
    expect(manifest.stressCount).toBe(267);
    expect(manifest.goldenCount).toBe(23);

    const catalog = generateBaseCatalog();
    const stress = generateStressSuite();
    // byte-identity of the base: same ids, same content hashes, same order prefix
    expect(scenarios.slice(0, 233).map((s) => s.id)).toEqual(catalog.map((s) => s.id));
    expect(JSON.stringify(scenarios.slice(0, 233))).toBe(JSON.stringify(catalog));
    expect(scenarios.slice(233).map((s) => s.id)).toEqual(stress.scenarios.map((s) => s.id));
  });

  it("pins the base catalog hash and golden count to the accepted fixtures", () => {
    expect(manifest.baseCatalogHash).toBe(hashCanonical(generateBaseCatalog()));
    expect(goldenCore().length).toBe(23);
  });

  it("carries 500 unique scenario hashes", () => {
    expect(manifest.scenarioHashes).toHaveLength(500);
    expect(manifest.uniqueHashCount).toBe(500);
    const hashes = scenarios.map(contentHash);
    expect(JSON.stringify(hashes)).toBe(JSON.stringify(manifest.scenarioHashes));
  });

  it("the combined manifest hash covers every manifest field except itself", () => {
    const { combinedManifestHash, ...rest } = manifest;
    expect(combinedManifestHash).toBe(hashCanonical(rest));
  });

  it("is fully deterministic across generations", () => {
    const again = buildCombinedSuite();
    expect(again.manifest.combinedManifestHash).toBe(manifest.combinedManifestHash);
    expect(again.manifest.stressManifestHash).toBe(manifest.stressManifestHash);
    expect(JSON.stringify(again.manifest.scenarioHashes)).toBe(JSON.stringify(manifest.scenarioHashes));
  });

  it("keeps harness-integrity rows fully separate (never in the 500)", () => {
    const integrity = buildHarnessIntegritySuite();
    expect(integrity.total).toBe(70);
    const productIds = new Set(scenarios.map((s) => s.id));
    for (const row of integrity.rows) expect(productIds.has(row.scenario.id)).toBe(false);
    for (const s of scenarios) expect(s.environmentPublic?.harnessFault).toBeUndefined();
  });

  it("records the full family distribution in the manifest", () => {
    const fromScenarios: Record<string, number> = {};
    for (const s of scenarios) fromScenarios[s.family] = (fromScenarios[s.family] ?? 0) + 1;
    expect(manifest.familyDistribution).toEqual(fromScenarios);
    const total = Object.values(manifest.familyDistribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(500);
  });
});
