import { describe, expect, it } from "vitest";
import {
  assembleWorkspace,
  mergeTimeline,
  projectAuthority,
  projectGuardian,
  projectIntentSummary,
  projectOutcome,
  projectProvenanceGraph,
  projectResolution,
  projectSemanticState,
  redactForUi,
  sliceSourceGrounding,
} from "./index.js";

describe("read-model projectors", () => {
  it("does not mutate canonical-like input objects", () => {
    const intent = {
      id: "i1" as never,
      principalId: "p1" as never,
      rawText: "Buy 500 food-grade containers",
      createdAt: "2026-01-01T00:00:00.000Z",
      contentHash: "h" as never,
    };
    const before = { ...intent };
    projectIntentSummary({ intent });
    expect(intent).toEqual(before);
  });

  it("keeps raw intent visible and grounds UTF-16 spans", () => {
    const raw = "Buy 500 food-grade containers";
    const start = raw.indexOf("food-grade");
    const end = start + "food-grade".length;
    expect(sliceSourceGrounding(raw, { start, end })).toBe("food-grade");
    const semantic = projectSemanticState({
      intent: {
        id: "i1" as never,
        principalId: "p1" as never,
        rawText: raw,
        createdAt: "2026-01-01T00:00:00.000Z",
        contentHash: "h" as never,
      },
      constraints: [
        {
          id: "c1" as never,
          concept: "food_grade",
          operator: "REQUIRE" as never,
          value: true,
          kind: "SAFETY_CRITICAL" as never,
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN" as never,
          sourceText: "food-grade",
          sourceSpan: { start, end },
          mutability: "IMMUTABLE" as never,
          meaningClass: "EXPLICIT" as never,
        },
      ],
    });
    expect(semantic.rawIntent).toBe(raw);
    expect(semantic.constraints[0]?.sourceSpan).toEqual({ start, end });
  });

  it("renders payment and outcome from canonical fields separately", () => {
    const view = projectOutcome({
      id: "oc1" as never,
      intentId: "i1" as never,
      intentStateId: "s1" as never,
      requirements: [
        {
          id: "r1" as never,
          concept: "quantity_received",
          operator: "EQ" as never,
          value: 450,
          criticality: "HARD" as never,
          state: "PARTIAL" as never,
        },
      ],
      state: "PARTIAL" as never,
      paymentStatus: "SUCCESS" as never,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      contractHash: "h" as never,
    });
    expect(view?.paymentStatus).toBe("SUCCESS");
    expect(view?.contractState).toBe("PARTIAL");
    expect(view?.paymentStatus).not.toBe(view?.contractState);
  });

  it("AT_RISK derives deadline from requirement fields only", () => {
    const atRisk = projectOutcome({
      id: "oc2" as never,
      intentId: "i1" as never,
      intentStateId: "s1" as never,
      requirements: [
        {
          id: "r-dl" as never,
          concept: "delivery_before",
          operator: "LTE" as never,
          value: "2026-06-06T23:59:59.000Z",
          criticality: "HARD" as never,
          state: "AT_RISK" as never,
        },
      ],
      state: "AT_RISK" as never,
      paymentStatus: "SUCCESS" as never,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      contractHash: "h" as never,
    });
    expect(atRisk?.atRisk).toEqual({ deadline: "2026-06-06T23:59:59.000Z" });
    expect(atRisk?.atRisk?.basis).toBeUndefined();
    expect(atRisk?.contractState).not.toBe("BREACHED");

    const emptyReqs = projectOutcome({
      id: "oc2b" as never,
      intentId: "i1" as never,
      intentStateId: "s1" as never,
      requirements: [],
      state: "AT_RISK" as never,
      paymentStatus: "SUCCESS" as never,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      contractHash: "h" as never,
    });
    expect(emptyReqs?.atRisk).toEqual({});

    const res = projectResolution({
      case: {
        id: "rc1" as never,
        contractId: "oc1" as never,
        intentId: "i1" as never,
        intentStateId: "s1" as never,
        openedAt: "2026-01-01T00:00:00.000Z",
        responsibilityState: "UNKNOWN" as never,
        missingEvidence: [],
        state: "OPEN" as never,
      },
    });
    expect(res?.blameHonest).toBe(true);
    expect(res?.responsibilityState).toBe("UNKNOWN");
  });

  it("Guardian judges remain separate from aggregator", () => {
    const g = projectGuardian({
      id: "gv1",
      actionId: "a1" as never,
      intentId: "i1" as never,
      intentStateId: "s1" as never,
      intentStateHash: "h" as never,
      actionContentHash: "h" as never,
      evidenceSnapshotHash: "e" as never,
      decision: "ALLOW" as never,
      semanticStatus: "CLEAR" as never,
      overallFidelity: 1,
      constraintClaims: [],
      contradictions: [],
      uncertainty: 0,
      criticalFailure: false,
      judgeResults: [
        {
          judgeId: "FIDELITY" as never,
          status: "OK" as never,
          findings: [
            {
              judgeId: "FIDELITY" as never,
              code: "OK",
              message: "ok",
              severity: "LOW",
              confidence: 1,
              sourceRefs: [],
            },
          ],
        },
      ],
      protocolVersion: "0",
      promptVersions: {},
      schemaVersions: {},
      stale: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      verdictHash: "h" as never,
    });
    expect(g.judges).toHaveLength(1);
    expect(g.aggregator.decision).toBe("ALLOW");
    expect(g.judges[0]?.judgeId).not.toBe(g.aggregator.decision);
  });

  it("Authority view is not inferred from Guardian alone", () => {
    const a = projectAuthority({
      guardianDecision: "ALLOW",
      authorityDecision: "BLOCK",
    });
    expect(a.guardianRecommendation).toBe("ALLOW");
    expect(a.decision).toBe("BLOCK");
    expect(a.decision).not.toBe(a.guardianRecommendation);
  });

  it("provenance edges are only those provided (no invented edges)", () => {
    const g = projectProvenanceGraph({
      nodes: [
        {
          id: "n1" as never,
          kind: "INTENT" as never,
          label: "intent",
          createdAt: "2026-01-01T00:00:00.000Z",
          trustClass: "TRUSTED_HUMAN" as never,
          taint: { classes: [], origins: [] },
        },
        {
          id: "n2" as never,
          kind: "ACTION" as never,
          label: "action",
          createdAt: "2026-01-01T00:00:00.000Z",
          trustClass: "TRUSTED_SYSTEM" as never,
          taint: { classes: ["EXTERNAL_CONTENT"] as never, origins: [] },
        },
      ],
      edges: [
        {
          id: "e1" as never,
          from: "n1" as never,
          to: "n2" as never,
          relation: "RESULTED_IN" as never,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      filter: "tainted",
      tracePath: ["n2", "n1"],
    });
    expect(g.nodes.every((n) => n.tainted)).toBe(true);
    expect(g.edges.every((e) => e.id === "e1")).toBe(true);
    expect(g.traceToHuman).toEqual(["n2", "n1"]);
  });

  it("timeline dedupes by dedupeKey", () => {
    const t = mergeTimeline([
      {
        id: "1",
        type: "A",
        at: "2026-01-01T00:00:00.000Z",
        summary: "a",
        relatedObjectIds: [],
        dedupeKey: "k1",
      },
      {
        id: "2",
        type: "A",
        at: "2026-01-01T00:00:01.000Z",
        summary: "a2",
        relatedObjectIds: [],
        dedupeKey: "k1",
      },
    ]);
    expect(t.events).toHaveLength(1);
  });

  it("redacts secrets", () => {
    const r = redactForUi({
      merchant: "a",
      apiKey: "secret-key",
      nested: { oauthToken: "tok" },
    });
    expect(r.apiKey).toBe("[REDACTED]");
    expect(r.nested.oauthToken).toBe("[REDACTED]");
    expect(r.merchant).toBe("a");
  });

  it("assembleWorkspace keeps payment≠outcome and raw intent", () => {
    const summary = projectIntentSummary({
      intent: {
        id: "i1" as never,
        principalId: "p1" as never,
        rawText: "Buy 500 food-grade",
        createdAt: "2026-01-01T00:00:00.000Z",
        contentHash: "h" as never,
      },
    });
    const ws = assembleWorkspace({
      summary,
      semantic: projectSemanticState({
        intent: {
          id: "i1" as never,
          principalId: "p1" as never,
          rawText: "Buy 500 food-grade",
          createdAt: "2026-01-01T00:00:00.000Z",
          contentHash: "h" as never,
        },
        constraints: [],
      }),
      graph: projectProvenanceGraph({ nodes: [], edges: [] }),
      timeline: mergeTimeline([]),
      outcome: projectOutcome({
        id: "oc" as never,
        intentId: "i1" as never,
        intentStateId: "s1" as never,
        requirements: [],
        state: "PARTIAL" as never,
        paymentStatus: "SUCCESS" as never,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        contractHash: "h" as never,
      }),
    });
    expect(ws.summary.rawIntent).toContain("food-grade");
    expect(ws.outcome?.paymentStatus).toBe("SUCCESS");
    expect(ws.outcome?.contractState).toBe("PARTIAL");
  });
});
