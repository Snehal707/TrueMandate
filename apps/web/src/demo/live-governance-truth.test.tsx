import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IntentWorkspaceView, SdkOutcomeView, SdkResolutionCaseView, SdkWorkflowView } from "@truemandate/sdk-core";
import { GovernanceReport } from "./GovernanceReport";
import { LiveProvenanceGraph } from "./LiveProvenanceGraph";
import { sanitizeLiveDisplayValue } from "./LiveDemoPage";
import { buildLiveDemoWorkflowRequest } from "./liveDemoPresets";
import {
  buildGovernanceReport,
  buildLiveProvenanceModel,
  type LiveWorkflowTruthInput,
} from "./liveWorkflowTruth";

function workspace(intentId: string, intentStateId: string, workflowId: string): IntentWorkspaceView {
  return {
    summary: {
      intentId,
      rawIntent: "Book a refundable stay with an approved provider.",
      principalId: "live-demo-web",
      createdAt: "2026-08-24T10:00:00.000Z",
      intentStateId,
      intentStateVersion: 2,
      readiness: "ACTIONABLE",
      ambiguityClass: "A0",
      historicalStateIds: [],
    },
    semantic: {
      intentId,
      rawIntent: "Book a refundable stay with an approved provider.",
      constraints: [
        {
          id: "c-provider",
          concept: "booking_provider_approval",
          operator: "REQUIRE",
          expectedValue: true,
          criticality: "HARD",
          meaningClass: "EXPLICIT",
          status: "SATISFIED",
          criticalFailure: false,
        },
      ],
    },
    plan: {
      planId: "plan-fresh-live",
      steps: [{
        id: "step-book",
        objective: "Book the governed stay",
        commitmentLevel: "ECONOMIC",
        deferred: false,
        irrelevant: false,
        requiredConstraints: ["c-provider"],
        proofObligations: ["proof-c-provider"],
        delegatedCapabilities: ["book_travel"],
      }],
    },
    guardian: {
      judges: [{
        judgeId: "FIDELITY",
        status: "OK",
        findings: [],
        affectedConstraints: [],
      }],
      aggregator: {
        decision: "ALLOW",
        semanticStatus: "VERIFIED",
        criticalFailure: false,
      },
    },
    authority: {
      decision: "ALLOW",
      capability: "book_travel",
      explanation: "Current action preserves the authoritative intent.",
    },
    execution: {
      phase: "COMMIT",
      sideEffects: [{ id: "side-effect-fresh", result: "SUCCESS" }],
      unknownPending: false,
      blockedRetry: false,
    },
    graph: {
      nodes: [
        { id: intentId, kind: "INTENT", label: "Human Intent", tainted: false, taintClasses: [] },
        { id: intentStateId, kind: "INTENT_STATE", label: "IntentState v2", tainted: false, taintClasses: [] },
        { id: "plan-fresh-live", kind: "PLAN", label: "Travel plan", tainted: false, taintClasses: [] },
      ],
      edges: [
        { id: "edge-intent-state", from: intentId, to: intentStateId, relation: "DERIVED_FROM" },
        { id: "edge-state-plan", from: intentStateId, to: "plan-fresh-live", relation: "PRESERVES" },
      ],
    },
    timeline: {
      events: [{
        id: "timeline-plan",
        type: "plan.created",
        at: "2026-08-24T10:01:00.000Z",
        summary: "Plan created",
        relatedObjectIds: ["plan-fresh-live"],
      }],
    },
  };
}

function input(options: {
  readonly withWorkspace?: boolean;
  readonly outcome?: SdkOutcomeView;
  readonly resolution?: SdkResolutionCaseView;
} = {}): LiveWorkflowTruthInput {
  const request = buildLiveDemoWorkflowRequest("travel");
  const intentId = (request.intent.kind === "RAW" ? request.intent.id : request.intent.intentId)!;
  const workflowId = request.workflowId!;
  const intentStateId = "intent-state-fresh-live-v2";
  const workflow: SdkWorkflowView = {
    workflowId,
    state: "EXECUTED",
    artifacts: {
      plan: { id: "plan-fresh-live", hash: "public-hash" },
      planVerification: { id: "plan-verification-fresh-live", hash: "public-hash" },
      guardian: { id: "guardian-fresh-live", hash: "public-hash" },
      commitToken: { id: "ct-never-render", secret: "do-not-render" },
    },
    execution: { status: "SUCCESS", executionId: "exec-fresh-live", resultRef: "mock-result" },
    outcomeContract: options.outcome ? { id: options.outcome.id } : undefined,
  };
  return {
    createdAt: "2026-08-24T10:00:00.000Z",
    domainLabel: "Travel",
    request,
    workflow,
    workspace: options.withWorkspace ? workspace(intentId, intentStateId, workflowId) : undefined,
    outcome: options.outcome,
    resolution: options.resolution,
    evidenceSubmissions: [],
  };
}

