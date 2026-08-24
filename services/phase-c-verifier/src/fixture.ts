import { hashCanonical } from "@truemandate/crypto";

/**
 * Phase C flagship delivery-verification fixture.
 *
 * The authorized purchase is 500 food-grade containers (this fixture must
 * never redefine that quantity — it is re-read from the authoritative
 * OutcomeContract requirement). The delivery evidence set covers the three
 * canonical source kinds:
 *
 *  - merchant dispatch record: 500 dispatched (proves shipment, NOT receipt)
 *  - carrier manifest: no count (cannot establish delivery quantity)
 *  - warehouse receiving record: 450 received (destination-quantity evidence)
 *
 * Evidence artifacts are distinct from claims; claims are derived from
 * artifacts with source identity, timestamps and trust class preserved.
 */
export const PHASE_C_ID = "phase-c-food-grade-500-v5";

export const EXPECTED_QUANTITY = 500;

export interface PhaseCDeliveryEvidence {
  readonly artifactId: string;
  readonly source: string;
  readonly concept: string;
  readonly value: unknown;
  readonly trustClass: "UNTRUSTED_EXTERNAL";
  readonly capturedAt: string;
  readonly taintOrigins: readonly string[];
}

/**
 * Two independent evidence classes (v2 repair):
 *
 *  A. Authorization / chain-era evidence — establishes pre-execution
 *     eligibility: supplier approval, food-grade certification and the
 *     quote (quantity/price/deadline support). Never used to prove delivery.
 *  B. Outcome / post-execution evidence — establishes what actually
 *     happened after execution: merchant dispatch, carrier manifest and the
 *     destination receiving record. Never used to fabricate pre-execution
 *     eligibility.
 */
export function phaseCAuthorizationEvidence(): readonly PhaseCDeliveryEvidence[] {
  return [
    {
      artifactId: "phase-c-evidence-v5-supplier-approval",
      source: "supplier-approval-registry",
      concept: "supplier_approved",
      value: { approved: true, supplierId: "phase-b-supplier" },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-02T00:00:00.000Z",
      taintOrigins: ["supplier-approval-registry"],
    },
    {
      artifactId: "phase-c-evidence-v5-food-grade-certificate",
      source: "inspection-certificate-system",
      concept: "food_grade_certified",
      value: { foodGrade: true, product: "food-grade containers" },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-03T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: "phase-c-evidence-v5-quote",
      source: "supplier-quote-system",
      concept: "quote",
      value: { quantity: 500, price: 742000, currency: "INR", deliveryDeadline: "2030-12-31T23:59:59.000Z" },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-02T00:00:00.000Z",
      taintOrigins: ["supplier-quote-system"],
    },
  ];
}

export function phaseCDeliveryEvidence(): readonly PhaseCDeliveryEvidence[] {
  return [
    {
      artifactId: "phase-c-evidence-v5-payment",
      source: "execution-side-effect-ledger",
      concept: "price_paid",
      value: 742000,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: "phase-c-evidence-v5-merchant",
      source: "execution-side-effect-ledger",
      concept: "merchant_observed",
      value: "phase-b-supplier",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: "phase-c-evidence-v5-certificate",
      source: "inspection-certificate-system",
      concept: "certificate_valid",
      value: true,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-07T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: "phase-c-evidence-v5-dispatch",
      source: "merchant-dispatch-system",
      concept: "dispatched_quantity",
      value: 500,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-05T00:00:00.000Z",
      taintOrigins: ["merchant-dispatch-system"],
    },
    {
      artifactId: "phase-c-evidence-v5-carrier",
      source: "carrier-manifest-system",
      concept: "carrier_acceptance_count",
      value: null,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-06T00:00:00.000Z",
      taintOrigins: ["carrier-manifest-system"],
    },
    {
      artifactId: "phase-c-evidence-v5-receipt",
      source: "warehouse-receiving-system",
      concept: "quantity_received",
      value: 450,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2030-01-07T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
  ];
}

/** The shortfall of 50 the flagship must derive — never hard-coded into the
 * outcome, only into the expected test assertion. */
export const EXPECTED_SHORTFALL = EXPECTED_QUANTITY - 450;

export const contentHashOf = (evidence: PhaseCDeliveryEvidence): string =>
  hashCanonical({ artifactId: evidence.artifactId, concept: evidence.concept, value: evidence.value, source: evidence.source, capturedAt: evidence.capturedAt });

/** Owner-accepted claims derived from the flagship evidence artifacts. Claim
 * ids carry the phase-c- namespace (the caller-bound fixture guard applies
 * to claims too). The claims are the canonical references the verifier
 * submits to the Outcome owner — never the facts themselves. */
export interface PhaseCClaim {
  readonly id: string;
  readonly evidenceId: string;
  readonly concept: string;
  readonly value: unknown;
}

export function phaseCClaims(): readonly PhaseCClaim[] {
  return phaseCDeliveryEvidence().map((item) => ({
    id: `phase-c-claim-v5-${item.concept}`,
    evidenceId: item.artifactId,
    concept: item.concept,
    value: item.value,
  }));
}

/** The full acceptance fixture (envelopes + claims) for the Evidence owner. */
export const RAW_INTENT = "Buy 500 food-grade containers from approved supplier Phase B Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z.";

export function phaseCRawEvent(): unknown {
  const payload = { rawText: RAW_INTENT, principalId: "phase-c-human-principal", intentId: PHASE_C_ID };
  return {
    eventId: `event-${PHASE_C_ID}`,
    type: "intent.created",
    aggregateId: PHASE_C_ID,
    aggregateVersion: 1,
    causationId: PHASE_C_ID,
    correlationId: PHASE_C_ID,
    actorService: "phase-c-verifier",
    payloadHash: hashCanonical(payload),
    idempotencyKey: PHASE_C_ID,
    provenanceRefs: [],
    payload,
    occurredAt: "2030-01-01T00:00:00.000Z",
  };
}

export function phaseCWorkflow(): unknown {
  return {
    intentId: PHASE_C_ID,
    idempotencyKey: PHASE_C_ID,
    supplier: { id: "phase-b-supplier", name: "Phase B Supplier", approved: true, approvalEvidenceId: "phase-c-evidence-v5-supplier-approval" },
    item: { specification: "food-grade containers" },
    quantity: 500,
    totalAmount: 742000,
    currency: "INR",
    foodGradeEvidenceId: "phase-c-evidence-v5-food-grade-certificate",
    evidenceIds: ["phase-c-evidence-v5-quote"],
    delivery: { terms: "deliver 500 food-grade containers", deadline: "2030-12-31T23:59:59.000Z" },
  };
}

export function phaseCAcceptanceFixture(): { envelopes: readonly unknown[]; claims: readonly unknown[] } {
  // Both evidence classes are accepted through the caller-bound fixture
  // route: the chain-era envelopes back the authorization obligations, the
  // delivery envelopes + claims back the outcome evaluation.
  const envelopes = [...phaseCAuthorizationEvidence(), ...phaseCDeliveryEvidence()].map((item) => ({
    id: item.artifactId,
    source: item.source,
    contentHash: contentHashOf(item),
    trustClass: item.trustClass,
    captureTime: item.capturedAt,
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [...item.taintOrigins] },
    originId: item.source,
    lineageGroupId: `phase-c-${item.concept}`,
  }));
  const claims = phaseCClaims().map((claim) => ({
    id: claim.id,
    evidenceId: claim.evidenceId,
    concept: claim.concept,
    value: claim.value,
    confidence: 1,
    derivedBy: "phase-c-derivation",
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [claim.evidenceId] },
  }));
  return { envelopes, claims };
}
