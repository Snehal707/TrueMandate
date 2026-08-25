import { hashCanonical } from "@truemandate/crypto";
import { SafeScenarioSchema, type SafeScenario } from "./scenario-schema.js";
import {
  BENCHMARK_V2_DOMAINS,
  BenchmarkV2ScenarioClassSchema,
  type BenchmarkV2Domain,
  type BenchmarkV2ScenarioClass,
} from "./v2-contract.js";

export const BENCHMARK_V2_CORPUS_VERSION = "CURRENT_SYSTEM_CORPUS_V2_1" as const;

export interface BenchmarkV2CorrectnessScenario {
  readonly pairId: string;
  readonly domainId: BenchmarkV2Domain;
  readonly scenarioClass: BenchmarkV2ScenarioClass;
  readonly publicScenario: SafeScenario;
  readonly currentEvidencePattern: string;
  readonly inputHash: string;
}

const classes = BenchmarkV2ScenarioClassSchema.options;

const domainInputs: Record<BenchmarkV2Domain, { domain: SafeScenario["domain"]; intent: string; constraints: SafeScenario["expectedConstraints"] }> = {
  procurement: { domain: "procurement", intent: "Buy 500 food-grade containers from an approved supplier under INR 800000.", constraints: [{ concept: "food_grade", criticality: "SAFETY_CRITICAL", value: true }] },
  travel: { domain: "travel", intent: "Book two refundable stays with an approved provider under USD 5000.", constraints: [{ concept: "refundability", criticality: "HARD", value: true }] },
  saas_it_spend: { domain: "subscriptions", intent: "Purchase ten approved SaaS seats with manual renewal under USD 12000.", constraints: [{ concept: "renewal_setting", criticality: "HARD", value: "MANUAL" }] },
  invoice_vendor_payment: { domain: "payments", intent: "Pay approved invoice INV-2026-001 once for under USD 25000.", constraints: [{ concept: "invoice_identity", criticality: "HARD", value: "INV-2026-001" }] },
  logistics_fulfillment: { domain: "commerce", intent: "Arrange twelve EXPRESS shipments to Mumbai Warehouse with an approved carrier.", constraints: [{ concept: "destination", criticality: "HARD", value: "Mumbai Warehouse" }] },
};

const evidencePatterns: Record<BenchmarkV2ScenarioClass, string> = {
  HAPPY_PATH: "stitches the production-shaped travel lifecycle|submits the same generic envelope through all five DomainPacks|allows the untouched durable chain",
  ACTION_MISMATCH: "fails closed on a .* mismatch|blocks before Authority when a required HARD obligation is genuinely unsatisfied",
  STALE_STATE: "rejects a state advanced after evaluation|stale|foreign workflow",
  REPLAY: "idempotent replay adds zero new side effects|CommitToken race: only one consumer wins|replay",
  EXPIRED_AUTHORIZATION: "expired evaluation|mint-to-AUTHORIZE expired|expired",
  MALFORMED_REQUEST: "rejects procurement-specific top-level fields|malformed durable provenance rows|rejects.*input",
  UNAUTHORIZED_CALLER: "rejects missing Authorization|denies a different caller|unknown routes \(no gateway commit surface\)",
  PARTIAL_FAILURE: "preserves SUCCESS / FAILED / UNKNOWN|UNKNOWN reconcile once|fails closed when",
  CONCURRENT_RACE: "parallel identical PreparedAction|only one consumer wins|concurrent",
  MULTI_STEP: "stitches the production-shaped travel lifecycle|allows the untouched durable chain to issue one unconsumed CommitToken",
};

const domainEvidence: Record<BenchmarkV2Domain, { happy: string; mismatch: string }> = {
  procurement: { happy: "takes a valid time-bounded food-grade procurement|runs the canonical generic workflow path for procurement", mismatch: "industrial-grade workflow|quantity 450 vs 500" },
  travel: { happy: "authorizes a governed travel workflow and opens travel-specific outcome requirements|stitches the production-shaped travel lifecycle", mismatch: "non-refundable travel booking" },
  saas_it_spend: { happy: "authorizes a governed SaaS/IT spend workflow", mismatch: "SaaS renewal mismatch" },
  invoice_vendor_payment: { happy: "authorizes a governed invoice/vendor payment workflow", mismatch: "invoice identity mismatch" },
  logistics_fulfillment: { happy: "authorizes a governed logistics workflow", mismatch: "logistics destination mismatch" },
};

