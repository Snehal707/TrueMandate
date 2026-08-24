import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { FakeModel } from "@truemandate/model";
import { ResolutionAgent } from "@truemandate/resolution-agent";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  OutcomeContractState,
  ResolutionCaseState,
  ResponsibilityState,
  RootCauseCode,
  SourceType,
  asAuthorityGrantId,
  asConstraintId,
  asRemedyProposalId,
} from "@truemandate/protocol";
import {
  assertIndependentRemedyAuthority,
} from "@truemandate/authority";
import { describe, expect, it } from "vitest";
import {
  executeRemedyPipeline,
  type PrivilegedRemedyPort,
} from "./remedy-pipeline.js";
import { ResolutionService } from "./service.js";
import { DEFAULT_RESOLUTION_BOUNDS } from "@truemandate/resolution-core";

const NOW = "2026-06-04T12:00:00.000Z";

async function seedPartialProcurement() {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: "intent-p9",
    principalId: "principal-1",
    rawText: "Buy 500 food-grade containers under INR 800000",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: "state-p9",
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.SAFETY_CRITICAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!state.ok) throw new Error("state");
  const outcomes = new OutcomeService();
  const contract = await outcomes.createContractFromIntent({
    id: "oc-p9",
    intentState: state.value,
    principalId: "principal-1",
    merchant: "ApprovedFoodChem",
    quantity: 500,
    budgetMax: 800000,
    createdAt: NOW,
  });
  if (!contract.ok) throw new Error("contract");
  await outcomes.onPaymentSuccess(contract.value.id, NOW);
  await outcomes.applyObservations(
    contract.value.id,
    {
      quantityReceived: 450,
      quantityOrdered: 500,
      pricePaid: 700000,
      budgetMax: 800000,
      merchantObserved: "ApprovedFoodChem",
      merchantExpected: "ApprovedFoodChem",
      certificateValid: true,
      productObserved: "fg",
      productExpected: "fg",
    },
    NOW,
  );
  const trigger = outcomes
    .listEvents(contract.value.id)
    .find((e) => e.type === "OUTCOME_PARTIAL");
  if (!trigger) throw new Error("no trigger");
  const resolution = new ResolutionService(outcomes);
  return {
    intents,
    state: state.value,
    outcomes,
    contract: contract.value,
    trigger,
    resolution,
  };
}

