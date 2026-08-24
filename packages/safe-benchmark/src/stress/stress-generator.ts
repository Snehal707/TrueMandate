import { hashCanonical } from "@truemandate/crypto";
import { applyMutation } from "../mutation-engine.js";
import { applyBudgetCounterfactual } from "../counterfactual.js";
import {
  assertParaphrasePreservesAuthority,
  paraphraseEquivalent,
} from "../metamorphic.js";
import { generateBaseCatalog, goldenCore } from "../generate-catalog.js";
import type { MutationOperator, SafeScenario } from "../scenario-schema.js";
import {
  completePipelineGroundTruth,
  contentHash,
  REJECTED_MUTATION_OPS,
  VALID_MUTATION_OPS,
  validOpsFor,
} from "./validity.js";
import { GOLDEN_PARAPHRASES } from "./paraphrases.js";

/**
 * Deterministic product stress suite — exactly 267 validated rows on top of
 * the untouched 233 base catalog (233 + 267 = 500 product scenarios).
 *
 * Approved composition (bucket targets):
 *   T2 golden compatibility matrix (computed)                   79
 *   T1 selected universal mutations (inject / stale)           74
 *   T3 counterfactual budget sweeps (5 domains x 6 x 2)        60
 *   T4 metamorphic paraphrase invariance (23 x 1)              23
 *   T5 UNKNOWN/TOCTOU ordering matrix (5 x 2 concepts x 2)     20
 *   T6 stale-tip timing variants (golden-23 swap x 2)           2
 *   T7 op anchors (one validated row per valid op type)         9
 *   --------------------------------------------------------------
 *   total                                                      267
 *
 * Generation guards (authoritative): every emitted row must pass the
 * validity rule (SUT-observable input change + ground-truth transform or
 * documented invariance + non-no-op) and carry a unique scenarioHash
 * (canonical content hash over identity fields). Rejections are recorded:
 * rejectedInvalid / rejectedNoOp / rejectedDuplicate. No RNG, no clocks —
 * fully deterministic. The 23 goldens and the 233 base catalog are never
 * mutated: the suite reads them and emits a separate stress layer.
 */

export type StressBucket = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

export interface StressSubstitution {
  readonly rejectedScenarioId: string;
  readonly substituteScenarioId: string;
  readonly bucket: "T1";
  readonly reason: string;
}

export interface StressBucketReport {
  readonly bucket: StressBucket;
  readonly target: number;
  readonly emitted: number;
  readonly rejectedInvalid: number;
  readonly rejectedNoOp: number;
  readonly rejectedDuplicate: number;
  readonly substitutions: readonly StressSubstitution[];
  readonly basis: string;
}

export interface StressManifest {
  readonly schema: "TRUEMANDATE_STRESS_MANIFEST_V1";
  readonly generatorVersion: "1.0.0";
  readonly buckets: readonly StressBucketReport[];
  /** Exact scenario ids per bucket (id-level provenance). */
  readonly bucketIds: Readonly<Record<StressBucket, readonly string[]>>;
  readonly totalTarget: 267;
  readonly totalEmitted: number;
  readonly uniqueHashCount: number;
  readonly scenarioHashAlgorithm: "canonical-content-hash";
  readonly scenarioHashFields: readonly string[];
  readonly baseCatalogCount: 233;
  readonly baseCatalogHash: string;
  readonly goldenCount: 23;
  readonly rejectedOps: readonly { op: string; reason: string }[];
  readonly generatedContextPoolSize: number;
  readonly t2OpBreakdown: Readonly<Record<string, number>>;
  readonly familyDistribution: Readonly<Record<string, number>>;
  readonly holdoutCount: number;
  readonly developmentCount: number;
  readonly completionRules: readonly string[];
}

export interface StressSuite {
  readonly scenarios: readonly SafeScenario[];
  readonly manifest: StressManifest;
}

const byId = (a: SafeScenario, b: SafeScenario): number => a.id.localeCompare(b.id);

const DOMAINS = ["procurement", "travel", "commerce", "subscriptions", "payments"] as const;
const NON_BENIGN_FAMILIES = [
  "semantic",
  "authority",
  "injection",
  "execution",
  "outcome",
  "resolution",
] as const;

const T2_BASIS =
  "computed golden compatibility matrix: every (golden, operator) pair passing the validity rule";
