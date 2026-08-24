import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mintDelegationEnvelope } from "@truemandate/delegation";
import { IntentService } from "@truemandate/intent-service";
import { FakeModel } from "@truemandate/model";
import { PLAN_VERIFIER_SCHEMA_ID } from "@truemandate/plan-verifier";
import {
  AmbiguityClass,
  AuthorityDecision,
  CommitmentLevel,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  IntentReadiness,
  MeaningClass,
  PlanStatus,
  SemanticLifecycle,
  SourceType,
  asConstraintId,
} from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { describe, expect, it } from "vitest";
import { planAndVerify } from "./orchestrator.js";
import { PLANNER_SCHEMA_ID } from "./prompts/v1.js";
import { InMemoryPlanStore } from "./store.js";
import {
  acceptPlanVerifier,
  aroundBudgetPlan,
  cleanProcurementPlanOutput,
  industrialPlan,
  missingApprovalPlan,
  missingBudgetPlan,
  omitFoodGradePlan,
  researchPlanOutput,
} from "./test-fixtures.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function verification(partial: {
  readiness?: IntentReadiness;
  ambiguityClass?: AmbiguityClass;
  lifecycle?: SemanticLifecycle;
  criticalFailure?: boolean;
  id?: string;
}) {
  return {
    id: partial.id ?? "verdict-1",
    intentId: "intent-p5" as never,
    candidateId: "cand-1",
    candidateHash: "hash" as never,
    lifecycle: partial.lifecycle ?? SemanticLifecycle.AMBIGUOUS,
    findings: [],
    transformations: [],
    criticalFailure: partial.criticalFailure ?? false,
    readiness: partial.readiness ?? IntentReadiness.PLANNABLE,
    ambiguityClass: partial.ambiguityClass ?? AmbiguityClass.A2,
    modelMeta: {
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "v",
      schemaVersion: "1",
      protocolVersion: "0.1.0",
      requestId: "r",
      timestamp: "2026-06-01T12:00:00.000Z",
    },
    verifiedAt: "2026-06-01T12:00:00.000Z",
  };
}

async function seedIntent(intents: IntentService, intentId: string, rawText: string) {
  const intent = await intents.createIntent({
    id: intentId,
    principalId: "principal-1",
    rawText,
    createdAt: "2026-06-01T12:00:00.000Z",
  });
  expect(intent.ok).toBe(true);
  if (!intent.ok) throw new Error("intent");

  const constraints = [
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
      concept: "budget",
      operator: ConstraintOperator.LTE,
      value: 800000,
      kind: ConstraintKind.FINANCIAL,
      importance: 1,
      confidence: 1,
      sourceType: SourceType.HUMAN,
      mutability: ConstraintMutability.IMMUTABLE,
      meaningClass: MeaningClass.EXPLICIT,
    },
    {
      id: asConstraintId("c-approved"),
      concept: "approved_supplier",
      operator: ConstraintOperator.REQUIRE,
      value: true,
      kind: ConstraintKind.HARD,
      importance: 1,
      confidence: 1,
      sourceType: SourceType.HUMAN,
      mutability: ConstraintMutability.HUMAN_REVISABLE,
      meaningClass: MeaningClass.EXPLICIT,
    },
  ];

  const state = await intents.createIntentState({
    intentId,
    constraints,
    assumptions: [],
    createdBy: "principal-1",
    createdAt: "2026-06-01T12:00:00.000Z",
  });
  expect(state.ok).toBe(true);
  if (!state.ok) throw new Error("state");
  return { intent: intent.value, state: state.value, constraints };
}

function models(
  plannerFn: (constraints: Awaited<ReturnType<typeof seedIntent>>["constraints"]) => unknown,
) {
  let constraintsRef: Awaited<ReturnType<typeof seedIntent>>["constraints"] = [];
  const plannerModel = new FakeModel({
    handlers: {
      [PLANNER_SCHEMA_ID]: async () => plannerFn(constraintsRef),
    },
  });
  const planVerifierModel = new FakeModel({
    handlers: {
      [PLAN_VERIFIER_SCHEMA_ID]: async () => acceptPlanVerifier(),
    },
  });
  return {
    plannerModel,
    planVerifierModel,
    setConstraints(c: typeof constraintsRef) {
      constraintsRef = c;
    },
  };
}

