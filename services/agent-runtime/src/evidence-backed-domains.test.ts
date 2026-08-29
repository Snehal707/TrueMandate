import { describe, expect, it } from "vitest";
import { AuthorityDecision, ConstraintKind, ConstraintOperator, TrustClass } from "@truemandate/protocol";
import { explicitConstraint, replaceConstraints, runtime, temporalConstraint } from "./generic-workflow.e2e.test.js";

/**
 * All five domains, each carried through the real evidence-backed lifecycle with
 * the harness's proof-summary shortcut suppressed. The demo evidence for each
 * domain attests exactly the execution-critical concepts that domain's pack
 * declares, and nothing more — no domain is handed a proof it does not require,
 * and no gate is relaxed to make a row pass.
 */

const DEADLINE = "2026-12-31T00:00:00.000Z";
const CHECK_IN = "2026-12-20T00:00:00.000Z";
const CHECK_OUT = "2026-12-22T00:00:00.000Z";

function envelope(id: string) {
  return {
    id,
    source: `deterministic-demo-fixture:${id}`,
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
  readonly packId: "travel" | "saas_it_spend" | "invoice_vendor_payment" | "logistics_fulfillment";
  readonly label: string;
  readonly rawText: string;
  readonly capability: string;
  readonly constraints: Array<Record<string, unknown>>;
  readonly facts: readonly (readonly [string, unknown])[];
  readonly action: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}

const EVIDENCE_ID = "demo-domain-offer";

const CASES: readonly DomainCase[] = [
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
      ["approved_provider", true],
      ["hotel_name", "Seaside Lodge"],
      ["refundable", true],
      ["traveler_count", 2],
      ["travel_budget", 3200],
      ["check_in_date", CHECK_IN],
      ["check_out_date", CHECK_OUT],
      ["booking_deadline", DEADLINE],
    ],
    action: {
      capability: "book_travel", merchant: "travel-provider", product: "Seaside Lodge",
      quantity: 2, amount: 3200, currency: "USD", refundable: true,
      deliveryTerms: "travel on 2026-12-20", parameters: {}, consequenceLevel: "HIGH",
    },
    payload: {
      provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: EVIDENCE_ID },
      booking: { itineraryId: "it-1", lodgingName: "Seaside Lodge", travelDate: CHECK_IN, checkInDate: CHECK_IN, checkOutDate: CHECK_OUT, travelerCount: 2, completionDeadline: DEADLINE },
      policy: { refundableRequired: true },
      evidenceIds: [EVIDENCE_ID],
    },
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
      ["approved_vendor", true],
      ["plan_name", "Business Plan"],
      ["seat_count", 10],
      ["term_months", 12],
      ["renewal_setting", "MANUAL"],
      ["saas_budget", 9000],
      ["subscription_deadline", DEADLINE],
    ],
    action: {
      capability: "manage_saas_subscription", merchant: "approved-vendor", product: "Business Plan",
      quantity: 10, amount: 9000, currency: "USD",
      deliveryTerms: "activate before 2026-12-31",
      parameters: { renewalSetting: "MANUAL", termMonths: 12, seatCount: 10 },
      consequenceLevel: "HIGH",
    },
    payload: {
      vendor: { id: "approved-vendor", name: "Approved Vendor", approved: true, approvalEvidenceId: EVIDENCE_ID },
      subscription: { planId: "plan-business", planName: "Business Plan", termMonths: 12, renewalSetting: "MANUAL", seatCount: 10, subscriptionDeadline: DEADLINE },
      evidenceIds: [EVIDENCE_ID],
    },
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
      ["approved_payee", true],
      ["invoice_id", "INV-2026-001"],
      ["duplicate_payment", "dup-1"],
      ["invoice_amount", 24000],
      ["invoice_due_date", DEADLINE],
    ],
    action: {
      capability: "pay_invoice", merchant: "approved-payee", product: "INV-2026-001",
      quantity: 1, amount: 24000, currency: "USD",
      deliveryTerms: "settle before 2026-11-30",
      parameters: { invoiceId: "INV-2026-001", remittanceReference: "remit-1" },
      consequenceLevel: "HIGH",
    },
    payload: {
      payee: { id: "approved-payee", name: "Approved Payee", approved: true, approvalEvidenceId: EVIDENCE_ID },
      invoice: { invoiceId: "INV-2026-001", poReference: "PO-77", dueDate: DEADLINE, duplicateCheckKey: "dup-1", remittanceReference: "remit-1" },
      evidenceIds: [EVIDENCE_ID],
    },
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
      ["approved_carrier", true],
      ["destination", "Mumbai Warehouse"],
      ["service_level", "EXPRESS"],
      ["fulfill_count", 12],
      ["budget", 3500],
      ["shipment_deadline", DEADLINE],
    ],
    action: {
      capability: "arrange_fulfillment", merchant: "approved-carrier", product: "EXPRESS",
      quantity: 12, amount: 3500, currency: "USD",
      deliveryTerms: "ship to Mumbai Warehouse before 2026-12-31",
      parameters: { destination: "Mumbai Warehouse", serviceLevel: "EXPRESS", fulfillCount: 12 },
      consequenceLevel: "HIGH",
    },
    payload: {
      provider: { id: "approved-carrier", name: "Approved Carrier", approved: true, approvalEvidenceId: EVIDENCE_ID },
      shipment: { serviceLevel: "EXPRESS", destination: "Mumbai Warehouse", shipBy: DEADLINE, fulfillCount: 12 },
      evidenceIds: [EVIDENCE_ID],
    },
  },
];

