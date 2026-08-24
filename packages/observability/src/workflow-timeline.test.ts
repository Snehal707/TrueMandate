import { describe, expect, it } from "vitest";
import type { WorkflowStageEvent } from "@truemandate/protocol";
import {
  listWorkflowStages,
  type SemanticArtifactTimelinePort,
  type WorkflowStageListPort,
} from "./workflow-timeline.js";

const STAGE_EVENTS: readonly WorkflowStageEvent[] = [
  {
    id: "evt-1",
    workflowId: "wf-1",
    stage: "COMPILATION",
    status: "STARTED",
    occurredAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "evt-2",
    workflowId: "wf-1",
    stage: "COMPILATION",
    status: "COMPLETED",
    occurredAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
  },
];

const ARTIFACTS = [
  { id: "art-1", kind: "PLAN", createdAt: "2026-01-01T00:00:00.500Z" },
  { id: "art-2", kind: "WORKFLOW", createdAt: "2026-01-01T00:00:02.000Z" },
];

describe("listWorkflowStages", () => {
  it("merges and time-orders stage events with semantic artifacts", async () => {
    const stages: WorkflowStageListPort = {
      listStages: async () => STAGE_EVENTS,
    };
    const artifacts: SemanticArtifactTimelinePort = {
      listWorkflow: async () => ARTIFACTS,
    };

    const timeline = await listWorkflowStages("wf-1", { stages, artifacts });

    expect(timeline.map((e) => e.id)).toEqual([
      "evt-1",
      "art-1",
      "evt-2",
      "art-2",
    ]);
    expect(timeline[0]).toMatchObject({ source: "STAGE_EVENT", stage: "COMPILATION", status: "STARTED" });
    expect(timeline[1]).toMatchObject({ source: "SEMANTIC_ARTIFACT", stage: "PLAN" });
    expect(timeline[2]).toMatchObject({ durationMs: 1000 });
  });

  it("is fail-open: a throwing artifacts port yields stage-events-only, never throws", async () => {
    const stages: WorkflowStageListPort = { listStages: async () => STAGE_EVENTS };
    const artifacts: SemanticArtifactTimelinePort = {
      listWorkflow: async () => {
        throw new Error("firestore unavailable");
      },
    };

    const timeline = await listWorkflowStages("wf-1", { stages, artifacts });
    expect(timeline.map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
  });

  it("is fail-open: a throwing stages port yields artifacts-only, never throws", async () => {
    const stages: WorkflowStageListPort = {
      listStages: async () => {
        throw new Error("firestore unavailable");
      },
    };
    const artifacts: SemanticArtifactTimelinePort = { listWorkflow: async () => ARTIFACTS };

    const timeline = await listWorkflowStages("wf-1", { stages, artifacts });
    expect(timeline.map((e) => e.id)).toEqual(["art-1", "art-2"]);
  });

  it("works with no artifacts port supplied", async () => {
    const stages: WorkflowStageListPort = { listStages: async () => STAGE_EVENTS };
    const timeline = await listWorkflowStages("wf-1", { stages });
    expect(timeline.map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
  });
});
