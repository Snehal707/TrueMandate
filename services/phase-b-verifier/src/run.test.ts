import { ErrorCode, err, ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { phaseBFixture, phaseBRawEvent, phaseBWorkflow, PHASE_B_ID, RAW_INTENT } from "./fixture.js";
import { runPhaseBVerifier } from "./run.js";

function deps(overrides: Partial<{
  workflowResults: unknown[];
  commitResults: unknown[];
  commitCalls: { tokenId: string }[];
}>) {
  const commitCalls: { tokenId: string }[] = [];
  const wf = [...(overrides.workflowResults ?? [])];
  const commits = [...(overrides.commitResults ?? [])];
  let published = 0;
  let clock = 0;
  return {
    commitCalls,
    published: () => published,
    run: () => runPhaseBVerifier({
      publishRawIntent: async () => { published += 1; },
      submitWorkflow: async () => {
        const next = wf.shift();
        if (next !== undefined) return next as never;
        return ok({
          state: "AUTHORIZED",
          authorization: {
            commitToken: { id: "ct-phase-b-1" },
            grant: { id: "grant-phase-b-1", amount: 742000, currency: "INR", merchant: "phase-b-supplier" },
          },
        });
      },
      submitCommit: async (body) => {
        commitCalls.push(body);
        const next = commits.shift();
        return next !== undefined ? (next as never) : ok({ status: "SUCCESS", executionId: "exec-1", resultRef: "mock-pay-key", grantId: "grant-phase-b-1" });
      },
      now: () => clock,
      sleep: async () => { clock += 1_000; },
    }),
  };
}

describe("Phase B verifier", () => {
  it("emits deterministic raw intent and phase-b evidence", () => {
    expect(RAW_INTENT).toContain("2030-12-31");
    expect(phaseBRawEvent().payload).toEqual(expect.objectContaining({ rawText: RAW_INTENT, intentId: PHASE_B_ID }));
    expect(phaseBFixture().envelopes.every((x) => x.id.startsWith("phase-b-"))).toBe(true);
    expect(phaseBWorkflow().supplier.id).toBe("phase-b-supplier");
  });

  it("exits success only on the strict durable contract: SUCCESS commit + idempotent replay with the same effect", async () => {
    const d = deps({
      commitResults: [
        ok({ status: "SUCCESS", executionId: "exec-1", resultRef: "mock-pay-key", grantId: "grant-phase-b-1" }),
        ok({ status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-key", grantId: "grant-phase-b-1" }),
      ],
    });
    const result = await d.run();
    expect(result).toEqual(expect.objectContaining({ execution: expect.objectContaining({ status: "SUCCESS", executionId: "exec-1" }) }));
    expect(d.commitCalls).toEqual([{ commitTokenId: "ct-phase-b-1" }, { commitTokenId: "ct-phase-b-1" }]);
    expect(d.published()).toBe(1);
  });

  it("fails when the workflow never reaches AUTHORIZED with a fresh token", async () => {
    const d = deps({ workflowResults: [ok({ state: "BLOCKED" })] });
    await expect(d.run()).rejects.toThrow("PHASE_B_AUTHORIZATION_NOT_COMPLETE");
    expect(d.commitCalls).toHaveLength(0);
  });

  it("fails when the authorized economics do not match the fixture", async () => {
    const d = deps({ workflowResults: [ok({
      state: "AUTHORIZED",
      authorization: {
        commitToken: { id: "ct-phase-b-1" },
        grant: { id: "g1", amount: 1, currency: "USD", merchant: "evil" },
      },
    })] });
    await expect(d.run()).rejects.toThrow("PHASE_B_ECONOMICS_MISMATCH");
    expect(d.commitCalls).toHaveLength(0);
  });

  it("fails when the commit is not a canonical SUCCESS", async () => {
    const d = deps({ commitResults: [ok({ status: "UNKNOWN", reconciliationRequired: true, grantId: "g1" })] });
    await expect(d.run()).rejects.toThrow("PHASE_B_EXECUTION_NOT_SUCCESS");
  });

  it("fails when replay produces a different economic effect", async () => {
    const d = deps({
      commitResults: [
        ok({ status: "SUCCESS", executionId: "exec-1", resultRef: "mock-pay-key", grantId: "g1" }),
        ok({ status: "SUCCESS", executionId: "exec-2", resultRef: "mock-pay-key-2", grantId: "g1" }),
      ],
    });
    await expect(d.run()).rejects.toThrow("PHASE_B_EXACTLY_ONCE_VIOLATED");
  });

  it("does not retry a terminal commit failure", async () => {
    const d = deps({ commitResults: [err(ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY, "cannot retry", {})] });
    await expect(d.run()).rejects.toThrow("PHASE_B_COMMIT_FAILED");
    expect(d.commitCalls).toHaveLength(1);
  });
});

/** Fake-clock harness: polling time is driven entirely by deps.now/sleep. */
function timedDeps(workflowBehavior: (clock: number, call: number) => unknown) {
  let clock = 0;
  let calls = 0;
  const commitCalls: { tokenId: string }[] = [];
  const run = () => runPhaseBVerifier({
    publishRawIntent: async () => undefined,
    submitWorkflow: async () => {
      calls += 1;
      return workflowBehavior(clock, calls) as never;
    },
    submitCommit: async (body) => {
      commitCalls.push(body);
      return commitCalls.length === 1
        ? ok({ status: "SUCCESS", executionId: "exec-1", resultRef: "mock-pay-key", grantId: "grant-phase-b-1" })
        : ok({ status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-key", grantId: "grant-phase-b-1" });
    },
    now: () => clock,
    sleep: async (milliseconds: number) => { clock += milliseconds; },
  });
  return { run, calls: () => calls, commitCalls };
}

describe("Phase B verifier readiness-window timing (v3 race regression)", () => {
  const NOT_READY = err(ErrorCode.INTENT_STATE_NOT_READY, "not ready", { retryable: true });
  const AUTHORIZED = ok({
    state: "AUTHORIZED",
    authorization: {
      commitToken: { id: "ct-phase-b-1" },
      grant: { id: "grant-phase-b-1", amount: 742000, currency: "INR", merchant: "phase-b-supplier" },
    },
  });

  it("keeps polling when the state finalizes after 120s but before 300s of equivalent time", async () => {
    // Exact v3 race class: compilation persisted after the old 120s window.
    const d = timedDeps((clock) => (clock >= 130_000 ? AUTHORIZED : NOT_READY));
    const result = await d.run();
    expect(result).toEqual(expect.objectContaining({ execution: expect.objectContaining({ status: "SUCCESS" }) }));
    // 130s of polling with the 1→10s capped backoff needs well over 10 calls —
    // proving the verifier did NOT give up at the old 120s boundary.
    expect(d.calls()).toBeGreaterThan(10);
    // Commit + the verifier's built-in idempotent replay assertion.
    expect(d.commitCalls).toEqual([{ commitTokenId: "ct-phase-b-1" }, { commitTokenId: "ct-phase-b-1" }]);
  });

  it("exits fail closed when the state never becomes ready within the 300s window", async () => {
    const d = timedDeps(() => NOT_READY);
    await expect(d.run()).rejects.toThrow("did not finalize within the Phase B retry window");
    // Bounded polling: with a 300s window and 1→10s backoff the attempt count
    // stays far below any unbounded loop, and nothing is committed.
    expect(d.calls()).toBeLessThan(45);
    expect(d.commitCalls).toHaveLength(0);
  });

  it("fails immediately on a non-retryable error instead of waiting out the window", async () => {
    const d = timedDeps(() => err(ErrorCode.VALIDATION_FAILED, "malformed owner artifacts", { status: 400, retryable: false }));
    await expect(d.run()).rejects.toThrow("VALIDATION_FAILED");
    expect(d.calls()).toBe(1);
    expect(d.commitCalls).toHaveLength(0);
  });
});