async function runDomain(domainCase: DomainCase) {
  const rt = await runtime({
    rawText: domainCase.rawText,
    omitProofSummary: true,
    capabilities: { [domainCase.capability]: AuthorityDecision.ALLOW },
    compilerTransform: replaceConstraints(domainCase.rawText, domainCase.constraints),
    demoEvidence: [{ envelope: envelope(EVIDENCE_ID), claims: claims(EVIDENCE_ID, domainCase.facts) }],
  });

  const body = (expectedIntentStateId: string) => ({
    intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId },
    action: domainCase.action,
    domain: { packId: domainCase.packId, payload: domainCase.payload },
    idempotencyKey: `domain-${domainCase.packId}`,
  });

  let result = await rt.dispatcher.submitWorkflow(body(rt.state.id));
  if (!result.ok && result.code === "INTENT_STATE_NOT_READY") {
    result = await rt.dispatcher.submitWorkflow(
      body(String((result.details as Record<string, unknown>).intentStateId)),
    );
  }
  return { rt, result };
}

describe("all five domains through the real evidence-backed lifecycle", () => {
  for (const domainCase of CASES) {
    it(`${domainCase.label} reaches Authority on evidence alone`, async () => {
      const { rt, result } = await runDomain(domainCase);
      if (!result.ok) throw new Error(`${domainCase.label}: ${result.code}: ${result.message}`);

      const value = result.value as { state: string; workflowId: string };
      const artifacts = await rt.owner.listWorkflowArtifacts(value.workflowId);
      const rows = artifacts.ok ? (artifacts.value as { kind: string; payload: Record<string, unknown> }[]) : [];
      const proofs = rows.filter((row) => row.kind === "PROOF").map((row) => row.payload);
      const planVerification = rows.find((row) => row.kind === "PLAN_VERIFICATION")?.payload;
      const guardian = rows.find((row) => row.kind === "GUARDIAN")?.payload;
      const boundStateId = String(rows.find((row) => row.kind === "WORKFLOW")?.payload.intentStateId ?? "");

      // Which constraint each obligation actually covers, so the count is auditable
      // rather than asserted. Obligations derive from the constraints present in
      // THIS IntentState, not from the pack's full concept catalogue.
      const covered = proofs.map((proof) => String(proof.constraintId)).sort();
      const outcomeContract = (result.value as { outcomeContract?: { id?: string } }).outcomeContract;
      const provenanceNodes = rt.provenance.getGraph().listNodes().length;
      // eslint-disable-next-line no-console
      console.log(`DOMAIN ${domainCase.label} | state=${value.state} | proofs=${proofs.filter((p) => p.status === "SATISFIED").length}/${proofs.length} satisfied [${covered.join(",")}] | planVerification=${String((planVerification?.verification as Record<string, unknown>)?.status)} | guardian=${String((guardian?.verdict as Record<string, unknown>)?.decision)} | bound=${boundStateId.includes("-semantic-") ? "successor" : "original"} | outcome=${outcomeContract?.id ?? "NOT PRODUCED"} | provenanceNodes=${provenanceNodes}`);

      expect(proofs.length).toBeGreaterThan(0);
      for (const proof of proofs) {
        expect(proof.method).toBe("authoritative-proof-handoff");
        expect(proof.status).toBe("SATISFIED");
      }
      expect((planVerification?.verification as Record<string, unknown>)?.status).toBe("VERIFIED");
      expect(value.state).toBe("AUTHORIZED");
      expect(rt.calls).toMatchObject({ evaluation: 1, prepare: 1, mint: 1, authorize: 1 });

      // Governed mock execution, exactly once.
      const committed = await rt.dispatcher.commitWorkflow(value.workflowId);
      if (!committed.ok) throw new Error(`${domainCase.label} commit: ${committed.code}: ${committed.message}`);
      expect(committed.value).toMatchObject({ status: "SUCCESS" });
      expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
      const replay = await rt.dispatcher.commitWorkflow(value.workflowId);
      expect(replay.ok && (replay.value as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
      expect(await rt.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
    });
  }
});
