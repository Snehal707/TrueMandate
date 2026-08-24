import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import {
  AnalyticsEventType,
  AnalyticsPayloadField,
  AnalyticsTopic,
  FIELD_CONTRACT,
} from "@truemandate/analytics-query";
import { IntentService } from "@truemandate/intent-service";
import { describe, expect, it } from "vitest";
import { OutcomeService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";

describe("Wave 3.5 outcome.events field-contract compliance", () => {
  it("emits OUTCOME_PARTIAL/BREACHED with merchant from contract", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-oc-contract",
      principalId: "principal-1",
      rawText: "Buy 500 containers",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-oc-contract",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);

    const outcomes = new OutcomeService(
      undefined,
      undefined,
      undefined,
      publisher,
    );
    const contract = await outcomes.createContractFromIntent({
      id: "oc-contract-1",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) throw new Error(contract.message);
    expect(contract.value.merchant).toBe("ApprovedFoodChem");

    await outcomes.onPaymentSuccess(contract.value.id, NOW);
    await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 100,
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

    const outcomeRow = FIELD_CONTRACT.find(
      (r) => r.topic === AnalyticsTopic.OUTCOME,
    )!;
    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.OUTCOME,
    );
    expect(published.length).toBeGreaterThanOrEqual(1);
    const matching = published.filter((p) =>
      (
        outcomeRow.eventTypes as readonly string[]
      ).includes(p.envelope.type),
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
    for (const rec of matching) {
      for (const field of outcomeRow.fields) {
        expect(
          rec.envelope.payload[field],
          `missing ${field} on ${rec.envelope.type}`,
        ).toBeDefined();
      }
      expect(rec.envelope.payload.merchant).toBe("ApprovedFoodChem");
    }
  });

  it("does not fabricate merchant when contract has none (legacy)", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const outcomes = new OutcomeService(
      undefined,
      undefined,
      undefined,
      publisher,
    );
    // Direct publish of a trigger-like event without merchant in payload.
    await outcomes.publishEvent({
      id: "ev-legacy",
      contractId: "oc-legacy" as never,
      type: AnalyticsEventType.OUTCOME_PARTIAL,
      observedAt: NOW,
      payload: { state: "PARTIAL" },
      dedupeKey: "legacy-partial",
    });
    const published = publisher.published.find(
      (p) => p.envelope.type === AnalyticsEventType.OUTCOME_PARTIAL,
    );
    expect(published).toBeDefined();
    expect(published!.envelope.payload.merchant).toBeUndefined();
    void AnalyticsPayloadField.MERCHANT;
  });

  it("fail-open: publisher throw does not fail publishEvent Result", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    publisher.setThrowOnPublish(true);
    const outcomes = new OutcomeService(
      undefined,
      undefined,
      undefined,
      publisher,
    );
    const result = await outcomes.publishEvent({
      id: "ev-throw",
      contractId: "oc-throw" as never,
      type: AnalyticsEventType.OUTCOME_BREACHED,
      observedAt: NOW,
      payload: { merchant: "x", state: "BREACHED" },
      dedupeKey: "throw-breach",
    });
    expect(result.ok).toBe(true);
  });
});
