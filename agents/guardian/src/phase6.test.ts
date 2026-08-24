import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIDELITY_SCHEMA_ID,
} from "@truemandate/fidelity-judge";
import {
  CONTRADICTION_SCHEMA_ID,
} from "@truemandate/contradiction-judge";
import {
  DEVILS_ADVOCATE_SCHEMA_ID,
} from "@truemandate/devils-advocate";
import {
  PROVENANCE_SCHEMA_ID,
} from "@truemandate/provenance-judge";
import {
  EVIDENCE_SCHEMA_ID,
} from "@truemandate/evidence-judge";
import { hashActionProposal } from "@truemandate/guardian-core";
import { IntentService } from "@truemandate/intent-service";
import { FakeModel } from "@truemandate/model";
import {
  AuthorityDecision,
  ConstraintCoverageStatus,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  MeaningClass,
  SourceType,
  TaintClass,
  TrustClass,
  asConstraintId,
  asProvenanceNodeId,
  type ActionProposal,
} from "@truemandate/protocol";
import { emptyTaint } from "@truemandate/provenance";
import { ProvenanceService } from "@truemandate/provenance-service";
import { describe, expect, it } from "vitest";
import { evaluateActionProposal, isVerdictStale } from "./evaluate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function finding(
  code: string,
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  message: string,
  sourceRefs: string[],
  confidence = 0.9,
) {
  return { code, severity, message, confidence, sourceRefs };
}

type ScenarioMode =
  | "industrial"
  | "food_pass"
  | "quiet_party"
  | "arrive_ship"
  | "bag_fee"
  | "strengthen"
  | "injection"
  | "unsupported"
  | "missing_cert"
  | "data_taint_only"
  | "soft_miss";