describe("Phase 5 Planner + Plan Verifier + Delegation", () => {
  it("A2 PLANNABLE research plan is allowed without economic commitment", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(
      intents,
      "intent-a2-research",
      "Buy 500 food grade containers from an approved supplier for under INR 800000.",
    );
    const m = models(researchPlanOutput);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "intent",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });

    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.PLANNABLE,
          ambiguityClass: AmbiguityClass.A2,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.status).toBe(PlanStatus.VERIFIED);
    expect(
      result.value.plan.steps.every((s) => s.commitmentLevel === CommitmentLevel.READ_ONLY),
    ).toBe(true);
    expect(
      result.value.plan.steps.every((s) => !s.requestedCapabilities.includes("execute_payment")),
    ).toBe(true);
  });

  it("A2 economic delegation is blocked", async () => {
    const intents = new IntentService();
    const seeded = await seedIntent(
      intents,
      "intent-a2-econ",
      "Buy 500 food grade containers from an approved supplier for under INR 800000.",
    );
    const m = models(researchPlanOutput);
    m.setConstraints(seeded.constraints);
    const planStore = new InMemoryPlanStore();
    const provenance = new ProvenanceService();
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const planned = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const step = planned.value.plan.steps[0]!;
    const parentScope = {
      capabilities: {
        search: AuthorityDecision.ALLOW,
        execute_payment: AuthorityDecision.ALLOW,
      },
      maxAmount: 800000,
      currency: "INR",
      expiresAt: "2027-01-01T00:00:00.000Z",
      maxDelegationDepth: 2,
    };
    const minted = mintDelegationEnvelope({
      parentAgentId: "parent",
      childAgentId: "child",
      intentId: seeded.intent.id,
      intentStateId: seeded.state.id,
      tipIntentStateId: seeded.state.id,
      parentScope,
      childScope: {
        capabilities: { execute_payment: AuthorityDecision.ALLOW },
        maxAmount: 800000,
        currency: "INR",
        expiresAt: "2026-12-01T00:00:00.000Z",
        maxDelegationDepth: 1,
      },
      stickyConstraintIds: seeded.constraints.map((c) => c.id),
      plan: planned.value.plan,
      planStep: {
        ...step,
        requestedCapabilities: ["execute_payment"],
        commitmentLevel: CommitmentLevel.ECONOMIC,
      },
      verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      createdAt: "2026-06-01T12:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      delegationDepth: 1,
    });
    expect(minted.ok).toBe(false);
    if (!minted.ok) {
      expect(
        minted.code === ErrorCode.SEMANTIC_READINESS_INSUFFICIENT ||
          minted.code === ErrorCode.DELEGATION_SCOPE_EXPANDED,
      ).toBe(true);
    }
  });

  it("rejects food_grade omitted", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-omit-food", "Buy 500 food grade containers under INR 800000 from approved supplier");
    const m = models(omitFoodGradePlan);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.code === ErrorCode.CONSTRAINT_DROPPED ||
          result.code === ErrorCode.PLAN_COVERAGE_GAP ||
          result.code === ErrorCode.PLAN_VERIFICATION_FAILED,
      ).toBe(true);
    }
  });

  it("detects food_grade → industrial_grade drift", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-industrial", "Buy 500 food grade containers under INR 800000 from approved supplier");
    const m = models(industrialPlan);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.SEMANTIC_WEAKENING);
  });

  it("PLAN_COVERAGE_GAP when approval verification missing", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-gap", "Buy 500 food grade containers from an approved supplier for under INR 800000.");
    const m = models(missingApprovalPlan);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.PLAN_COVERAGE_GAP);
  });

  it("rejects missing budget verification", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-nobudget", "Buy 500 food grade containers from an approved supplier for under INR 800000.");
    const m = models(missingBudgetPlan);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(false);
  });

  it("detects under → around budget weakening", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-around", "Buy 500 food grade containers from an approved supplier for under INR 800000.");
    const m = models(aroundBudgetPlan);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.SEMANTIC_WEAKENING);
  });

  it("blocks child amount / merchant / expiry / depth expansion", async () => {
    const intents = new IntentService();
    const seeded = await seedIntent(intents, "intent-del", "Buy food grade");
    const plan = {
      id: "plan-x" as never,
      intentId: seeded.intent.id,
      intentStateId: seeded.state.id,
      semanticVerificationId: "v",
      semanticVerificationHash: "h" as never,
      readinessAtPlan: IntentReadiness.ACTIONABLE,
      ambiguityClassAtPlan: AmbiguityClass.A0,
      status: PlanStatus.VERIFIED,
      version: 1,
      planHash: "ph" as never,
      plannerMeta: {
        modelId: "m",
        promptVersion: "v1",
        schemaId: "s",
        schemaVersion: "1",
        protocolVersion: "0.1.0",
        requestId: "r",
        timestamp: "2026-06-01T00:00:00.000Z",
      },
      createdAt: "2026-06-01T00:00:00.000Z",
      steps: [],
      coverage: [],
      proofObligations: [],
      operationalizations: [],
      assumptionIds: [],
      invalidationDeps: { stepIds: [], proofConstraintIds: [], relatedPlanIds: [] },
    };
    const step = {
      id: "s" as never,
      objective: "search",
      assignedAgent: "a" as never,
      requiredConstraintIds: [],
      requestedCapabilities: ["search"],
      requiredFutureCapabilities: [],
      inputs: [],
      expectedOutput: "out",
      assumptionIds: [],
      consequenceLevel: "LOW" as const,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: [],
      applicableConstraintIds: [],
      inheritedConstraintIds: [],
      irrelevantConstraintIds: [],
    };
    const parent = {
      capabilities: { search: AuthorityDecision.ALLOW },
      maxAmount: 1000,
      currency: "INR",
      allowedMerchants: ["m1"],
      allowedCategories: ["containers"],
      expiresAt: "2026-06-01T00:00:00.000Z",
      maxDelegationDepth: 1,
    };
    const v = verification({
      readiness: IntentReadiness.ACTIONABLE,
      ambiguityClass: AmbiguityClass.A0,
      lifecycle: SemanticLifecycle.VERIFIED,
    });

    expect(
      mintDelegationEnvelope({
        parentAgentId: "p",
        childAgentId: "c",
        intentId: seeded.intent.id,
        intentStateId: seeded.state.id,
        tipIntentStateId: seeded.state.id,
        parentScope: parent,
        childScope: { ...parent, maxAmount: 2000 },
        stickyConstraintIds: [],
        plan,
        planStep: step,
        verification: v,
        createdAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-05-15T00:00:00.000Z",
        delegationDepth: 1,
      }).ok,
    ).toBe(false);

    expect(
      mintDelegationEnvelope({
        parentAgentId: "p",
        childAgentId: "c",
        intentId: seeded.intent.id,
        intentStateId: seeded.state.id,
        tipIntentStateId: seeded.state.id,
        parentScope: parent,
        childScope: { ...parent, allowedMerchants: ["m2"] },
        stickyConstraintIds: [],
        plan,
        planStep: step,
        verification: v,
        createdAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-05-15T00:00:00.000Z",
        delegationDepth: 1,
      }).ok,
    ).toBe(false);

    expect(
      mintDelegationEnvelope({
        parentAgentId: "p",
        childAgentId: "c",
        intentId: seeded.intent.id,
        intentStateId: seeded.state.id,
        tipIntentStateId: seeded.state.id,
        parentScope: parent,
        childScope: { ...parent, expiresAt: "2026-12-01T00:00:00.000Z" },
        stickyConstraintIds: [],
        plan,
        planStep: step,
        verification: v,
        createdAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-12-01T00:00:00.000Z",
        delegationDepth: 1,
      }).ok,
    ).toBe(false);

    expect(
      mintDelegationEnvelope({
        parentAgentId: "p",
        childAgentId: "c",
        intentId: seeded.intent.id,
        intentStateId: seeded.state.id,
        tipIntentStateId: seeded.state.id,
        parentScope: parent,
        childScope: parent,
        stickyConstraintIds: [],
        plan,
        planStep: step,
        verification: v,
        createdAt: "2026-05-01T00:00:00.000Z",
        expiresAt: "2026-05-15T00:00:00.000Z",
        delegationDepth: 2,
      }).ok,
    ).toBe(false);
  });

  it("stale plan after new IntentState is unusable", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-stale", "Buy 500 food grade containers from an approved supplier for under INR 800000.");
    const m = models(researchPlanOutput);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const planned = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const next = await intents.createIntentState({
      intentId: seeded.intent.id,
      constraints: seeded.constraints,
      createdBy: "principal-1",
      createdAt: "2026-06-02T00:00:00.000Z",
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    planStore.markStaleForIntentState(seeded.intent.id, next.value.id);
    const stale = planStore.get(planned.value.plan.id);
    expect(stale?.status).toBe(PlanStatus.STALE);

    const minted = mintDelegationEnvelope({
      parentAgentId: "p",
      childAgentId: "c",
      intentId: seeded.intent.id,
      intentStateId: planned.value.plan.intentStateId,
      tipIntentStateId: next.value.id,
      parentScope: {
        capabilities: { search: AuthorityDecision.ALLOW },
        expiresAt: "2027-01-01T00:00:00.000Z",
        maxDelegationDepth: 2,
      },
      childScope: {
        capabilities: { search: AuthorityDecision.ALLOW },
        expiresAt: "2026-12-01T00:00:00.000Z",
        maxDelegationDepth: 1,
      },
      stickyConstraintIds: [],
      plan: stale!,
      planStep: planned.value.plan.steps[0]!,
      verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      createdAt: "2026-06-02T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      delegationDepth: 1,
    });
    expect(minted.ok).toBe(false);
    if (!minted.ok) expect(minted.code).toBe(ErrorCode.PLAN_STALE);
  });

  it("invalid planner structured output fails closed", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-bad", "Buy 500 food grade containers");
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      },
      {
        intents,
        provenance,
        plannerModel: new FakeModel({
          handlers: { [PLANNER_SCHEMA_ID]: async () => ({ steps: "nope" }) },
        }),
        planVerifierModel: new FakeModel({ unavailable: true }),
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.MODEL_OUTPUT_INVALID);
  });

  it("planner unavailable yields no verified plan", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(intents, "intent-down", "Buy 500 food grade containers");
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({ readiness: IntentReadiness.PLANNABLE }),
      },
      {
        intents,
        provenance,
        plannerModel: new FakeModel({ unavailable: true }),
        planVerifierModel: new FakeModel({ unavailable: true }),
        planStore,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
    expect(planStore.listForIntent(seeded.intent.id).length).toBe(0);
  });

  it("ACTIONABLE clean plan verifies with proof obligations and provenance", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const planStore = new InMemoryPlanStore();
    const seeded = await seedIntent(
      intents,
      "intent-clean",
      "Buy 500 food grade containers from an approved supplier for under INR 800000.",
    );
    const m = models(cleanProcurementPlanOutput);
    m.setConstraints(seeded.constraints);
    await provenance.recordNode({
      id: `intent-node-${seeded.intent.id}` as never,
      kind: "INTENT",
      label: "i",
      createdAt: seeded.intent.createdAt,
      trustClass: "TRUSTED_HUMAN",
      taint: { classes: ["NONE"], origins: [] },
    });
    const result = await planAndVerify(
      {
        intentId: seeded.intent.id,
        verification: verification({
          readiness: IntentReadiness.ACTIONABLE,
          ambiguityClass: AmbiguityClass.A0,
          lifecycle: SemanticLifecycle.VERIFIED,
        }),
      },
      {
        intents,
        provenance,
        plannerModel: m.plannerModel,
        planVerifierModel: m.planVerifierModel,
        planStore,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.proofObligations.length).toBeGreaterThan(0);
    expect(result.value.plan.steps.some((s) => s.privileged)).toBe(true);
    const nodes = provenance.getGraph().listNodes();
    expect(nodes.some((n) => n.kind === "PLAN")).toBe(true);
    expect(provenance.getGraph().descendants(`intent-node-${seeded.intent.id}`).length).toBeGreaterThan(1);
  });

  it("loads SAFE phase5 fixtures", async () => {
    const clean = JSON.parse(
      readFileSync(path.join(root, "scenarios/procurement/phase5/clean-plan.json"), "utf8"),
    ) as { expectedPlanSteps: string[] };
    expect(clean.expectedPlanSteps.length).toBeGreaterThan(5);
    const adv = JSON.parse(
      readFileSync(path.join(root, "evals/planning-drift/adversarial-pairs.json"), "utf8"),
    ) as { pairs: unknown[] };
    expect(adv.pairs.length).toBeGreaterThan(5);
  });
});
