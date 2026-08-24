import {
  AnalyticsEventType,
  AnalyticsTopic,
  CrossWorkflowAnalyticsService,
  MemoryBigQueryQueryPort,
} from "@truemandate/analytics-query";
import { deriveExportId } from "@truemandate/analytics-bigquery";
import { describe, expect, it } from "vitest";
import { createAnalyticsQueryRoutes } from "./analytics-query-routes.js";

function makePort() {
  return new MemoryBigQueryQueryPort({
    governanceEvents: [
      {
        export_id: deriveExportId("event", "e1"),
        topic: AnalyticsTopic.INTENT,
        event_id: "e1",
        event_type: AnalyticsEventType.DRIFT_DETECTED,
        aggregate_id: "wf-1",
        aggregate_version: 1,
        causation_id: "c",
        correlation_id: "corr",
        actor_service: "intent",
        protocol_version: "0.1.0",
        schema_version: "1",
        payload_hash: "h",
        idempotency_key: "idem-e1",
        provenance_refs: [],
        payload: JSON.stringify({ concept: "food_grade" }),
        occurred_at: "2026-08-01T12:00:00.000Z",
        exported_at: "2026-08-01T12:00:00.000Z",
      },
    ],
    provenanceNodes: [
      {
        export_id: deriveExportId("node", "n1"),
        node_id: "n1",
        kind: "INTENT",
        label: "intent",
        trust_class: "TRUSTED_HUMAN",
        taint: null,
        subject_ref: "wf-1",
        created_at: "2026-08-01T12:00:00.000Z",
        exported_at: "2026-08-01T12:00:00.000Z",
        schema_version: "1",
      },
    ],
    provenanceEdges: [],
  });
}

describe("analytics-query-routes", () => {
  it("exposes six read-only analytics GET routes", () => {
    const analytics = new CrossWorkflowAnalyticsService(makePort());
    const routes = createAnalyticsQueryRoutes({ analytics });
    expect(routes.map((r) => r.pattern).sort()).toEqual(
      [
        "/internal/analytics/ambiguity-blocked-correlation",
        "/internal/analytics/counterparty-outcome-correlation",
        "/internal/analytics/guardian-intervention-agents",
        "/internal/analytics/provenance-traversal/:startNodeId",
        "/internal/analytics/remedy-restoration-rate",
        "/internal/analytics/weakened-constraints",
      ].sort(),
    );
    expect(routes.every((r) => r.method === "GET")).toBe(true);
  });

  it("weakened-constraints route returns ranked rows", async () => {
    const analytics = new CrossWorkflowAnalyticsService(makePort());
    const routes = createAnalyticsQueryRoutes({ analytics });
    const route = routes.find(
      (r) => r.pattern === "/internal/analytics/weakened-constraints",
    );
    expect(route).toBeDefined();
    const res = await route!.handler({
      params: {},
      body: {},
      headers: {},
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { concept: "food_grade", weakenCount: 1, workflowCount: 1 },
    ]);
  });

  it("provenance-traversal route returns graph from start node", async () => {
    const analytics = new CrossWorkflowAnalyticsService(makePort());
    const routes = createAnalyticsQueryRoutes({ analytics });
    const route = routes.find(
      (r) => r.pattern === "/internal/analytics/provenance-traversal/:startNodeId",
    );
    expect(route).toBeDefined();
    const res = await route!.handler({
      params: { startNodeId: "n1" },
      body: {},
      headers: {},
    });
    expect(res.status).toBe(200);
    const body = res.body as { startNodeId: string; nodes: unknown[] };
    expect(body.startNodeId).toBe("n1");
    expect(body.nodes).toHaveLength(1);
  });
});