describe("live provenance and governance truth", () => {
  it("uses recorded public graph edges and labels presentation-only stage ordering", () => {
    const model = buildLiveProvenanceModel(input({ withWorkspace: true }));
    expect(model.edges).toContainEqual(expect.objectContaining({ relation: "DERIVED_FROM", source: "PUBLIC_API" }));
    expect(model.edges).toContainEqual(expect.objectContaining({ relation: "PRESERVES", source: "PUBLIC_API" }));
    expect(model.edges.filter((edge) => edge.relation === "STAGE_ORDER").every((edge) => edge.source === "DERIVED_PRESENTATION")).toBe(true);
  });

  it("does not create graph nodes for absent lifecycle stages", () => {
    const model = buildLiveProvenanceModel(input());
    expect(model.nodes.some((node) => node.stage === "approval-monitoring")).toBe(false);
    expect(model.nodes.some((node) => node.stage === "outcome")).toBe(false);
    expect(model.nodes.some((node) => node.stage === "resolution")).toBe(false);
  });

  it("shows Resolution only when a real ResolutionCase is present", () => {
    const base = input();
    const outcome: SdkOutcomeView = {
      id: "outcome-fresh-live",
      workflowId: base.workflow.workflowId,
      intentId: (base.request.intent.kind === "RAW" ? base.request.intent.id : base.request.intent.intentId)!,
      intentStateId: "intent-state-fresh-live-v2",
      domain: "travel",
      state: "BREACHED",
      paymentStatus: "SUCCESS",
    };
    const withoutResolution = buildLiveProvenanceModel(input({ outcome }));
    expect(withoutResolution.nodes.some((node) => node.stage === "outcome" && node.state === "BREACHED")).toBe(true);
    expect(withoutResolution.nodes.some((node) => node.stage === "resolution")).toBe(false);

    const resolution: SdkResolutionCaseView = {
      id: "resolution-fresh-live",
      contractId: outcome.id,
      intentId: outcome.intentId,
      intentStateId: outcome.intentStateId,
      openedAt: "2026-08-24T10:04:00.000Z",
      responsibilityState: "UNKNOWN",
      state: "OPEN",
    };
    const withResolution = buildLiveProvenanceModel(input({ outcome, resolution }));
    expect(withResolution.nodes).toContainEqual(expect.objectContaining({ id: resolution.id, stage: "resolution", state: "OPEN" }));
  });

  it("never renders privileged handles and preserves the fresh workflow identity", () => {
    const truth = input({ withWorkspace: true });
    const sanitized = JSON.stringify(sanitizeLiveDisplayValue({
      workflowId: truth.workflow.workflowId,
      commitToken: "ct-secret",
      commitTokenId: "ct-secret-id",
      authorityGrant: { id: "grant-secret" },
      executionAuthorizationPayload: { privateKey: "secret" },
    }));
    expect(sanitized).toContain(truth.workflow.workflowId);
    expect(sanitized).not.toContain("ct-secret");
    expect(sanitized).not.toContain("grant-secret");
    expect(sanitized).not.toContain("privateKey");

    const model = buildLiveProvenanceModel(truth);
    const graphHtml = renderToString(<LiveProvenanceGraph model={model} />);
    const reportHtml = renderToString(
      <GovernanceReport
        workflowId={truth.workflow.workflowId}
        sections={buildGovernanceReport(truth, model)}
      />,
    );
    expect(`${graphHtml}${reportHtml}`).toContain(truth.workflow.workflowId);
    expect(`${graphHtml}${reportHtml}`).not.toContain("phase-c-food-grade-500-v5");
    expect(`${graphHtml}${reportHtml}`).not.toContain("ct-never-render");
  });

  it("renders all report sections and honest unavailable states", () => {
    const truth = input();
    const model = buildLiveProvenanceModel(truth);
    const sections = buildGovernanceReport(truth, model);
    expect(sections.map((item) => item.title)).toEqual([
      "Intent",
      "Decision Summary",
      "Constraint Verification",
      "Authority & Monitoring",
      "Execution",
      "Outcome",
      "Resolution",
      "Provenance / Audit Trail",
      "Observability",
    ]);
    expect(sections.find((item) => item.id === "outcome")?.availability).toBe("NOT_CREATED");
    expect(sections.find((item) => item.id === "resolution")?.availability).toBe("NOT_CREATED");
    const observability = sections.find((item) => item.id === "observability");
    expect(observability?.availability).toBe("NOT_PUBLIC");
    // Private is stated as private — the absence of internal telemetry is never
    // reported as a number, and never as a gap in what the public API can show.
    expect(observability?.rows).toContainEqual({
      label: "Model telemetry",
      value: "Internal model telemetry is private. This view uses verified public workflow artifacts.",
      source: "DERIVED_PRESENTATION",
    });
    expect(observability?.rows).not.toContainEqual(expect.objectContaining({
      label: "Model telemetry",
      value: "0",
    }));
    for (const forbidden of ["Not publicly available through the public API", "Not publicly available"]) {
      expect(observability?.rows.map((item) => item.value), forbidden).not.toContain(forbidden);
    }
  });
});
