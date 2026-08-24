import { describe, expect, it } from "vitest";
import {
  AttackLabScenarioView,
  BenchmarkComparisonView,
  IntentWorkspace,
  Phase11Placeholder,
} from "./panels.js";
import type { IntentWorkspaceView } from "@truemandate/read-model";

const workspace: IntentWorkspaceView = {
  summary: {
    intentId: "i1",
    rawIntent: "Buy 500 food-grade containers",
    principalId: "p1",
    createdAt: "2026-01-01T00:00:00.000Z",
    historicalStateIds: [],
  },
  semantic: {
    intentId: "i1",
    rawIntent: "Buy 500 food-grade containers",
    constraints: [],
  },
  plan: { steps: [] },
  guardian: {
    judges: [{ judgeId: "FIDELITY", status: "OK", findings: [], affectedConstraints: [] }],
    aggregator: {
      decision: "ALLOW",
      semanticStatus: "CLEAR",
      criticalFailure: false,
    },
  },
  authority: {
    guardianRecommendation: "ALLOW",
    decision: "BLOCK",
    explanation: "Guardian recommends. Authority decides. Gateway enforces.",
  },
  execution: {
    phase: "PREPARE",
    sideEffects: [],
    unknownPending: true,
    blockedRetry: true,
  },
  outcome: {
    contractId: "oc1",
    contractState: "PARTIAL",
    paymentStatus: "SUCCESS",
    requirements: [],
    missingEvidence: [],
    conflicts: [],
  },
  resolution: {
    caseId: "rc1",
    state: "OPEN",
    responsibilityState: "UNKNOWN",
    hypotheses: [],
    evidenceRequests: [],
    remedies: [],
    blameHonest: true,
  },
  graph: { nodes: [], edges: [] },
  timeline: { events: [] },
};

describe("dashboard-ui components", () => {
  it("exports workspace and attack lab views", () => {
    expect(typeof IntentWorkspace).toBe("function");
    expect(typeof AttackLabScenarioView).toBe("function");
    expect(typeof BenchmarkComparisonView).toBe("function");
    expect(typeof Phase11Placeholder).toBe("function");
    expect(workspace.outcome?.paymentStatus).not.toBe(workspace.outcome?.contractState);
    expect(workspace.resolution?.blameHonest).toBe(true);
    expect(workspace.execution.unknownPending).toBe(true);
    expect(workspace.authority.decision).not.toBe(
      workspace.authority.guardianRecommendation,
    );
  });
});
