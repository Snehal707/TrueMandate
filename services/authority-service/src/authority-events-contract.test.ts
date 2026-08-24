import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import { IntentService } from "@truemandate/intent-service";
import {
  AnalyticsPayloadField,
  AnalyticsTopic,
  FIELD_CONTRACT,
} from "@truemandate/analytics-query";
import { AuthorityDecision } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { AuthorityService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";

describe("Wave 3.5 authority.events field-contract compliance", () => {
  it("emits AUTHORITY_DECISION with decision (+ agentId when known)", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-auth-contract",
      principalId: "principal-1",
      rawText: "Buy approved containers",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-auth-contract",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);

    const authority = new AuthorityService(
      intents,
      undefined,
      undefined,
      publisher,
    );
    const result = await authority.evaluateAuthorityRequest({
      id: "ar-contract-1",
      principalId: "principal-1",
      agentId: "agent-runtime",
      intentId: intent.value.id,
      intentStateId: state.value.id,
      actionId: "action-1",
      capability: "execute_payment",
      scope: {
        capabilities: { execute_payment: AuthorityDecision.ALLOW },
        maxAmount: 1000,
        currency: "INR",
        allowedMerchants: ["acme"],
      },
      merchant: "acme",
      amount: 1000,
      currency: "INR",
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);

    const authorityRow = FIELD_CONTRACT.find(
      (r) => r.topic === AnalyticsTopic.AUTHORITY,
    )!;
    const published = publisher.published.filter(
      (p) => p.topic === PubSubTopics.AUTHORITY,
    );
    expect(published.length).toBeGreaterThanOrEqual(1);
    const envelope = published[0]!.envelope;
    expect(envelope.type).toBe("AUTHORITY_DECISION");
    for (const field of authorityRow.fields) {
      expect(
        envelope.payload[field],
        `missing required field ${field}`,
      ).toBeDefined();
    }
    expect(envelope.payload.decision).toBeTruthy();
    expect(envelope.payload.agentId).toBe("agent-runtime");
  });

  it("fail-open: publisher soft-failure does not change decision Result", async () => {
    const publisher = new MemoryPubSubPublisherPort();
    publisher.setFailPublishes(true);
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-auth-failopen",
      principalId: "principal-1",
      rawText: "Buy",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-auth-failopen",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);
    const authority = new AuthorityService(
      intents,
      undefined,
      undefined,
      publisher,
    );
    const result = await authority.evaluateAuthorityRequest({
      id: "ar-failopen",
      principalId: "principal-1",
      agentId: "agent-runtime",
      intentId: intent.value.id,
      intentStateId: state.value.id,
      actionId: "action-1",
      capability: "execute_payment",
      scope: {
        capabilities: { execute_payment: AuthorityDecision.ALLOW },
        maxAmount: 100,
        currency: "INR",
        allowedMerchants: ["acme"],
      },
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("backward compatible: default Noop publisher does not emit", async () => {
    const intents = new IntentService();
    const intent = await intents.createIntent({
      id: "intent-auth-noop",
      principalId: "principal-1",
      rawText: "Buy",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    const state = await intents.createIntentState({
      id: "state-auth-noop",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [],
    });
    if (!state.ok) throw new Error(state.message);
    const authority = new AuthorityService(intents);
    const result = await authority.evaluateAuthorityRequest({
      id: "ar-noop",
      principalId: "principal-1",
      agentId: "agent-runtime",
      intentId: intent.value.id,
      intentStateId: state.value.id,
      actionId: "action-1",
      capability: "execute_payment",
      scope: {
        capabilities: { execute_payment: AuthorityDecision.ALLOW },
        maxAmount: 100,
        currency: "INR",
        allowedMerchants: ["acme"],
      },
      createdAt: NOW,
    });
    expect(result.ok).toBe(true);
    // No Memory port attached — nothing to assert on published[], but decision works.
    void AnalyticsPayloadField.DECISION;
  });
});
