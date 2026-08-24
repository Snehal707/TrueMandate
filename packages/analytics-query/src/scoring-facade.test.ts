import { createLearningProposal } from "@truemandate/authority";
import { describe, expect, it } from "vitest";
import {
  AnalyticsEventType,
  AnalyticsPayloadField,
  AnalyticsTopic,
} from "./field-contract.js";
import { MemoryBigQueryQueryPort } from "./query-port.js";
import {
  generateAgentReliabilityProposals,
  generateCounterpartyTrustProposals,
} from "./scoring-facade.js";
import { govEvent } from "./test-fixtures.js";

const AT = "2026-08-21T12:00:00.000Z";

function seedWithAgentAndMerchant(): MemoryBigQueryQueryPort {
  const events = [
    // Agent with enough workflows (5 distinct aggregates) and 1 intervention
    ...[1, 2, 3, 4, 5].map((i) =>
      govEvent({
        eventId: `g-allow-${i}`,
        topic: AnalyticsTopic.GUARDIAN,
        eventType: AnalyticsEventType.GUARDIAN_VERDICT,
        aggregateId: `wf-${i}`,
        actorService: "agent-runtime",
        payload: {
          [AnalyticsPayloadField.AGENT_ID]: "agent-alpha",
          [AnalyticsPayloadField.DECISION]: i === 1 ? "BLOCK" : "ALLOW",
        },
        occurredAt: AT,
      }),
    ),
    // Extra intervention for agent-alpha on same workflow still counts as intervention
    // but workflow set already has 5 — use a second agent with insufficient history
    govEvent({
      eventId: "g-new-1",
      topic: AnalyticsTopic.GUARDIAN,
      eventType: AnalyticsEventType.GUARDIAN_VERDICT,
      aggregateId: "wf-new-1",
      payload: {
        [AnalyticsPayloadField.AGENT_ID]: "agent-new",
        [AnalyticsPayloadField.DECISION]: "REQUIRE_APPROVAL",
      },
      occurredAt: AT,
    }),
    // Counterparty outcomes for acme (3 satisfied → trust 1.0)
    ...[1, 2, 3].map((i) =>
      govEvent({
        eventId: `o-acme-${i}`,
        topic: AnalyticsTopic.OUTCOME,
        eventType: AnalyticsEventType.OUTCOME_SATISFIED,
        aggregateId: `out-acme-${i}`,
        payload: { [AnalyticsPayloadField.MERCHANT]: "acme" },
        occurredAt: AT,
      }),
    ),
    // sketchy: 2 breached of 3 → trust ≈ 0.333
    govEvent({
      eventId: "o-sk-1",
      topic: AnalyticsTopic.OUTCOME,
      eventType: AnalyticsEventType.OUTCOME_BREACHED,
      aggregateId: "out-sk-1",
      payload: { [AnalyticsPayloadField.MERCHANT]: "sketchy" },
      occurredAt: AT,
    }),
    govEvent({
      eventId: "o-sk-2",
      topic: AnalyticsTopic.OUTCOME,
      eventType: AnalyticsEventType.OUTCOME_PARTIAL,
      aggregateId: "out-sk-2",
      payload: { [AnalyticsPayloadField.MERCHANT]: "sketchy" },
      occurredAt: AT,
    }),
    govEvent({
      eventId: "o-sk-3",
      topic: AnalyticsTopic.OUTCOME,
      eventType: AnalyticsEventType.OUTCOME_SATISFIED,
      aggregateId: "out-sk-3",
      payload: { [AnalyticsPayloadField.MERCHANT]: "sketchy" },
      occurredAt: AT,
    }),
    // insufficient counterparty (1 outcome only)
    govEvent({
      eventId: "o-new-1",
      topic: AnalyticsTopic.OUTCOME,
      eventType: AnalyticsEventType.OUTCOME_SATISFIED,
      aggregateId: "out-new-1",
      payload: { [AnalyticsPayloadField.MERCHANT]: "new-vendor" },
      occurredAt: AT,
    }),
  ];

  return new MemoryBigQueryQueryPort({
    governanceEvents: events,
    provenanceNodes: [],
    provenanceEdges: [],
  });
}

describe("scoring-facade", () => {
  it("generates AGENT_RELIABILITY drafts from guardian verdict analytics", async () => {
    const port = seedWithAgentAndMerchant();
    const result = await generateAgentReliabilityProposals(port, {
      principalId: "principal-1",
      computedAt: AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const alpha = result.value.find(
      (d) => d.content.trustSignal.subjectId === "agent-alpha",
    );
    const newbie = result.value.find(
      (d) => d.content.trustSignal.subjectId === "agent-new",
    );
    expect(alpha).toBeDefined();
    expect(newbie).toBeDefined();
    if (!alpha || !newbie) return;

    expect(alpha.proposalType).toBe("AGENT_RELIABILITY");
    expect(alpha.content.trustSignal.subjectType).toBe("AGENT");
    // 5 workflows, 1 BLOCK → reliability = 1 - 1/5 = 0.8
    expect(alpha.content.trustSignal.sampleSize).toBe(5);
    expect(alpha.content.trustSignal.value).toBeCloseTo(0.8, 6);

    // 1 workflow only → insufficient evidence → neutral 0.5
    expect(newbie.content.trustSignal.value).toBe(0.5);
    expect(
      newbie.content.trustSignal.basis.some((b) =>
        b.startsWith("insufficient_evidence"),
      ),
    ).toBe(true);

    const created = createLearningProposal({ draft: alpha });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresConfirmation).toBe(true);
    expect(created.value.status).toBe("PROPOSED");
  });

  it("generates COUNTERPARTY_TRUST drafts from outcome correlation analytics", async () => {
    const port = seedWithAgentAndMerchant();
    const result = await generateCounterpartyTrustProposals(port, {
      principalId: "principal-1",
      computedAt: AT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const acme = result.value.find(
      (d) => d.content.trustSignal.subjectId === "acme",
    );
    const sketchy = result.value.find(
      (d) => d.content.trustSignal.subjectId === "sketchy",
    );
    const newbie = result.value.find(
      (d) => d.content.trustSignal.subjectId === "new-vendor",
    );
    expect(acme).toBeDefined();
    expect(sketchy).toBeDefined();
    expect(newbie).toBeDefined();
    if (!acme || !sketchy || !newbie) return;

    expect(acme.proposalType).toBe("COUNTERPARTY_TRUST");
    expect(acme.content.trustSignal.value).toBe(1.0);
    expect(sketchy.content.trustSignal.value).toBeCloseTo(1 - 2 / 3, 6);
    expect(newbie.content.trustSignal.value).toBe(0.5);

    const created = createLearningProposal({ draft: acme });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requiresConfirmation).toBe(true);
  });
});
