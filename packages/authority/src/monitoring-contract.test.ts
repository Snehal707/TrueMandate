import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  MonitoringContractState,
  MonitoringRiskState,
  MonitoringSignalSeverity,
} from "@truemandate/protocol";
import {
  assertMonitoringTransitionAllowed,
  assertPrivilegedActionAllowed,
  createMonitoringContract,
  InMemoryMonitoringContractStore,
  markVerifiedOutcomeFailure,
  recordRiskSignal,
} from "./monitoring-contract.js";

const NOW = "2026-08-21T12:00:00.000Z";
const LATER = "2026-08-21T13:00:00.000Z";

function baseContract() {
  const created = createMonitoringContract({
    id: "monitoring-wf-1",
    workflowId: "wf-1",
    intentId: "intent-1",
    intentStateId: "state-1",
    evaluationId: "evaluation-1",
    evaluationHash: "a".repeat(64),
    capability: "execute_payment",
    merchant: "Acme",
    amount: 100,
    currency: "USD",
    createdAt: NOW,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("setup failed");
  return created.value;
}

function signal(
  severity: (typeof MonitoringSignalSeverity)[keyof typeof MonitoringSignalSeverity],
  id = "sig-1",
) {
  return {
    id,
    severity,
    source: "outcome-event",
    reason: `test-${severity}`,
    observedAt: LATER,
  };
}

describe("MonitoringContract create", () => {
  it("opens ACTIVE / HEALTHY with empty signals", () => {
    const c = baseContract();
    expect(c.state).toBe(MonitoringContractState.ACTIVE);
    expect(c.riskState).toBe(MonitoringRiskState.HEALTHY);
    expect(c.signals).toEqual([]);
  });
});

describe("MonitoringContract transitions", () => {
  it.each([
    [MonitoringContractState.ACTIVE, MonitoringContractState.ESCALATED, true],
    [MonitoringContractState.ACTIVE, MonitoringContractState.FROZEN, true],
    [MonitoringContractState.ACTIVE, MonitoringContractState.RESOLUTION_OPENED, true],
    [MonitoringContractState.ACTIVE, MonitoringContractState.CLOSED, true],
    [MonitoringContractState.ESCALATED, MonitoringContractState.FROZEN, true],
    [MonitoringContractState.ESCALATED, MonitoringContractState.RESOLUTION_OPENED, true],
    [MonitoringContractState.ESCALATED, MonitoringContractState.CLOSED, true],
    [MonitoringContractState.FROZEN, MonitoringContractState.RESOLUTION_OPENED, true],
    [MonitoringContractState.FROZEN, MonitoringContractState.CLOSED, true],
    [MonitoringContractState.RESOLUTION_OPENED, MonitoringContractState.CLOSED, true],
    [MonitoringContractState.CLOSED, MonitoringContractState.ACTIVE, false],
    [MonitoringContractState.FROZEN, MonitoringContractState.ACTIVE, false],
    [MonitoringContractState.ESCALATED, MonitoringContractState.ACTIVE, false],
    [MonitoringContractState.RESOLUTION_OPENED, MonitoringContractState.ACTIVE, false],
  ] as const)("%s → %s allowed=%s", (from, to, allowed) => {
    const result = assertMonitoringTransitionAllowed(from, to);
    expect(result.ok).toBe(allowed);
    if (!allowed && !result.ok) {
      expect(result.code).toBe(ErrorCode.MONITORING_TRANSITION_INVALID);
    }
  });
});

describe("recordRiskSignal thresholds", () => {
  it("LOW keeps HEALTHY / ACTIVE (continue)", () => {
    const result = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.LOW), LATER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated.state).toBe(MonitoringContractState.ACTIVE);
    expect(result.value.updated.riskState).toBe(MonitoringRiskState.HEALTHY);
    expect(result.value.escalated).toBe(false);
  });

  it("MEDIUM escalates to ESCALATED / ELEVATED (REQUIRE_APPROVAL gate)", () => {
    const result = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.MEDIUM), LATER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated.state).toBe(MonitoringContractState.ESCALATED);
    expect(result.value.updated.riskState).toBe(MonitoringRiskState.ELEVATED);
    expect(result.value.escalated).toBe(true);
  });

  it("HIGH freezes to FROZEN / UNACCEPTABLE", () => {
    const result = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.HIGH), LATER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated.state).toBe(MonitoringContractState.FROZEN);
    expect(result.value.updated.riskState).toBe(MonitoringRiskState.UNACCEPTABLE);
    expect(result.value.escalated).toBe(true);
  });

  it("escalation is monotonic — LOW cannot de-escalate ESCALATED", () => {
    const mid = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.MEDIUM), LATER);
    expect(mid.ok).toBe(true);
    if (!mid.ok) return;
    const low = recordRiskSignal(
      mid.value.updated,
      signal(MonitoringSignalSeverity.LOW, "sig-2"),
      LATER,
    );
    expect(low.ok).toBe(true);
    if (!low.ok) return;
    expect(low.value.updated.state).toBe(MonitoringContractState.ESCALATED);
    expect(low.value.updated.riskState).toBe(MonitoringRiskState.ELEVATED);
    expect(low.value.updated.signals).toHaveLength(2);
  });

  it("rejects signals on RESOLUTION_OPENED / CLOSED", () => {
    const failed = markVerifiedOutcomeFailure(baseContract(), LATER);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const result = recordRiskSignal(failed.value, signal(MonitoringSignalSeverity.LOW), LATER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.MONITORING_TRANSITION_INVALID);
  });
});

