import { envelopeToGovernanceEventRow } from "@truemandate/analytics-bigquery";
import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { OutcomeContractState, ResolutionCaseState } from "@truemandate/protocol";
import { ResolutionService } from "@truemandate/resolution-service";
import { describe, expect, it } from "vitest";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runRemedyRestorationRate } from "./remedy-restoration-rate.js";
import { runWeakenedConstraints } from "./weakened-constraints.js";

const NOW = "2026-06-04T12:00:00.000Z";
const LATER = "2026-06-04T13:00:00.000Z";

/**
 * Wave 3.6: end-to-end pipeline tests proving the two cross-workflow queries
 * (weakenedConstraints, remedyRestorationRate) produce correct results from
 * REAL runtime publisher output — real IntentService/ResolutionService
 * lifecycles, through the real envelope -> BigQuery row transform — not
 * hand-crafted synthetic event fixtures.
 */
describe("Wave 3.6 real-publisher pipeline: weakenedConstraints", () => {
  it("ranks a concept weakened by a real IntentState transition", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);

    const intent = await intents.createIntent({
      id: "intent-pipeline-1",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);

    const v1 = await intents.createIntentState({
      id: "state-pipeline-1-v1",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: "budget",
          concept: "budget_max",
          operator: "LTE",
          value: 800000,
          kind: "FINANCIAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          mutability: "HUMAN_REVISABLE",
          meaningClass: "EXPLICIT",
        },
      ],
    });
    if (!v1.ok) throw new Error(v1.message);

    const v2 = await intents.createIntentState({
      id: "state-pipeline-1-v2",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: LATER,
      constraints: [
        {
          id: "budget",
          concept: "budget_max",
          operator: "LTE",
          value: 950000,
          kind: "FINANCIAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          mutability: "HUMAN_REVISABLE",
          meaningClass: "EXPLICIT",
        },
      ],
    });
    if (!v2.ok) throw new Error(v2.message);

    // Real publisher output -> real envelope -> BigQuery row transform.
    const rows = publisher.published
      .filter((p) => p.topic === PubSubTopics.INTENT)
      .map((p) => envelopeToGovernanceEventRow(p.topic, p.envelope));
    expect(rows).toHaveLength(1);

    const port = new MemoryBigQueryQueryPort({
      governanceEvents: rows,
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runWeakenedConstraints(port);
    expect(result.ok && result.value).toEqual([
      { concept: "budget_max", weakenCount: 1, workflowCount: 1 },
    ]);
  });
});

describe("Wave 3.6 real-publisher pipeline: remedyRestorationRate", () => {
  it("ranks the real remedyType bound to a restored ResolutionCase", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-pipeline-2",
      principalId: "principal-1",
      rawText: "Buy containers",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-pipeline-2",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);

    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-pipeline-2",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) throw new Error(contract.message);
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
    if (!trigger) throw new Error("no OUTCOME_PARTIAL trigger");

    const resolution = new ResolutionService(outcomes, undefined, undefined, {
      getIntentState: async (id) => {
        const r = await intents.getIntentState(id);
        return r.ok ? r.value : undefined;
      },
      publisher,
    });

    const opened = await resolution.openCaseFromTrigger({
      intentState: state.value,
      principalId: "principal-1",
      contractId: contract.value.id,
      triggerEvent: trigger,
      now: NOW,
    });
    if (!opened.ok) throw new Error(opened.message);

    const remedies = await resolution.planRemedies(opened.value.id, NOW);
    if (!remedies.ok) throw new Error(remedies.message);
    const topRemedy = remedies.value[0]!;
    const issued = await resolution.issueMandate({
      caseId: opened.value.id,
      remedy: topRemedy,
      principalId: "principal-1",
      maxAmount: 100000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: "2026-12-01T00:00:00.000Z",
      now: NOW,
    });
    if (!issued.ok) throw new Error(issued.message);
    resolution.transition(opened.value.id, ResolutionCaseState.REMEDIATING, NOW, "auth");

    const stub = await resolution.createRemedyOutcomeContractStub({
      caseId: opened.value.id,
      kind: "refund",
      intentState: state.value,
      principalId: "principal-1",
      now: NOW,
    });
    if (!stub.ok) throw new Error(stub.message);
    resolution.observeRemedyToolSuccess({
      caseId: opened.value.id,
      remedyOutcomeContractId: stub.value.outcomeContractId,
      now: NOW,
    });

    const resolved = resolution.resolveFromRemedyOutcome({
      caseId: opened.value.id,
      remedyContractState: OutcomeContractState.SATISFIED,
      now: NOW,
    });
    expect(resolved.ok).toBe(true);

    const rows = publisher.published
      .filter((p) => p.topic === PubSubTopics.RESOLUTION)
      .map((p) => envelopeToGovernanceEventRow(p.topic, p.envelope));
    expect(rows).toHaveLength(1);

    const port = new MemoryBigQueryQueryPort({
      governanceEvents: rows,
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runRemedyRestorationRate(port);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        remedyType: topRemedy.remedyType,
        totalRemedies: 1,
        restoredCount: 1,
        restorationRate: 1,
      },
    ]);
  });
});
