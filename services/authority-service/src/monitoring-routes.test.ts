import { createEvaluationRecord, InMemoryMonitoringContractStore } from "@truemandate/authority";
import {
  AuthorityDecision,
  MonitoringContractState,
  MonitoringRiskState,
  type Result,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { InMemoryEvaluationStore } from "./evaluation-record.js";
import {
  applyOutcomeEventToMonitoring,
  createMonitoringRoutes,
} from "./monitoring-routes.js";

const NOW = "2026-08-21T12:00:00.000Z";
const FUTURE = "2026-12-31T12:00:00.000Z";
const H = (char: string) => char.repeat(64);

async function seedEvaluation(
  store: InMemoryEvaluationStore,
  overrides: Partial<{
    id: string;
    decision: AuthorityDecision;
    workflowId: string;
  }> = {},
) {
  const workflowId = overrides.workflowId ?? "wf-monitoring";
  const result = await createEvaluationRecord(store, {
    schemaVersion: 1,
    id: overrides.id ?? `evaluation-${workflowId}`,
    workflowId,
    workflow: { id: workflowId, hash: H("a") },
    action: { id: `action-${workflowId}`, hash: H("b") },
    guardian: { id: `guardian-${workflowId}`, hash: H("c") },
    evaluatedIntentState: { id: "state-1", hash: H("d"), version: 1 },
    decision: overrides.decision ?? AuthorityDecision.ALLOW_WITH_MONITORING,
    scope: {
      capabilities: { execute_payment: AuthorityDecision.ALLOW_WITH_MONITORING },
      maxAmount: 742000,
      currency: "INR",
      expiresAt: FUTURE,
    },
    capability: "execute_payment",
    merchant: "approved-supplier",
    amount: 742000,
    currency: "INR",
    expiresAt: FUTURE,
    materializationEligible: true,
    materializationReason: "PENDING_MONITORING",
    createdAt: NOW,
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.value;
}

function routeFixture() {
  const evaluations = new InMemoryEvaluationStore();
  const monitoring = new InMemoryMonitoringContractStore();
  const routes = createMonitoringRoutes({ evaluations, monitoring, now: () => NOW });
  const route = (method: "GET" | "POST", pattern: string) => {
    const found = routes.find((item) => item.method === method && item.pattern === pattern);
    if (!found) throw new Error(`missing route ${method} ${pattern}`);
    return found;
  };
  return { evaluations, monitoring, route };
}

function bodyResult<T>(response: { status: number; body: unknown }): Result<T> {
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, value: response.body as T };
  }
  const body = response.body as { error?: string; message?: string; details?: Record<string, unknown> };
  return { ok: false, code: body.error as never, message: body.message ?? "route failed", details: body.details ?? {} };
}

describe("MonitoringContract owner routes", () => {
  it("creates a MonitoringContract from an ALLOW_WITH_MONITORING evaluation", async () => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations);
    const response = await f.route("POST", "/internal/monitoring").handler({
      body: {
        id: "monitoring-wf-monitoring",
        evaluationId: evaluation.id,
        intentId: "intent-1",
        intentStateId: "state-1",
        workflowId: evaluation.workflowId,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    const result = bodyResult<{ id: string; state: string; riskState: string }>(response);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: "monitoring-wf-monitoring",
      state: MonitoringContractState.ACTIVE,
      riskState: MonitoringRiskState.HEALTHY,
    });
  });

  it("rejects non-monitoring evaluations", async () => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations, {
      id: "evaluation-allow",
      decision: AuthorityDecision.ALLOW,
      workflowId: "wf-allow",
    });
    const response = await f.route("POST", "/internal/monitoring").handler({
      body: {
        evaluationId: evaluation.id,
        intentId: "intent-1",
        intentStateId: "state-1",
        workflowId: evaluation.workflowId,
      },
      headers: {},
      params: {},
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "VALIDATION_FAILED",
      message: "MonitoringContract requires ALLOW_WITH_MONITORING evaluation",
    });
  });

  it("replays create idempotently via putIfAbsent", async () => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations);
    const body = {
      id: "monitoring-replay",
      evaluationId: evaluation.id,
      intentId: "intent-1",
      intentStateId: "state-1",
      workflowId: evaluation.workflowId,
      createdAt: NOW,
    };
    const first = await f.route("POST", "/internal/monitoring").handler({ body, headers: {}, params: {} });
    const second = await f.route("POST", "/internal/monitoring").handler({ body, headers: {}, params: {} });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it.each([
    ["LOW", MonitoringContractState.ACTIVE, MonitoringRiskState.HEALTHY],
    ["MEDIUM", MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    ["HIGH", MonitoringContractState.FROZEN, MonitoringRiskState.UNACCEPTABLE],
  ] as const)("records %s signals with the expected escalation", async (severity, state, riskState) => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations, { workflowId: `wf-${severity.toLowerCase()}` });
    await f.route("POST", "/internal/monitoring").handler({
      body: {
        id: `monitoring-${severity.toLowerCase()}`,
        evaluationId: evaluation.id,
        intentId: "intent-1",
        intentStateId: "state-1",
        workflowId: evaluation.workflowId,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    const response = await f.route("POST", "/internal/monitoring/:id/signals").handler({
      body: {
        id: `signal-${severity.toLowerCase()}`,
        severity,
        source: "test",
        reason: `${severity.toLowerCase()}-risk`,
        observedAt: NOW,
      },
      headers: {},
      params: { id: `monitoring-${severity.toLowerCase()}` },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      state,
      riskState,
    });
  });

  it("marks verified outcome failure as RESOLUTION_OPENED", async () => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations, { workflowId: "wf-breach" });
    await f.route("POST", "/internal/monitoring").handler({
      body: {
        id: "monitoring-breach",
        evaluationId: evaluation.id,
        intentId: "intent-1",
        intentStateId: "state-1",
        workflowId: evaluation.workflowId,
      },
      headers: {},
      params: {},
    });
    const response = await f.route("POST", "/internal/monitoring/:id/outcome-failure").handler({
      body: { resolutionCaseHint: "case-1", observedAt: NOW },
      headers: {},
      params: { id: "monitoring-breach" },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      state: MonitoringContractState.RESOLUTION_OPENED,
      riskState: MonitoringRiskState.UNACCEPTABLE,
      resolutionCaseHint: "case-1",
    });
  });

  it("reads contracts by id and by workflow id", async () => {
    const f = routeFixture();
    const evaluation = await seedEvaluation(f.evaluations, { workflowId: "wf-read" });
    await f.route("POST", "/internal/monitoring").handler({
      body: {
        id: "monitoring-read",
        evaluationId: evaluation.id,
        intentId: "intent-1",
        intentStateId: "state-1",
        workflowId: evaluation.workflowId,
      },
      headers: {},
      params: {},
    });
    const byId = await f.route("GET", "/internal/monitoring/:id").handler({
      body: undefined,
      headers: {},
      params: { id: "monitoring-read" },
    });
    const byWorkflow = await f.route("GET", "/internal/monitoring/by-workflow/:workflowId").handler({
      body: undefined,
      headers: {},
      params: { workflowId: "wf-read" },
    });
    expect(byId.status).toBe(200);
    expect(byWorkflow.status).toBe(200);
    expect(byId.body).toMatchObject({ id: "monitoring-read", workflowId: "wf-read" });
    expect(byWorkflow.body).toMatchObject({ id: "monitoring-read", workflowId: "wf-read" });
  });

  it.each([
    ["OUTCOME_AT_RISK", undefined, MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    ["OUTCOME_PARTIAL", undefined, MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    ["OUTCOME_CONFLICTED", undefined, MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    [undefined, "AT_RISK", MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    [undefined, "PARTIAL", MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
    [undefined, "CONFLICTED", MonitoringContractState.ESCALATED, MonitoringRiskState.ELEVATED],
  ] as const)(
    "real outcome events escalate monitoring risk for type=%s payload.state=%s",
    async (type, state, contractState, riskState) => {
      const f = routeFixture();
      const evaluation = await seedEvaluation(f.evaluations, { workflowId: `wf-${type ?? state}` });
      await f.route("POST", "/internal/monitoring").handler({
        body: {
          id: `monitoring-${type ?? state}`,
          evaluationId: evaluation.id,
          intentId: "intent-1",
          intentStateId: "state-1",
          workflowId: evaluation.workflowId,
          createdAt: NOW,
        },
        headers: {},
        params: {},
      });
      await applyOutcomeEventToMonitoring(
        f.monitoring,
        {
          ...(type ? { type } : {}),
          payload: {
            monitoringContractId: `monitoring-${type ?? state}`,
            ...(state ? { state } : {}),
          },
        },
        NOW,
      );
      const loaded = await f.monitoring.get(`monitoring-${type ?? state}`);
      expect(loaded.ok && loaded.value).toBeTruthy();
      if (!loaded.ok || !loaded.value) return;
      expect(loaded.value).toMatchObject({
        state: contractState,
        riskState,
      });
    },
  );

  it.each([
    ["OUTCOME_BREACHED", undefined],
    [undefined, "BREACHED"],
  ] as const)(
    "real breached outcome events move monitoring to RESOLUTION_OPENED for type=%s payload.state=%s",
    async (type, state) => {
      const f = routeFixture();
      const evaluation = await seedEvaluation(f.evaluations, { workflowId: `wf-${type ?? state}` });
      await f.route("POST", "/internal/monitoring").handler({
        body: {
          id: `monitoring-${type ?? state}`,
          evaluationId: evaluation.id,
          intentId: "intent-1",
          intentStateId: "state-1",
          workflowId: evaluation.workflowId,
          createdAt: NOW,
        },
        headers: {},
        params: {},
      });
      await applyOutcomeEventToMonitoring(
        f.monitoring,
        {
          ...(type ? { type } : {}),
          payload: {
            monitoringContractId: `monitoring-${type ?? state}`,
            ...(state ? { state } : {}),
          },
        },
        NOW,
      );
      const loaded = await f.monitoring.get(`monitoring-${type ?? state}`);
      expect(loaded.ok && loaded.value).toBeTruthy();
      if (!loaded.ok || !loaded.value) return;
      expect(loaded.value).toMatchObject({
        state: MonitoringContractState.RESOLUTION_OPENED,
        riskState: MonitoringRiskState.UNACCEPTABLE,
      });
    },
  );
});
