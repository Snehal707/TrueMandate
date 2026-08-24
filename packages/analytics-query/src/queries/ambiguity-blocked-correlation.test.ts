import { describe, expect, it } from "vitest";
import { AnalyticsEventType, AnalyticsTopic } from "../field-contract.js";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runAmbiguityBlockedCorrelation } from "./ambiguity-blocked-correlation.js";
import { govEvent } from "../test-fixtures.js";

describe("ambiguityBlockedCorrelation", () => {
  it("correlates plan ambiguity class with authority BLOCK on aggregate_id", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [
        govEvent({
          eventId: "p1",
          topic: AnalyticsTopic.PLAN,
          eventType: AnalyticsEventType.PLAN_CREATED,
          aggregateId: "wf-a",
          payload: { ambiguityClass: "A3" },
        }),
        govEvent({
          eventId: "a1",
          topic: AnalyticsTopic.AUTHORITY,
          eventType: AnalyticsEventType.AUTHORITY_DECISION,
          aggregateId: "wf-a",
          payload: { decision: "BLOCK" },
        }),
        govEvent({
          eventId: "p2",
          topic: AnalyticsTopic.PLAN,
          eventType: AnalyticsEventType.PLAN_CREATED,
          aggregateId: "wf-b",
          payload: { ambiguityClass: "A3" },
        }),
        govEvent({
          eventId: "a2",
          topic: AnalyticsTopic.AUTHORITY,
          eventType: AnalyticsEventType.AUTHORITY_DECISION,
          aggregateId: "wf-b",
          payload: { decision: "ALLOW" },
        }),
        govEvent({
          eventId: "p3",
          topic: AnalyticsTopic.PLAN,
          eventType: AnalyticsEventType.PLAN_CREATED,
          aggregateId: "wf-c",
          payload: { ambiguityClass: "A0" },
        }),
        govEvent({
          eventId: "a3",
          topic: AnalyticsTopic.AUTHORITY,
          eventType: AnalyticsEventType.AUTHORITY_DECISION,
          aggregateId: "wf-c",
          payload: { decision: "ALLOW" },
        }),
      ],
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runAmbiguityBlockedCorrelation(port);
    expect(result.ok && result.value).toEqual([
      {
        ambiguityClass: "A3",
        planCount: 2,
        blockedCount: 1,
        blockRate: 0.5,
      },
      {
        ambiguityClass: "A0",
        planCount: 1,
        blockedCount: 0,
        blockRate: 0,
      },
    ]);
  });
});