function modelFor(mode: ScenarioMode, opts?: { unavailableJudges?: string[] }) {
  const unavailable = new Set(opts?.unavailableJudges ?? []);
  const handlers: Record<string, () => unknown> = {
    [FIDELITY_SCHEMA_ID]: () => {
      if (unavailable.has(FIDELITY_SCHEMA_ID)) throw new Error("unavailable");
      if (mode === "industrial") {
        return {
          findings: [
            finding(
              "CONSTRAINT_SUPPORTED",
              "LOW",
              "quantity ok",
              ["c-qty"],
              0.97,
            ),
          ],
          constraintClassifications: [
            {
              constraintId: "c-food",
              classification: GuardianConstraintClassification.CONTRADICTED,
              confidence: 0.99,
              rationale: "industrial vs food_grade",
            },
            {
              constraintId: "c-qty",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.97,
            },
          ],
        };
      }
      if (mode === "food_pass") {
        return {
          findings: [
            finding("CONSTRAINT_SUPPORTED", "LOW", "food grade supported", [
              "c-food",
            ]),
          ],
          constraintClassifications: [
            {
              constraintId: "c-food",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.95,
            },
            {
              constraintId: "c-qty",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.95,
            },
            {
              constraintId: "c-budget",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.9,
            },
          ],
        };
      }
      if (mode === "strengthen") {
        return {
          findings: [
            finding(
              "SEMANTIC_STRENGTHENING",
              "MEDIUM",
              "near strengthened to beachfront",
              ["c-near"],
            ),
          ],
          constraintClassifications: [
            {
              constraintId: "c-near",
              classification:
                GuardianConstraintClassification.PARTIALLY_SUPPORTED,
              confidence: 0.7,
            },
          ],
        };
      }
      if (mode === "soft_miss" || mode === "data_taint_only") {
        return {
          findings: [
            finding(
              mode === "soft_miss" ? "PREFERENCE_MISS" : "CONSTRAINT_SUPPORTED",
              "LOW",
              mode === "soft_miss"
                ? "soft preference for window seat missed"
                : "hard constraints supported",
              mode === "soft_miss" ? ["c-soft"] : ["c-food"],
              0.6,
            ),
          ],
          constraintClassifications: [
            {
              constraintId: "c-soft",
              classification:
                mode === "soft_miss"
                  ? GuardianConstraintClassification.UNCERTAIN
                  : GuardianConstraintClassification.SUPPORTED,
              confidence: 0.6,
            },
            {
              constraintId: "c-food",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.9,
            },
            {
              constraintId: "c-qty",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.9,
            },
            {
              constraintId: "c-budget",
              classification: GuardianConstraintClassification.SUPPORTED,
              confidence: 0.9,
            },
          ],
        };
      }
      return {
        findings: [
          finding("CONSTRAINT_SUPPORTED", "LOW", "ok", ["c-food"], 0.9),
        ],
        constraintClassifications: [
          {
            constraintId: "c-food",
            classification: GuardianConstraintClassification.SUPPORTED,
            confidence: 0.9,
          },
          {
            constraintId: "c-qty",
            classification: GuardianConstraintClassification.SUPPORTED,
            confidence: 0.9,
          },
          {
            constraintId: "c-budget",
            classification: GuardianConstraintClassification.SUPPORTED,
            confidence: 0.9,
          },
        ],
      };
    },
    [CONTRADICTION_SCHEMA_ID]: () => {
      if (unavailable.has(CONTRADICTION_SCHEMA_ID)) throw new Error("unavailable");
      if (mode === "industrial") {
        return {
          findings: [
            finding(
              "FOOD_GRADE_CONTRADICTED",
              "CRITICAL",
              "industrial grade contradicts food_grade",
              ["c-food"],
              1,
            ),
          ],
        };
      }
      if (mode === "quiet_party") {
        return {
          findings: [
            finding(
              "QUIET_CONTRADICTED",
              "CRITICAL",
              "party hotel contradicts quiet",
              ["c-quiet"],
              1,
            ),
          ],
        };
      }
      if (mode === "arrive_ship") {
        return {
          findings: [
            finding(
              "TEMPORAL_CONTRADICTED",
              "CRITICAL",
              "ship Friday ≠ arrive Friday",
              ["c-arrive"],
              1,
            ),
          ],
        };
      }
      if (mode === "bag_fee") {
        return {
          findings: [
            finding(
              "BUDGET_CONTRADICTED",
              "CRITICAL",
              "total cost exceeds budget",
              ["c-budget"],
              1,
            ),
          ],
        };
      }
      return { findings: [] };
    },
    [DEVILS_ADVOCATE_SCHEMA_ID]: () => {
      if (unavailable.has(DEVILS_ADVOCATE_SCHEMA_ID)) {
        return { findings: [] };
      }
      if (mode === "missing_cert") {
        return {
          findings: [
            finding(
              "MISSING_CERTIFICATE",
              "HIGH",
              "no food-grade certificate evidence",
              ["c-food"],
              0.85,
            ),
          ],
        };
      }
      return { findings: [] };
    },
    [PROVENANCE_SCHEMA_ID]: () => {
      if (mode === "injection") {
        return {
          findings: [
            finding(
              ErrorCode.UNTRUSTED_INFLUENCE,
              "CRITICAL",
              "prompt injection influenced privileged proposal",
              ["c-food"],
              1,
            ),
          ],
        };
      }
      if (mode === "data_taint_only") {
        return {
          findings: [
            finding(
              "EXTERNAL_DATA_TAINT",
              "MEDIUM",
              "untrusted merchant data present; not instructional",
              [],
              0.7,
            ),
          ],
        };
      }
      return { findings: [] };
    },
    [EVIDENCE_SCHEMA_ID]: () => {
      if (unavailable.has(EVIDENCE_SCHEMA_ID)) throw new Error("unavailable");
      if (mode === "unsupported") {
        return {
          findings: [
            finding(
              ErrorCode.UNSUPPORTED_ASSUMPTION,
              "CRITICAL",
              "rating does not entail quiet",
              ["c-quiet"],
              0.95,
            ),
          ],
        };
      }
      if (mode === "missing_cert") {
        return {
          findings: [
            finding(
              ErrorCode.EVIDENCE_INSUFFICIENT,
              "HIGH",
              "missing food-grade certificate",
              ["c-food"],
              0.9,
            ),
          ],
        };
      }
      if (mode === "food_pass") {
        return {
          findings: [
            finding("EVIDENCE_SUFFICIENT", "LOW", "certificate supports claim", [
              "c-food",
            ]),
          ],
        };
      }
      return { findings: [] };
    },
  };

  return new FakeModel({
    handlers: Object.fromEntries(
      Object.entries(handlers).map(([k, v]) => [k, () => v()]),
    ),
  });
}

