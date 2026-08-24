import { MemoryPubSubPublisherPort, PubSubTopics } from "@truemandate/cloud-pubsub";
import {
  AnalyticsPayloadField,
  AnalyticsTopic,
  FIELD_CONTRACT,
} from "@truemandate/analytics-query";
import { describe, expect, it } from "vitest";
import {
  publishGuardianVerdictEvent,
  publishPlanCreatedEvent,
} from "./analytics-events.js";

describe("Wave 3.5 plan/guardian analytics field-contract compliance", () => {
  it("PLAN_CREATED emits ambiguityClass", () => {
    const publisher = new MemoryPubSubPublisherPort();
    publishPlanCreatedEvent(publisher, {
      workflowId: "wf-1",
      intentId: "intent-1",
      planId: "plan-1",
      ambiguityClass: "A1",
    });
    const planRow = FIELD_CONTRACT.find((r) => r.topic === AnalyticsTopic.PLAN)!;
    const published = publisher.published.find(
      (p) => p.topic === PubSubTopics.PLAN,
    );
    expect(published).toBeDefined();
    expect(published!.envelope.type).toBe("PLAN_CREATED");
    for (const field of planRow.fields) {
      expect(published!.envelope.payload[field]).toBeDefined();
    }
    expect(published!.envelope.payload.ambiguityClass).toBe("A1");
  });

  it("GUARDIAN_VERDICT emits decision and agentId", () => {
    const publisher = new MemoryPubSubPublisherPort();
    publishGuardianVerdictEvent(publisher, {
      workflowId: "wf-1",
      intentId: "intent-1",
      agentId: "agent-runtime",
      decision: "ALLOW",
      criticalFailure: false,
      semanticStatus: "CLEAR",
    });
    const guardianRow = FIELD_CONTRACT.find(
      (r) => r.topic === AnalyticsTopic.GUARDIAN,
    )!;
    const published = publisher.published.find(
      (p) => p.topic === PubSubTopics.GUARDIAN,
    );
    expect(published).toBeDefined();
    expect(published!.envelope.type).toBe("GUARDIAN_VERDICT");
    for (const field of guardianRow.fields) {
      expect(published!.envelope.payload[field]).toBeDefined();
    }
    expect(published!.envelope.payload.decision).toBe("ALLOW");
    expect(published!.envelope.payload.agentId).toBe("agent-runtime");
  });

  it("fail-open: soft-fail publisher does not throw", () => {
    const publisher = new MemoryPubSubPublisherPort();
    publisher.setFailPublishes(true);
    expect(() =>
      publishGuardianVerdictEvent(publisher, {
        workflowId: "wf-1",
        intentId: "intent-1",
        agentId: "agent-runtime",
        decision: "BLOCK",
      }),
    ).not.toThrow();
    void AnalyticsPayloadField.DECISION;
  });
});