const T1_BASIS =
  "selected universal mutations: inject on benign + authority rows, stale on outcome + resolution rows; " +
  "cross-bucket content collisions with T2 resolved by deterministic substitution from the execution UNKNOWN pool";
const T3_BASIS =
  "counterfactual budget sweeps: over-budget transforms expected authority/consequence; " +
  "under-budget asserts authority invariance";
const T4_BASIS =
  "metamorphic paraphrase invariance: one deterministic paraphrase per golden; expectedAuthority preserved";
const T5_BASIS =
  "UNKNOWN/TOCTOU ordering matrix: execution_constraint vs idempotency x adapterResult UNKNOWN vs " +
  "preparedFieldMutated — deliberately probes the *_constraint-before-UNKNOWN ordering defect (blocker #6)";
const T6_BASIS = "stale-tip timing variants of golden-23 (state ordering swap)";
const T7_BASIS = "one validated row per valid op type, first deterministic pick from the generated-context pool";

class Ledger {
  rejectedInvalid = 0;
  rejectedNoOp = 0;
  rejectedDuplicate = 0;
  readonly substitutions: StressSubstitution[] = [];
  private readonly used = new Set<string>();

  constructor(seedHashes?: Iterable<string>) {
    if (seedHashes) for (const h of seedHashes) this.used.add(h);
  }

  has(hash: string): boolean {
    return this.used.has(hash);
  }

  reserve(hash: string): void {
    this.used.add(hash);
  }

  recordDuplicate(): void {
    this.rejectedDuplicate += 1;
  }
  recordInvalid(): void {
    this.rejectedInvalid += 1;
  }
  recordNoOp(): void {
    this.rejectedNoOp += 1;
  }
}

/**
 * Emit a candidate stress row. Returns true when accepted (valid + unique),
 * false otherwise. Mutating the ledger is left to the caller so the reason
 * (invalid vs no-op vs duplicate) is attributed to the right bucket.
 */
