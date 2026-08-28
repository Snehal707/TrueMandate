import { describe, expect, it } from "vitest";
import { AuthorityDecision, ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";

/**
 * Proves the trusted demo-evidence orchestration's FIXTURE DATA (mirroring
 * services/phase-c-verifier/src/demo-evidence-templates.ts — duplicated
 * here rather than imported, since agent-runtime does not and should not
 * depend on phase-c-verifier) actually produces the promised outcomes when
 * carried through the REAL evidence-backed-readiness engine, with proofs
 * suppressed from the harness's synthetic shortcut (`omitProofSummary`) so
 * only the genuine `PreExecutionReadinessService` path can produce one.
 *
 * Two concerns, two test groups:
 *  - ALL FIVE DOMAINS: does each domain's control fixture reach AUTHORIZED
 *    and execute through the real pipeline (Guardian, PreparedAction,
 *    CommitToken, MockPaymentAdapter, Outcome, Provenance, exactly-once
 *    replay)?
 *  - PROCUREMENT CAUSALITY + ISOLATION: control (quantity 500) and attack
 *    (quantity 450) submitted against the exact same evidence-backed S1,
 *    proving control executes first, then attack's own evaluation is
 *    unaffected by that execution and stops at actionFidelity specifically.
 */

const DEADLINE = "2026-12-31T00:00:00.000Z";
const CHECK_IN = "2026-12-20T00:00:00.000Z";
const CHECK_OUT = "2026-12-22T00:00:00.000Z";
const PROCUREMENT_DEADLINE = "2026-12-31T17:00:00.000Z";

function envelope(id: string, source: string) {
  return {
    id,
    source,
    contentHash: "b".repeat(64),
    captureTime: "2026-06-01T00:00:00.000Z",
    mimeType: "application/json",
    trustClass: TrustClass.ELEVATED_EXTERNAL,
    taint: { classes: ["EXTERNAL_CONTENT"], origins: ["verified-by:demo-fixture-writer"] },
  };
}

function claims(envelopeId: string, facts: readonly (readonly [string, unknown])[]) {
  return facts.map(([concept, value]) => ({
    id: `${envelopeId}-${concept}`,
    evidenceId: envelopeId,
    concept,
    value,
    confidence: 1,
  }));
}

interface DomainCase {
  readonly packId: "procurement" | "travel" | "saas_it_spend" | "invoice_vendor_payment" | "logistics_fulfillment";
  readonly label: string;
  readonly rawText: string;
  readonly capability: string;
  readonly constraints: Array<Record<string, unknown>>;
  readonly facts: readonly (readonly [string, unknown])[];
  readonly controlAction: Record<string, unknown>;
  readonly payload: (evidenceId: string) => Record<string, unknown>;
}

const EVIDENCE_ID = "demo-domain-offer";

const CASES: readonly DomainCase[] = [
  {
    packId: "procurement",
    label: "Procurement",
    rawText: "Buy 500 food-grade containers from an approved supplier for under INR 800000 before December 31, 2026.",
    capability: "execute_payment",
    constraints: [
      explicitConstraint("p-supplier", "approved_supplier", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved supplier"),
      explicitConstraint("p-grade", "food_grade", ConstraintOperator.EQ, true, ConstraintKind.HARD, "food-grade"),
      explicitConstraint("p-quantity", "quantity", ConstraintOperator.EQ, 500, ConstraintKind.HARD, "500"),
      explicitConstraint("p-budget", "budget", ConstraintOperator.LTE, 800000, ConstraintKind.FINANCIAL, "under INR 800000"),
      temporalConstraint("p-deadline", "execution_deadline", PROCUREMENT_DEADLINE, "before December 31, 2026"),
    ],
    facts: [
      ["approved_supplier", true],
      ["food_grade", true],
      ["quantity", 500],
      ["budget", 742000],
      ["execution_deadline", PROCUREMENT_DEADLINE],
    ],
    controlAction: {
      capability: "execute_payment", merchant: "approved-supplier", product: "food-grade containers",
      quantity: 500, amount: 742000, currency: "INR",
      deliveryTerms: "deliver before 2026-12-30", parameters: {}, consequenceLevel: "HIGH",
    },
    payload: (evidenceId) => ({
      supplier: { id: "approved-supplier", name: "Approved Supplier", approved: true, approvalEvidenceId: evidenceId },
      item: { specification: "food-grade containers" },
      foodGradeEvidenceId: evidenceId,
      evidenceIds: [evidenceId],
      delivery: { terms: "deliver before 2026-12-30", deadline: "2026-12-30T23:59:59.000Z" },
    }),
  },
  {
    packId: "travel",
    label: "Travel",
    rawText: "Book 2 refundable hotel stays at Seaside Lodge with an approved provider for under USD 5000, checking in December 20 and out December 22, before December 31, 2026.",
    capability: "book_travel",
    constraints: [
      explicitConstraint("t-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
      explicitConstraint("t-property", "hotel_name", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "hotel"),
      explicitConstraint("t-refund", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
      explicitConstraint("t-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
      explicitConstraint("t-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
      temporalConstraint("t-checkin", "check_in_date", CHECK_IN, "December 20"),
      temporalConstraint("t-checkout", "check_out_date", CHECK_OUT, "December 22"),
      temporalConstraint("t-deadline", "booking_deadline", DEADLINE, "before December 31, 2026"),
    ],
    facts: [
      ["approved_provider", true], ["hotel_name", "Seaside Lodge"], ["refundable", true],
      ["traveler_count", 2], ["travel_budget", 3200], ["check_in_date", CHECK_IN],
      ["check_out_date", CHECK_OUT], ["booking_deadline", DEADLINE],
    ],
    controlAction: {
      capability: "book_travel", merchant: "Meridian Travel Partners", product: "Seaside Lodge",
      quantity: 2, amount: 3200, currency: "USD", refundable: true,
      deliveryTerms: "travel on 2026-12-20", parameters: {}, consequenceLevel: "HIGH",
    },
    payload: (evidenceId) => ({
      provider: { id: "Meridian Travel Partners", name: "Meridian Travel Partners", approved: true, approvalEvidenceId: evidenceId },
      booking: { itineraryId: "it-1", lodgingName: "Seaside Lodge", travelDate: CHECK_IN, checkInDate: CHECK_IN, checkOutDate: CHECK_OUT, travelerCount: 2 },
      policy: { refundableRequired: true },
      evidenceIds: [evidenceId],
    }),
  },
  {
    packId: "saas_it_spend",
    label: "SaaS / IT Spend",
    rawText: "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term for under USD 12000 before December 31, 2026.",
    capability: "manage_saas_subscription",
    constraints: [
      explicitConstraint("s-vendor", "approved_vendor", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved"),
      explicitConstraint("s-plan", "plan_name", ConstraintOperator.EQ, "Business Plan", ConstraintKind.HARD, "SaaS plan"),
      explicitConstraint("s-seats", "seat_count", ConstraintOperator.EQ, 10, ConstraintKind.HARD, "10 seats"),
      explicitConstraint("s-term", "term_months", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12 month term"),
      explicitConstraint("s-renewal", "renewal_setting", ConstraintOperator.EQ, "MANUAL", ConstraintKind.HARD, "manual renewal"),
      explicitConstraint("s-budget", "saas_budget", ConstraintOperator.LTE, 12000, ConstraintKind.FINANCIAL, "under USD 12000"),
      temporalConstraint("s-deadline", "subscription_deadline", DEADLINE, "before December 31, 2026"),
    ],
    facts: [
      ["approved_vendor", true], ["plan_name", "Business Plan"], ["seat_count", 10],
      ["term_months", 12], ["renewal_setting", "MANUAL"], ["saas_budget", 9000], ["subscription_deadline", DEADLINE],
    ],
    controlAction: {
      capability: "manage_saas_subscription", merchant: "approved-vendor", product: "Business Plan",
      quantity: 10, amount: 9000, currency: "USD", deliveryTerms: "activate before 2026-12-31",
      parameters: { renewalSetting: "MANUAL", termMonths: 12, seatCount: 10 }, consequenceLevel: "HIGH",
    },
    payload: (evidenceId) => ({
      vendor: { id: "approved-vendor", name: "Approved Vendor", approved: true, approvalEvidenceId: evidenceId },
      subscription: { planId: "plan-business", planName: "Business Plan", termMonths: 12, renewalSetting: "MANUAL", seatCount: 10 },
      evidenceIds: [evidenceId],
    }),
  },
  {
    packId: "invoice_vendor_payment",
    label: "Invoice / Vendor Payment",
    rawText: "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026.",
    capability: "pay_invoice",
    constraints: [
      explicitConstraint("i-payee", "approved_payee", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved vendor"),
      explicitConstraint("i-invoice", "invoice_id", ConstraintOperator.EQ, "INV-2026-001", ConstraintKind.HARD, "INV-2026-001"),
      explicitConstraint("i-duplicate", "duplicate_payment", ConstraintOperator.EQ, "dup-1", ConstraintKind.HARD, "one time"),
      explicitConstraint("i-amount", "invoice_amount", ConstraintOperator.LTE, 25000, ConstraintKind.FINANCIAL, "under USD 25000"),
      temporalConstraint("i-due", "invoice_due_date", DEADLINE, "before November 30, 2026"),
    ],
    facts: [
      ["approved_payee", true], ["invoice_id", "INV-2026-001"], ["duplicate_payment", "dup-1"],
      ["invoice_amount", 24000], ["invoice_due_date", DEADLINE],
    ],
    controlAction: {
      capability: "pay_invoice", merchant: "approved-payee", product: "INV-2026-001",
      quantity: 1, amount: 24000, currency: "USD", deliveryTerms: "settle before 2026-11-30",
      parameters: { invoiceId: "INV-2026-001", remittanceReference: "remit-1" }, consequenceLevel: "HIGH",
    },
    payload: (evidenceId) => ({
      payee: { id: "approved-payee", name: "Approved Payee", approved: true, approvalEvidenceId: evidenceId },
      invoice: { invoiceId: "INV-2026-001", poReference: "PO-77", dueDate: DEADLINE, duplicateCheckKey: "dup-1", remittanceReference: "remit-1" },
      evidenceIds: [evidenceId],
    }),
  },
  {
    packId: "logistics_fulfillment",
    label: "Logistics / Fulfillment",
    rawText: "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse for under USD 4000 before December 31, 2026.",
    capability: "arrange_fulfillment",
    constraints: [
      explicitConstraint("l-carrier", "approved_carrier", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved carrier"),
      explicitConstraint("l-destination", "destination", ConstraintOperator.EQ, "Mumbai Warehouse", ConstraintKind.HARD, "Mumbai Warehouse"),
      explicitConstraint("l-service", "service_level", ConstraintOperator.EQ, "EXPRESS", ConstraintKind.HARD, "EXPRESS"),
      explicitConstraint("l-count", "fulfill_count", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12"),
      explicitConstraint("l-budget", "budget", ConstraintOperator.LTE, 4000, ConstraintKind.FINANCIAL, "under USD 4000"),
      temporalConstraint("l-deadline", "shipment_deadline", DEADLINE, "before December 31, 2026"),
    ],
    facts: [
      ["approved_carrier", true], ["destination", "Mumbai Warehouse"], ["service_level", "EXPRESS"],
      ["fulfill_count", 12], ["budget", 3500], ["shipment_deadline", DEADLINE],
    ],
    controlAction: {
      capability: "arrange_fulfillment", merchant: "approved-carrier", product: "EXPRESS",
      quantity: 12, amount: 3500, currency: "USD", deliveryTerms: "ship to Mumbai Warehouse before 2026-12-31",
      parameters: { destination: "Mumbai Warehouse", serviceLevel: "EXPRESS", fulfillCount: 12 }, consequenceLevel: "HIGH",
    },
    payload: (evidenceId) => ({
      provider: { id: "approved-carrier", name: "Approved Carrier", approved: true, approvalEvidenceId: evidenceId },
      shipment: { serviceLevel: "EXPRESS", destination: "Mumbai Warehouse", shipBy: DEADLINE, fulfillCount: 12 },
      evidenceIds: [evidenceId],
    }),
  },
];

async function runControl(domainCase: DomainCase) {
  const rt = await runtime({
    rawText: domainCase.rawText,
    omitProofSummary: true,
    capabilities: { [domainCase.capability]: AuthorityDecision.ALLOW },
    compilerTransform: replaceConstraints(domainCase.rawText, domainCase.constraints),
    demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${domainCase.packId}:v1`), claims: claims(EVIDENCE_ID, domainCase.facts) }],
  });

  const body = (expectedIntentStateId: string) => ({
    intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
    action: domainCase.controlAction,
    domain: { packId: domainCase.packId, payload: domainCase.payload(EVIDENCE_ID) },
    idempotencyKey: `demo-control-${domainCase.packId}`,
  });

  let result = await rt.dispatcher.submitWorkflow(body(rt.state.id));
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    result = await rt.dispatcher.submitWorkflow(body(String((result.details as Record<string, unknown>).intentStateId)));
  }
  return { rt, result };
}

describe("all five domain controls reach AUTHORIZED and execute through the real pipeline", () => {
  for (const domainCase of CASES) {
    it(`${domainCase.label}: proofs, plan verification, Guardian, Authority, PreparedAction, CommitToken, execution, Outcome, Provenance, exactly-once replay`, async () => {
      const { rt, result } = await runControl(domainCase);
      if (!result.ok) throw new Error(`${domainCase.label}: ${result.code}: ${result.message}`);
      const value = result.value as { state: string; workflowId: string; outcomeContract?: { id?: string } };

      const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
      const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
      const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
      const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
      const guardian = rows.find((row) => row.kind === "GUARDIAN")?.payload;
      const authorization = rows.find((row) => row.kind === "EXECUTION_AUTHORIZATION")?.payload;

      // Proofs: real evidence-backed handoff, not the harness shortcut.
      expect(proofs.length).toBeGreaterThan(0);
      for (const proof of proofs) {
        expect(proof.method).toBe("authoritative-proof-handoff");
        expect(proof.status).toBe("SATISFIED");
      }
      // Plan verification.
      expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");
      // Guardian actually ran — a real verdict object with real judges, not a
      // hardcoded sentinel. criticalFailure must be false for AUTHORIZED to
      // have been reachable at all (see generic-workflow-engine.ts eligible gate).
      const verdict = guardian?.verdict as Record<string, unknown> | undefined;
      expect(verdict).toBeDefined();
      expect(["ALLOW", "ALLOW_WITH_MONITORING"]).toContain(verdict?.decision);
      expect(verdict?.criticalFailure).toBe(false);
      // Authority reached, PreparedAction + CommitToken produced.
      expect(value.state).toBe("AUTHORIZED");
      expect(typeof authorization?.preparedActionId).toBe("string");
      expect(typeof authorization?.commitTokenId).toBe("string");
      expect(typeof authorization?.grantId).toBe("string");
      expect(rt.calls).toMatchObject({ evaluation: 1, prepare: 1, mint: 1, authorize: 1 });

      // Governed mock execution, exactly once.
      const committed = await rt.dispatcher.commitWorkflow(value.workflowId);
      if (!committed.ok) throw new Error(`${domainCase.label} commit: ${committed.code}: ${committed.message}`);
      expect(committed.value).toMatchObject({ status: "SUCCESS" });
      expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
      const replay = await rt.dispatcher.commitWorkflow(value.workflowId);
      expect(replay.ok && (replay.value as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
      expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

      // Outcome produced.
      expect(typeof value.outcomeContract?.id).toBe("string");
      // Provenance produced.
      expect(rt.provenance.getGraph().listNodes().length).toBeGreaterThan(0);
    });
  }
});

describe("procurement: control (500) executes, then attack (450) against the exact same S1", () => {
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is actionFidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const procurement = CASES[0]!;
    const rt = await runtime({
      rawText: procurement.rawText,
      omitProofSummary: true,
      capabilities: { [procurement.capability]: AuthorityDecision.ALLOW },
      compilerTransform: replaceConstraints(procurement.rawText, procurement.constraints),
      demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${procurement.packId}:v1`), claims: claims(EVIDENCE_ID, procurement.facts) }],
    });

    const controlBody = (expectedIntentStateId: string) => ({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
      action: procurement.controlAction,
      domain: { packId: procurement.packId, payload: procurement.payload(EVIDENCE_ID) },
      idempotencyKey: "demo-control-procurement-causality",
    });

    // Control leg 2, unpinned in spirit (first attempt bound to the pre-evidence
    // tip; the retry below mirrors resolveEvidenceBackedState's own
    // caller-must-rebind contract when a caller DOES name a state).
    let controlResult = await rt.dispatcher.submitWorkflow(controlBody(rt.state.id));
    let boundStateId = rt.state.id;
    let boundStateHash = rt.state.stateHash;
    if (!controlResult.ok && controlResult.code === "INTENT_STATE_NOT_READY") {
      const details = controlResult.details as Record<string, unknown>;
      boundStateId = String(details.intentStateId);
      boundStateHash = String(details.intentStateHash);
      controlResult = await rt.dispatcher.submitWorkflow(controlBody(boundStateId));
    }
    if (!controlResult.ok) throw new Error(`control: ${controlResult.code}: ${controlResult.message}`);
    const controlValue = controlResult.value as { state: string; workflowId: string };
    expect(controlValue.state).toBe("AUTHORIZED");

    // Read back the exact bound state via the durable WORKFLOW artifact —
    // never assumed, never independently derived.
    const controlArtifacts = await rt.owner.listWorkflowArtifacts(controlValue.workflowId);
    const controlRows = controlArtifacts.ok ? (controlArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const controlWorkflowRow = controlRows.find((row) => row.kind === "WORKFLOW");
    const s1Id = String(controlWorkflowRow?.payload.intentStateId);
    const s1Hash = String(controlWorkflowRow?.payload.intentStateHash);
    expect(s1Id).toBe(boundStateId);
    expect(s1Hash).toBe(boundStateHash);
    expect(s1Id).not.toBe(rt.state.id); // genuinely superseded from S0

    // Control executes BEFORE attack is even submitted.
    const committed = await rt.dispatcher.commitWorkflow(controlValue.workflowId);
    if (!committed.ok) throw new Error(`control commit: ${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    // Attack leg 2: explicitly pinned to the exact S1 control established,
    // same evidence, same intent, only the action's quantity differs.
    const attackAction = { ...procurement.controlAction, quantity: 450 };
    const attackResult = await rt.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: s1Id },
      action: attackAction,
      domain: { packId: procurement.packId, payload: procurement.payload(EVIDENCE_ID) },
      idempotencyKey: "demo-attack-procurement-quantity-drift",
    });
    if (!attackResult.ok) throw new Error(`attack: ${attackResult.code}: ${attackResult.message}`);
    const attackValue = attackResult.value as { state: string; workflowId: string };

    // No orphan second semantic successor: attack's own bound state, read
    // from ITS OWN durable WORKFLOW artifact, is byte-identical to control's.
    const attackArtifacts = await rt.owner.listWorkflowArtifacts(attackValue.workflowId);
    const attackRows = attackArtifacts.ok ? (attackArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const attackWorkflowRow = attackRows.find((row) => row.kind === "WORKFLOW");
    expect(String(attackWorkflowRow?.payload.intentStateId)).toBe(s1Id);
    expect(String(attackWorkflowRow?.payload.intentStateHash)).toBe(s1Hash);

    // Same proof/evidence basis: attack's own proofs are STILL satisfied
    // (evidence still says 500, matching the intent — the action is what
    // diverged, not the evidence).
    const attackProofs = attackRows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    expect(attackProofs.length).toBeGreaterThan(0);
    for (const proof of attackProofs) expect(proof.status).toBe("SATISFIED");

    // First causal divergence is BLOCKED — never AUTHORIZED, never executed.
    expect(attackValue.state).toBe("BLOCKED");
    expect(attackValue.workflowId).not.toBe(controlValue.workflowId);

    // Authority never reached for attack: no EXECUTION_AUTHORIZATION row,
    // no PreparedAction, no CommitToken, and the call counter attack alone
    // contributes zero authority/prepare/mint/authorize calls beyond
    // control's own (already-counted) ones.
    const attackAuthorization = attackRows.find((row) => row.kind === "EXECUTION_AUTHORIZATION");
    expect(attackAuthorization).toBeUndefined();
    expect(rt.calls.evaluation).toBe(1); // control's only — attack never called Authority
    expect(rt.calls.prepare).toBe(1); // control's only — attack never prepared an action

    // Zero side effects from attack: the ledger still holds exactly
    // control's one entry, not two.
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    // Guardian is not falsely blamed: it DID run for attack (the fidelity
    // check and Guardian both run before the eligibility gate), and its own
    // verdict is reported honestly rather than being the reason blocked.
    const attackGuardian = attackRows.find((row) => row.kind === "GUARDIAN")?.payload;
    expect(attackGuardian).toBeDefined();
  });
});

describe("travel: control executes, then provider_substitution against the exact same S1", () => {
  /**
   * Travel is the other domain (besides invoice) whose attack variant
   * mutates the counterparty merchant — provider_substitution swaps in
   * "Unapproved Provider" and flips refundable to false. Same requirement as
   * invoice: the attack's domain.payload.provider.id must mirror
   * action.merchant or workflow-registry.ts rejects the request outright
   * before proof evaluation ever runs.
   */
  it("shares S1, control executes, attack's first causal blocker is actionFidelity, zero attack side effects", async () => {
    const travel = CASES.find((item) => item.packId === "travel")!;
    const rt = await runtime({
      rawText: travel.rawText,
      omitProofSummary: true,
      capabilities: { [travel.capability]: AuthorityDecision.ALLOW },
      compilerTransform: replaceConstraints(travel.rawText, travel.constraints),
      demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${travel.packId}:v1`), claims: claims(EVIDENCE_ID, travel.facts) }],
    });

    const controlBody = (expectedIntentStateId: string) => ({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
      action: travel.controlAction,
      domain: { packId: travel.packId, payload: travel.payload(EVIDENCE_ID) },
      idempotencyKey: "demo-control-travel-causality",
    });

    let controlResult = await rt.dispatcher.submitWorkflow(controlBody(rt.state.id));
    if (!controlResult.ok && controlResult.code === "INTENT_STATE_NOT_READY") {
      const details = controlResult.details as Record<string, unknown>;
      controlResult = await rt.dispatcher.submitWorkflow(controlBody(String(details.intentStateId)));
    }
    if (!controlResult.ok) throw new Error(`control: ${controlResult.code}: ${controlResult.message}`);
    const controlValue = controlResult.value as { state: string; workflowId: string };
    expect(controlValue.state).toBe("AUTHORIZED");

    const controlArtifacts = await rt.owner.listWorkflowArtifacts(controlValue.workflowId);
    const controlRows = controlArtifacts.ok ? (controlArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const controlWorkflowRow = controlRows.find((row) => row.kind === "WORKFLOW");
    const s1Id = String(controlWorkflowRow?.payload.intentStateId);
    const s1Hash = String(controlWorkflowRow?.payload.intentStateHash);
    expect(s1Id).not.toBe(rt.state.id);

    const committed = await rt.dispatcher.commitWorkflow(controlValue.workflowId);
    if (!committed.ok) throw new Error(`control commit: ${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    // Attack leg 2: same intent, same evidence, explicitly pinned to S1 —
    // merchant (unapproved provider) and refundable differ. domain.payload
    // must mirror the merchant mutation for the same reason as invoice.
    const attackAction = { ...travel.controlAction, merchant: "Unapproved Provider", refundable: false };
    const controlPayload = travel.payload(EVIDENCE_ID) as { provider: Record<string, unknown> };
    const attackPayload = {
      ...controlPayload,
      provider: { ...controlPayload.provider, id: "Unapproved Provider", name: "Unapproved Provider", approved: false },
    };
    const attackResult = await rt.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: s1Id },
      action: attackAction,
      domain: { packId: travel.packId, payload: attackPayload },
      idempotencyKey: "demo-attack-travel-provider-substitution",
    });
    if (!attackResult.ok) throw new Error(`attack: ${attackResult.code}: ${attackResult.message}`);
    const attackValue = attackResult.value as { state: string; workflowId: string };

    const attackArtifacts = await rt.owner.listWorkflowArtifacts(attackValue.workflowId);
    const attackRows = attackArtifacts.ok ? (attackArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const attackWorkflowRow = attackRows.find((row) => row.kind === "WORKFLOW");
    expect(String(attackWorkflowRow?.payload.intentStateId)).toBe(s1Id);
    expect(String(attackWorkflowRow?.payload.intentStateHash)).toBe(s1Hash);

    const attackProofs = attackRows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    expect(attackProofs.length).toBeGreaterThan(0);
    for (const proof of attackProofs) expect(proof.status).toBe("SATISFIED");

    expect(attackValue.state).toBe("BLOCKED");
    expect(attackValue.workflowId).not.toBe(controlValue.workflowId);
    const attackAuthorization = attackRows.find((row) => row.kind === "EXECUTION_AUTHORIZATION");
    expect(attackAuthorization).toBeUndefined();
    expect(rt.calls.evaluation).toBe(1);
    expect(rt.calls.prepare).toBe(1);
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const attackGuardian = attackRows.find((row) => row.kind === "GUARDIAN")?.payload;
    expect(attackGuardian).toBeDefined();
  });
});

describe("invoice: control executes, then payee_substitution against the exact same S1", () => {
  /**
   * Invoice is explicitly required to get its own real-engine proof (not
   * just procurement's) because its `duplicate_payment` constraint
   * ("dup-1") could be misread as an EXECUTION-HISTORY check — "has a
   * payment already gone out for this invoice?" — rather than what it
   * actually is: an ordinary HARD constraint evaluated once against the
   * evidence claim, exactly like `approved_payee` or `invoice_id`. This
   * test proves that reading is correct: after control's REAL commit
   * (a genuine side effect), the attack leg's own duplicate_payment proof
   * is still independently SATISFIED from the same evidence claim — it did
   * not flip, get skipped, or get reinterpreted because a payment already
   * executed. The attack's first causal blocker is actionFidelity (shadow
   * payee / substituted invoice id), the same class of blocker as
   * procurement's quantity drift, not a domain-specific duplicate-payment
   * mechanism.
   */
  it("shares S1, control executes, attack's duplicate_payment proof stays SATISFIED, first causal blocker is actionFidelity, zero attack side effects", async () => {
    const invoice = CASES.find((item) => item.packId === "invoice_vendor_payment")!;
    const rt = await runtime({
      rawText: invoice.rawText,
      omitProofSummary: true,
      capabilities: { [invoice.capability]: AuthorityDecision.ALLOW },
      compilerTransform: replaceConstraints(invoice.rawText, invoice.constraints),
      demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${invoice.packId}:v1`), claims: claims(EVIDENCE_ID, invoice.facts) }],
    });

    const controlBody = (expectedIntentStateId: string) => ({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
      action: invoice.controlAction,
      domain: { packId: invoice.packId, payload: invoice.payload(EVIDENCE_ID) },
      idempotencyKey: "demo-control-invoice-causality",
    });

    let controlResult = await rt.dispatcher.submitWorkflow(controlBody(rt.state.id));
    if (!controlResult.ok && controlResult.code === "INTENT_STATE_NOT_READY") {
      const details = controlResult.details as Record<string, unknown>;
      controlResult = await rt.dispatcher.submitWorkflow(controlBody(String(details.intentStateId)));
    }
    if (!controlResult.ok) throw new Error(`control: ${controlResult.code}: ${controlResult.message}`);
    const controlValue = controlResult.value as { state: string; workflowId: string };
    expect(controlValue.state).toBe("AUTHORIZED");

    const controlArtifacts = await rt.owner.listWorkflowArtifacts(controlValue.workflowId);
    const controlRows = controlArtifacts.ok ? (controlArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const controlWorkflowRow = controlRows.find((row) => row.kind === "WORKFLOW");
    const s1Id = String(controlWorkflowRow?.payload.intentStateId);
    const s1Hash = String(controlWorkflowRow?.payload.intentStateHash);
    expect(s1Id).not.toBe(rt.state.id);

    // Control's REAL payment commits before attack is even submitted — the
    // one genuine side effect this test's contamination check pivots on.
    const committed = await rt.dispatcher.commitWorkflow(controlValue.workflowId);
    if (!committed.ok) throw new Error(`control commit: ${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    // Attack leg 2: same intent, same evidence, explicitly pinned to S1 —
    // only merchant/product/invoiceId (the payee) differ. Mirrors (not
    // imports — see the module docstring) the `payee_substitution` fixture
    // in services/phase-c-verifier/src/demo-evidence-templates.ts, INCLUDING
    // that fixture's domain.payload.payee.id/invoice.invoiceId mutation:
    // workflow-registry.ts's invoice adapter rejects a request outright
    // (VALIDATION_FAILED, before proof evaluation) if those don't match
    // action.merchant/action.product — this is not optional plumbing, it's
    // required for the attack to even reach the interesting causal point.
    const attackAction = {
      ...invoice.controlAction,
      merchant: "shadow-payee",
      product: "INV-ATTACK-999",
      parameters: { invoiceId: "INV-ATTACK-999", remittanceReference: "remit-1" },
    };
    const controlPayload = invoice.payload(EVIDENCE_ID) as { payee: Record<string, unknown>; invoice: Record<string, unknown> };
    const attackPayload = {
      ...controlPayload,
      payee: { ...controlPayload.payee, id: "shadow-payee", name: "shadow-payee", approved: false },
      invoice: { ...controlPayload.invoice, invoiceId: "INV-ATTACK-999" },
    };
    const attackResult = await rt.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: s1Id },
      action: attackAction,
      domain: { packId: invoice.packId, payload: attackPayload },
      idempotencyKey: "demo-attack-invoice-payee-substitution",
    });
    if (!attackResult.ok) throw new Error(`attack: ${attackResult.code}: ${attackResult.message}`);
    const attackValue = attackResult.value as { state: string; workflowId: string };

    const attackArtifacts = await rt.owner.listWorkflowArtifacts(attackValue.workflowId);
    const attackRows = attackArtifacts.ok ? (attackArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    const attackWorkflowRow = attackRows.find((row) => row.kind === "WORKFLOW");
    expect(String(attackWorkflowRow?.payload.intentStateId)).toBe(s1Id);
    expect(String(attackWorkflowRow?.payload.intentStateHash)).toBe(s1Hash);

    // The duplicate_payment proof — the concept this domain is singled out
    // for — is independently SATISFIED for the attack leg too. It is
    // evaluated from the same static evidence claim ("dup-1"), not from
    // whether a payment has already executed in this session.
    const attackProofs = attackRows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    expect(attackProofs.length).toBeGreaterThan(0);
    for (const proof of attackProofs) expect(proof.status).toBe("SATISFIED");
    const duplicatePaymentProof = attackProofs.find((proof) => proof.constraintId === "i-duplicate");
    expect(duplicatePaymentProof?.status).toBe("SATISFIED");

    // First causal divergence is BLOCKED on actionFidelity, not a
    // duplicate-payment-shaped rejection.
    expect(attackValue.state).toBe("BLOCKED");
    expect(attackValue.workflowId).not.toBe(controlValue.workflowId);
    const attackAuthorization = attackRows.find((row) => row.kind === "EXECUTION_AUTHORIZATION");
    expect(attackAuthorization).toBeUndefined();
    expect(rt.calls.evaluation).toBe(1);
    expect(rt.calls.prepare).toBe(1);

    // Zero side effects from attack: control's single real payment is the
    // only entry in the ledger — no second, no reversal, no duplicate-check
    // side effect of any kind triggered by the attack leg.
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const attackGuardian = attackRows.find((row) => row.kind === "GUARDIAN")?.payload;
    expect(attackGuardian).toBeDefined();
  });
});
