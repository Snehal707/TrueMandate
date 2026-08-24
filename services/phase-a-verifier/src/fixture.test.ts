import { describe, expect, it } from "vitest";
import { ErrorCode, err, ok } from "@truemandate/protocol";
import { phaseAFixture, phaseARawEvent, phaseAWorkflow, PHASE_A_ID, RAW_INTENT } from "./fixture.js";
import { runPhaseAVerifier } from "./run.js";
describe("phase A verifier inputs", () => {
  it("emits only deterministic raw intent and phase-a evidence", () => {
    expect(RAW_INTENT).toContain("2030-12-31");
    expect(phaseARawEvent().payload).toEqual(expect.objectContaining({ rawText: RAW_INTENT, intentId: PHASE_A_ID }));
    expect(phaseAFixture().envelopes.every((x) => x.id.startsWith("phase-a-"))).toBe(true);
  });
  it("does not include authority-bearing fields in the workflow input", () => {
    const request = phaseAWorkflow();
    for (const forbidden of ["grant", "preparedAction", "commitToken", "temporalAuthority", "authorityDecision", "expectedIntentStateId", "expectedIntentStateHash"]) expect(request).not.toHaveProperty(forbidden);
  });

  it("publishes once and retries only typed readiness with identical workflow input", async () => {
    let published = 0;
    const calls: unknown[] = [];
    let clock = 0;
    const result = await runPhaseAVerifier({
      publishRawIntent: async () => { published += 1; },
      submitWorkflow: async (input) => {
        calls.push(input);
        return calls.length === 1
          ? err(ErrorCode.INTENT_STATE_NOT_READY, "not ready", { status: 404, retryable: true })
          : ok({ state: "AUTHORIZED", authorization: { commitToken: { id: "token-1" }, grant: { id: "grant-1" } } });
      },
      now: () => clock,
      sleep: async () => { clock += 1_000; },
    });
    expect(result).toEqual({ state: "AUTHORIZED", authorization: { commitToken: { id: "token-1" }, grant: { id: "grant-1" } } });
    expect(published).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual(phaseAWorkflow());
  });

  it("does not retry non-readiness failures", async () => {
    let calls = 0;
    await expect(runPhaseAVerifier({
      publishRawIntent: async () => undefined,
      submitWorkflow: async () => { calls += 1; return err(ErrorCode.VALIDATION_FAILED, "denied", { status: 403, retryable: false }); },
      sleep: async () => undefined,
    })).rejects.toThrow("VALIDATION_FAILED");
    expect(calls).toBe(1);
  });

  it("does not claim success for BLOCKED, REJECTED, or stale workflow results", async () => {
    for (const terminal of [
      { state: "BLOCKED" },
      { state: "REJECTED" },
      { state: "BLOCKED", workflowId: "wf-stale" },
    ]) {
      await expect(runPhaseAVerifier({
        publishRawIntent: async () => undefined,
        submitWorkflow: async () => ok(terminal),
        sleep: async () => undefined,
      })).rejects.toThrow("PHASE_A_NOT_COMPLETE");
    }
  });
});
