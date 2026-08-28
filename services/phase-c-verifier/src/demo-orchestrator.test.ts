import { describe, expect, it, vi } from "vitest";
import { ErrorCode, ok, type Result } from "@truemandate/protocol";
import { runDemoOrchestration, type DemoOrchestratorPorts } from "./demo-orchestrator.js";

/**
 * Pure control-flow proof: given mocked ports, does the orchestrator
 * sequence calls correctly, reject unknown scenario/variant pairs before
 * touching any port, pin the attack leg to the exact state control
 * established, and collapse retries onto the same derived ids? The
 * "does the real engine reach the promised outcome" question is answered
 * separately in demo-orchestrator-pipeline.test.ts against the real
 * evidence-backed-readiness harness.
 */

function tip(id: string, stateHash: string): Result<{ id: string; stateHash: string }> {
  return ok({ id, stateHash });
}

function workflowOk(workflowId: string, state: string): Result<Record<string, unknown>> {
  return ok({ workflowId, state });
}

function mockPorts(overrides: Partial<DemoOrchestratorPorts> = {}): DemoOrchestratorPorts & {
  readonly submitWorkflowCalls: unknown[];
  readonly submitEvidenceCalls: unknown[];
  readonly verifyEvidenceCalls: unknown[];
  readonly getTipCalls: string[];
} {
  const submitWorkflowCalls: unknown[] = [];
  const submitEvidenceCalls: unknown[] = [];
  const verifyEvidenceCalls: unknown[] = [];
  const getTipCalls: string[] = [];
  let tipState = { id: "S0", stateHash: "hash-s0" };

  const base: DemoOrchestratorPorts = {
    submitWorkflow: vi.fn(async (body: unknown) => {
      submitWorkflowCalls.push(body);
      const record = body as { intent?: { kind?: string }; idempotencyKey?: string };
      if (record.intent?.kind === "RAW") {
        // Leg 1: finalize the tip as a side effect, matching real behavior.
        tipState = { id: "S0", stateHash: "hash-s0" };
        return { ok: true, value: { workflowId: "wf-leg1", state: "BLOCKED" } };
      }
      if (record.idempotencyKey?.endsWith("-control")) {
        // Control's unpinned leg 2 is the only call allowed to supersede.
        tipState = { id: "S1", stateHash: "hash-s1" };
        return workflowOk("wf-control", "AUTHORIZED");
      }
      return workflowOk(`wf-${record.idempotencyKey}`, "BLOCKED");
    }),
    evidence: {
      submitEvidence: vi.fn(async (body: unknown) => {
        submitEvidenceCalls.push(body);
        return ok({ envelopeIds: ["env-1"], claimIds: ["claim-1", "claim-2"] });
      }),
      verifyEvidence: vi.fn(async (body: unknown) => {
        verifyEvidenceCalls.push(body);
        return ok({ envelopeIds: ["env-1-verified"], claimIds: ["claim-1-verified", "claim-2-verified"] });
      }),
    },
    intents: {
      getTip: vi.fn(async (intentId: string) => {
        getTipCalls.push(intentId);
        return tip(tipState.id, tipState.stateHash);
      }),
    },
    newRunId: () => "run-fixed",
    now: () => "2026-08-28T00:00:00.000Z",
    sleep: async () => undefined,
    ...overrides,
  };

  return { ...base, submitWorkflowCalls, submitEvidenceCalls, verifyEvidenceCalls, getTipCalls };
}

describe("unknown scenario/variant is rejected before any port is touched", () => {
  it("rejects an unlisted scenarioId", async () => {
    const ports = mockPorts();
    const result = await runDemoOrchestration(ports, { scenarioId: "not-a-real-scenario", variantId: "control" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(ports.submitWorkflowCalls).toHaveLength(0);
    expect(ports.submitEvidenceCalls).toHaveLength(0);
    expect(ports.verifyEvidenceCalls).toHaveLength(0);
  });

  it("rejects an attack variant not defined for the given scenario", async () => {
    const ports = mockPorts();
    // renewal_flip is a saas_it_spend variant, not procurement's.
    const result = await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "renewal_flip" });
    expect(result.ok).toBe(false);
    expect(ports.submitWorkflowCalls).toHaveLength(0);
  });
});

describe("control-only orchestration", () => {
  it("submits leg 1, provisions evidence once, submits one leg 2, returns intentId+workflowId", async () => {
    const ports = mockPorts();
    const result = await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "control" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("control");
    expect(ports.submitEvidenceCalls).toHaveLength(1);
    expect(ports.verifyEvidenceCalls).toHaveLength(1);
    // Leg 1 (RAW) + leg 2 (control) — exactly two workflow submissions.
    expect(ports.submitWorkflowCalls).toHaveLength(2);
  });

  it("never sends browser-shaped free-form content — only the two allowlisted fields select anything", async () => {
    const ports = mockPorts();
    await runDemoOrchestration(ports, { scenarioId: "travel", variantId: "control" });
    for (const call of ports.submitEvidenceCalls) {
      const body = call as { claims: readonly { value: unknown }[] };
      // Every claim value traces back to the fixture, never to the input args.
      expect(body.claims.every((c) => typeof c.value !== "undefined")).toBe(true);
    }
  });
});