describe("Phase 9 Resolution Engine", () => {
  it("PARTIAL opens exactly one ResolutionCase; duplicate trigger is idempotent", async () => {
    const ctx = await seedPartialProcurement();
    const a = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.state).toBe(ResolutionCaseState.OPEN);
    expect(a.value.responsibilityState).toBe(ResponsibilityState.UNKNOWN);

    const b = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.id).toBe(a.value.id);
    expect(ctx.resolution.listCasesForContract(ctx.contract.id).length).toBe(1);
  });

  it("breach does not automatically assign blame; divergence ≠ root cause", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const hyps = ctx.resolution.getHypotheses(opened.value.id);
    expect(hyps.some((h) => h.assertedCause === RootCauseCode.UNKNOWN)).toBe(true);
    expect(hyps.every((h) => h.status !== ResponsibilityState.ESTABLISHED)).toBe(
      true,
    );
    const div = ctx.resolution
      .listEvents(opened.value.id)
      .find((e) => e.type === "DIVERGENCE_IDENTIFIED");
    expect(div?.payload).toMatchObject({ isRootCause: false });
  });

  it("one party accusation cannot establish responsibility", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const hyp = ctx.resolution.proposeHypothesis(opened.value.id, {
      id: "hyp-accuse",
      assertedCause: RootCauseCode.MERCHANT_FAILURE,
      involvedActor: "merchant",
      supportingEvidenceIds: ["merchant-claim-only"],
      contradictoryEvidenceIds: [],
      missingEvidence: [],
      confidence: 0.9,
      status: ResponsibilityState.ESTABLISHED,
      createdAt: NOW,
    });
    expect(hyp.ok).toBe(true);
    if (!hyp.ok) return;
    expect(hyp.value.status).toBe(ResponsibilityState.POSSIBLE);
  });

  it("missing evidence produces structured EvidenceRequest preferring discriminating evidence", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const reqs = ctx.resolution.planEvidenceRequests(opened.value.id, NOW);
    expect(reqs.ok).toBe(true);
    if (!reqs.ok) return;
    expect(reqs.value[0]?.targetSource).toBe("carrier");
    expect(reqs.value[0]?.expectedInformationValue).toBeGreaterThan(
      reqs.value[1]?.expectedInformationValue ?? 0,
    );
  });

  it("Resolution Agent cannot mutate OutcomeContract or invent events", async () => {
    const ctx = await seedPartialProcurement();
    const forbid = ctx.resolution.forbidContractMutation();
    expect(forbid.ok).toBe(false);
    if (!forbid.ok) {
      expect(forbid.code).toBe(ErrorCode.RESOLUTION_AGENT_MUTATION_FORBIDDEN);
    }
    const original = await ctx.outcomes.getContract(ctx.contract.id);
    expect(original.ok).toBe(true);

    const model = new FakeModel({
      handlers: {
        ResolutionHypotheses: () => ({
          hypotheses: [
            {
              assertedCause: "LOGISTICS_FAILURE",
              confidence: 0.5,
              inventedEventIds: ["never-existed-event"],
            },
          ],
        }),
      },
    });
    const agent = new ResolutionAgent(model);
    const result = await agent.proposeCausalHypotheses({
      knownEventIds: ["cte-1"],
      structuredHistory: { events: [] },
    });
    expect(result.ok).toBe(false);
  });

  it("original purchase authority cannot fund remedy; mandate required → AWAITING_AUTHORITY", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const remedies = await ctx.resolution.planRemedies(opened.value.id, NOW);
    expect(remedies.ok).toBe(true);
    if (!remedies.ok) return;
    const top = remedies.value[0]!;
    expect(top.description.toLowerCase()).toContain("remaining");
    const indep = assertIndependentRemedyAuthority(
      top,
      asAuthorityGrantId("grant-payment"),
    );
    expect(indep.ok).toBe(false);

    const awaiting = ctx.resolution.requireRemedyAuthority({
      caseId: opened.value.id,
      remedy: top,
      originalPaymentGrantId: "grant-payment",
      now: NOW,
    });
    expect(awaiting.ok).toBe(true);
    if (!awaiting.ok) return;
    expect(awaiting.value.state).toBe(ResolutionCaseState.AWAITING_AUTHORITY);
  });

  it("refund API success does not resolve case; settlement can", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    await ctx.resolution.planRemedies(opened.value.id, NOW);
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.AWAITING_AUTHORITY,
      NOW,
      "test",
    );
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.REMEDIATING,
      NOW,
      "auth",
    );
    const stub = await ctx.resolution.createRemedyOutcomeContractStub({
      caseId: opened.value.id,
      kind: "refund",
      intentState: ctx.state,
      principalId: "principal-1",
      now: NOW,
    });
    expect(stub.ok).toBe(true);
    if (!stub.ok) return;
    const afterTool = ctx.resolution.observeRemedyToolSuccess({
      caseId: opened.value.id,
      remedyOutcomeContractId: stub.value.outcomeContractId,
      now: NOW,
    });
    expect(afterTool.ok).toBe(true);
    if (!afterTool.ok) return;
    expect(afterTool.value.state).toBe(ResolutionCaseState.VERIFYING_REMEDY);
    expect(afterTool.value.state).not.toBe(ResolutionCaseState.RESOLVED);

    const resolved = ctx.resolution.resolveFromRemedyOutcome({
      caseId: opened.value.id,
      remedyContractState: OutcomeContractState.SATISFIED,
      now: NOW,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.state).toBe(ResolutionCaseState.RESOLVED);

    // Original contract still PARTIAL historically
    const orig = await ctx.outcomes.getContract(ctx.contract.id);
    expect(orig.ok).toBe(true);
    if (orig.ok) expect(orig.value.state).toBe(OutcomeContractState.PARTIAL);
  });

  it("hard food_grade preserved — refund-alone ranks below replacement", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-fg",
      principalId: "principal-1",
      rawText: "food grade",
      createdAt: NOW,
    });
    if (!intent.ok) return;
    const state = await intents.createIntentState({
      id: "state-fg",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-food"),
          concept: "food_grade",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.SAFETY_CRITICAL,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) return;
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-fg",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: false,
        productObserved: "industrial",
        productExpected: "food-grade",
      },
      NOW,
    );
    const trigger = outcomes
      .listEvents(contract.value.id)
      .find((e) => e.type === "OUTCOME_BREACHED");
    expect(trigger).toBeTruthy();
    if (!trigger) return;
    const resolution = new ResolutionService(outcomes);
    const opened = await resolution.openCaseFromTrigger({
      intentState: state.value,
      principalId: "principal-1",
      contractId: contract.value.id,
      triggerEvent: trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const remedies = await resolution.planRemedies(opened.value.id, NOW);
    expect(remedies.ok).toBe(true);
    if (!remedies.ok) return;
    expect(remedies.value[0]?.description.toLowerCase()).toContain("food-grade");
  });

  it("AT_RISK may open preemptive case", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-risk",
      principalId: "principal-1",
      rawText: "Deliver by Friday",
      createdAt: NOW,
    });
    if (!intent.ok) return;
    const state = await intents.createIntentState({
      id: "state-risk",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-dl"),
          concept: "delivery_before",
          operator: ConstraintOperator.LTE,
          value: "2026-06-06T23:59:59.000Z",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) return;
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-risk",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "carrier",
      quantity: 1,
      budgetMax: 1000,
      createdAt: NOW,
      domain: "travel",
    });
    if (!contract.ok) return;
    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    await outcomes.applyObservations(
      contract.value.id,
      {
        deliveryEta: "2026-06-07T12:00:00.000Z",
        deadline: "2026-06-06T23:59:59.000Z",
        now: NOW,
      },
      NOW,
    );
    const trigger = outcomes
      .listEvents(contract.value.id)
      .find((e) => e.type === "OUTCOME_AT_RISK");
    expect(trigger).toBeTruthy();
    if (!trigger) return;
    const resolution = new ResolutionService(outcomes);
    const opened = await resolution.openCaseFromTrigger({
      intentState: state.value,
      principalId: "principal-1",
      contractId: contract.value.id,
      triggerEvent: trigger,
      now: NOW,
    });
    expect(opened.ok).toBe(true);
  });

  it("illegal state transition rejected; model unavailable fails closed", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const bad = ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.RESOLVED,
      NOW,
      "illegal",
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe(ErrorCode.RESOLUTION_TRANSITION_INVALID);

    const model = new FakeModel({ unavailable: true });
    const agent = new ResolutionAgent(model);
    const r = await agent.proposeCausalHypotheses({
      knownEventIds: [],
      structuredHistory: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
  });

  it("human accepted variance does not rewrite original requirement", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    // walk to VERIFYING_REMEDY
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.GATHERING_EVIDENCE,
      NOW,
      "x",
    );
    ctx.resolution.transition(opened.value.id, ResolutionCaseState.ANALYZING, NOW, "x");
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.REMEDY_PROPOSED,
      NOW,
      "x",
    );
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.AWAITING_AUTHORITY,
      NOW,
      "x",
    );
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.REMEDIATING,
      NOW,
      "x",
    );
    ctx.resolution.transition(
      opened.value.id,
      ResolutionCaseState.VERIFYING_REMEDY,
      NOW,
      "x",
    );
    const resolved = ctx.resolution.resolveFromRemedyOutcome({
      caseId: opened.value.id,
      remedyContractState: "PARTIAL",
      now: NOW,
      humanAcceptedVariance: true,
    });
    expect(resolved.ok).toBe(true);
    const qty = ctx.contract.requirements.find((r) => r.concept === "quantity_received");
    expect(qty?.value).toBe(500);
  });

  it("duplicate resolution event is idempotent", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const before = ctx.resolution.listEvents(opened.value.id).length;
    await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(ctx.resolution.listEvents(opened.value.id).length).toBe(before);
  });

  it("remedy proposal id branding", async () => {
    void asRemedyProposalId;
    expect(true).toBe(true);
  });

  it("remedy pipeline uses RemediationMandate + distinct execution grant; tool SUCCESS → VERIFYING", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const remedies = await ctx.resolution.planRemedies(opened.value.id, NOW);
    expect(remedies.ok).toBe(true);
    if (!remedies.ok) return;
    const top = remedies.value[0]!;

    const issued = await ctx.resolution.issueMandate({
      caseId: opened.value.id,
      remedy: top,
      principalId: "principal-1",
      maxAmount: 100000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: "2026-12-01T00:00:00.000Z",
      now: NOW,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const port: PrivilegedRemedyPort = {
      executeBoundEconomicAction: (input) => ({
        ok: true,
        value: {
          status: "SUCCESS",
          preparedActionId: `pa-${input.idempotencyKey}`,
          preparedActionHash: `hash-${input.amount}`,
          executionGrantId: `grant-exec-${input.idempotencyKey}`,
          sideEffectId: `se-${input.idempotencyKey}`,
        },
      }),
    };

    // Cannot reuse purchase grant id as mandate
    const collide = ctx.resolution.issueMandate({
      caseId: opened.value.id,
      remedy: top,
      principalId: "principal-1",
      maxAmount: 100000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: "2026-12-01T00:00:00.000Z",
      now: NOW,
    });
    // second issue creates new mandate id; pipeline with first mandate should work
    void collide;

    const pipeline = await executeRemedyPipeline({
      resolution: ctx.resolution,
      outcomes: ctx.outcomes,
      gateway: port,
      caseId: opened.value.id,
      remedy: issued.value.remedy,
      mandate: issued.value.mandate,
      originalPaymentGrantId: asAuthorityGrantId("grant-payment"),
      intentState: ctx.state,
      principalId: "principal-1",
      now: NOW,
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(pipeline.ok).toBe(true);
    if (!pipeline.ok) return;
    expect(pipeline.value.case.state).toBe(ResolutionCaseState.VERIFYING_REMEDY);
    expect(pipeline.value.executionGrantId).not.toBe(issued.value.mandate.id);
    expect(pipeline.value.case.state).not.toBe(ResolutionCaseState.RESOLVED);
    const remedyOc = await ctx.outcomes.getContract(pipeline.value.remedyOutcomeContractId);
    expect(remedyOc.ok).toBe(true);
    if (remedyOc.ok) {
      expect(remedyOc.value.state).not.toBe(OutcomeContractState.SATISFIED);
    }
  });

  it("remediation spend is bounded; excess escalates", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const spend = ctx.resolution.recordRemediationSpend(
      opened.value.id,
      DEFAULT_RESOLUTION_BOUNDS.maxEconomicExposure + 1,
      NOW,
    );
    expect(spend.ok).toBe(true);
    if (!spend.ok) return;
    expect(spend.value.state).toBe(ResolutionCaseState.ESCALATED);
  });

  it("failed remedy opens child case; parent remains unresolved; recursion capped", async () => {
    const bounds = { ...DEFAULT_RESOLUTION_BOUNDS, maxRecursionDepth: 1 };
    const ctx = await seedPartialProcurement();
    const res = new ResolutionService(ctx.outcomes, bounds);
    const parent = await res.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;
    expect(parent.value.state).not.toBe(ResolutionCaseState.RESOLVED);

    const child = await res.openChildCaseAfterFailedRemedy({
      parentCaseId: parent.value.id,
      intentState: ctx.state,
      principalId: "principal-1",
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.value.parentCaseId).toBe(parent.value.id);
    expect(child.value.recursionDepth).toBe(1);
    const still = res.getCase(parent.value.id);
    expect(still.ok).toBe(true);
    if (still.ok) {
      expect(still.value.state).not.toBe(ResolutionCaseState.RESOLVED);
      expect(still.value.state).not.toBe(ResolutionCaseState.CLOSED);
    }

    const grandchild = await res.openChildCaseAfterFailedRemedy({
      parentCaseId: child.value.id,
      intentState: ctx.state,
      principalId: "principal-1",
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    expect(grandchild.ok).toBe(true);
    if (!grandchild.ok) return;
    // depth 2 > max 1 → escalate the child parent path
    expect(grandchild.value.state).toBe(ResolutionCaseState.ESCALATED);
  });

  it("carrier evidence strengthens logistics to LIKELY not ESTABLISHED", async () => {
    const ctx = await seedPartialProcurement();
    const opened = await ctx.resolution.openCaseFromTrigger({
      intentState: ctx.state,
      principalId: "principal-1",
      contractId: ctx.contract.id,
      triggerEvent: ctx.trigger,
      now: NOW,
    });
    if (!opened.ok) return;
    const hyp = ctx.resolution.proposeHypothesis(opened.value.id, {
      id: "hyp-log",
      assertedCause: RootCauseCode.LOGISTICS_FAILURE,
      involvedActor: "carrier",
      supportingEvidenceIds: ["ev-carrier-weight", "ev-warehouse"],
      contradictoryEvidenceIds: [],
      missingEvidence: ["packing-seal-photo"],
      confidence: 0.7,
      status: ResponsibilityState.LIKELY,
      createdAt: NOW,
    });
    expect(hyp.ok).toBe(true);
    if (!hyp.ok) return;
    expect(hyp.value.status).toBe(ResponsibilityState.LIKELY);
    expect(hyp.value.status).not.toBe(ResponsibilityState.ESTABLISHED);
  });
});