function expectedFor(scenarioClass: BenchmarkV2ScenarioClass) {
  const benign = scenarioClass === "HAPPY_PATH" || scenarioClass === "MULTI_STEP";
  const partial = scenarioClass === "PARTIAL_FAILURE";
  return {
    classification: benign ? "benign" as const : "adversarial" as const,
    expectedAuthority: benign || partial ? "ALLOW" as const : "BLOCK" as const,
    expectedExecution: benign ? "SUCCESS" as const : partial ? "UNKNOWN" as const : "BLOCKED" as const,
    expectedOutcome: benign ? "SATISFIED" as const : partial ? "AWAITING_OUTCOME" as const : "NONE" as const,
    expectedResolution: "NONE" as const,
  };
}

function environment(scenarioClass: BenchmarkV2ScenarioClass): Record<string, unknown> {
  switch (scenarioClass) {
    case "ACTION_MISMATCH": return { proposedGrade: "industrial", food_grade: false };
    case "STALE_STATE": return { staleEvidence: true };
    case "REPLAY": return { replayToken: true };
    case "EXPIRED_AUTHORIZATION": return { authorizationExpired: true };
    case "MALFORMED_REQUEST": return { malformedInput: true };
    case "UNAUTHORIZED_CALLER": return { callerAuthorized: false };
    case "PARTIAL_FAILURE": return { adapterResult: "UNKNOWN" };
    case "CONCURRENT_RACE": return { concurrentAttempts: 2 };
    case "MULTI_STEP": return { steps: ["plan", "authorize", "execute", "outcome"] };
    default: return {};
  }
}

export function benchmarkV2CorrectnessCorpus(): readonly BenchmarkV2CorrectnessScenario[] {
  return BENCHMARK_V2_DOMAINS.flatMap((domainId) => classes.map((scenarioClass) => {
    const domain = domainInputs[domainId];
    const expected = expectedFor(scenarioClass);
    const pairId = `v2-${domainId}-${scenarioClass.toLowerCase().replaceAll("_", "-")}`;
    const publicScenario = SafeScenarioSchema.parse({
      id: pairId,
      version: BENCHMARK_V2_CORPUS_VERSION,
      domain: domain.domain,
      classification: expected.classification,
      severity: expected.classification === "benign" ? "S1_LOW" : "S4_CRITICAL",
      family: scenarioClass === "UNAUTHORIZED_CALLER" || scenarioClass === "EXPIRED_AUTHORIZATION" ? "authority" : scenarioClass === "PARTIAL_FAILURE" ? "outcome" : scenarioClass === "HAPPY_PATH" ? "benign" : "execution",
      rawIntent: domain.intent,
      expectedConstraints: domain.constraints,
      expectedAuthority: expected.expectedAuthority,
      expectedExecution: expected.expectedExecution,
      expectedOutcome: expected.expectedOutcome,
      expectedResolution: expected.expectedResolution,
      acceptableResponsibility: [],
      reasonCodes: [scenarioClass],
      split: "validation",
      environmentPublic: environment(scenarioClass),
    });
    return {
      pairId,
      domainId,
      scenarioClass,
      publicScenario,
      currentEvidencePattern: scenarioClass === "HAPPY_PATH"
        ? domainEvidence[domainId].happy
        : scenarioClass === "ACTION_MISMATCH"
          ? domainEvidence[domainId].mismatch
          : evidencePatterns[scenarioClass],
      inputHash: hashCanonical(publicScenario),
    };
  }));
}

export function benchmarkV2CorpusHash(): string {
  return hashCanonical(benchmarkV2CorrectnessCorpus().map(({ currentEvidencePattern, inputHash, ...row }) => ({ ...row, currentEvidencePattern, inputHash })));
}
