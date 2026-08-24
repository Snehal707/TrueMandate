import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { generateBaseCatalog, goldenCore } from "../generate-catalog.js";
import { SafeScenarioSchema } from "../scenario-schema.js";
import {
  generateStressSuite,
  type StressBucket,
} from "./stress-generator.js";
import {
  contentHash,
  REJECTED_MUTATION_OPS,
  VALID_MUTATION_OPS,
} from "./validity.js";
import { buildHarnessIntegritySuite } from "./harness-integrity.js";

const ALL_BUCKETS: readonly StressBucket[] = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];

describe("stress generator — approved composition", () => {
  const suite = generateStressSuite();
  const { manifest, scenarios } = suite;

  it("emits exactly 267 stress rows across the approved buckets", () => {
    expect(scenarios.length).toBe(267);
    expect(manifest.totalEmitted).toBe(267);
    expect(manifest.totalTarget).toBe(267);
    expect(manifest.buckets.map((b) => [b.bucket, b.emitted])).toEqual([
      ["T2", 79],
      ["T1", 74],
      ["T3", 60],
      ["T4", 23],
      ["T5", 20],
      ["T6", 2],
      ["T7", 9],
    ]);
  });

  it("pins the computed T2 golden compatibility breakdown", () => {
    expect(manifest.t2OpBreakdown).toEqual({
      inject_instruction: 23,
      stale_evidence: 9,
      replay_token: 9,
      split_payment: 9,
      change_prepared_field: 9,
      change_amount: 4,
      change_merchant: 9,
      drop_constraint: 5,
      change_deadline: 2,
    });
    const total = Object.values(manifest.t2OpBreakdown).reduce((a, b) => a + b, 0);
    expect(total).toBe(79);
  });

  it("keeps the 23 goldens and the 233 base catalog byte-identical", () => {
    const catalog = generateBaseCatalog();
    const goldens = goldenCore();
    expect(goldens.length).toBe(23);
    expect(catalog.length).toBe(233);
    expect(manifest.goldenCount).toBe(23);
    expect(manifest.baseCatalogCount).toBe(233);
    expect(manifest.baseCatalogHash).toBe(hashCanonical(catalog));
    // No stress id collides with a base catalog id.
    const baseIds = new Set(catalog.map((s) => s.id));
    for (const s of scenarios) expect(baseIds.has(s.id)).toBe(false);
  });

  it("enforces unique scenario hashes across all 267 rows", () => {
    expect(manifest.uniqueHashCount).toBe(267);
    const hashes = scenarios.map(contentHash);
    expect(new Set(hashes).size).toBe(267);
  });

  it("records the expected rejection ledger (6 T1 substitutions, zero invalid/no-op)", () => {
    for (const b of manifest.buckets) {
      expect(b.rejectedInvalid, `${b.bucket}.rejectedInvalid`).toBe(0);
      expect(b.rejectedNoOp, `${b.bucket}.rejectedNoOp`).toBe(0);
    }
    const t1 = manifest.buckets.find((b) => b.bucket === "T1")!;
    expect(t1.rejectedDuplicate).toBe(6);
    expect(t1.substitutions.length).toBe(6);
    // The six substituted rows are exactly the golden sources shared with T2:
    // 3 benign goldens x inject + 3 outcome goldens x stale.
    const rejectedIds = t1.substitutions.map((s) => s.rejectedScenarioId).sort();
    expect(rejectedIds).toEqual([
      "golden-01-valid-food-grade__mut__inject_instruction",
      "golden-02-valid-lower-cost__mut__inject_instruction",
      "golden-03-valid-certified-supplier__mut__inject_instruction",
      "golden-05-full-delivery__mut__stale_evidence",
      "golden-20-partial-450-500__mut__stale_evidence",
      "golden-21-at-risk-delivery__mut__stale_evidence",
    ]);
  });

  it("reports the generated-context pool size of 924 valid pairs", () => {
    expect(manifest.generatedContextPoolSize).toBe(924);
  });

  it("matches the approved family distribution (hardest families dominate)", () => {
    expect(manifest.familyDistribution).toEqual({
      execution: 102,
      injection: 74,
      authority: 40,
      semantic: 21,
      outcome: 16,
      resolution: 11,
      benign: 3,
    });
  });

  it("assigns the deterministic stress split (27 holdout / 240 development)", () => {
    expect(manifest.holdoutCount).toBe(27);
    expect(manifest.developmentCount).toBe(240);
    expect(manifest.holdoutCount + manifest.developmentCount).toBe(267);
  });

  it("never uses the four SUT-invisible operators", () => {
    const rejected = new Set(REJECTED_MUTATION_OPS.map((r) => r.op));
    for (const s of scenarios) {
      if (s.mutationOperator) expect(rejected.has(s.mutationOperator)).toBe(false);
    }
    expect(VALID_MUTATION_OPS).toHaveLength(9);
  });

  it("is fully deterministic (two runs, identical ids and hashes)", () => {
    const again = generateStressSuite();
    expect(again.scenarios.map((s) => s.id)).toEqual(scenarios.map((s) => s.id));
    expect(again.scenarios.map(contentHash)).toEqual(scenarios.map(contentHash));
    expect(JSON.stringify(again.manifest.bucketIds)).toBe(JSON.stringify(manifest.bucketIds));
  });

  it("emits schema-valid rows with no ground-truth leakage into the SUT input", () => {
    for (const s of scenarios) {
      const parsed = SafeScenarioSchema.parse(s);
      expect(parsed.id).toBe(s.id);
      const env = parsed.environmentPublic ?? {};
      for (const key of ["expectedAuthority", "expectedExecution", "groundTruth", "attackLabel"]) {
        expect(Object.prototype.hasOwnProperty.call(env, key), s.id).toBe(false);
      }
    }
  });

  it("bucket id attribution covers every row exactly once", () => {
    const all = ALL_BUCKETS.flatMap((b) => manifest.bucketIds[b]);
    expect(all).toHaveLength(267);
    expect(new Set(all).size).toBe(267);
    expect(new Set(all)).toEqual(new Set(scenarios.map((s) => s.id)));
  });

  it("harness integrity rows stay fully separate from the product suite", () => {
    const integrity = buildHarnessIntegritySuite();
    expect(integrity.total).toBe(70);
    const productIds = new Set(scenarios.map((s) => s.id));
    for (const row of integrity.rows) {
      expect(productIds.has(row.scenario.id)).toBe(false);
      expect(row.scenario.environmentPublic?.harnessFault).toBeDefined();
    }
    for (const s of scenarios) {
      expect(s.environmentPublic?.harnessFault).toBeUndefined();
    }
  });
});
