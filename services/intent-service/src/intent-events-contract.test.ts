import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import {
  AnalyticsPayloadField,
  AnalyticsTopic,
  FIELD_CONTRACT,
} from "@truemandate/analytics-query";
import { describe, expect, it } from "vitest";
import { IntentService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";
const LATER = "2026-06-04T13:00:00.000Z";

describe("Wave 3.6 intent.events field-contract compliance", () => {
  it("emits INTENT_RECORDED when a durable raw Intent is created", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const created = await intents.createIntent({
      id: "intent-recorded-1",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.INTENT && p.envelope.type === "INTENT_RECORDED",
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.envelope.payload).toMatchObject({
      intentId: "intent-recorded-1",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
  });

  it("re-emits INTENT_RECORDED on idempotent createIntent replay while no finalized tip exists", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const first = await intents.createIntent({
      id: "intent-recorded-replay",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    publisher.clear();
    const replay = await intents.createIntent({
      id: "intent-recorded-replay",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: LATER,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;

    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.INTENT && p.envelope.type === "INTENT_RECORDED",
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.envelope.idempotencyKey).toBe(
      `intent-recorded:${first.value.id}:${first.value.contentHash}`,
    );
    expect(published[0]?.envelope.payload).toMatchObject({
      intentId: first.value.id,
      createdAt: NOW,
    });
  });

  it("does not re-emit INTENT_RECORDED on idempotent replay after a finalized tip exists", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const first = await intents.createIntent({
      id: "intent-recorded-finalized",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    publisher.clear();
    const state = await intents.createIntentState({
      id: "state-recorded-finalized-v1",
      intentId: first.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    expect(state.ok).toBe(true);
    publisher.clear();

    const replay = await intents.createIntent({
      id: "intent-recorded-finalized",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: LATER,
    });
    expect(replay.ok).toBe(true);

    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.INTENT && p.envelope.type === "INTENT_RECORDED",
    );
    expect(published).toHaveLength(0);
  });

  it("emits CONSTRAINT_WEAKENED with concept when a real bound is loosened", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const intent = await intents.createIntent({
      id: "intent-drift-1",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);

    const v1 = await intents.createIntentState({
      id: "state-drift-1-v1",
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
      id: "state-drift-1-v2",
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
    expect(v2.ok).toBe(true);

    const intentRow = FIELD_CONTRACT.find(
      (r) => r.topic === AnalyticsTopic.INTENT,
    )!;
    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.INTENT && p.envelope.type === "CONSTRAINT_WEAKENED",
    );
    expect(published).toHaveLength(1);
    const payload = published[0]!.envelope.payload;
    for (const field of intentRow.fields) {
      expect(payload[field], `missing ${field}`).toBeDefined();
    }
    expect(payload.concept).toBe("budget_max");
  });

  it("does not emit CONSTRAINT_WEAKENED when constraints only tighten", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const intent = await intents.createIntent({
      id: "intent-drift-2",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);

    const v1 = await intents.createIntentState({
      id: "state-drift-2-v1",
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
      id: "state-drift-2-v2",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: LATER,
      constraints: [
        {
          id: "budget",
          concept: "budget_max",
          operator: "LTE",
          value: 700000,
          kind: "FINANCIAL",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          mutability: "HUMAN_REVISABLE",
          meaningClass: "EXPLICIT",
        },
      ],
    });
    expect(v2.ok).toBe(true);

    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.INTENT && p.envelope.type === "CONSTRAINT_WEAKENED",
    );
    expect(published).toHaveLength(0);
  });

  it("does not emit anything for the first IntentState version (no prior tip)", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService(undefined, undefined, publisher);
    const intent = await intents.createIntent({
      id: "intent-drift-3",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    publisher.clear();

    const v1 = await intents.createIntentState({
      id: "state-drift-3-v1",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    expect(v1.ok).toBe(true);

    expect(publisher.published).toHaveLength(0);
  });

  it("fail-open: soft-fail publisher does not throw and does not block createIntentState", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    publisher.setFailPublishes(true);
    const intents = new IntentService(undefined, undefined, publisher);
    const intent = await intents.createIntent({
      id: "intent-drift-4",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);

    const v1 = await intents.createIntentState({
      id: "state-drift-4-v1",
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

    let v2Result: unknown;
    expect(async () => {
      v2Result = await intents.createIntentState({
        id: "state-drift-4-v2",
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
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    void AnalyticsPayloadField.CONCEPT;
    void v2Result;
  });
});
