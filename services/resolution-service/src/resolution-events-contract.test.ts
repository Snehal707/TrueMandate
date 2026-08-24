import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import {
  AnalyticsPayloadField,
  AnalyticsTopic,
  FIELD_CONTRACT,
} from "@truemandate/analytics-query";
import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import {
  OutcomeContractState,
  ResolutionCaseState,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ResolutionService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";

describe("Wave 3.5/3.6 resolution.events field-contract compliance", () => {
  it("emits REMEDY_COMPLETED with restored and remedyType from the bound RemedyProposal", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-res-contract",
      principalId: "principal-1",
      rawText: "Buy containers",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-res-contract",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-res-contract",
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
    resolution.transition(
      opened.value.id,
      ResolutionCaseState.REMEDIATING,
      NOW,
      "auth",
    );
    const stub = await resolution.createRemedyOutcomeContractStub({
      caseId: opened.value.id,
      kind: "refund",
      intentState: state.value,
      principalId: "principal-1",
      now: NOW,
    });
    if (!stub.ok) throw new Error(stub.message);
    const afterTool = resolution.observeRemedyToolSuccess({
      caseId: opened.value.id,
      remedyOutcomeContractId: stub.value.outcomeContractId,
      now: NOW,
    });
    if (!afterTool.ok) throw new Error(afterTool.message);

    const resolved = resolution.resolveFromRemedyOutcome({
      caseId: opened.value.id,
      remedyContractState: OutcomeContractState.SATISFIED,
      now: NOW,
    });
    expect(resolved.ok).toBe(true);

    const resolutionRow = FIELD_CONTRACT.find(
      (r) => r.topic === AnalyticsTopic.RESOLUTION,
    )!;
    const published = publisher.published.filter(
      (p) =>
        p.topic === PubSubTopics.RESOLUTION &&
        p.envelope.type === "REMEDY_COMPLETED",
    );
    expect(published).toHaveLength(1);
    const payload = published[0]!.envelope.payload;
    for (const field of resolutionRow.fields) {
      expect(payload[field], `missing ${field}`).toBeDefined();
    }
    expect(payload.restored).toBe(true);
    // Wave 3.6: real deterministic taxonomy from the RemedyProposal bound
    // to this case's mandate — never fabricated.
    expect(payload[AnalyticsPayloadField.REMEDY_TYPE]).toBe(topRemedy.remedyType);
  });

  it("omits remedyType (never fabricates) when no mandate/remedy binding exists", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-res-contract-2",
      principalId: "principal-1",
      rawText: "Buy containers",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-res-contract-2",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "oc-res-contract-2",
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

    // Remedies were proposed but no mandate was ever issued for this case
    // (e.g. a non-financial remedy path) — restored is real, but no
    // RemedyProposal is bound via a mandate, so remedyType must be omitted.
    await resolution.planRemedies(opened.value.id, NOW);
    resolution.transition(
      opened.value.id,
      ResolutionCaseState.AWAITING_AUTHORITY,
      NOW,
      "test",
    );
    resolution.transition(
      opened.value.id,
      ResolutionCaseState.REMEDIATING,
      NOW,
      "auth",
    );
    const stub = await resolution.createRemedyOutcomeContractStub({
      caseId: opened.value.id,
      kind: "refund",
      intentState: state.value,
      principalId: "principal-1",
      now: NOW,
    });
    if (!stub.ok) throw new Error(stub.message);
    const afterTool = resolution.observeRemedyToolSuccess({
      caseId: opened.value.id,
      remedyOutcomeContractId: stub.value.outcomeContractId,
      now: NOW,
    });
    if (!afterTool.ok) throw new Error(afterTool.message);

    const resolved = resolution.resolveFromRemedyOutcome({
      caseId: opened.value.id,
      remedyContractState: OutcomeContractState.SATISFIED,
      now: NOW,
    });
    expect(resolved.ok).toBe(true);

    const published = publisher.published.filter(
      (p) =>
        p.topic === PubSubTopics.RESOLUTION &&
        p.envelope.type === "REMEDY_COMPLETED",
    );
    expect(published).toHaveLength(1);
    expect(published[0]!.envelope.payload.restored).toBe(true);
    expect(published[0]!.envelope.payload[AnalyticsPayloadField.REMEDY_TYPE]).toBeUndefined();
  });
});
