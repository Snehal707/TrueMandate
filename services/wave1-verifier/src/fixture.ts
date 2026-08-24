import { hashCanonical } from "@truemandate/crypto";

/**
 * Wave 1 acceptance fixtures (fresh wave1- namespaces — the historical
 * Phase A/B/C fixtures are never referenced or modified).
 *
 *  A — unsafe supplier: the supplier approval obligation is UNSATISFIED, so
 *      the workflow must BLOCK before any economic activity (zero purchase).
 *  B — valid supplier, full delivery: 500 dispatched AND 500 received →
 *      OutcomeContract SATISFIED → owner CLOSE → CLOSED.
 *  C — short delivery: 500 dispatched, 450 received → PARTIAL →
 *      ResolutionCase → RemedyProposal (50-unit replacement) → mandate →
 *      independent authority execution → remedy OutcomeContract SATISFIED →
 *      case RESOLVED. The original contract stays PARTIAL (history preserved);
 *      combined received = 450 + 50 = 500.
 */

export const WAVE1_A_ID = "wave1-a-unsafe-supplier";
export const WAVE1_B_ID = "wave1-b-full-delivery";
export const WAVE1_C_ID = "wave1-c-short-delivery";

export interface Wave1Evidence {
  readonly artifactId: string;
  readonly source: string;
  readonly concept: string;
  readonly value: unknown;
  readonly trustClass: "UNTRUSTED_EXTERNAL";
  readonly capturedAt: string;
  readonly taintOrigins: readonly string[];
}

export function wave1AuthorizationEvidence(prefix: string, supplierId: string): readonly Wave1Evidence[] {
  return [
    {
      artifactId: `${prefix}-supplier-approval`,
      source: "supplier-approval-registry",
      concept: "supplier_approved",
      value: { approved: true, supplierId },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-02T00:00:00.000Z",
      taintOrigins: ["supplier-approval-registry"],
    },
    {
      artifactId: `${prefix}-food-grade-certificate`,
      source: "inspection-certificate-system",
      concept: "food_grade_certified",
      value: { foodGrade: true, product: "food-grade containers" },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-03T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: `${prefix}-quote`,
      source: "supplier-quote-system",
      concept: "quote",
      value: { quantity: 500, price: 742000, currency: "INR", deliveryDeadline: "2026-12-31T17:00:00.000Z" },
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-02T00:00:00.000Z",
      taintOrigins: ["supplier-quote-system"],
    },
  ];
}

