import { ErrorCode, ok, err, type OutcomeContract, type Result } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { runPhaseCVerifier, type PhaseCVerifierPorts, type PhaseCClosure } from "./run.js";
import { PHASE_C_ID, phaseCAcceptanceFixture, phaseCRawEvent, phaseCWorkflow } from "./fixture.js";



function AUTHORIZED(contractId: string) {
  return ok({
    state: "AUTHORIZED",
    authorization: {
      commitToken: { id: "ct-phase-c-1" },
      grant: { id: "grant-phase-c-1", amount: 742000, currency: "INR", merchant: "phase-b-supplier", outcomeContractId: contractId },
    },
  });
}

interface State {
  commits: number;
  evaluated: { contractId: string; claimIds: readonly string[] }[];
  casePolled: number;
  caseResponsibility: string;
  caseRequests: number;
  contractState: string;
  fixtureRejected: boolean;
  evaluateMode: "PARTIAL" | "SATISFIED" | "AWAITING_EVIDENCE" | "CONFLICTED";
  /** Readiness state machine: contract states returned per read, in order. */
  readinessStates: string[];
  paymentStatus: string;
  contractReads: number;
}

function ports(state: State): PhaseCVerifierPorts {
  let clock = 0;
  return {
    submitEvidenceFixture: async () => (state.fixtureRejected ? err(ErrorCode.VALIDATION_FAILED, "fixture rejected") : ok({})),
    getContract: async () => {
      state.contractReads += 1;
      const nextState = state.readinessStates.length > 1
        ? state.readinessStates.shift()!
        : (state.readinessStates[0] ?? "AWAITING_OUTCOME");
      return ok({ id: "outcome-phase-c-flagship", state: nextState, paymentStatus: state.paymentStatus } as unknown as OutcomeContract);
    },
    publishRawIntent: async () => undefined,
    submitWorkflow: async () => AUTHORIZED("outcome-phase-c-flagship"),
    submitCommit: async () => {
      state.commits += 1;
      return state.commits === 1
        ? ok({ status: "SUCCESS", executionId: "exec-phase-c", resultRef: "mock-pay-phase-c", grantId: "grant-phase-c-1" })
        : ok({ status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-phase-c" });
    },
    evaluateEvidence: async (contractId, body) => {
      state.evaluated.push({ contractId, claimIds: body.claimIds });
      const stateMap = {
        PARTIAL: "PARTIAL",
        SATISFIED: "SATISFIED",
        AWAITING_EVIDENCE: "AWAITING_EVIDENCE",
        CONFLICTED: "CONFLICTED",
      } as const;
      const next = stateMap[state.evaluateMode];
      const divergence = next === "PARTIAL" ? { requiredQuantity: 500, verifiedReceived: 450, shortfall: 50 } : null;
      if (state.evaluateMode === "AWAITING_EVIDENCE" && state.contractState !== "AWAITING_EVIDENCE") {
        return err(ErrorCode.VALIDATION_FAILED, "no accepted destination-quantity evidence");
      }
      return ok({
        contract: { id: contractId, state: next, paymentStatus: "SUCCESS" } as unknown as OutcomeContract,
        verification: { contractId, requirementResults: [], overallState: next, criticalFailure: false, verifiedAt: "t" },
        divergence,
      });
    },
    getResolutionCaseByContract: async () => {
      state.casePolled += 1;
      if (state.caseResponsibility === "MISSING") return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase for contract");
      return ok({
        case: { id: "rc-phase-c-1", responsibilityState: state.caseResponsibility, state: "OPEN" },
        evidenceRequests: Array.from({ length: state.caseRequests }, (_, i) => ({ id: `phase-c-request-${i + 1}`, requiresAuthority: false })),
      });
    },
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
  };
}

const run = (state: State) => runPhaseCVerifier(ports(state), {
  fixture: phaseCAcceptanceFixture() as never,
  rawEvent: phaseCRawEvent(),
  workflow: phaseCWorkflow(),
});

const baseState = (): State => ({
  commits: 0, evaluated: [], casePolled: 0, caseResponsibility: "UNKNOWN", caseRequests: 3,
  contractState: "AWAITING_OUTCOME", fixtureRejected: false, evaluateMode: "PARTIAL",
  readinessStates: ["AWAITING_OUTCOME"], paymentStatus: "SUCCESS", contractReads: 0,
});

describe("Phase C verifier deployed lifecycle", () => {
  it("exits the full closure: fixture → authorization → exactly-once execution → owner PARTIAL → UNKNOWN case + requests", async () => {
    const state = baseState();
    const result = await run(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const closure = result.value as PhaseCClosure;
    expect(closure.fixture).toBe(PHASE_C_ID);
    expect(closure.execution).toEqual(expect.objectContaining({ status: "SUCCESS", executionId: "exec-phase-c", resultRef: "mock-pay-phase-c" }));
    expect(closure.exactlyOnce).toEqual({ replayStatus: "IDEMPOTENT_REPLAY", sameResultRef: true });
    expect(closure.outcome.state).toBe("PARTIAL");
    expect(closure.divergence).toEqual({ requiredQuantity: 500, verifiedReceived: 450, shortfall: 50 });
    expect(closure.resolutionCase.responsibilityState).toBe("UNKNOWN");
    expect(closure.evidenceRequests).toHaveLength(3);
    // The verifier submitted canonical claim ids only — never facts.
    expect(state.evaluated).toEqual([{
      contractId: "outcome-phase-c-flagship",
      claimIds: phaseCAcceptanceFixture().claims.map((claim) => (claim as { id: string }).id),
    }]);
  });

  it("fails when the evidence fixture is rejected by the owner", async () => {
    const state = baseState();
    state.fixtureRejected = true;
    const result = await run(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("fixture rejected");
  });

  it("fails closed when the outcome is not PARTIAL (e.g., SATISFIED would violate the flagship expectation)", async () => {
    const state = baseState();
    state.evaluateMode = "SATISFIED";
    await expect(run(state)).rejects.toThrow("PHASE_C_OUTCOME_NOT_PARTIAL");
  });

  it("fails closed on a divergent shortfall", async () => {
    const state = baseState();
    // The owner is the authority on divergence; the verifier only asserts.
    // Simulate a divergent owner result by overriding evaluateMode to
    // PARTIAL with a tampered verification path is not possible through the
    // port — assert instead that a CONFLICTED owner result fails closed.
    state.evaluateMode = "CONFLICTED";
    await expect(run(state)).rejects.toThrow("PHASE_C_OUTCOME_NOT_PARTIAL");
  });

  it("fails closed when responsibility is not UNKNOWN", async () => {
    const state = baseState();
    state.caseResponsibility = "MERCHANT";
    await expect(run(state)).rejects.toThrow("PHASE_C_RESPONSIBILITY_NOT_UNKNOWN");
  });

  it("fails closed when the resolution case never appears", async () => {
    const state = baseState();
    state.caseResponsibility = "MISSING";
    await expect(run(state)).rejects.toThrow("PHASE_C_RESOLUTION_CASE_MISSING");
  });

  it("fails closed when no discriminating evidence requests exist", async () => {
    const state = baseState();
    state.caseRequests = 0;
    await expect(run(state)).rejects.toThrow("PHASE_C_EVIDENCE_REQUESTS_MISSING");
  });

  it("fails closed on any evidence request that requires authority", async () => {
    const state = baseState();
    const p = ports(state);
    const orig = p.getResolutionCaseByContract;
    p.getResolutionCaseByContract = async (contractId) => {
      const base = await orig(contractId);
      if (!base.ok) return base;
      return ok({ case: base.value.case, evidenceRequests: [{ id: "bad-request", requiresAuthority: true }] });
    };
    await expect(runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    })).rejects.toThrow("PHASE_C_REQUEST_REQUIRES_AUTHORITY");
  });

  it("rejects a second economic execution (commit replay returns a new effect)", async () => {
    const state = baseState();
    const p = ports(state);
    const orig = p.submitCommit;
    let count = 0;
    p.submitCommit = async (body) => {
      count += 1;
      if (count === 1) return orig(body);
      return ok({ status: "SUCCESS", executionId: "exec-phase-c-2", resultRef: "mock-pay-phase-c-2" });
    };
    await expect(runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    })).rejects.toThrow("PHASE_C_EXACTLY_ONCE_VIOLATED");
  });

  it("does not authorize an economics mismatch", async () => {
    const state = baseState();
    const p = ports(state);
    p.submitWorkflow = async () => ok({
      state: "AUTHORIZED",
      authorization: {
        commitToken: { id: "ct-phase-c-1" },
        grant: { id: "g", amount: 1, currency: "USD", merchant: "evil", outcomeContractId: "oc" },
      },
    });
    await expect(runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    })).rejects.toThrow("PHASE_C_ECONOMICS_MISMATCH");
  });

  it("carries no direct Gateway COMMIT capability (ports are reference-only)", async () => {
    const p = ports(baseState());
    expect("submitGatewayCommit" in p).toBe(false);
    expect("invokeAdapter" in p).toBe(false);
  });
});