async function seedProcurement(intents: IntentService, intentId: string, raw: string) {
  const intent = await intents.createIntent({
    id: intentId,
    principalId: "principal-1",
    rawText: raw,
    createdAt: "2026-06-01T12:00:00.000Z",
  });
  expect(intent.ok).toBe(true);
  if (!intent.ok) throw new Error("intent");

  const state = await intents.createIntentState({
    intentId,
    id: `${intentId}-state`,
    createdBy: "principal-1",
    createdAt: "2026-06-01T12:00:00.000Z",
    constraints: [
      {
        id: asConstraintId("c-qty"),
        concept: "quantity",
        operator: ConstraintOperator.EQ,
        value: 500,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("c-budget"),
        concept: "budget_per_kg",
        operator: ConstraintOperator.LTE,
        value: 1500,
        kind: ConstraintKind.FINANCIAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("c-soft"),
        concept: "window_seat",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.SOFT,
        importance: 0.2,
        confidence: 0.5,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.HUMAN_REVISABLE,
        meaningClass: MeaningClass.IMPLIED,
      },
    ],
  });
  expect(state.ok).toBe(true);
  if (!state.ok) throw new Error("state");
  return state.value;
}

function actionBase(
  intentId: string,
  stateId: string,
  partial: Partial<ActionProposal> & Pick<ActionProposal, "parameters">,
): ActionProposal {
  return {
    id: (partial.id ?? `act-${intentId}`) as ActionProposal["id"],
    intentId: intentId as ActionProposal["intentId"],
    intentStateId: stateId as ActionProposal["intentStateId"],
    agentId: "agent-1" as ActionProposal["agentId"],
    capability: partial.capability ?? "execute_payment",
    merchant: partial.merchant,
    product: partial.product,
    quantity: partial.quantity,
    amount: partial.amount,
    currency: partial.currency ?? "INR",
    parameters: partial.parameters,
    consequenceLevel: partial.consequenceLevel ?? "HIGH",
    createdAt: "2026-06-01T12:05:00.000Z",
    planId: partial.planId,
    planStepId: partial.planStepId,
  };
}

