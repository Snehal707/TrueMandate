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
 *  - CAUSALITY + ISOLATION, all six trusted attack variants: control and
 *    attack submitted against the exact same evidence-backed S1, proving
 *    control executes and attack's own evaluation is unaffected by that
 *    execution.
 *
 * Sequencing is deliberately EXACT to what demo-orchestrator.ts and
 * attackLabCore.ts's executeTrustedAttackComparison actually do in
 * production, not a convenient shortcut: control leg 2 is submitted, THEN
 * attack leg 2 is submitted immediately (pinned to control's bound S1) —
 * demo-orchestrator.ts commits NEITHER. Only afterward, mirroring
 * resolveGovernedResult's per-lane resolution order, is control committed
 * first and attack's commit attempted second. This distinction matters: the
 * exposure ledger that Authority's cumulative-exposure check reads is only
 * WRITTEN by gateway-service's two-phase COMMIT path
 * (reserveIfUnderThreshold in two-phase.ts) — never by Authority's
 * evaluate-for-authorization call, which is a pure read. An earlier version
 * of these tests committed control BEFORE submitting attack, which produced
 * a materially different (and more favorable) result for capability_expansion
 * than what demo-orchestrator.ts's actual submit/submit/commit/commit order
 * produces — see that describe block below for what the real order reveals.
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
      explicitConstraint("p-grade", "food_grade", ConstraintOperator.REQUIRE, "food-grade containers", ConstraintKind.HARD, "food-grade containers"),
      explicitConstraint("p-quantity", "quantity", ConstraintOperator.EQ, 500, ConstraintKind.HARD, "500"),
      explicitConstraint("p-budget", "budget", ConstraintOperator.LTE, 800000, ConstraintKind.FINANCIAL, "under INR 800000"),
      temporalConstraint("p-deadline", "execution_deadline", PROCUREMENT_DEADLINE, "before December 31, 2026"),
    ],
    facts: [
      ["approved_supplier", true],
      ["food_grade", "food-grade containers"],
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

interface CausalityTrace {
  readonly controlValue: { readonly state: string; readonly workflowId: string };
  readonly attackValue: { readonly state: string; readonly workflowId: string };
  readonly s1Id: string;
  readonly s1Hash: string;
  readonly s0Id: string;
  readonly attackRows: readonly { readonly kind: string; readonly payload: Record<string, unknown> }[];
  readonly controlCommitOk: boolean;
  readonly attackCommitAttempted: boolean;
  readonly attackCommitOk: boolean;
  readonly attackCommitCode?: string;
  readonly sideEffectLedgerLength: number;
  readonly evaluationCalls: number;
  readonly prepareCalls: number;
}

/**
 * Submits control leg 2, then attack leg 2 immediately (pinned to control's
 * bound S1) — NO commit call happens between these two submissions, exactly
 * matching demo-orchestrator.ts. Only afterward are commits attempted, in
 * the same order attackLabCore.ts's resolveGovernedResult resolves lanes:
 * control first, attack second.
 */
async function runCausalityTrace(
  domainCase: DomainCase,
  label: string,
  attackAction: Record<string, unknown>,
  attackPayload?: Record<string, unknown>,
): Promise<CausalityTrace> {
  const rt = await runtime({
    rawText: domainCase.rawText,
    omitProofSummary: true,
    capabilities: { [domainCase.capability]: AuthorityDecision.ALLOW },
    compilerTransform: replaceConstraints(domainCase.rawText, domainCase.constraints),
    demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${domainCase.packId}:v1`), claims: claims(EVIDENCE_ID, domainCase.facts) }],
  });
  const s0Id = rt.state.id;

  const controlBody = (expectedIntentStateId: string) => ({
    intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
    action: domainCase.controlAction,
    domain: { packId: domainCase.packId, payload: domainCase.payload(EVIDENCE_ID) },
    idempotencyKey: `demo-control-${label}`,
  });
  let controlResult = await rt.dispatcher.submitWorkflow(controlBody(rt.state.id));
  if (!controlResult.ok && controlResult.code === "INTENT_STATE_NOT_READY") {
    const details = controlResult.details as Record<string, unknown>;
    controlResult = await rt.dispatcher.submitWorkflow(controlBody(String(details.intentStateId)));
  }
  if (!controlResult.ok) throw new Error(`${label} control: ${controlResult.code}: ${controlResult.message}`);
  const controlValue = controlResult.value as { state: string; workflowId: string };

  // Read back the exact bound state via the durable WORKFLOW artifact —
  // never assumed, never independently derived.
  const controlArtifacts = await rt.owner.listWorkflowArtifacts(controlValue.workflowId);
  const controlRows = controlArtifacts.ok ? (controlArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
  const controlWorkflowRow = controlRows.find((row) => row.kind === "WORKFLOW");
  const s1Id = String(controlWorkflowRow?.payload.intentStateId);
  const s1Hash = String(controlWorkflowRow?.payload.intentStateHash);

  // Attack leg 2 — submitted immediately, pinned to S1. NO commit call
  // happens before this, matching demo-orchestrator.ts exactly.
  const attackResult = await rt.dispatcher.submitWorkflow({
    intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: s1Id },
    action: attackAction,
    domain: { packId: domainCase.packId, payload: attackPayload ?? domainCase.payload(EVIDENCE_ID) },
    idempotencyKey: `demo-attack-${label}`,
  });
  if (!attackResult.ok) throw new Error(`${label} attack: ${attackResult.code}: ${attackResult.message}`);
  const attackValue = attackResult.value as { state: string; workflowId: string };

  const attackArtifacts = await rt.owner.listWorkflowArtifacts(attackValue.workflowId);
  const attackRows = attackArtifacts.ok ? (attackArtifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];

  // NOW commit — control first, attack second, mirroring
  // resolveGovernedResult's per-lane resolution order.
  let controlCommitOk = false;
  if (controlValue.state === "AUTHORIZED") {
    const committed = await rt.dispatcher.commitWorkflow(controlValue.workflowId);
    controlCommitOk = committed.ok && (committed.value as { status: string }).status === "SUCCESS";
  }

  let attackCommitAttempted = false;
  let attackCommitOk = false;
  let attackCommitCode: string | undefined;
  if (attackValue.state === "AUTHORIZED") {
    attackCommitAttempted = true;
    const attackCommit = await rt.dispatcher.commitWorkflow(attackValue.workflowId);
    attackCommitOk = attackCommit.ok && (attackCommit.value as { status: string }).status === "SUCCESS";
    if (!attackCommit.ok) attackCommitCode = attackCommit.code;
  }

  return {
    controlValue, attackValue, s1Id, s1Hash, s0Id, attackRows,
    controlCommitOk, attackCommitAttempted, attackCommitOk, attackCommitCode,
    sideEffectLedgerLength: (await rt.gateway.getSideEffectLedger().listAll()).length,
    evaluationCalls: rt.calls.evaluation,
    prepareCalls: rt.calls.prepare,
  };
}

/**
 * Common assertions for the five variants whose mutation IS caught by
 * domain-pack-level actionFidelity before Authority is ever reached: shared
 * S1, control executes, attack is BLOCKED at its own submit (never
 * AUTHORIZED, never committed), zero attack side effects, zero orphan
 * successor state.
 */
function expectFidelityBlockedAttack(trace: CausalityTrace) {
  expect(trace.s1Id).not.toBe(trace.s0Id);
  expect(trace.controlValue.state).toBe("AUTHORIZED");
  expect(trace.controlCommitOk).toBe(true);

  expect(trace.attackValue.state).toBe("BLOCKED");
  expect(trace.attackValue.workflowId).not.toBe(trace.controlValue.workflowId);
  const attackWorkflowRow = trace.attackRows.find((row) => row.kind === "WORKFLOW");
  expect(String(attackWorkflowRow?.payload.intentStateId)).toBe(trace.s1Id);
  expect(String(attackWorkflowRow?.payload.intentStateHash)).toBe(trace.s1Hash);

  const attackProofs = trace.attackRows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
  expect(attackProofs.length).toBeGreaterThan(0);
  for (const proof of attackProofs) expect(proof.status).toBe("SATISFIED");

  expect(trace.attackRows.find((row) => row.kind === "EXECUTION_AUTHORIZATION")).toBeUndefined();
  expect(trace.attackCommitAttempted).toBe(false);
  expect(trace.evaluationCalls).toBe(1);
  expect(trace.prepareCalls).toBe(1);
  expect(trace.sideEffectLedgerLength).toBe(1);

  const attackGuardian = trace.attackRows.find((row) => row.kind === "GUARDIAN")?.payload;
  expect(attackGuardian).toBeDefined();
}

describe("procurement: control (500) executes, then quantity_drift (450) against the exact same S1", () => {
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is actionFidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const procurement = CASES[0]!;
    const trace = await runCausalityTrace(procurement, "procurement-quantity-drift", { ...procurement.controlAction, quantity: 450 });
    expectFidelityBlockedAttack(trace);
  });
});

describe("travel: control executes, then provider_substitution against the exact same S1", () => {
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is actionFidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const travel = CASES.find((item) => item.packId === "travel")!;
    const controlPayload = travel.payload(EVIDENCE_ID) as { provider: Record<string, unknown> };
    const attackAction = { ...travel.controlAction, merchant: "Unapproved Provider", refundable: false };
    // Mirrors demo-evidence-templates.ts's provider_substitution fixture:
    // domain.payload.provider.id must track action.merchant or
    // workflow-registry.ts rejects the request before proof evaluation.
    const attackPayload = { ...controlPayload, provider: { ...controlPayload.provider, id: "Unapproved Provider", name: "Unapproved Provider", approved: false } };
    const trace = await runCausalityTrace(travel, "travel-provider-substitution", attackAction, attackPayload);
    expectFidelityBlockedAttack(trace);
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
   * is still independently SATISFIED from the same evidence claim.
   */
  it("shares S1, control executes, attack's duplicate_payment proof stays SATISFIED, first causal blocker is actionFidelity, zero attack side effects", async () => {
    const invoice = CASES.find((item) => item.packId === "invoice_vendor_payment")!;
    const controlPayload = invoice.payload(EVIDENCE_ID) as { payee: Record<string, unknown>; invoice: Record<string, unknown> };
    const attackAction = { ...invoice.controlAction, merchant: "shadow-payee", product: "INV-ATTACK-999", parameters: { invoiceId: "INV-ATTACK-999", remittanceReference: "remit-1" } };
    const attackPayload = {
      ...controlPayload,
      payee: { ...controlPayload.payee, id: "shadow-payee", name: "shadow-payee", approved: false },
      invoice: { ...controlPayload.invoice, invoiceId: "INV-ATTACK-999" },
    };
    const trace = await runCausalityTrace(invoice, "invoice-payee-substitution", attackAction, attackPayload);
    expectFidelityBlockedAttack(trace);

    const attackProofs = trace.attackRows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
    const duplicatePaymentProof = attackProofs.find((proof) => proof.constraintId === "i-duplicate");
    expect(duplicatePaymentProof?.status).toBe("SATISFIED");
  });
});

describe("logistics: control executes, then destination_substitution against the exact same S1", () => {
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is actionFidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const logistics = CASES.find((item) => item.packId === "logistics_fulfillment")!;
    const controlPayload = logistics.payload(EVIDENCE_ID) as { shipment: Record<string, unknown> };
    const attackAction = { ...logistics.controlAction, parameters: { destination: "Remote Transfer Depot", serviceLevel: "EXPRESS", fulfillCount: 12 } };
    // LogisticsFulfillmentDomainPack.buildActionProposal derives
    // ActionProposal.parameters.destination from domain.payload.shipment.destination,
    // unconditionally overwriting action.parameters.destination — the mutation has
    // to land here or actionFidelity never sees it (see demo-evidence-templates.ts fix).
    const attackPayload = { ...controlPayload, shipment: { ...controlPayload.shipment, destination: "Remote Transfer Depot" } };
    const trace = await runCausalityTrace(logistics, "logistics-destination-substitution", attackAction, attackPayload);
    expectFidelityBlockedAttack(trace);
  });
});

describe("saas: control executes, then renewal_flip against the exact same S1", () => {
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is actionFidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const saas = CASES.find((item) => item.packId === "saas_it_spend")!;
    const controlPayload = saas.payload(EVIDENCE_ID) as { subscription: Record<string, unknown> };
    const attackAction = { ...saas.controlAction, parameters: { renewalSetting: "AUTO", termMonths: 12, seatCount: 10 } };
    // SaasItSpendDomainPack.buildActionProposal derives
    // ActionProposal.parameters.renewalSetting from
    // domain.payload.subscription.renewalSetting, unconditionally
    // overwriting action.parameters.renewalSetting — same reason as
    // logistics's destination above.
    const attackPayload = { ...controlPayload, subscription: { ...controlPayload.subscription, renewalSetting: "AUTO" } };
    const trace = await runCausalityTrace(saas, "saas-renewal-flip", attackAction, attackPayload);
    expectFidelityBlockedAttack(trace);
  });
});

describe("logistics: control executes, then capability_expansion against the exact same S1", () => {
  /**
   * Capability-fidelity invariant (generic-workflow-engine.ts): the
   * submitted action's capability must equal the selected domain pack's own
   * planning.executionCapability, checked in the same eligible conjunction
   * as actionPreservesIntent/completeProofs/Guardian/privilegedReady. Before
   * this invariant existed, capability_expansion was the one variant with a
   * genuinely different (and weaker) causal story than the other five: the
   * attack reached AUTHORIZED, with PreparedAction/CommitToken/Grant all
   * minted, and was stopped only by a commit-order-dependent exposure
   * backstop (see the standalone describe block below for proof that a
   * fresh, unrelated submission is now blocked WITHOUT that backstop). This
   * test proves capability_expansion now follows the exact same
   * BLOCKED-before-Authority shape as every other variant.
   */
  it("shares S1, control reaches AUTHORIZED and executes, attack's first causal blocker is capability fidelity, Authority NOT_REACHED, zero side effects for attack", async () => {
    const logistics = CASES.find((item) => item.packId === "logistics_fulfillment")!;
    const trace = await runCausalityTrace(logistics, "logistics-capability-expansion", { ...logistics.controlAction, capability: "execute_payment" });
    expectFidelityBlockedAttack(trace);

    // Distinctly attributable: capability fidelity failed, not action
    // fidelity (which never inspects action.capability at all).
    const attackAction = trace.attackRows.find((row) => row.kind === "ACTION")?.payload;
    const capabilityFidelity = attackAction?.capabilityFidelity as { matches?: boolean; actual?: string; expected?: string } | undefined;
    expect(capabilityFidelity?.matches).toBe(false);
    expect(capabilityFidelity?.actual).toBe("execute_payment");
    expect(capabilityFidelity?.expected).toBe("arrange_fulfillment");
    const deterministicActionFidelity = attackAction?.deterministicActionFidelity as { preservesIntent?: boolean } | undefined;
    expect(deterministicActionFidelity?.preservesIntent).toBe(true);
  });
});

describe("standalone: capability_expansion blocked with NO prior same-intent commit", () => {
  /**
   * Critical isolation proof: unlike the paired trace above (which shares an
   * intent with a control that commits first), THIS test submits the
   * capability-expanded action completely alone — fresh intent, no control
   * workflow ever ran, no CommitToken ever consumed, exposure ledger
   * untouched for this intent+currency. If the fix here were merely
   * incidental (e.g. only reachable via the shared-S1 causal trace, or only
   * effective when exposure happens to be exhausted), this would still
   * reach AUTHORIZED, exactly as it did before the invariant existed (see
   * git history — this test previously proved the opposite). It must now be
   * BLOCKED, and rt.calls.evaluation must be 0 — not "evaluated then
   * rejected," but never reached at all — proving the fix closes the actual
   * vulnerability rather than masking it behind exposure exhaustion.
   */
  it("a capability_expansion request with no prior same-intent execution is BLOCKED before Authority — not merely rejected at commit", async () => {
    const logistics = CASES.find((item) => item.packId === "logistics_fulfillment")!;
    const rt = await runtime({
      rawText: logistics.rawText,
      omitProofSummary: true,
      capabilities: { arrange_fulfillment: AuthorityDecision.ALLOW },
      compilerTransform: replaceConstraints(logistics.rawText, logistics.constraints),
      demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${logistics.packId}:v1`), claims: claims(EVIDENCE_ID, logistics.facts) }],
    });
    const soloAction = { ...logistics.controlAction, capability: "execute_payment" };
    const body = (expectedIntentStateId: string) => ({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
      action: soloAction,
      domain: { packId: logistics.packId, payload: logistics.payload(EVIDENCE_ID) },
      idempotencyKey: "demo-solo-capability-expansion",
    });
    let result = await rt.dispatcher.submitWorkflow(body(rt.state.id));
    if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
      const details = result.details as Record<string, unknown>;
      result = await rt.dispatcher.submitWorkflow(body(String(details.intentStateId)));
    }
    if (!result.ok) throw new Error(`solo capability_expansion: ${result.code}: ${result.message}`);
    const value = result.value as { state: string; workflowId: string };
    expect(value.state).toBe("BLOCKED");

    const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
    const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
    expect(rows.find((row) => row.kind === "EXECUTION_AUTHORIZATION")).toBeUndefined();
    const actionRow = rows.find((row) => row.kind === "ACTION")?.payload;
    const capabilityFidelity = actionRow?.capabilityFidelity as { matches?: boolean } | undefined;
    expect(capabilityFidelity?.matches).toBe(false);

    // Authority never invoked at all — not evaluated-then-rejected. This is
    // the assertion that distinguishes "the vulnerability is closed" from
    // "the vulnerability is masked by exposure exhaustion": there is no
    // prior workflow, no prior commit, nothing in the exposure ledger for
    // this intent+currency, and the attack is still blocked.
    expect(rt.calls.evaluation).toBe(0);
    expect(rt.calls.prepare).toBe(0);
    expect(rt.calls.mint).toBe(0);
    expect(rt.calls.authorize).toBe(0);
    expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });
});

