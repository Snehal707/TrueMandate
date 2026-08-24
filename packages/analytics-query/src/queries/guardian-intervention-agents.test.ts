import { describe, expect, it } from "vitest";
import { AnalyticsEventType, AnalyticsTopic } from "../field-contract.js";
import { MemoryBigQueryQueryPort } from "../query-port.js";
import { runGuardianInterventionAgents } from "./guardian-intervention-agents.js";
import { govEvent } from "../test-fixtures.js";

describe("guardianInterventionAgents", () => {
  it("counts non-ALLOW guardian verdicts by agentKey", async () => {
    const port = new MemoryBigQueryQueryPort({
      governanceEvents: [
        govEvent({
          eventId: "g1",
          topic: AnalyticsTopic.GUARDIAN,
          eventType: AnalyticsEventType.GUARDIAN_VERDICT,
          aggregateId: "wf-1",
          actorService: "agent-runtime",
          payload: { decision: "BLOCK", agentId: "agent-x" },
        }),
        govEvent({
          eventId: "g2",
          topic: AnalyticsTopic.GUARDIAN,
          eventType: AnalyticsEventType.GUARDIAN_VERDICT,
          aggregateId: "wf-2",
          actorService: "agent-runtime",
          payload: { decision: "REQUIRE_APPROVAL", agentId: "agent-x" },
        }),
        govEvent({
          eventId: "g3",
          topic: AnalyticsTopic.GUARDIAN,
          eventType: AnalyticsEventType.GUARDIAN_VERDICT,
          aggregateId: "wf-3",
          actorService: "agent-runtime",
          payload: { decision: "ALLOW", agentId: "agent-x" },
        }),
        govEvent({
          eventId: "g4",
          topic: AnalyticsTopic.GUARDIAN,
          eventType: AnalyticsEventType.GUARDIAN_VERDICT,
          aggregateId: "wf-4",
          actorService: "other-agent",
          payload: { decision: "BLOCK" },
        }),
      ],
      provenanceNodes: [],
      provenanceEdges: [],
    });

    const result = await runGuardianInterventionAgents(port);
    expect(result.ok && result.value).toEqual([
      { agentKey: "agent-x", interventionCount: 2, workflowCount: 2 },
      { agentKey: "other-agent", interventionCount: 1, workflowCount: 1 },
    ]);
  });
});
