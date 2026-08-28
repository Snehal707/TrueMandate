import { hashCanonical } from "@truemandate/crypto";

/**
 * Server-owned fixtures for the trusted demo-evidence orchestration.
 *
 * Every scenario's human intent, evidence claims, control action, and each
 * attack variant's mutated action are compile-time constants here. Nothing
 * in this file is ever constructed from a request body — a caller selects a
 * `scenarioId`/`variantId` (or `scenarioId`/`runId`) pair and gets exactly
 * this content, never anything it supplied itself.
 *
 * This is the single canonical copy, shared by demo-evidence-orchestrator
 * (which needs the full template — rawText/action/domainPayload/variants —
 * to build workflow requests) and public-bff (which needs only the source
 * evidence portion — rawText for cross-check, evidenceSource/
 * evidenceCaptureTime/evidenceClaims for reconstruction). Server-side only:
 * never imported by apps/web or any browser-bundled code.
 *
 * Evidence content is intentionally static (no `new Date()`, no random
 * ids): the deterministic id/hash helpers below derive every envelope/
 * claim/verification id from the run's own `scenarioId`/`runId`, so
 * identical retries of the same orchestration attempt produce
 * byte-identical content and are safe to replay against
 * `persistEnvelope`/`persistClaim`'s content-hash-equality idempotency
 * check.
 *
 * rawText/action/domain-payload values are reused verbatim from
 * `apps/web/src/demo/liveDemoPresets.ts` — the existing, already-reviewed
 * Live Proof scenario text — rather than inventing new wording. See the
 * caveat in the module docstring of `demo-orchestrator.ts` about compiler
 * fidelity: this fixture's exact concept/constraint alignment has been
 * proven against this codebase's deterministic test compiler, not against
 * the real deployed LLM compiler.
 */

export type DemoScenarioId =
  | "procurement"
  | "travel"
  | "saas_it_spend"
  | "invoice_vendor_payment"
  | "logistics_fulfillment";

export type DemoVariantId =
  | "control"
  | "quantity_drift"
  | "provider_substitution"
  | "capability_expansion"
  | "destination_substitution"
  | "payee_substitution"
  | "renewal_flip";

export const DEMO_SCENARIO_IDS: readonly DemoScenarioId[] = [
  "procurement",
  "travel",
  "saas_it_spend",
  "invoice_vendor_payment",
  "logistics_fulfillment",
];

export interface DemoEvidenceClaimFixture {
  readonly concept: string;
  readonly value: unknown;
}