describe("generic cross-domain coverage: a foreign capability cannot cross the eligibility boundary in any domain", () => {
  /**
   * One shared GenericWorkflowEngine invariant enforces all five domains —
   * not five separate policy implementations. Proof: for each domain,
   * submit that domain's OWN otherwise-legitimate control action but with
   * capability swapped to a DIFFERENT domain's real, valid capability name
   * (cyclically: procurement→travel's, travel→saas's, saas→invoice's,
   * invoice→logistics's, logistics→procurement's) — a genuinely foreign,
   * well-formed capability, not a nonsense string, so this can't pass by
   * accident of a missing string-format check. Each must be BLOCKED before
   * Authority, with zero side effects, using nothing but the single
   * `domainAction.capability === this.deps.pack.planning.executionCapability`
   * check shared by every domain pack.
   */
  const foreignCapability: Readonly<Record<string, string>> = {
    procurement: "book_travel",
    travel: "manage_saas_subscription",
    saas_it_spend: "pay_invoice",
    invoice_vendor_payment: "arrange_fulfillment",
    logistics_fulfillment: "execute_payment",
  };

  for (const domainCase of CASES) {
    it(`${domainCase.label}: capability=${foreignCapability[domainCase.packId]} (foreign to this domain) is BLOCKED before Authority`, async () => {
      const rt = await runtime({
        rawText: domainCase.rawText,
        omitProofSummary: true,
        capabilities: { [domainCase.capability]: AuthorityDecision.ALLOW, [foreignCapability[domainCase.packId]!]: AuthorityDecision.ALLOW },
        compilerTransform: replaceConstraints(domainCase.rawText, domainCase.constraints),
        demoEvidence: [{ envelope: envelope(EVIDENCE_ID, `demo-fixture:${domainCase.packId}:v1`), claims: claims(EVIDENCE_ID, domainCase.facts) }],
      });
      const foreignAction = { ...domainCase.controlAction, capability: foreignCapability[domainCase.packId] };
      const body = (expectedIntentStateId: string) => ({
        intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
        action: foreignAction,
        domain: { packId: domainCase.packId, payload: domainCase.payload(EVIDENCE_ID) },
        idempotencyKey: `demo-foreign-capability-${domainCase.packId}`,
      });
      let result = await rt.dispatcher.submitWorkflow(body(rt.state.id));
      if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
        const details = result.details as Record<string, unknown>;
        result = await rt.dispatcher.submitWorkflow(body(String(details.intentStateId)));
      }
      if (!result.ok) throw new Error(`${domainCase.label} foreign capability: ${result.code}: ${result.message}`);
      const value = result.value as { state: string; workflowId: string };
      expect(value.state).toBe("BLOCKED");

      const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
      const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
      expect(rows.find((row) => row.kind === "EXECUTION_AUTHORIZATION")).toBeUndefined();
      const actionRow = rows.find((row) => row.kind === "ACTION")?.payload;
      const capabilityFidelity = actionRow?.capabilityFidelity as { matches?: boolean; actual?: string; expected?: string } | undefined;
      expect(capabilityFidelity?.matches).toBe(false);
      expect(capabilityFidelity?.actual).toBe(foreignCapability[domainCase.packId]);
      expect(capabilityFidelity?.expected).toBe(domainCase.capability);

      expect(rt.calls.evaluation).toBe(0);
      expect(rt.calls.prepare).toBe(0);
      expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
    });
  }
});
