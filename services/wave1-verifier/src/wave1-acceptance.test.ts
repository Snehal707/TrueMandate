import { describe, expect, it } from "vitest";
import { OutcomeContractState, ResolutionCaseState } from "@truemandate/protocol";
import { wave1RawIntent, WAVE1_A_ID, WAVE1_B_ID, WAVE1_C_ID } from "./fixture.js";
import {
  runWave1BlockAcceptance,
  runWave1FullDeliveryAcceptance,
  runWave1RemedyAcceptance,
  wave1Runtime,
} from "./run.js";

/**
 * Wave 1 V0 acceptance proofs over the real owner routes (fresh wave1-
 * namespaces; the historical Phase A/B/C fixtures are never touched).
 *
 *  A — unsafe supplier: BLOCK with zero purchase.
 *  B — valid supplier, full delivery: SATISFIED → owner CLOSE → CLOSED.
 *  C — short delivery: PARTIAL → remedy (50-unit replacement) → combined
 *      500 received → case RESOLVED; original contract stays PARTIAL.
 */

describe("Wave 1 acceptance A — unsafe supplier BLOCK, zero purchase", () => {
  it("blocks before any economic activity", async () => {
    const rt = await wave1Runtime(wave1RawIntent(WAVE1_A_ID, "Unsafe Supplier"), WAVE1_A_ID);
    const result = await runWave1BlockAcceptance(rt, WAVE1_A_ID);
    expect(result.state).toBe("BLOCKED");
    expect(result.sideEffects).toBe(0);
    // Zero authority: no evaluation record was ever created (Guardian made
    // the action ineligible before the Authority owner was consulted).
    expect(result.evaluations).toBe(0);
    // The durable proof trail documents the semantic failure.
    expect(result.unsatisfiedProofs).toBeGreaterThanOrEqual(1);
  });
});

describe("Wave 1 acceptance B — full delivery SATISFIED → CLOSED", () => {
  it("satisfies and closes the V0 full-delivery case with complete evidence", async () => {
    const rt = await wave1Runtime(wave1RawIntent(WAVE1_B_ID, "Wave1 Supplier"), WAVE1_B_ID);
    const result = await runWave1FullDeliveryAcceptance(rt, WAVE1_B_ID);
    expect(result.state).toBe(OutcomeContractState.CLOSED);
    // Complete full-delivery acceptance evidence:
    expect(result.sideEffects).toBe(1); // controlled purchase side effect exactly 1
    expect(result.paymentStatus).toBe("SUCCESS");
    expect(result.quantityReceived).toBe(500);
    expect(result.foodGradeSatisfied).toBe(true); // valid food-grade evidence
    expect(result.supplierSatisfied).toBe(true); // supplier approved
    expect(result.amount).toBe(742000);
    expect(result.withinBudget).toBe(true); // 742000 <= 800000
    expect(result.tokenConsumed).toBe(true); // CommitToken consumed exactly once
    expect(result.replaySideEffects).toBe(1); // replay: 0 additional side effects
    // No ResolutionCase was ever opened for a satisfied contract.
    const caseRead = await rt.getCaseByContract(result.contractId);
    expect(caseRead.ok).toBe(false);
  });
});

describe("Wave 1 acceptance C — short delivery PARTIAL → remedy → RESOLVED", () => {
  it("runs the full remedy lifecycle and restores 500 combined units", async () => {
    const rt = await wave1Runtime(wave1RawIntent(WAVE1_C_ID, "Wave1 Supplier"), WAVE1_C_ID);
    const result = await runWave1RemedyAcceptance(rt, WAVE1_C_ID);
    expect(result.originalState).toBe(OutcomeContractState.PARTIAL);
    expect(result.remedyState).toBe(OutcomeContractState.SATISFIED);
    expect(result.caseState).toBe(ResolutionCaseState.RESOLVED);
    expect(result.combinedReceived).toBe(500);
  });
});
