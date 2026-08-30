import { describe, expect, it, vi } from "vitest";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
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

function workspaceFixture(input: {
  readonly intentStateId: string;
  readonly stateHash: string;
  readonly readiness: string;
  readonly historicalStateIds: readonly string[];
  readonly authorityDecision?: string;
  readonly guardianDecision?: string;
  readonly guardianCriticalFailure?: boolean;
  readonly blockingStage?: string;
  readonly evidenceDetail?: string;
  readonly planVerificationDetail?: string;
  readonly sideEffects?: readonly unknown[];
}): Record<string, unknown> {
  return {
    summary: {
      intentId: "demo-procurement-run-fixed-intent",
      rawIntent: "same",
      principalId: "demo",
      createdAt: "2026-08-30T00:00:00.000Z",
      intentStateId: input.intentStateId,
      stateHash: input.stateHash,
      readiness: input.readiness,
      historicalStateIds: input.historicalStateIds,
    },
    guardian: {
      aggregator: {
        decision: input.guardianDecision ?? "ALLOW",
        semanticStatus: "CLEAR",
        criticalFailure: input.guardianCriticalFailure ?? false,
      },
    },
    authority: {
      decision: input.authorityDecision,
      explanation: "test",
    },
    execution: {
      phase: "BLOCKED",
      preparedAction: undefined,
      sideEffects: input.sideEffects ?? [],
      unknownPending: false,
      blockedRetry: false,
    },
    lifecycle: {
      stages: [
        { stage: "evidence", status: "COMPLETED", detail: input.evidenceDetail ?? "4 of 4 required proofs satisfied" },
        { stage: "planVerification", status: "COMPLETED", detail: input.planVerificationDetail ?? "VERIFIED" },
        { stage: "authority", status: "COMPLETED", detail: input.authorityDecision ?? "AUTHORIZED" },
      ],
      blockingStage: input.blockingStage,
    },
  };
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
    readWorkspace: vi.fn(async (_intentId: string, workflowId: string) => ok(
      workflowId === "wf-control"
        ? workspaceFixture({
            intentStateId: "S1",
            stateHash: "hash-s1",
            readiness: "ACTIONABLE",
            historicalStateIds: ["S0"],
            authorityDecision: "ALLOW",
          })
        : workspaceFixture({
            intentStateId: "S1",
            stateHash: "hash-s1",
            readiness: "ACTIONABLE",
            historicalStateIds: ["S0"],
            blockingStage: "planVerification",
          }),
    )),
    readApproval: vi.fn(async () => err(ErrorCode.VALIDATION_FAILED, "No approval")),
    newRunId: () => "run-fixed",
    now: () => "2026-08-30T00:00:00.000Z",
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
    expect(result.value.verifiedEvidenceIds).toEqual(["env-1-verified"]);
    expect(result.value.verifiedClaimIds).toEqual(["claim-1-verified", "claim-2-verified"]);
    expect(ports.submitEvidenceCalls).toHaveLength(1);
    expect(ports.verifyEvidenceCalls).toHaveLength(1);
    // Leg 1 (RAW) + leg 2 (control) — exactly two workflow submissions.
    expect(ports.submitWorkflowCalls).toHaveLength(2);
  });

  it("sends only closed identifiers to evidence provisioning — never envelope/claim content", async () => {
    const ports = mockPorts();
    await runDemoOrchestration(ports, { scenarioId: "travel", variantId: "control" });
    expect(ports.submitEvidenceCalls).toHaveLength(1);
    const body = ports.submitEvidenceCalls[0] as Record<string, unknown>;
    // A-Prime content-authority boundary: the orchestrator structurally has
    // no field through which it could supply claim/envelope content — it
    // can only name which pre-approved scenario/run/intent to provision.
    expect(Object.keys(body).sort()).toEqual(["intentId", "intentStateId", "runId", "scenarioId"]);
    expect(body.scenarioId).toBe("travel");
    expect(body.runId).toBe("run-fixed");
    expect(typeof body.intentId).toBe("string");
    expect(typeof body.intentStateId).toBe("string");
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
    expect(result.value.verifiedEvidenceIds).toEqual(["env-1-verified"]);
    expect(result.value.verifiedClaimIds).toEqual(["claim-1-verified", "claim-2-verified"]);
    expect(result.value.comparisonIntegrity.status).toBe("VERIFIED_COMPARISON");
    expect(result.value.comparisonIntegrity.sameVerifiedS1).toBe(true);
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

describe("establishIntent's tip poll performs a real retry, not a single cached attempt", () => {
  // Reproduces the shape of a real production incident: the demo
  // orchestrator's first tip poll landed before compilation finished (a
  // correct, expected "not ready" response), but intent-provenance's logs
  // showed zero further requests ever reached it for the rest of the ~137s
  // retry budget, even though the tip had finished compiling 27s in — well
  // inside the window. A mock that succeeds on the first call (as every
  // pre-existing test in this file uses) cannot catch that: it never
  // exercises the retry path at all.
  it("performs another real getTip call and succeeds once the tip becomes ready", async () => {
    let calls = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return err(ErrorCode.INTENT_STATE_NOT_READY, "not ready yet", { status: 404, retryable: false });
      }
      return tip("S0", "hash-s0");
    });
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip } }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("issues one real getTip call per attempt across multiple not-ready responses before timeout", async () => {
    let calls = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      if (calls <= 5) {
        return err(ErrorCode.INTENT_STATE_NOT_READY, "not ready yet", { status: 404, retryable: false });
      }
      return tip("S0", "hash-s0");
    });
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip } }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(6);
  });

  it("calls getTip exactly maxTipPollAttempts times, no more and no fewer, before giving up on sustained not-ready", async () => {
    const getTip = vi.fn(async () =>
      err(ErrorCode.INTENT_STATE_NOT_READY, "not ready yet", { status: 404, retryable: false }),
    );
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip }, maxTipPollAttempts: 3 }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.INTENT_STATE_NOT_READY);
    expect(getTip).toHaveBeenCalledTimes(3);
  });
});