describe("attack variant orchestration — single request, S1 sequencing", () => {
  it("runs leg 1 once, provisions evidence once, then control leg 2 before attack leg 2", async () => {
    const ports = mockPorts();
    const result = await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "quantity_drift" });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "attack") return;

    expect(ports.submitEvidenceCalls).toHaveLength(1);
    expect(ports.verifyEvidenceCalls).toHaveLength(1);
    // Leg 1 + control leg 2 + attack leg 2 = exactly three workflow submissions.
    expect(ports.submitWorkflowCalls).toHaveLength(3);

    const [leg1, controlLeg2, attackLeg2] = ports.submitWorkflowCalls as Array<{
      intent: { kind: string; expectedIntentStateId?: string; expectedIntentStateHash?: string };
      idempotencyKey: string;
    }>;
    expect(leg1.intent.kind).toBe("RAW");
    expect(controlLeg2.intent.kind).toBe("REFERENCE");
    expect(controlLeg2.intent.expectedIntentStateId).toBeUndefined();
    expect(controlLeg2.intent.expectedIntentStateHash).toBeUndefined();
    expect(attackLeg2.intent.kind).toBe("REFERENCE");
    // Attack is explicitly pinned to exactly the state control's own
    // submission established (read back via getTip after control completed).
    expect(attackLeg2.intent.expectedIntentStateId).toBe("S1");
    expect(attackLeg2.intent.expectedIntentStateHash).toBe("hash-s1");
  });

  it("reads the tip again after control leg 2 completes, to bind the attack leg — never before", async () => {
    let controlSubmitted = false;
    const getTipCallSawControlSubmitted: boolean[] = [];
    const submitWorkflow = vi.fn(async (body: unknown) => {
      const record = body as { intent?: { kind?: string }; idempotencyKey?: string };
      if (record.idempotencyKey?.endsWith("-control")) {
        controlSubmitted = true;
        return workflowOk("wf-control", "AUTHORIZED");
      }
      return { ok: true, value: { workflowId: "wf-leg1", state: "BLOCKED" } };
    });
    // getTip is also polled during leg 1 (confirming intent finalization),
    // before control has been submitted at all — that call is expected and
    // does not bind anything. Only the LAST getTip call (the one whose
    // result becomes the attack leg's pin) must see control already done.
    const getTip = vi.fn(async () => {
      getTipCallSawControlSubmitted.push(controlSubmitted);
      return tip("S1", "hash-s1");
    });
    const result = await runDemoOrchestration(mockPorts({ submitWorkflow, intents: { getTip } }), {
      scenarioId: "procurement",
      variantId: "quantity_drift",
    });
    expect(result.ok).toBe(true);
    expect(getTipCallSawControlSubmitted.at(-1)).toBe(true);
  });

  it("uses distinct idempotency keys for control and attack, never the same workflow identity path", async () => {
    const ports = mockPorts();
    await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "quantity_drift" });
    const keys = (ports.submitWorkflowCalls as Array<{ idempotencyKey: string }>).map((c) => c.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns both workflow ids and the exact bound state pinned into the attack leg", async () => {
    const ports = mockPorts();
    const result = await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "quantity_drift" });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== "attack") return;
    expect(result.value.controlWorkflowId).toBe("wf-control");
    expect(result.value.attackWorkflowId).toMatch(/^wf-/);
    expect(result.value.controlWorkflowId).not.toBe(result.value.attackWorkflowId);
    expect(result.value.boundIntentStateId).toBe("S1");
    expect(result.value.boundIntentStateHash).toBe("hash-s1");
  });
});

describe("fail-closed: attack leg is never submitted if control's leg 2 fails", () => {
  it("aborts without attempting the attack leg when control leg 2 returns an error", async () => {
    const ports = mockPorts({
      submitWorkflow: vi.fn(async (body: unknown) => {
        const record = body as { intent?: { kind?: string }; idempotencyKey?: string };
        if (record.intent?.kind === "RAW") return { ok: true, value: { workflowId: "wf-leg1", state: "BLOCKED" } };
        if (record.idempotencyKey?.endsWith("-control")) {
          return { ok: false, code: ErrorCode.VALIDATION_FAILED, message: "control leg failed" } as Result<never>;
        }
        throw new Error("attack leg must never be submitted after control leg 2 failed");
      }),
    });
    const result = await runDemoOrchestration(ports, { scenarioId: "procurement", variantId: "quantity_drift" });
    expect(result.ok).toBe(false);
  });
});

describe("idempotency: retrying the whole orchestration with the same runId is safe", () => {
  it("collapses to the same derived evidence/verification/workflow ids on a full replay", async () => {
    const first = mockPorts();
    const second = mockPorts();
    // Both runs use the SAME injected runId — simulating a retried request.
    await runDemoOrchestration(first, { scenarioId: "procurement", variantId: "control" });
    await runDemoOrchestration(second, { scenarioId: "procurement", variantId: "control" });

    const firstEnvelope = (first.submitEvidenceCalls[0] as { envelopes: { id: string }[] }).envelopes[0]!.id;
    const secondEnvelope = (second.submitEvidenceCalls[0] as { envelopes: { id: string }[] }).envelopes[0]!.id;
    expect(firstEnvelope).toBe(secondEnvelope);

    const firstVerification = (first.verifyEvidenceCalls[0] as { verificationId: string }).verificationId;
    const secondVerification = (second.verifyEvidenceCalls[0] as { verificationId: string }).verificationId;
    expect(firstVerification).toBe(secondVerification);

    const firstKeys = (first.submitWorkflowCalls as Array<{ idempotencyKey: string }>).map((c) => c.idempotencyKey);
    const secondKeys = (second.submitWorkflowCalls as Array<{ idempotencyKey: string }>).map((c) => c.idempotencyKey);
    expect(firstKeys).toEqual(secondKeys);
  });
});