/** Full-delivery evidence: dispatch 500 AND receiving 500 → SATISFIED. */
export function wave1FullDeliveryEvidence(prefix: string): readonly Wave1Evidence[] {
  return [
    {
      artifactId: `${prefix}-payment`,
      source: "execution-side-effect-ledger",
      concept: "price_paid",
      value: 742000,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-merchant`,
      source: "execution-side-effect-ledger",
      concept: "merchant_observed",
      value: "wave1-supplier",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-certificate`,
      source: "inspection-certificate-system",
      concept: "certificate_valid",
      value: true,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: `${prefix}-dispatch`,
      source: "merchant-dispatch-system",
      concept: "dispatched_quantity",
      value: 500,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-05T00:00:00.000Z",
      taintOrigins: ["merchant-dispatch-system"],
    },
    {
      artifactId: `${prefix}-receipt`,
      source: "warehouse-receiving-system",
      concept: "quantity_received",
      value: 500,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
    {
      artifactId: `${prefix}-product-receipt`,
      source: "warehouse-receiving-system",
      concept: "product_observed",
      value: "food-grade containers",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
  ];
}

/** Short-delivery evidence: dispatch 500, receiving 450 → PARTIAL. */
export function wave1ShortDeliveryEvidence(prefix: string): readonly Wave1Evidence[] {
  return [
    {
      artifactId: `${prefix}-payment`,
      source: "execution-side-effect-ledger",
      concept: "price_paid",
      value: 742000,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-merchant`,
      source: "execution-side-effect-ledger",
      concept: "merchant_observed",
      value: "wave1-supplier",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-04T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-certificate`,
      source: "inspection-certificate-system",
      concept: "certificate_valid",
      value: true,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: `${prefix}-dispatch`,
      source: "merchant-dispatch-system",
      concept: "dispatched_quantity",
      value: 500,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-05T00:00:00.000Z",
      taintOrigins: ["merchant-dispatch-system"],
    },
    {
      artifactId: `${prefix}-receipt`,
      source: "warehouse-receiving-system",
      concept: "quantity_received",
      value: 450,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
    {
      artifactId: `${prefix}-product-receipt`,
      source: "warehouse-receiving-system",
      concept: "product_observed",
      value: "food-grade containers",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-07T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
  ];
}

/** The 50-unit replacement delivery — proves the remedy outcome contract. */
export function wave1ReplacementEvidence(prefix: string): readonly Wave1Evidence[] {
  return [
    {
      artifactId: `${prefix}-remedy-payment`,
      source: "execution-side-effect-ledger",
      concept: "price_paid",
      value: 6000,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-08T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-remedy-merchant`,
      source: "execution-side-effect-ledger",
      concept: "merchant_observed",
      value: "remedy-counterparty",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-08T00:00:00.000Z",
      taintOrigins: ["execution-side-effect-ledger"],
    },
    {
      artifactId: `${prefix}-remedy-receipt`,
      source: "warehouse-receiving-system",
      concept: "quantity_received",
      value: 50,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-09T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
    {
      artifactId: `${prefix}-remedy-certificate`,
      source: "inspection-certificate-system",
      concept: "certificate_valid",
      value: true,
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-08T00:00:00.000Z",
      taintOrigins: ["inspection-certificate-system"],
    },
    {
      artifactId: `${prefix}-remedy-product`,
      source: "warehouse-receiving-system",
      concept: "product_observed",
      value: "remedy",
      trustClass: "UNTRUSTED_EXTERNAL",
      capturedAt: "2031-01-09T00:00:00.000Z",
      taintOrigins: ["warehouse-receiving-system"],
    },
  ];
}

export const contentHashOf = (evidence: Wave1Evidence): string =>
  hashCanonical({ artifactId: evidence.artifactId, concept: evidence.concept, value: evidence.value, source: evidence.source, capturedAt: evidence.capturedAt });

export function wave1AcceptanceFixture(prefix: string, evidence: readonly Wave1Evidence[]): { envelopes: readonly unknown[]; claims: readonly unknown[] } {
  const envelopes = evidence.map((item) => ({
    id: item.artifactId,
    source: item.source,
    contentHash: contentHashOf(item),
    trustClass: item.trustClass,
    captureTime: item.capturedAt,
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [...item.taintOrigins] },
    originId: item.source,
    lineageGroupId: `${prefix}-${item.concept}`,
  }));
  // Claim ids are artifact-bound (a fixture may carry several claims per
  // concept across distinct evidence sets without colliding).
  const claims = evidence.map((item) => ({
    id: `${item.artifactId}-claim`,
    evidenceId: item.artifactId,
    concept: item.concept,
    value: item.value,
    confidence: 1,
    derivedBy: "wave1-derivation",
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [item.artifactId] },
  }));
  return { envelopes, claims };
}

export function wave1RawIntent(_intentId: string, supplierName: string): string {
  return `Buy 500 food-grade containers from approved supplier ${supplierName} for under INR 800000 before 2026-12-31T17:00:00.000Z`;
}

export function wave1RawEvent(intentId: string, rawText: string): unknown {
  const payload = { rawText, principalId: "wave1-human-principal", intentId };
  return {
    eventId: `event-${intentId}`,
    type: "intent.created",
    aggregateId: intentId,
    aggregateVersion: 1,
    causationId: intentId,
    correlationId: intentId,
    actorService: "wave1-verifier",
    payloadHash: hashCanonical(payload),
    idempotencyKey: intentId,
    provenanceRefs: [],
    payload,
    occurredAt: "2031-01-01T00:00:00.000Z",
  };
}

export function wave1Workflow(intentId: string, supplier: { id: string; approved: boolean }): unknown {
  return {
    intentId,
    idempotencyKey: intentId,
    supplier: { id: supplier.id, name: supplier.id, approved: supplier.approved, approvalEvidenceId: `${intentId}-supplier-approval` },
    item: { specification: "food-grade containers" },
    quantity: 500,
    totalAmount: 742000,
    currency: "INR",
    foodGradeEvidenceId: `${intentId}-food-grade-certificate`,
    evidenceIds: [`${intentId}-quote`],
    delivery: { terms: "deliver 500 food-grade containers", deadline: "2026-12-31T17:00:00.000Z" },
  };
}
