import { describe, expect, it } from "vitest";
import {
  VIEW_KEY_ALLOWLISTS,
  assertNoUnknownViewKeys,
  pickAllowlisted,
} from "./allowlist.js";

describe("view key allowlists", () => {
  it("pickAllowlisted drops unexpectedFutureField and keeps known keys", () => {
    const raw = {
      contractId: "oc1",
      contractState: "PARTIAL",
      paymentStatus: "SUCCESS",
      requirements: [],
      missingEvidence: [],
      conflicts: [],
      unexpectedFutureField: { nested: true },
      apiKey: "should-not-survive-pick",
    };
    const picked = pickAllowlisted(raw, VIEW_KEY_ALLOWLISTS.OutcomeView);
    expect(picked.contractId).toBe("oc1");
    expect(picked).not.toHaveProperty("unexpectedFutureField");
    expect(picked).not.toHaveProperty("apiKey");
    expect(() =>
      assertNoUnknownViewKeys(picked, VIEW_KEY_ALLOWLISTS.OutcomeView),
    ).not.toThrow();
  });

  it("assertNoUnknownViewKeys rejects nested secrets and unexpectedFutureField", () => {
    const polluted = {
      summary: {
        intentId: "i1",
        rawIntent: "Buy",
        principalId: "p1",
        createdAt: "2026-01-01T00:00:00.000Z",
        historicalStateIds: [],
        unexpectedFutureField: "leak",
      },
      semantic: { intentId: "i1", constraints: [], rawIntent: "Buy" },
      plan: { steps: [] },
      guardian: {
        judges: [],
        aggregator: {
          decision: "ALLOW",
          semanticStatus: "CLEAR",
          criticalFailure: false,
        },
      },
      authority: {
        explanation: "x",
        nested: { oauthToken: "tok", unexpectedFutureField: 1 },
      },
      execution: {
        phase: "EXECUTE",
        sideEffects: [],
        unknownPending: false,
        blockedRetry: false,
      },
      graph: { nodes: [], edges: [] },
      timeline: { events: [] },
    };

    expect(() =>
      assertNoUnknownViewKeys(polluted, [
        ...VIEW_KEY_ALLOWLISTS.IntentWorkspaceView,
        ...VIEW_KEY_ALLOWLISTS.IntentSummaryView,
        ...VIEW_KEY_ALLOWLISTS.SemanticStateView,
        ...VIEW_KEY_ALLOWLISTS.PlanView,
        ...VIEW_KEY_ALLOWLISTS.GuardianView,
        ...VIEW_KEY_ALLOWLISTS.AuthorityView,
        ...VIEW_KEY_ALLOWLISTS.ExecutionView,
        ...VIEW_KEY_ALLOWLISTS.ProvenanceGraphView,
        ...VIEW_KEY_ALLOWLISTS.TimelineView,
        "decision",
        "semanticStatus",
        "criticalFailure",
        "nested",
        "oauthToken",
        "unexpectedFutureField",
      ]),
    ).not.toThrow();

    // Without secret/future keys in the allowlist they must be rejected.
    expect(() =>
      assertNoUnknownViewKeys(polluted, [
        ...VIEW_KEY_ALLOWLISTS.IntentWorkspaceView,
        ...VIEW_KEY_ALLOWLISTS.IntentSummaryView,
        ...VIEW_KEY_ALLOWLISTS.SemanticStateView,
        ...VIEW_KEY_ALLOWLISTS.PlanView,
        ...VIEW_KEY_ALLOWLISTS.GuardianView,
        ...VIEW_KEY_ALLOWLISTS.AuthorityView,
        ...VIEW_KEY_ALLOWLISTS.ExecutionView,
        ...VIEW_KEY_ALLOWLISTS.ProvenanceGraphView,
        ...VIEW_KEY_ALLOWLISTS.TimelineView,
        "decision",
        "semanticStatus",
        "criticalFailure",
      ]),
    ).toThrow(/Unexpected view key/);

    const sanitizedSummary = pickAllowlisted(
      polluted.summary as Record<string, unknown>,
      VIEW_KEY_ALLOWLISTS.IntentSummaryView,
    );
    expect(sanitizedSummary).not.toHaveProperty("unexpectedFutureField");

    const sanitizedAuthority = pickAllowlisted(
      {
        explanation: "x",
        decision: "ALLOW",
        oauthToken: "tok",
        unexpectedFutureField: 1,
      },
      VIEW_KEY_ALLOWLISTS.AuthorityView,
    );
    expect(sanitizedAuthority).not.toHaveProperty("oauthToken");
    expect(sanitizedAuthority).not.toHaveProperty("unexpectedFutureField");
    expect(sanitizedAuthority.explanation).toBe("x");
  });

  it("deep nested unexpectedFutureField is stripped by pick then assert passes", () => {
    const outcome = {
      contractId: "oc",
      contractState: "AT_RISK",
      paymentStatus: "SUCCESS",
      requirements: [
        {
          concept: "delivery_before",
          criticality: "HARD",
          state: "AT_RISK",
          display: "delivery_before",
          unexpectedFutureField: "nope",
          apiKey: "secret",
        },
      ],
      atRisk: {},
      missingEvidence: [],
      conflicts: [],
      unexpectedFutureField: "top",
    };
    const top = pickAllowlisted(outcome, VIEW_KEY_ALLOWLISTS.OutcomeView);
    expect(top).not.toHaveProperty("unexpectedFutureField");
    const req = pickAllowlisted(
      outcome.requirements[0]! as Record<string, unknown>,
      VIEW_KEY_ALLOWLISTS.OutcomeRequirementView,
    );
    expect(req).not.toHaveProperty("unexpectedFutureField");
    expect(req).not.toHaveProperty("apiKey");
    const rebuilt = { ...top, requirements: [req] };
    expect(() =>
      assertNoUnknownViewKeys(rebuilt, [
        ...VIEW_KEY_ALLOWLISTS.OutcomeView,
        ...VIEW_KEY_ALLOWLISTS.OutcomeRequirementView,
      ]),
    ).not.toThrow();
  });
});