describe("immediate transport retry — scoped to exactly {status: 503, retryable: true}", () => {
  const notReady404 = (): Result<{ id: string; stateHash: string }> =>
    err(ErrorCode.INTENT_STATE_NOT_READY, "not ready yet", { status: 404, retryable: false });
  const transport503 = (): Result<{ id: string; stateHash: string }> =>
    err(ErrorCode.VALIDATION_FAILED, "transport failure", { status: 503, retryable: true });
  const permanent400 = (): Result<{ id: string; stateHash: string }> =>
    err(ErrorCode.VALIDATION_FAILED, "permanently invalid", { status: 400, retryable: false });

  // A: an ordinary 404 must wait for the OUTER loop's own backoff, not
  // trigger an immediate second call. A same-tick second call would look
  // identical on a bare call count, so this also asserts sleep ran first —
  // the one signal that distinguishes "next outer attempt" from "immediate
  // retry within this attempt".
  it("A: does not immediately retry a plain 404 — waits for the next outer attempt", async () => {
    let calls = 0;
    let sleepsBeforeSecondCall = -1;
    let sleeps = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      if (calls === 2) sleepsBeforeSecondCall = sleeps;
      return calls === 1 ? notReady404() : tip("S0", "hash-s0");
    });
    const sleep = vi.fn(async () => {
      sleeps += 1;
    });
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip }, sleep }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleepsBeforeSecondCall).toBe(1);
  });

  // B: a retryable 503 gets exactly one immediate retry, resolved within the
  // SAME outer attempt — no backoff needed if the retry succeeds.
  it("B: immediately retries a retryable 503 and succeeds without waiting for another outer attempt", async () => {
    let calls = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? transport503() : tip("S0", "hash-s0");
    });
    const sleep = vi.fn(async () => undefined);
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip }, sleep }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  // C: the immediate retry's own result is processed normally — if IT comes
  // back not-ready, that is not retried again (no recursion); the outer loop
  // backs off and tries again on its own schedule.
  it("C: processes the immediate retry's result normally — a not-ready retry waits for the next outer attempt, no infinite retry", async () => {
    let calls = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return transport503();
      if (calls === 2) return notReady404();
      return tip("S0", "hash-s0");
    });
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip } }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  // D: sustained retryable 503 never exceeds 2 calls per outer attempt, and
  // still times out through the ordinary exhaustion path — bounded, not
  // unbounded/infinite.
  it("D: bounds to at most 2 getTip calls per outer attempt under a persistent retryable 503, and still times out", async () => {
    const getTip = vi.fn(async () => transport503());
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip }, maxTipPollAttempts: 3 }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.INTENT_STATE_NOT_READY);
    expect(getTip).toHaveBeenCalledTimes(6); // 3 outer attempts x (primary + immediate retry)
  });

  // E: a non-retryable, non-404 error (e.g. a permanent validation failure)
  // gets no special treatment either — existing orchestration semantics
  // don't ask for one, so none is added.
  it("E: does not immediately retry a non-retryable, non-404 error", async () => {
    let calls = 0;
    let sleepsBeforeSecondCall = -1;
    let sleeps = 0;
    const getTip = vi.fn(async () => {
      calls += 1;
      if (calls === 2) sleepsBeforeSecondCall = sleeps;
      return calls === 1 ? permanent400() : tip("S0", "hash-s0");
    });
    const sleep = vi.fn(async () => {
      sleeps += 1;
    });
    const result = await runDemoOrchestration(mockPorts({ intents: { getTip }, sleep }), {
      scenarioId: "procurement",
      variantId: "control",
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(sleepsBeforeSecondCall).toBe(1);
  });
});

describe("idempotency: retrying the whole orchestration with the same runId is safe", () => {
  it("collapses to the same derived evidence/verification/workflow ids on a full replay", async () => {
    const first = mockPorts();
    const second = mockPorts();
    // Both runs use the SAME injected runId — simulating a retried request.
    await runDemoOrchestration(first, { scenarioId: "procurement", variantId: "control" });
    await runDemoOrchestration(second, { scenarioId: "procurement", variantId: "control" });

    // submitEvidence now carries only closed identifiers — a full replay
    // must send byte-identical provisioning requests both times.
    expect(first.submitEvidenceCalls[0]).toEqual(second.submitEvidenceCalls[0]);

    const firstEnvelope = (first.verifyEvidenceCalls[0] as { envelopeId: string }).envelopeId;
    const secondEnvelope = (second.verifyEvidenceCalls[0] as { envelopeId: string }).envelopeId;
    expect(firstEnvelope).toBe(secondEnvelope);

    const firstVerification = (first.verifyEvidenceCalls[0] as { verificationId: string }).verificationId;
    const secondVerification = (second.verifyEvidenceCalls[0] as { verificationId: string }).verificationId;
    expect(firstVerification).toBe(secondVerification);

    const firstKeys = (first.submitWorkflowCalls as Array<{ idempotencyKey: string }>).map((c) => c.idempotencyKey);
    const secondKeys = (second.submitWorkflowCalls as Array<{ idempotencyKey: string }>).map((c) => c.idempotencyKey);
    expect(firstKeys).toEqual(secondKeys);
  });
});