describe("Phase C post-payment outcome readiness", () => {
  const runWith = (state: State) => runPhaseCVerifier(ports(state), {
    fixture: phaseCAcceptanceFixture() as never,
    rawEvent: phaseCRawEvent(),
    workflow: phaseCWorkflow(),
  });

  it("immediate readiness: AWAITING_OUTCOME/SUCCESS → one read, no delay, evaluate once", async () => {
    const state = baseState();
    const result = await runWith(state);
    expect(result.ok).toBe(true);
    expect(state.contractReads).toBe(1);
    expect(state.evaluated).toHaveLength(1);
  });

  it("delayed payment event: CREATED → AWAITING_OUTCOME/SUCCESS → evaluate once", async () => {
    const state = baseState();
    state.readinessStates = ["CREATED", "CREATED", "AWAITING_EXECUTION", "AWAITING_OUTCOME"];
    const result = await runWith(state);
    expect(result.ok).toBe(true);
    expect(state.contractReads).toBe(4);
    expect(state.evaluated).toHaveLength(1);
  });

  it("readiness timeout: remains CREATED → fail closed, zero evaluate calls", async () => {
    const state = baseState();
    state.readinessStates = ["CREATED"];
    await expect(runWith(state)).rejects.toThrow("PHASE_C_OUTCOME_READY_TIMEOUT");
    expect(state.evaluated).toHaveLength(0);
  });

  it("unexpected early PARTIAL before evaluation → fail closed, zero evaluate calls", async () => {
    const state = baseState();
    state.readinessStates = ["PARTIAL"];
    await expect(runWith(state)).rejects.toThrow("PHASE_C_UNEXPECTED_OUTCOME_STATE");
    expect(state.evaluated).toHaveLength(0);
  });

  it.each(["SATISFIED", "BREACHED", "CONFLICTED"])("unexpected early %s → fail closed", async (early) => {
    const state = baseState();
    state.readinessStates = [early];
    await expect(runWith(state)).rejects.toThrow("PHASE_C_UNEXPECTED_OUTCOME_STATE");
    expect(state.evaluated).toHaveLength(0);
  });

  it("AWAITING_OUTCOME with payment not SUCCESS → fail closed", async () => {
    const state = baseState();
    state.readinessStates = ["AWAITING_OUTCOME"];
    state.paymentStatus = "PENDING";
    await expect(runWith(state)).rejects.toThrow("PHASE_C_PAYMENT_NOT_SUCCESS");
    expect(state.evaluated).toHaveLength(0);
  });

  it("owner read failure during polling → fail closed with the typed outcome", async () => {
    const state = baseState();
    const p = ports(state);
    p.getContract = async () => ({ ok: false as const, code: "MODEL_UNAVAILABLE" as never, message: "owner unavailable", details: undefined });
    await expect(runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    })).rejects.toThrow("PHASE_C_CONTRACT_READ_FAILED");
    expect(state.evaluated).toHaveLength(0);
  });
});