export interface DemoActionFixture {
  readonly capability: string;
  readonly merchant: string;
  readonly product: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
  readonly refundable?: boolean;
  readonly deliveryTerms?: string;
  readonly consequenceLevel: "HIGH";
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface DemoScenarioTemplate {
  readonly scenarioId: DemoScenarioId;
  readonly packId: DemoScenarioId;
  readonly rawText: string;
  /** Deterministic demo evidence, labeled and never claimed as real. */
  readonly evidenceSource: string;
  readonly evidenceCaptureTime: string;
  readonly evidenceClaims: readonly DemoEvidenceClaimFixture[];
  /**
   * `evidenceIds` is injected by the orchestrator once real verified ids
   * exist. `action` is whichever action fixture (control or the attack
   * variant) is actually being submitted this call — required because every
   * domain pack's request adapter (`workflow-registry.ts`) cross-validates
   * the payload's own entity-id/reference field against `action.merchant` /
   * `action.product` and rejects a mismatch with VALIDATION_FAILED before
   * the request ever reaches proof evaluation. A variant that mutates the
   * counterparty (provider_substitution, payee_substitution) MUST mirror
   * that mutation into the payload's id field for the same reason the real
   * browser-submitted path always kept both in sync.
   */
  readonly domainPayload: (verifiedEvidenceIds: readonly string[], action: DemoActionFixture) => Record<string, unknown>;
  readonly variants: Readonly<Partial<Record<DemoVariantId, DemoActionFixture>>>;
}

function evidenceSourceFor(scenarioId: DemoScenarioId): string {
  return `demo-fixture:${scenarioId}:v1`;
}

const PROCUREMENT: DemoScenarioTemplate = {
  scenarioId: "procurement",
  packId: "procurement",
  rawText:
    "Buy 500 food-grade containers from an approved supplier for under INR 800000 before December 31, 2026.",
  evidenceSource: evidenceSourceFor("procurement"),
  evidenceCaptureTime: "2026-06-01T00:00:00.000Z",
  evidenceClaims: [
    { concept: "quantity", value: 500 },
    { concept: "food_grade", value: true },
    { concept: "budget", value: 742000 },
    { concept: "approved_supplier", value: true },
    { concept: "execution_deadline", value: "2026-12-31T17:00:00.000Z" },
  ],
  domainPayload: (evidenceIds, action) => ({
    supplier: {
      id: action.merchant,
      name: "Approved Supplier",
      approved: true,
      approvalEvidenceId: evidenceIds[0] ?? "approval-evidence",
    },
    item: { specification: action.product },
    foodGradeEvidenceId: evidenceIds[0] ?? "food-evidence",
    evidenceIds,
    delivery: { terms: "deliver before 2026-12-30", deadline: "2026-12-30T23:59:59.000Z" },
  }),
  variants: {
    control: {
      capability: "execute_payment",
      merchant: "approved-supplier",
      product: "food-grade containers",
      quantity: 500,
      amount: 742000,
      currency: "INR",
      deliveryTerms: "deliver before 2026-12-30",
      consequenceLevel: "HIGH",
      parameters: {},
    },
    quantity_drift: {
      capability: "execute_payment",
      merchant: "approved-supplier",
      product: "food-grade containers",
      quantity: 450,
      amount: 742000,
      currency: "INR",
      deliveryTerms: "deliver before 2026-12-30",
      consequenceLevel: "HIGH",
      parameters: {},
    },
  },
};

const TRAVEL: DemoScenarioTemplate = {
  scenarioId: "travel",
  packId: "travel",
  rawText:
    "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5000 before December 31, 2026, with check-in on December 20 and checkout on December 22.",
  evidenceSource: evidenceSourceFor("travel"),
  evidenceCaptureTime: "2026-06-01T00:00:00.000Z",
  evidenceClaims: [
    { concept: "approved_provider", value: true },
    { concept: "hotel_name", value: "Seaside Lodge" },
    { concept: "refundable", value: true },
    { concept: "traveler_count", value: 2 },
    { concept: "travel_budget", value: 3200 },
    { concept: "check_in_date", value: "2026-12-20T00:00:00.000Z" },
    { concept: "check_out_date", value: "2026-12-22T00:00:00.000Z" },
    { concept: "booking_deadline", value: "2026-12-31T00:00:00.000Z" },
  ],
  domainPayload: (evidenceIds, action) => ({
    provider: {
      id: action.merchant,
      name: action.merchant,
      // Structural "approved" flag on the payload, distinct from the
      // evidence-backed `approved_provider` claim below: the evidence still
      // only ever verifies the ORIGINAL scenario's provider. Whether an
      // attack's substituted provider is actually treated as approved is a
      // question for the real proof/fidelity pipeline against that
      // evidence, not something this fixture should pre-decide by always
      // asserting true regardless of which provider is named.
      approved: action.merchant === "Meridian Travel Partners",
      approvalEvidenceId: evidenceIds[0] ?? "approval-evidence",
    },
    booking: {
      itineraryId: "demo-itinerary",
      lodgingName: action.product,
      travelDate: "2026-12-20T00:00:00.000Z",
      checkInDate: "2026-12-20T00:00:00.000Z",
      checkOutDate: "2026-12-22T00:00:00.000Z",
      travelerCount: 2,
    },
    policy: { refundableRequired: true },
    evidenceIds,
  }),
  variants: {
    control: {
      capability: "book_travel",
      merchant: "Meridian Travel Partners",
      product: "Seaside Lodge",
      quantity: 2,
      amount: 3200,
      currency: "USD",
      refundable: true,
      deliveryTerms: "check in on 2026-12-20 and check out on 2026-12-22",
      consequenceLevel: "HIGH",
      parameters: {
        provider: "Meridian Travel Partners",
        providerApproved: true,
        lodgingName: "Seaside Lodge",
        travelerCount: 2,
        checkInDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
      },
    },
    // The proposed action swaps in an unapproved, non-refundable provider —
    // human intent and verified evidence both still say Meridian
    // Travel Partners / refundable. A pure action-fidelity divergence, not
    // an external-content-injection mechanism. See README note in
    // demo-orchestrator.ts on why this is NOT called "prompt injection".
    provider_substitution: {
      capability: "book_travel",
      merchant: "Unapproved Provider",
      product: "Seaside Lodge",
      quantity: 2,
      amount: 3200,
      currency: "USD",
      refundable: false,
      deliveryTerms: "check in on 2026-12-20 and check out on 2026-12-22",
      consequenceLevel: "HIGH",
      parameters: {
        provider: "Unapproved Provider",
        providerApproved: false,
        lodgingName: "Seaside Lodge",
        travelerCount: 2,
        checkInDate: "2026-12-20T00:00:00.000Z",
        checkOutDate: "2026-12-22T00:00:00.000Z",
      },
    },
  },
};

const SAAS: DemoScenarioTemplate = {
  scenarioId: "saas_it_spend",
  packId: "saas_it_spend",
  rawText:
    "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term for under USD 12000 before December 31, 2026.",
  evidenceSource: evidenceSourceFor("saas_it_spend"),
  evidenceCaptureTime: "2026-06-01T00:00:00.000Z",
  evidenceClaims: [
    { concept: "approved_vendor", value: true },
    { concept: "plan_name", value: "Business Plan" },
    { concept: "seat_count", value: 10 },
    { concept: "term_months", value: 12 },
    { concept: "renewal_setting", value: "MANUAL" },
    { concept: "saas_budget", value: 9000 },
    { concept: "subscription_deadline", value: "2026-12-31T00:00:00.000Z" },
  ],
  domainPayload: (evidenceIds, action) => ({
    vendor: {
      id: action.merchant,
      name: "Approved Vendor",
      approved: true,
      approvalEvidenceId: evidenceIds[0] ?? "approval-evidence",
    },
    subscription: {
      planId: "plan-business",
      planName: action.product,
      termMonths: 12,
      // SaasItSpendDomainPack.buildActionProposal derives the
      // ENGINE-EVALUATED ActionProposal.parameters.renewalSetting from
      // input.subscription.renewalSetting (this field), unconditionally
      // overwriting whatever the action's OWN parameters.renewalSetting
      // said. renewal_flip's mutated setting therefore has to be mirrored
      // here or the attack never reaches the actionFidelity check it's
      // meant to exercise.
      renewalSetting: typeof action.parameters.renewalSetting === "string" ? action.parameters.renewalSetting : "MANUAL",
      seatCount: 10,
    },
    evidenceIds,
  }),
  variants: {
    control: {
      capability: "manage_saas_subscription",
      merchant: "approved-vendor",
      product: "Business Plan",
      quantity: 10,
      amount: 9000,
      currency: "USD",
      deliveryTerms: "activate subscription before 2026-12-31",
      consequenceLevel: "HIGH",
      parameters: { renewalSetting: "MANUAL", termMonths: 12, seatCount: 10 },
    },
    renewal_flip: {
      capability: "manage_saas_subscription",
      merchant: "approved-vendor",
      product: "Business Plan",
      quantity: 10,
      amount: 9000,
      currency: "USD",
      deliveryTerms: "activate subscription before 2026-12-31",
      consequenceLevel: "HIGH",
      parameters: { renewalSetting: "AUTO", termMonths: 12, seatCount: 10 },
    },
  },
};

const INVOICE: DemoScenarioTemplate = {
  scenarioId: "invoice_vendor_payment",
  packId: "invoice_vendor_payment",
  rawText:
    "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026.",
  evidenceSource: evidenceSourceFor("invoice_vendor_payment"),
  evidenceCaptureTime: "2026-06-01T00:00:00.000Z",
  evidenceClaims: [
    { concept: "approved_payee", value: true },
    { concept: "invoice_id", value: "INV-2026-001" },
    { concept: "duplicate_payment", value: "dup-1" },
    { concept: "invoice_amount", value: 24000 },
    { concept: "invoice_due_date", value: "2026-12-31T00:00:00.000Z" },
  ],
  domainPayload: (evidenceIds, action) => ({
    payee: {
      id: action.merchant,
      name: action.merchant === "approved-payee" ? "Approved Payee" : action.merchant,
      // See TRAVEL's provider.approved comment: this must not stay hardcoded
      // true once an attack substitutes a different payee — the evidence
      // only ever verifies the ORIGINAL scenario's approved payee.
      approved: action.merchant === "approved-payee",
      approvalEvidenceId: evidenceIds[0] ?? "approval-evidence",
    },
    invoice: {
      invoiceId: action.product,
      poReference: "PO-77",
      dueDate: "2026-11-20T00:00:00.000Z",
      duplicateCheckKey: "dup-1",
      remittanceReference: "remit-1",
    },
    evidenceIds,
  }),
  variants: {
    control: {
      capability: "pay_invoice",
      merchant: "approved-payee",
      product: "INV-2026-001",
      quantity: 1,
      amount: 24000,
      currency: "USD",
      deliveryTerms: "settle invoice before 2026-11-30",
      consequenceLevel: "HIGH",
      parameters: { invoiceId: "INV-2026-001", remittanceReference: "remit-1" },
    },
    payee_substitution: {
      capability: "pay_invoice",
      merchant: "shadow-payee",
      product: "INV-ATTACK-999",
      quantity: 1,
      amount: 24000,
      currency: "USD",
      deliveryTerms: "settle invoice before 2026-11-30",
      consequenceLevel: "HIGH",
      parameters: { invoiceId: "INV-ATTACK-999", remittanceReference: "remit-1" },
    },
  },
};

const LOGISTICS: DemoScenarioTemplate = {
  scenarioId: "logistics_fulfillment",
  packId: "logistics_fulfillment",
  rawText:
    "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026.",
  evidenceSource: evidenceSourceFor("logistics_fulfillment"),
  evidenceCaptureTime: "2026-06-01T00:00:00.000Z",
  evidenceClaims: [
    { concept: "approved_carrier", value: true },
    { concept: "destination", value: "Mumbai Warehouse" },
    { concept: "service_level", value: "EXPRESS" },
    { concept: "fulfill_count", value: 12 },
    { concept: "budget", value: 3500 },
    { concept: "shipment_deadline", value: "2026-12-31T00:00:00.000Z" },
  ],
  domainPayload: (evidenceIds, action) => ({
    provider: {
      id: action.merchant,
      name: "Approved Carrier",
      approved: true,
      approvalEvidenceId: evidenceIds[0] ?? "approval-evidence",
    },
    shipment: {
      serviceLevel: action.product,
      // LogisticsFulfillmentDomainPack.buildActionProposal derives the
      // ENGINE-EVALUATED ActionProposal.parameters.destination from
      // input.shipment.destination (this field), unconditionally
      // overwriting whatever the action's OWN parameters.destination said.
      // destination_substitution's mutated destination therefore has to be
      // mirrored here, exactly like merchant/product above, or the attack
      // never reaches the actionFidelity check it's meant to exercise.
      destination: typeof action.parameters.destination === "string" ? action.parameters.destination : "Mumbai Warehouse",
      shipBy: "2026-09-20T00:00:00.000Z",
      fulfillCount: 12,
    },
    evidenceIds,
  }),
  variants: {
    control: {
      capability: "arrange_fulfillment",
      merchant: "approved-carrier",
      product: "EXPRESS",
      quantity: 12,
      amount: 3500,
      currency: "USD",
      deliveryTerms: "ship to Mumbai Warehouse before 2026-10-01",
      consequenceLevel: "HIGH",
      parameters: { destination: "Mumbai Warehouse", serviceLevel: "EXPRESS", fulfillCount: 12 },
    },
    capability_expansion: {
      capability: "execute_payment",
      merchant: "approved-carrier",
      product: "EXPRESS",
      quantity: 12,
      amount: 3500,
      currency: "USD",
      deliveryTerms: "ship to Mumbai Warehouse before 2026-10-01",
      consequenceLevel: "HIGH",
      parameters: { destination: "Mumbai Warehouse", serviceLevel: "EXPRESS", fulfillCount: 12 },
    },
    destination_substitution: {
      capability: "arrange_fulfillment",
      merchant: "approved-carrier",
      product: "EXPRESS",
      quantity: 12,
      amount: 3500,
      currency: "USD",
      deliveryTerms: "ship to Mumbai Warehouse before 2026-10-01",
      consequenceLevel: "HIGH",
      parameters: { destination: "Remote Transfer Depot", serviceLevel: "EXPRESS", fulfillCount: 12 },
    },
  },
};

export const DEMO_SCENARIO_TEMPLATES: Readonly<Record<DemoScenarioId, DemoScenarioTemplate>> = {
  procurement: PROCUREMENT,
  travel: TRAVEL,
  saas_it_spend: SAAS,
  invoice_vendor_payment: INVOICE,
  logistics_fulfillment: LOGISTICS,
};

export function demoScenarioTemplate(scenarioId: string): DemoScenarioTemplate | undefined {
  return (DEMO_SCENARIO_TEMPLATES as Record<string, DemoScenarioTemplate>)[scenarioId];
}

/** True only for a `(scenarioId, variantId)` pair this fixture set actually defines. */
export function isAllowedDemoVariant(scenarioId: string, variantId: string): boolean {
  const template = demoScenarioTemplate(scenarioId);
  if (!template) return false;
  return Object.prototype.hasOwnProperty.call(template.variants, variantId);
}

/**
 * Deterministic id/hash derivation, shared by demo-evidence-orchestrator
 * (which predicts these same ids to ask evidence-service to verify) and
 * public-bff (which derives them to actually construct and submit the
 * envelope/claims). Both sides MUST compute identical ids from identical
 * inputs — that's the whole point of keeping one canonical implementation
 * here rather than two independently-maintained copies.
 */
export function evidenceEnvelopeId(scenarioId: string, runId: string): string {
  return `demo-${scenarioId}-${runId}-offer`;
}

export function evidenceClaimId(scenarioId: string, runId: string, concept: string): string {
  return `demo-${scenarioId}-${runId}-${concept}`;
}

export function contentHashFor(template: DemoScenarioTemplate): string {
  return hashCanonical({ scenarioId: template.scenarioId, claims: template.evidenceClaims }).padEnd(64, "0").slice(0, 64);
}
