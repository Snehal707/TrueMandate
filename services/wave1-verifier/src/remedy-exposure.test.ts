import { describe, expect, it } from "vitest";
import { ErrorCode } from "@truemandate/protocol";
import { wave1RawIntent, WAVE1_C_ID } from "./fixture.js";
import { wave1Runtime } from "./run.js";

/**
 * Cumulative remedy exposure (Wave 1 security closure):
 *
 * Remediation-specific exposure scoping (remedy:<mandate>:<currency>) must
 * never become an evasion of ROOT related cumulative exposure. Every remedy
 * commit additionally reserves against the root intent/policy budget group,
 * with the root threshold read from the authoritative IntentState budget
 * constraint — never caller-supplied.
 *
 * The adversarial scenario: the original purchase committed 742000 against
 * the root group; earlier remedies have driven cumulative root exposure to
 * 796000. One more individually-valid 6000 remedy would cross the 800000
 * policy budget — it must fail with CUMULATIVE_EXPOSURE_EXCEEDED and produce
 * ZERO additional economic state.
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
  return { rt, caseId, replacementId: replacement.id, mandateId: mandate.id, originalGrantId };
}

describe("remedy cumulative root exposure", () => {
  it("a remedy under the root budget succeeds and reserves BOTH groups", async () => {
    const f = await prepareRemedyCase();
    const executed = await f.rt.executeRemedy(f.caseId, f.replacementId, { mandateId: f.mandateId, originalPaymentGrantId: f.originalGrantId });
    expect(executed.status).toBe(200);
    const body = executed.body as { executionStatus: string };
    expect(body.executionStatus).toBe("SUCCESS");
    // The remedy reserved its own mandate group AND the root group.
    const rootEntries = await f.rt.authority.getExposureLedger().list(`${WAVE1_C_ID}:INR`);
    const committedRoot = rootEntries.filter((entry) => entry.status === "COMMITTED");
    expect(committedRoot.length).toBeGreaterThanOrEqual(2); // original + remedy
  });

  it("individually-valid remedies that cumulatively exceed the root policy budget fail with CUMULATIVE_EXPOSURE_EXCEEDED", async () => {
    const f = await prepareRemedyCase();
    // The original purchase (742000) is already COMMITTED against the root
    // group. Simulate prior remedies having driven root cumulative exposure
    // to 796000 (each individually valid at 6000 under the 800000 budget).
    const seeded = await f.rt.authority.getExposureLedger().add({
      id: "exp-adversarial-prior-remedies",
      amount: 54000,
      currency: "INR",
      relatedGroupId: `${WAVE1_C_ID}:INR`,
      status: "COMMITTED",
    });
    if (!seeded.ok) throw new Error(seeded.message);

    const executed = await f.rt.executeRemedy(f.caseId, f.replacementId, { mandateId: f.mandateId, originalPaymentGrantId: f.originalGrantId });
    // 742000 + 54000 + 6000 = 802000 > 800000 → deterministic overflow.
    expect(executed.status).toBe(400);
    expect(executed.body).toMatchObject({ error: ErrorCode.CUMULATIVE_EXPOSURE_EXCEEDED });

    // Zero additional economic state: the remedy token was never consumed and
    // no remedy side effect exists.
    const ledger = await f.rt.gateway.getSideEffectLedger().listAll();
    expect(ledger.filter((row) => row.counterparty === "remedy-counterparty")).toHaveLength(0);
    // The failed attempt released its mandate-scoped reservation and did not
    // consume the mandate — the case may reconcile, but never re-execute
    // blindly through a different idempotency path.
    const mandate = await f.rt.resolution.getMandate(f.mandateId);
    expect(mandate.ok).toBe(true);
    if (mandate.ok) expect(mandate.value.status).toBe("ACTIVE");
  });
});
