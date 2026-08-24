import { describe, expect, it } from "vitest";
import { AnalyticsEventType, AnalyticsTopic } from "../field-contract.js";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runCounterpartyOutcomeCorrelation } from "./counterparty-outcome-correlation.js";
import { govEvent } from "../test-fixtures.js";

describe("counterpartyOutcomeCorrelation", () => {
  it("ranks merchants by partial/breached failure rate", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [
        govEvent({
          eventId: "o1",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_BREACHED,
          aggregateId: "wf-1",
          payload: { merchant: "BadCo" },
        }),
        govEvent({
          eventId: "o2",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_PARTIAL,
          aggregateId: "wf-2",
          payload: { merchant: "BadCo" },
        }),
        govEvent({
          eventId: "o3",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_SATISFIED,
          aggregateId: "wf-3",
          payload: { merchant: "GoodCo" },
        }),
        govEvent({
          eventId: "o4",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_SATISFIED,
          aggregateId: "wf-4",
          payload: { merchant: "GoodCo" },
        }),
        govEvent({
          eventId: "o5",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_PARTIAL,
          aggregateId: "wf-5",
          payload: { merchant: "MixedCo" },
        }),
        govEvent({
          eventId: "o6",
          topic: AnalyticsTopic.OUTCOME,
          eventType: AnalyticsEventType.OUTCOME_SATISFIED,
          aggregateId: "wf-6",
          payload: { merchant: "MixedCo" },
        }),
      ],
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runCounterpartyOutcomeCorrelation(port);
    expect(result.ok && result.value).toEqual([
      {
        merchant: "BadCo",
        totalOutcomes: 2,
        partialOrBreached: 2,
        failureRate: 1,
      },
      {
        merchant: "MixedCo",
        totalOutcomes: 2,
        partialOrBreached: 1,
        failureRate: 0.5,
      },
      {
        merchant: "GoodCo",
        totalOutcomes: 2,
        partialOrBreached: 0,
        failureRate: 0,
      },
    ]);
  });
});