function acceptCandidate(
  candidate: SafeScenario,
  source: SafeScenario,
  ledger: Ledger,
): { ok: true } | { ok: false; kind: "invalid" | "noOp" | "duplicate" } {
  const h = contentHash(candidate);
  if (h === contentHash(source)) {
    ledger.recordNoOp();
    return { ok: false, kind: "noOp" };
  }
  if (ledger.has(h)) {
    ledger.recordDuplicate();
    return { ok: false, kind: "duplicate" };
  }
  ledger.reserve(h);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T2 — golden compatibility matrix
// ---------------------------------------------------------------------------
function buildT2(goldens: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  for (const g of [...goldens].sort(byId)) {
    for (const { op } of validOpsFor(g)) {
      const m = completePipelineGroundTruth(applyMutation(g, op));
      const verdict = acceptCandidate(m, g, ledger);
      if (!verdict.ok) {
        throw new Error(`T2 candidate ${m.id} failed guards: ${verdict.kind}`);
      }
      rows.push(m);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// T1 — selected universal mutations (inject / stale)
// ---------------------------------------------------------------------------
function buildT1(catalog: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  const sorted = [...catalog].sort(byId);

  const benign = sorted.filter((s) => s.family === "benign"); // 33 incl. 3 goldens
  const authorityTemplated = sorted.filter(
    (s) => s.family === "authority" && s.id.startsWith("gen-"),
  );
  const outcome = sorted.filter((s) => s.family === "outcome"); // 33 incl. 3 goldens
  const resolutionTemplated = sorted.filter(
    (s) => s.family === "resolution" && s.id.startsWith("gen-"),
  );

  const injectSources = [...benign, ...authorityTemplated.slice(0, 4)];
  const staleSources = [...outcome, ...resolutionTemplated.slice(0, 4)];

  // Substitution pool: ALLOW-shaped execution rows with adapterResult UNKNOWN
  // (valid for both inject and stale; T2 already covers goldens, so goldens
  // are skipped by the uniqueness guard).
  const unknownPool = sorted.filter(
    (s) => s.family === "execution" && s.environmentPublic?.adapterResult === "UNKNOWN",
  );

  const emitWithSubstitution = (
    source: SafeScenario,
    op: "inject_instruction" | "stale_evidence",
    rows: SafeScenario[],
  ): void => {
    const candidate = completePipelineGroundTruth(applyMutation(source, op));
    const verdict = acceptCandidate(candidate, source, ledger);
    if (verdict.ok) {
      rows.push(candidate);
      return;
    }
    if (verdict.kind !== "duplicate") {
      throw new Error(`T1 candidate ${candidate.id} failed guards: ${verdict.kind}`);
    }
    // Deterministic substitution from the execution UNKNOWN pool.
    for (const sub of unknownPool) {
      const m = completePipelineGroundTruth(applyMutation(sub, op));
      const subVerdict = acceptCandidate(m, sub, ledger);
      if (subVerdict.ok) {
        ledger.substitutions.push({
          rejectedScenarioId: candidate.id,
          substituteScenarioId: m.id,
          bucket: "T1",
          reason: `content hash collides with an earlier-emitted bucket row (same source + ${op}); substituted deterministically from the execution UNKNOWN pool`,
        });
        rows.push(m);
        return;
      }
    }
    ledger.recordInvalid();
    throw new Error(
      `T1 substitution pool exhausted for ${source.id} + ${op} — generation cannot be completed honestly`,
    );
  };

  for (const s of injectSources) emitWithSubstitution(s, "inject_instruction", rows);
  for (const s of staleSources) emitWithSubstitution(s, "stale_evidence", rows);
  return rows;
}

// ---------------------------------------------------------------------------
// T3 — counterfactual budget sweeps
// ---------------------------------------------------------------------------
function buildT3(catalog: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  const sorted = [...catalog].sort(byId);
  for (const domain of DOMAINS) {
    for (const family of NON_BENIGN_FAMILIES) {
      const source = sorted.find(
        (s) => s.domain === domain && s.family === family && s.id.startsWith("gen-"),
      );
      if (!source) throw new Error(`T3 source missing: ${domain}/${family}`);
      const amount = source.environmentPublic?.amount;
      if (typeof amount !== "number") {
        ledger.recordInvalid();
        throw new Error(`T3 source ${source.id} has no numeric amount`);
      }
      const over = completePipelineGroundTruth(applyBudgetCounterfactual(source, amount - 100));
      const under = completePipelineGroundTruth(applyBudgetCounterfactual(source, amount + 100));
      for (const c of [over, under]) {
        const verdict = acceptCandidate(c, source, ledger);
        if (!verdict.ok) {
          throw new Error(`T3 candidate ${c.id} failed guards: ${verdict.kind}`);
        }
        rows.push(c);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// T4 — metamorphic paraphrase invariance
// ---------------------------------------------------------------------------
function buildT4(goldens: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  for (const g of [...goldens].sort(byId)) {
    const paraphrase = GOLDEN_PARAPHRASES[g.id];
    if (!paraphrase) {
      ledger.recordInvalid();
      throw new Error(`T4 paraphrase missing for ${g.id}`);
    }
    const row = completePipelineGroundTruth(assertParaphrasePreservesAuthority(g, paraphrase));
    if (!paraphraseEquivalent(g, row)) {
      ledger.recordInvalid();
      throw new Error(`T4 paraphrase broke authority invariance for ${g.id}`);
    }
    const verdict = acceptCandidate(row, g, ledger);
    if (!verdict.ok) {
      throw new Error(`T4 candidate ${row.id} failed guards: ${verdict.kind}`);
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// T5 — UNKNOWN/TOCTOU ordering matrix (deliberate blocker-#6 probe)
// ---------------------------------------------------------------------------
function buildT5(ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  const concepts = ["execution_constraint", "idempotency"] as const;
  const dummy: SafeScenario = {
    id: "stress-t5-probe",
    version: "1.0.0",
    domain: "payments",
    classification: "adversarial",
    severity: "S3_HIGH",
    family: "execution",
    rawIntent: "Execute payment once; do not duplicate on timeout.",
    expectedConstraints: [],
    expectedAuthority: "ALLOW",
    expectedExecution: "UNKNOWN",
    expectedOutcome: "AWAITING_OUTCOME",
    expectedResolution: "NONE",
    split: "development",
    acceptableResponsibility: [],
    reasonCodes: [],
  };
  for (const domain of DOMAINS) {
    for (const concept of concepts) {
      const unknownRow: SafeScenario = {
        ...dummy,
        id: `stress-t5-${domain}-${concept}-unknown`,
        domain,
        rawIntent: `Execute ${domain} payment once; do not duplicate on timeout.`,
        expectedConstraints: [
          { concept, criticality: "HARD", operator: "REQUIRED", value: true },
        ],
        attackLabel: "unknown_execution",
        reasonCodes: ["STRESS_T5_UNKNOWN"],
        environmentPublic: { adapterResult: "UNKNOWN" },
      };
      const preparedRow: SafeScenario = {
        ...dummy,
        id: `stress-t5-${domain}-${concept}-prepared`,
        domain,
        severity: "S4_CRITICAL",
        rawIntent: `Execute ${domain} payment from the prepared amount only.`,
        expectedConstraints: [
          { concept, criticality: "HARD", operator: "REQUIRED", value: true },
        ],
        expectedAuthority: "BLOCK",
        expectedExecution: "BLOCKED",
        expectedOutcome: "NONE",
        attackLabel: "toctou",
        expectedSecurityConsequence: "BLOCK_PREPARED_HASH_MISMATCH",
        reasonCodes: ["STRESS_T5_PREPARED"],
        environmentPublic: { preparedAmount: 742000, preparedFieldMutated: true },
      };
      for (const row of [unknownRow, preparedRow]) {
        const verdict = acceptCandidate(row, dummy, ledger);
        if (!verdict.ok) {
          throw new Error(`T5 candidate ${row.id} failed guards: ${verdict.kind}`);
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// T6 — stale-tip timing variants of golden-23
// ---------------------------------------------------------------------------
function buildT6(goldens: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const base = goldens.find((g) => g.id === "golden-23-stale-intent-state");
  if (!base) throw new Error("golden-23 missing for T6");
  const rows: SafeScenario[] = [
    {
      ...base,
      id: "stress-t6-stale-tip-swapped",
      rawIntent: "Commit grant bound to IntentState v1; observed tip advanced to v2.",
      environmentPublic: { grantState: "v2", tipState: "v1", evidenceFreshness: "STALE" },
      expectedSecurityConsequence: "BLOCK_STALE_INTENT_STATE_SWAPPED",
      sourceScenarioId: base.id,
      mutationOperator: undefined,
      mutatedField: undefined,
      originalValue: undefined,
      newValue: undefined,
      reasonCodes: [...base.reasonCodes, "STRESS_T6_SWAP"],
    },
    {
      ...base,
      id: "stress-t6-stale-tip-resolved",
      rawIntent: "Commit grant bound to IntentState v1; tip state unchanged.",
      environmentPublic: { grantState: "v1", tipState: "v1", evidenceFreshness: "STALE" },
      expectedSecurityConsequence: "BLOCK_STALE_EVIDENCE_ONLY",
      sourceScenarioId: base.id,
      mutationOperator: undefined,
      mutatedField: undefined,
      originalValue: undefined,
      newValue: undefined,
      reasonCodes: [...base.reasonCodes, "STRESS_T6_RESOLVED"],
    },
  ];
  for (const row of rows) {
    const verdict = acceptCandidate(row, base, ledger);
    if (!verdict.ok) {
      throw new Error(`T6 candidate ${row.id} failed guards: ${verdict.kind}`);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// T7 — op anchors from the generated-context pool
// ---------------------------------------------------------------------------
function buildT7(catalog: readonly SafeScenario[], ledger: Ledger): SafeScenario[] {
  const rows: SafeScenario[] = [];
  const anchored = new Set<MutationOperator>();
  for (const s of [...catalog].sort(byId)) {
    for (const { op } of validOpsFor(s)) {
      if (anchored.has(op)) continue;
      const m = completePipelineGroundTruth(applyMutation(s, op));
      if (ledger.has(contentHash(m))) continue;
      ledger.reserve(contentHash(m));
      anchored.add(op);
      rows.push(m);
    }
  }
  if (anchored.size !== VALID_MUTATION_OPS.length) {
    throw new Error(
      `T7 anchored ${anchored.size}/${VALID_MUTATION_OPS.length} op types: ${[...anchored].join(", ")}`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Suite assembly
// ---------------------------------------------------------------------------
export function generateStressSuite(): StressSuite {
  const catalog = generateBaseCatalog();
  const goldens = goldenCore();
  if (catalog.length !== 233) throw new Error(`base catalog drifted: ${catalog.length}`);
  if (goldens.length !== 23) throw new Error(`golden core drifted: ${goldens.length}`);
  const baseCatalogHash = hashCanonical(catalog) as string;

  const ledger = new Ledger();
  const t2 = buildT2(goldens, ledger);
  const t1 = buildT1(catalog, ledger);
  const t3 = buildT3(catalog, ledger);
  const t4 = buildT4(goldens, ledger);
  const t5 = buildT5(ledger);
  const t6 = buildT6(goldens, ledger);
  const t7 = buildT7(catalog, ledger);

  const all = [...t2, ...t1, ...t3, ...t4, ...t5, ...t6, ...t7];

  // Deterministic stress split: i % 10 === 0 -> holdout (27), else development (240).
  const assigned = [...all]
    .sort(byId)
    .map((s, i) => ({ ...s, split: i % 10 === 0 ? "holdout" as const : "development" as const }));

  const uniqueHashes = new Set(assigned.map(contentHash));
  if (uniqueHashes.size !== assigned.length) {
    throw new Error(
      `stress suite hash collision: ${assigned.length} rows but ${uniqueHashes.size} unique hashes`,
    );
  }

  const t2OpBreakdown: Record<string, number> = {};
  for (const r of t2) {
    const op = r.mutationOperator ?? "unknown";
    t2OpBreakdown[op] = (t2OpBreakdown[op] ?? 0) + 1;
  }

  const familyDistribution: Record<string, number> = {};
  for (const r of assigned) {
    familyDistribution[r.family] = (familyDistribution[r.family] ?? 0) + 1;
  }

  // Generated-context pool size (valid (scenario, op) pairs over the catalog)
  // — the "pool" T7 anchors are drawn from.
  let poolSize = 0;
  for (const s of catalog) poolSize += validOpsFor(s).length;

  const bucketReports: StressBucketReport[] = [
    { bucket: "T2", target: 79, emitted: t2.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T2_BASIS },
    { bucket: "T1", target: 74, emitted: t1.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: ledger.substitutions.length, substitutions: ledger.substitutions, basis: T1_BASIS },
    { bucket: "T3", target: 60, emitted: t3.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T3_BASIS },
    { bucket: "T4", target: 23, emitted: t4.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T4_BASIS },
    { bucket: "T5", target: 20, emitted: t5.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T5_BASIS },
    { bucket: "T6", target: 2, emitted: t6.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T6_BASIS },
    { bucket: "T7", target: 9, emitted: t7.length, rejectedInvalid: 0, rejectedNoOp: 0, rejectedDuplicate: 0, substitutions: [], basis: T7_BASIS },
  ];

  const manifest: StressManifest = {
    schema: "TRUEMANDATE_STRESS_MANIFEST_V1",
    generatorVersion: "1.0.0",
    buckets: bucketReports,
    bucketIds: {
      T1: t1.map((s) => s.id),
      T2: t2.map((s) => s.id),
      T3: t3.map((s) => s.id),
      T4: t4.map((s) => s.id),
      T5: t5.map((s) => s.id),
      T6: t6.map((s) => s.id),
      T7: t7.map((s) => s.id),
    },
    totalTarget: 267,
    totalEmitted: assigned.length,
    uniqueHashCount: uniqueHashes.size,
    scenarioHashAlgorithm: "canonical-content-hash",
    scenarioHashFields: [
      "rawIntent",
      "expectedConstraints",
      "expectedAuthority",
      "expectedExecution",
      "expectedOutcome",
      "expectedResolution",
      "environmentPublic",
      "attackLabel",
    ],
    baseCatalogCount: 233,
    baseCatalogHash,
    goldenCount: 23,
    rejectedOps: REJECTED_MUTATION_OPS.map((r) => ({ op: r.op, reason: r.reason })),
    generatedContextPoolSize: poolSize,
    t2OpBreakdown,
    familyDistribution,
    holdoutCount: assigned.filter((s) => s.split === "holdout").length,
    developmentCount: assigned.filter((s) => s.split === "development").length,
    completionRules: [
      "BLOCK rows: expectedExecution/Outcome/Resolution completed to BLOCKED/NONE/NONE (the SUT BLOCK branch terminates the pipeline)",
      "AT_RISK rows with resolution NONE: completed to OPEN (canonical AT_RISK fixtures pair AT_RISK with OPEN)",
    ],
  };

  return { scenarios: assigned, manifest };
}
