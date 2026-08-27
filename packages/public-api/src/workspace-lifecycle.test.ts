import { describe, expect, it } from "vitest";
import { EvidenceService } from "@truemandate/evidence-service";
import { ok, type Intent, type Result } from "@truemandate/protocol";
import { createLivePublicBffPorts } from "./adapters.js";

/**
 * The workspace route previously projected no Guardian at all, so the read model
 * substituted an `UNAVAILABLE` placeholder on every run — and a UI reading it
 * concluded Guardian was where the workflow stopped. It must never synthesize
 * that from a projection gap again.
 */

const INTENT: Intent = {
  id: "intent-1",
  principalId: "principal-1" as Intent["principalId"],
  rawText: "Buy 500 food-grade containers from an approved supplier under INR 800000",
  createdAt: "2026-08-21T12:00:00.000Z",
  contentHash: "hash-stub",
} as Intent;

function ports(listIntentArtifacts?: () => Result<readonly unknown[]>) {
  return createLivePublicBffPorts({
    intentCreate: { createIntent: () => ok(INTENT) },
    workspaceSource: {
      getIntent: async () => ok(INTENT),
      getTip: async () =>
        ok({ id: "state-1", intentId: "intent-1", constraints: [], stateHash: "h", version: 1, createdAt: INTENT.createdAt, createdBy: "owner" } as never),
      ...(listIntentArtifacts ? { listIntentArtifacts: async () => listIntentArtifacts() } : {}),
    },
    evidence: new EvidenceService(),
  });
}

const AUTHORIZED = [
  { kind: "PROOF", payload: { status: "SATISFIED", method: "authoritative-proof-handoff", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: true } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  { kind: "WORKFLOW", payload: { state: "AUTHORIZED" } },
];

const FIDELITY_BLOCKED = [
  { kind: "PROOF", payload: { status: "SATISFIED", method: "authoritative-proof-handoff", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: false } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  { kind: "WORKFLOW", payload: { state: "BLOCKED" } },
];

describe("workspace projects stage truth from durable artifacts", () => {
  it("projects a real Guardian verdict rather than the placeholder", async () => {
    const result = await ports(() => ok(AUTHORIZED)).workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guardian.aggregator.decision).toBe("ALLOW");
    expect(result.value.guardian.aggregator.decision).not.toBe("UNAVAILABLE");
    expect(result.value.lifecycle?.blockingStage).toBeUndefined();
  });

  it("names action fidelity, not Guardian, when the action diverged from the intent", async () => {
    const result = await ports(() => ok(FIDELITY_BLOCKED)).workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle?.blockingStage).toBe("actionFidelity");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "authority")?.status).toBe("NOT_REACHED");
    expect(result.value.guardian.aggregator.decision).not.toBe("UNAVAILABLE");
  });

  it("says Guardian was NOT_REACHED rather than unavailable when it never ran", async () => {
    const rows = [
      { kind: "PLAN", payload: { plan: { steps: [] } } },
      { kind: "PLAN_VERIFICATION", payload: { verification: { status: "REJECTED" } } },
      { kind: "WORKFLOW", payload: { state: "BLOCKED" } },
    ];
    const result = await ports(() => ok(rows)).workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guardian.aggregator.decision).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.blockingStage).toBe("planVerification");
  });

  it("is unchanged for callers that cannot supply artifacts", async () => {
    const result = await ports().workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Legacy behaviour preserved exactly: no lifecycle, legacy Guardian default.
    expect(result.value.lifecycle).toBeUndefined();
    expect(result.value.guardian.aggregator.decision).toBe("UNAVAILABLE");
  });

  it("survives a historical artifact set missing newer kinds", async () => {
    const result = await ports(() => ok([{ kind: "WORKFLOW", payload: { state: "AUTHORIZED" } }]))
      .workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.blockingStage).toBeUndefined();
  });

  it("exposes no token, grant, credential or model internal", async () => {
    const result = await ports(() => ok(AUTHORIZED)).workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value).toLowerCase();
    for (const forbidden of ["committoken", "commit_token", "grantid", "nonce", "credential", "privatekey", "promptversion"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
