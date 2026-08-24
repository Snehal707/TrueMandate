import { describe, expect, it } from "vitest";
import { AnalyticsEventType, AnalyticsTopic } from "../field-contract.js";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runWeakenedConstraints } from "./weakened-constraints.js";
import { CrossWorkflowAnalyticsService } from "../service.js";
import { govEvent } from "../test-fixtures.js";

describe("weakenedConstraints", () => {
  it("ranks concepts by weaken count across workflows deterministically", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [
        govEvent({
          eventId: "e1",
          topic: AnalyticsTopic.INTENT,
          eventType: AnalyticsEventType.DRIFT_DETECTED,
          aggregateId: "wf-a",
          payload: { concept: "food_grade" },
        }),
        govEvent({
          eventId: "e2",
          topic: AnalyticsTopic.SEMANTIC,
          eventType: AnalyticsEventType.CONSTRAINT_WEAKENED,
          aggregateId: "wf-b",
          payload: { concept: "food_grade" },
        }),
        govEvent({
          eventId: "e3",
          topic: AnalyticsTopic.INTENT,
          eventType: AnalyticsEventType.DRIFT_DETECTED,
          aggregateId: "wf-a",
          payload: { concept: "budget_max" },
        }),
        govEvent({
          eventId: "e4",
          topic: AnalyticsTopic.GUARDIAN,
          eventType: AnalyticsEventType.GUARDIAN_VERDICT,
          aggregateId: "wf-a",
          payload: { decision: "BLOCK", concept: "ignored" },
        }),
      ],
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const first = await runWeakenedConstraints(port);
    const second = await runWeakenedConstraints(port);
    expect(first.ok && first.value).toEqual([
      { concept: "food_grade", weakenCount: 2, workflowCount: 2 },
      { concept: "budget_max", weakenCount: 1, workflowCount: 1 },
    ]);
    expect(second.ok && second.value).toEqual(first.ok && first.value);

    const svc = new CrossWorkflowAnalyticsService(port);
    const viaSvc = await svc.weakenedConstraints();
    expect(viaSvc.ok && viaSvc.value).toEqual(first.ok && first.value);
  });
});
