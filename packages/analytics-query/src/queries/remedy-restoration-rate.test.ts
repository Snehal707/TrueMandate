import { describe, expect, it } from "vitest";
import { AnalyticsEventType, AnalyticsTopic } from "../field-contract.js";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runRemedyRestorationRate } from "./remedy-restoration-rate.js";
import { govEvent } from "../test-fixtures.js";

describe("remedyRestorationRate", () => {
  it("ranks remedy types by restoration rate", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [
        govEvent({
          eventId: "r1",
          topic: AnalyticsTopic.RESOLUTION,
          eventType: AnalyticsEventType.REMEDY_COMPLETED,
          aggregateId: "wf-1",
          payload: { remedyType: "REPLACEMENT", restored: true },
        }),
        govEvent({
          eventId: "r2",
          topic: AnalyticsTopic.RESOLUTION,
          eventType: AnalyticsEventType.REMEDY_COMPLETED,
          aggregateId: "wf-2",
          payload: { remedyType: "REPLACEMENT", restored: true },
        }),
        govEvent({
          eventId: "r3",
          topic: AnalyticsTopic.RESOLUTION,
          eventType: AnalyticsEventType.REMEDY_COMPLETED,
          aggregateId: "wf-3",
          payload: { remedyType: "REFUND", restored: false },
        }),
        govEvent({
          eventId: "r4",
          topic: AnalyticsTopic.RESOLUTION,
          eventType: AnalyticsEventType.REMEDY_COMPLETED,
          aggregateId: "wf-4",
          payload: { remedyType: "REFUND", restored: true },
        }),
      ],
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runRemedyRestorationRate(port);
    expect(result.ok && result.value).toEqual([
      {
        remedyType: "REPLACEMENT",
        totalRemedies: 2,
        restoredCount: 2,
        restorationRate: 1,
      },
      {
        remedyType: "REFUND",
        totalRemedies: 2,
        restoredCount: 1,
        restorationRate: 0.5,
      },
    ]);
  });
});
