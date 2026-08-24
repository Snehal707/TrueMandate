import { describe, expect, it } from "vitest";
import { ResolutionCaseState } from "@truemandate/protocol";
import { wave1RawIntent, WAVE1_C_ID } from "./fixture.js";
import { wave1Runtime } from "./run.js";

/**
 * Remedy mandate concurrency (Wave 1 security closure):
 *
 * Two GENUINELY PARALLEL executions against the SAME remediation mandate must
 * produce at most ONE successful economic execution, ONE consumed CommitToken
 * and ONE side effect. Protection chain: single-slot atomic mandate claim
 * (ACTIVE → CLAIMED → CONSUMED) + deterministic grant/token identities +
 * single-use CommitToken + Gateway idempotency + side-effect ledger dedupe.
 */

async function prepareRemedyCase() {
  const rt = await wave1Runtime(wave1RawIntent(WAVE1_C_ID, "Wave1 Supplier"), WAVE1_C_ID);
  const { wave1AcceptanceFixture, wave1AuthorizationEvidence, wave1ShortDeliveryEvidence, wave1ReplacementEvidence, wave1Workflow } = await import("./fixture.js");
  const fixture = wave1AcceptanceFixture(WAVE1_C_ID, [
    ...wave1AuthorizationEvidence(WAVE1_C_ID, "wave1-supplier"),
    ...wave1ShortDeliveryEvidence(WAVE1_C_ID),
    ...wave1ReplacementEvidence(WAVE1_C_ID),
  ]);
  const submitted = await rt.submitFixture(fixture);
  if (!submitted.ok) throw new Error(submitted.message);
  const result = await rt.coordinator.run({ ...(wave1Workflow(WAVE1_C_ID, { id: "wave1-supplier", approved: true }) as object), expectedIntentStateId: rt.intentState.id });
  if (!result.ok) throw new Error(result.message);
  const value = result.value as { state: string; authorization?: { commitToken?: { id?: string }; grant?: { id?: string; outcomeContractId?: string } } };
  const tokenId = value.authorization?.commitToken?.id;
  const originalGrantId = value.authorization?.grant?.id;
  const contractId = value.authorization?.grant?.outcomeContractId;
  if (value.state !== "AUTHORIZED" || !tokenId || !originalGrantId || !contractId) throw new Error("authorization incomplete");
  const commit = await rt.commitRoute.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
  if (commit.status !== 200) throw new Error(`commit failed: ${JSON.stringify(commit.body)}`);
  const claims = wave1ShortDeliveryEvidence(WAVE1_C_ID).map((item) => `${item.artifactId}-claim`);
  const evaluated = await rt.evaluateEvidenceRoute.handler({ body: { claimIds: claims }, headers: {}, params: { outcomeContractId: contractId }, caller: { email: "wave1-verifier@test.iam.gserviceaccount.com" } });
  if (evaluated.status !== 200) throw new Error(`evaluate failed: ${JSON.stringify(evaluated.body)}`);
  let caseBody: { case: { id: string } } | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await rt.getCaseByContract(contractId);
    if (found.ok) { caseBody = found.value as { case: { id: string } }; break; }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (!caseBody) throw new Error("case not opened");
  const caseId = caseBody.case.id;
  const remediesResponse = await rt.listRemedies(caseId);
  const remedies = (remediesResponse.body as { remedies: { id: string; requiresFinancialAction: boolean }[] }).remedies;
  const replacement = remedies.find((remedy) => remedy.requiresFinancialAction);
  if (!replacement) throw new Error("no financial remedy");
  const mandateResponse = await rt.issueMandate(caseId, replacement.id, { expiresAt: "2026-12-31T17:00:00.000Z" });
  if (mandateResponse.status !== 200) throw new Error(`mandate failed: ${JSON.stringify(mandateResponse.body)}`);
  const mandate = (mandateResponse.body as { mandate: { id: string } }).mandate;
  return { rt, caseId, replacementId: replacement.id, mandateId: mandate.id, originalGrantId, contractId };
}

describe("remedy mandate concurrency", () => {
  it("two parallel executions of the same mandate yield at most one economic execution", async () => {
    const f = await prepareRemedyCase();
    const execute = () => f.rt.executeRemedy(f.caseId, f.replacementId, { mandateId: f.mandateId, originalPaymentGrantId: f.originalGrantId });
    const [first, second] = await Promise.all([execute(), execute()]);

    const bodies = [first, second].map((res) => res.body as { executionStatus?: string; error?: string; case?: { state: string }; remedyOutcomeContractId?: string });
    const successes = bodies.filter((body) => body.executionStatus === "SUCCESS");
    // At most ONE successful economic execution.
    expect(successes.length).toBeLessThanOrEqual(1);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // One original purchase + at most one remedy side effect.
    const ledger = await f.rt.gateway.getSideEffectLedger().listAll();
    expect(ledger.length).toBe(2);

    // Exactly one consumed remedy CommitToken (the original token was
    // consumed by the acceptance flow; no second remedy token may exist).
    const remedyTokens = ledger.filter((row) => row.counterparty === "remedy-counterparty");
    expect(remedyTokens).toHaveLength(1);

    // The consumed mandate closes the lifecycle: a third execution must fail
    // closed (mandate CONSUMED → claim/mandate validation rejects).
    const third = await f.rt.executeRemedy(f.caseId, f.replacementId, { mandateId: f.mandateId, originalPaymentGrantId: f.originalGrantId });
    expect(third.status).toBe(400);
    const ledgerAfter = await f.rt.gateway.getSideEffectLedger().listAll();
    expect(ledgerAfter.length).toBe(2);
  });

  it("the single-slot claim rejects a DIFFERENT execution attempt while CLAIMED", async () => {
    const f = await prepareRemedyCase();
    const claim = await f.rt.resolution.claimMandateForExecution(f.mandateId, {
      idempotencyKey: "remedy:attempt-A",
      caseId: f.caseId,
      remedyId: f.replacementId,
      claimedAt: "2026-06-05T12:00:00.000Z",
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value).toBe("CLAIMED");
    // A different attempt against the same mandate is rejected.
    const foreign = await f.rt.resolution.claimMandateForExecution(f.mandateId, {
      idempotencyKey: "remedy:attempt-B",
      caseId: f.caseId,
      remedyId: f.replacementId,
      claimedAt: "2026-06-05T12:00:01.000Z",
    });
    expect(foreign.ok).toBe(false);
    // The identical attempt may continue (idempotent convergence).
    const same = await f.rt.resolution.claimMandateForExecution(f.mandateId, {
      idempotencyKey: "remedy:attempt-A",
      caseId: f.caseId,
      remedyId: f.replacementId,
      claimedAt: "2026-06-05T12:00:02.000Z",
    });
    expect(same.ok && same.value === "CONTINUATION").toBe(true);
    // Release back to the identical attempt only.
    const release = await f.rt.resolution.releaseMandateClaim(f.mandateId, "remedy:attempt-A", "2026-06-05T12:00:03.000Z");
    expect(release.ok).toBe(true);
    // After release, a DIFFERENT attempt is still rejected (tombstone).
    const afterRelease = await f.rt.resolution.claimMandateForExecution(f.mandateId, {
      idempotencyKey: "remedy:attempt-B",
      caseId: f.caseId,
      remedyId: f.replacementId,
      claimedAt: "2026-06-05T12:00:04.000Z",
    });
    expect(afterRelease.ok).toBe(false);
  });
});