describe("markVerifiedOutcomeFailure", () => {
  it("transitions any non-closed state to RESOLUTION_OPENED", () => {
    const fromActive = markVerifiedOutcomeFailure(baseContract(), LATER, "case-hint");
    expect(fromActive.ok).toBe(true);
    if (!fromActive.ok) return;
    expect(fromActive.value.state).toBe(MonitoringContractState.RESOLUTION_OPENED);
    expect(fromActive.value.riskState).toBe(MonitoringRiskState.UNACCEPTABLE);
    expect(fromActive.value.resolutionCaseHint).toBe("case-hint");

    const escalated = recordRiskSignal(
      baseContract(),
      signal(MonitoringSignalSeverity.MEDIUM),
      LATER,
    );
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    const fromEscalated = markVerifiedOutcomeFailure(escalated.value.updated, LATER);
    expect(fromEscalated.ok).toBe(true);
    if (!fromEscalated.ok) return;
    expect(fromEscalated.value.state).toBe(MonitoringContractState.RESOLUTION_OPENED);

    const frozen = recordRiskSignal(
      baseContract(),
      signal(MonitoringSignalSeverity.HIGH),
      LATER,
    );
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const fromFrozen = markVerifiedOutcomeFailure(frozen.value.updated, LATER);
    expect(fromFrozen.ok).toBe(true);
    if (!fromFrozen.ok) return;
    expect(fromFrozen.value.state).toBe(MonitoringContractState.RESOLUTION_OPENED);
  });

  it("is idempotent when already RESOLUTION_OPENED", () => {
    const first = markVerifiedOutcomeFailure(baseContract(), LATER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = markVerifiedOutcomeFailure(first.value, LATER);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state).toBe(MonitoringContractState.RESOLUTION_OPENED);
  });
});

describe("assertPrivilegedActionAllowed", () => {
  it("no contract / ACTIVE → allowed without approval", () => {
    expect(assertPrivilegedActionAllowed(undefined)).toEqual({
      ok: true,
      value: { requiresApproval: false },
    });
    expect(assertPrivilegedActionAllowed(baseContract())).toEqual({
      ok: true,
      value: { requiresApproval: false },
    });
  });

  it("ESCALATED → requiresApproval (never widens)", () => {
    const mid = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.MEDIUM), LATER);
    expect(mid.ok).toBe(true);
    if (!mid.ok) return;
    expect(assertPrivilegedActionAllowed(mid.value.updated)).toEqual({
      ok: true,
      value: { requiresApproval: true },
    });
  });

  it("FROZEN / RESOLUTION_OPENED → MONITORING_CONTRACT_FROZEN", () => {
    const frozen = recordRiskSignal(baseContract(), signal(MonitoringSignalSeverity.HIGH), LATER);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) return;
    const blocked = assertPrivilegedActionAllowed(frozen.value.updated);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(ErrorCode.MONITORING_CONTRACT_FROZEN);

    const resolved = markVerifiedOutcomeFailure(baseContract(), LATER);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const blocked2 = assertPrivilegedActionAllowed(resolved.value);
    expect(blocked2.ok).toBe(false);
    if (!blocked2.ok) expect(blocked2.code).toBe(ErrorCode.MONITORING_CONTRACT_FROZEN);
  });
});

describe("InMemoryMonitoringContractStore", () => {
  it("putIfAbsent is create-once and getByWorkflowId resolves", async () => {
    const store = new InMemoryMonitoringContractStore();
    const c = baseContract();
    expect((await store.putIfAbsent(c.id, c)).value).toBe(true);
    expect((await store.putIfAbsent(c.id, c)).value).toBe(false);
    const byWf = await store.getByWorkflowId("wf-1");
    expect(byWf.ok && byWf.value?.id).toBe(c.id);
  });
});

describe("architecture ban — monitoring-contract cannot mint privilege", () => {
  it("source never mentions bindAndMint / CommitToken / Gateway / AuthorityGrant construction", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "monitoring-contract.ts"), "utf8")
      // strip comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const token of [
      "bindAndMint",
      "CommitToken",
      "GatewayS2SClient",
      "AuthorityGrant",
      "mintGrant",
      "createGrant",
    ] as const) {
      expect(src, `must not mention ${token}`).not.toContain(token);
    }
  });
});