describe("Phase 6 Semantic Guardian", () => {
  it("blocks industrial grade contradicting food_grade despite high fidelity scores", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(
      intents,
      "intent-ind",
      "Buy 500kg food-grade citric acid",
    );
    const action = actionBase("intent-ind", state.id, {
      product: "industrial-grade citric acid",
      quantity: 500,
      amount: 742000,
      parameters: { grade: "industrial" },
    });
    const result = await evaluateActionProposal(
      { action, createdAt: "2026-06-01T12:06:00.000Z" },
      {
        model: modelFor("industrial"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
    expect(result.value.criticalFailure).toBe(true);
    expect(result.value.semanticStatus).toBe(
      GuardianSemanticStatus.CRITICAL_FAILURE,
    );
    expect(result.value.overallFidelity).toBeGreaterThan(0);
  });

  it("allows food-grade with certificate without creating grants", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(
      intents,
      "intent-pass",
      "Buy 500kg food-grade citric acid",
    );
    const action = actionBase("intent-pass", state.id, {
      product: "food-grade citric acid",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      amount: 700000,
      parameters: { grade: "food", certificateId: "FG-9981" },
    });
    const provenance = new ProvenanceService();
    const result = await evaluateActionProposal(
      {
        action,
        evidenceClaims: [
          {
            id: "claim-1" as never,
            evidenceId: "ev-1" as never,
            concept: "food_grade_certificate",
            value: "FG-9981",
            confidence: 0.95,
            derivedBy: "research-agent",
            taint: {
              classes: [TaintClass.EXTERNAL_CONTENT],
              origins: [],
            },
          },
        ],
        evidenceEnvelopes: [
          {
            id: "ev-1" as never,
            source: "merchant://cert",
            contentHash: "h1" as never,
            trustClass: TrustClass.UNTRUSTED_EXTERNAL,
            captureTime: "2026-06-01T12:00:00.000Z",
            taint: {
              classes: [TaintClass.EXTERNAL_CONTENT],
              origins: [],
            },
          },
        ],
        createdAt: "2026-06-01T12:06:00.000Z",
      },
      { model: modelFor("food_pass"), intents, provenance },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([
      AuthorityDecision.ALLOW,
      AuthorityDecision.ALLOW_WITH_MONITORING,
    ]).toContain(result.value.decision);
    expect(result.value.criticalFailure).toBe(false);
    // No authority nodes minted by guardian
    const nodes = provenance.getGraph().listNodes();
    expect(nodes.some((n) => n.kind === "AUTHORITY")).toBe(false);
    expect(nodes.some((n) => n.kind === "DECISION")).toBe(true);
  });

  it("blocks quiet vs party hotel", async () => {
    const intents = new IntentService();
    await intents.createIntent({
      id: "intent-q",
      principalId: "p1",
      rawText: "Book a quiet hotel",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const state = await intents.createIntentState({
      intentId: "intent-q",
      id: "intent-q-state",
      createdBy: "p1",
      createdAt: "2026-06-01T12:00:00.000Z",
      constraints: [
        {
          id: asConstraintId("c-quiet"),
          concept: "quiet",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const action = actionBase("intent-q", state.value.id, {
      product: "Party Palace",
      parameters: { atmosphere: "party" },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("quiet_party"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("blocks arrive Friday vs ship Friday", async () => {
    const intents = new IntentService();
    await intents.createIntent({
      id: "intent-arr",
      principalId: "p1",
      rawText: "I need to arrive Friday",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const state = await intents.createIntentState({
      intentId: "intent-arr",
      id: "intent-arr-state",
      createdBy: "p1",
      createdAt: "2026-06-01T12:00:00.000Z",
      constraints: [
        {
          id: asConstraintId("c-arrive"),
          concept: "arrive_friday",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const action = actionBase("intent-arr", state.value.id, {
      parameters: { shipDate: "Friday", arriveDate: "Saturday" },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("arrive_ship"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("blocks headline vs total cost (hidden bag fee)", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(
      intents,
      "intent-bag",
      "Book under budget total including bags",
    );
    const action = actionBase("intent-bag", state.id, {
      amount: 18000,
      parameters: { headlineFare: 18000, totalCost: 22500 },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("bag_fee"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.BLOCK);
  });

  it("treats near→beachfront strengthening as not CLEAR ALLOW", async () => {
    const intents = new IntentService();
    await intents.createIntent({
      id: "intent-near",
      principalId: "p1",
      rawText: "Hotel near the beach",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const state = await intents.createIntentState({
      intentId: "intent-near",
      id: "intent-near-state",
      createdBy: "p1",
      createdAt: "2026-06-01T12:00:00.000Z",
      constraints: [
        {
          id: asConstraintId("c-near"),
          concept: "near_beach",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 0.8,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const action = actionBase("intent-near", state.value.id, {
      consequenceLevel: "MEDIUM",
      parameters: { location: "beachfront" },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("strengthen"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).not.toBe(AuthorityDecision.ALLOW);
    expect(result.value.semanticStatus).not.toBe(GuardianSemanticStatus.CLEAR);
  });

  it("blocks instructional injection influence; data-only taint does not auto-BLOCK", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(
      intents,
      "intent-inj",
      "Buy food-grade citric acid",
    );
    const action = actionBase("intent-inj", state.id, {
      product: "citric acid",
      quantity: 500,
      amount: 700000,
      parameters: { ignore_constraints: true },
    });
    const provenance = new ProvenanceService();
    const ext = asProvenanceNodeId("ext-merchant-page");
    await provenance.recordNode({
      id: ext,
      kind: "EXTERNAL",
      label: "merchant:ignore-food-grade",
      createdAt: "2026-06-01T12:00:00.000Z",
      trustClass: TrustClass.UNTRUSTED_EXTERNAL,
      taint: {
        classes: [TaintClass.PROMPT_INJECTION_SUSPECTED],
        origins: [ext],
      },
    });

    const blocked = await evaluateActionProposal(
      { action, actionNodeId: "action-inj" },
      {
        model: modelFor("injection"),
        intents,
        provenance,
      },
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.value.decision).toBe(AuthorityDecision.BLOCK);
    expect(
      blocked.value.judgeResults
        .flatMap((j) => j.findings)
        .some((f) => f.code === ErrorCode.UNTRUSTED_INFLUENCE),
    ).toBe(true);

    const intents2 = new IntentService();
    const state2 = await seedProcurement(
      intents2,
      "intent-data",
      "Buy food-grade citric acid",
    );
    const action2 = actionBase("intent-data", state2.id, {
      product: "food-grade citric acid",
      quantity: 500,
      amount: 700000,
      parameters: { grade: "food" },
    });
    const dataOnly = await evaluateActionProposal(
      {
        action: action2,
        evidenceEnvelopes: [
          {
            id: "ev-d" as never,
            source: "merchant://spec",
            contentHash: "hd" as never,
            trustClass: TrustClass.UNTRUSTED_EXTERNAL,
            captureTime: "2026-06-01T12:00:00.000Z",
            taint: {
              classes: [TaintClass.EXTERNAL_CONTENT],
              origins: [],
            },
          },
        ],
      },
      {
        model: modelFor("data_taint_only"),
        intents: intents2,
        provenance: new ProvenanceService(),
      },
    );
    expect(dataOnly.ok).toBe(true);
    if (!dataOnly.ok) return;
    expect(dataOnly.value.decision).not.toBe(AuthorityDecision.BLOCK);
  });

  it("fail-closes when required judge unavailable for high-consequence action", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(intents, "intent-unavail", "Buy food-grade");
    const action = actionBase("intent-unavail", state.id, {
      quantity: 500,
      amount: 700000,
      parameters: {},
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("food_pass", {
          unavailableJudges: [EVIDENCE_SCHEMA_ID],
        }),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.GUARDIAN_JUDGE_UNAVAILABLE);
  });

  it("invalidates verdict when ActionProposal content changes", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(intents, "intent-stale", "Buy food-grade");
    const action = actionBase("intent-stale", state.id, {
      quantity: 500,
      amount: 700000,
      parameters: { grade: "food" },
    });
    const first = await evaluateActionProposal(
      { action },
      {
        model: modelFor("food_pass"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const changed = { ...action, amount: 999999 };
    expect(isVerdictStale(first.value, changed, state.id)).toBe(true);
    const rematch = await evaluateActionProposal(
      {
        action: changed,
        expectedActionHash: first.value.actionContentHash,
      },
      {
        model: modelFor("food_pass"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(rematch.ok).toBe(false);
    if (rematch.ok) return;
    expect(rematch.code).toBe(ErrorCode.ACTION_PROPOSAL_MISMATCH);
  });

  it("rejects stale IntentState tip", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(intents, "intent-tip", "Buy food-grade");
    // Create a new tip
    const next = await intents.createIntentState({
      intentId: "intent-tip",
      id: "intent-tip-state-2",
      createdBy: "principal-1",
      createdAt: "2026-06-01T13:00:00.000Z",
      previousStateId: state.id,
      constraints: state.constraints,
    });
    expect(next.ok).toBe(true);
    const action = actionBase("intent-tip", state.id, {
      quantity: 500,
      amount: 700000,
      parameters: {},
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("food_pass"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.GUARDIAN_VERDICT_STALE);
  });

  it("soft preference miss is not a hard breach", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(intents, "intent-soft", "Buy food-grade");
    const action = actionBase("intent-soft", state.id, {
      quantity: 500,
      amount: 700000,
      parameters: { grade: "food" },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("soft_miss"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).not.toBe(AuthorityDecision.BLOCK);
    expect(result.value.criticalFailure).toBe(false);
  });

  it("unsupported assumption (rating ⇒ quiet) elevates uncertainty", async () => {
    const intents = new IntentService();
    await intents.createIntent({
      id: "intent-rate",
      principalId: "p1",
      rawText: "quiet hotel",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const state = await intents.createIntentState({
      intentId: "intent-rate",
      id: "intent-rate-state",
      createdBy: "p1",
      createdAt: "2026-06-01T12:00:00.000Z",
      constraints: [
        {
          id: asConstraintId("c-quiet"),
          concept: "quiet",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const action = actionBase("intent-rate", state.value.id, {
      parameters: { rating: 4.8 },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("unsupported"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
    expect(
      result.value.judgeResults
        .flatMap((j) => j.findings)
        .some((f) => f.code === ErrorCode.UNSUPPORTED_ASSUMPTION),
    ).toBe(true);
  });

  it("package dependency ban: guardian packages exclude gateway/authority-service", async () => {
    const pkgs = [
      "packages/guardian-core/package.json",
      "agents/fidelity-judge/package.json",
      "agents/contradiction-judge/package.json",
      "agents/devils-advocate/package.json",
      "agents/provenance-judge/package.json",
      "agents/evidence-judge/package.json",
      "agents/guardian/package.json",
    ];
    for (const p of pkgs) {
      const json = JSON.parse(
        readFileSync(path.join(root, p), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const deps = Object.keys(json.dependencies ?? {});
      expect(deps).not.toContain("@truemandate/gateway-service");
      expect(deps).not.toContain("@truemandate/authority-service");
    }
  });

  it("hashes bind ActionProposal content", async () => {
    const a = actionBase("i", "s", { parameters: { x: 1 }, amount: 1 });
    const b = { ...a, amount: 2 };
    expect(hashActionProposal(a)).not.toBe(hashActionProposal(b));
  });

  it("DEFERRED ≠ IRRELEVANT for coverage semantics", async () => {
    expect(ConstraintCoverageStatus.DEFERRED).toBe("DEFERRED");
    expect(ConstraintCoverageStatus.IRRELEVANT).toBe("IRRELEVANT");
    expect(ConstraintCoverageStatus.DEFERRED).not.toBe(
      ConstraintCoverageStatus.IRRELEVANT,
    );
    const fixture = JSON.parse(
      readFileSync(
        path.join(root, "scenarios/procurement/phase6/industrial-block.json"),
        "utf8",
      ),
    ) as { expectedDecision: string };
    expect(fixture.expectedDecision).toBe("BLOCK");
    void emptyTaint;
  });

  it("missing certificate → evidence insufficient / not CLEAR ALLOW", async () => {
    const intents = new IntentService();
    const state = await seedProcurement(intents, "intent-cert", "Buy food-grade");
    const action = actionBase("intent-cert", state.id, {
      quantity: 500,
      amount: 700000,
      parameters: { grade: "food" },
    });
    const result = await evaluateActionProposal(
      { action },
      {
        model: modelFor("missing_cert"),
        intents,
        provenance: new ProvenanceService(),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).not.toBe(AuthorityDecision.ALLOW);
    expect(
      result.value.judgeResults
        .flatMap((j) => j.findings)
        .some((f) => f.code === ErrorCode.EVIDENCE_INSUFFICIENT),
    ).toBe(true);
  });
});
