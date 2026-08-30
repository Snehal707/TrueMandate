import type { SdkWorkflowRequest } from "@truemandate/sdk-core";

export type LiveDemoDomainId =
  | "procurement"
  | "travel"
  | "saas_it_spend"
  | "invoice_vendor_payment"
  | "logistics_fulfillment"
  | "custom_intent";

export type RealPackId =
  | "procurement"
  | "travel"
  | "saas_it_spend"
  | "invoice_vendor_payment"
  | "logistics_fulfillment";

export interface LiveDemoDomainOption {
  readonly id: LiveDemoDomainId;
  readonly label: string;
  readonly summary: string;
}

export interface OutcomeEvidenceAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface OutcomeEvidenceContext {
  readonly workflowId: string;
  readonly intentId?: string;
  readonly intentStateId?: string;
  readonly outcomeContractId: string;
}

export const LIVE_DEMO_DOMAINS: readonly LiveDemoDomainOption[] = [
  {
    id: "procurement",
    label: "Procurement",
    summary: "Approved supplier, food-grade item, bounded budget, governed payment.",
  },
  {
    id: "travel",
    label: "Travel",
    summary: "Provider, stay dates, refundability, traveler count, and booking outcome.",
  },
  {
    id: "saas_it_spend",
    label: "SaaS / IT Spend",
    summary: "Vendor approval, plan, seats, term, renewal policy, and subscription outcome.",
  },
  {
    id: "invoice_vendor_payment",
    label: "Invoice / Vendor Payment",
    summary: "Approved payee, exact invoice identity, one-time settlement, and remittance outcome.",
  },
  {
    id: "logistics_fulfillment",
    label: "Logistics / Fulfillment",
    summary: "Carrier approval, destination, service level, fulfillment count, and delivery outcome.",
  },
  {
    id: "custom_intent",
    label: "Custom Intent",
    summary: "Use the same generic lifecycle with your own fresh raw intent text.",
  },
];

const DEFAULT_CUSTOM_PACK: RealPackId = "travel";

function uniqueId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function buildProcurementRequest(rawText?: string): SdkWorkflowRequest {
  const workflowId = uniqueId("wf-live-demo-procurement");
  return {
    workflowId,
    idempotencyKey: uniqueId("idem-procurement"),
    adaptiveSubjectId: "live-demo-procurement-subject",
    intent: {
      kind: "RAW",
      principalId: "live-demo-web",
      id: uniqueId("intent-live-demo-procurement"),
      createdAt: isoNow(),
      rawText:
        rawText ??
        "Buy 500 food-grade containers from an approved supplier for under INR 800000 before December 31, 2026.",
    },
    action: {
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
    domain: {
      packId: "procurement",
      payload: {
        supplier: {
          id: "approved-supplier",
          name: "Approved Supplier",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        item: {
          specification: "food-grade containers",
        },
        foodGradeEvidenceId: "food-evidence",
        evidenceIds: [
          "food-evidence",
          "quote-evidence",
          "approval-evidence",
          "quantity-evidence",
        ],
        delivery: {
          terms: "deliver before 2026-12-30",
          deadline: "2026-12-30T23:59:59.000Z",
        },
      },
    },
  };
}

function buildTravelRequest(rawText?: string): SdkWorkflowRequest {
  const workflowId = uniqueId("wf-live-demo-travel");
  return {
    workflowId,
    idempotencyKey: uniqueId("idem-travel"),
    adaptiveSubjectId: "live-demo-travel-subject",
    intent: {
      kind: "RAW",
      principalId: "live-demo-web",
      id: uniqueId("intent-live-demo-travel"),
      createdAt: isoNow(),
      rawText:
        rawText ??
        "Book 2 refundable hotel stays at Seaside Lodge through Meridian Travel Partners, with check-in on December 20, 2026 and checkout on December 22, 2026. Complete the booking strictly before December 31, 2026 and keep the total cost under USD 5000.",
    },
    action: {
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
    domain: {
      packId: "travel",
      payload: {
        provider: {
          id: "Meridian Travel Partners",
          name: "Meridian Travel Partners",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        booking: {
          itineraryId: uniqueId("itin"),
          lodgingName: "Seaside Lodge",
          travelDate: "2026-12-20T00:00:00.000Z",
          checkInDate: "2026-12-20T00:00:00.000Z",
          checkOutDate: "2026-12-22T00:00:00.000Z",
          travelerCount: 2,
        },
        policy: {
          refundableRequired: true,
        },
        evidenceIds: [
          "approval-evidence",
          "traveler-count-evidence",
          "refund-evidence",
          "hotel-offer-evidence",
        ],
      },
    },
  };
}

function buildSaasRequest(rawText?: string): SdkWorkflowRequest {
  const workflowId = uniqueId("wf-live-demo-saas");
  return {
    workflowId,
    idempotencyKey: uniqueId("idem-saas"),
    adaptiveSubjectId: "live-demo-saas-subject",
    intent: {
      kind: "RAW",
      principalId: "live-demo-web",
      id: uniqueId("intent-live-demo-saas"),
      createdAt: isoNow(),
      rawText:
        rawText ??
        "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term for under USD 12000 before December 31, 2026.",
    },
    action: {
      capability: "manage_saas_subscription",
      merchant: "approved-vendor",
      product: "Business Plan",
      quantity: 10,
      amount: 9000,
      currency: "USD",
      deliveryTerms: "activate subscription before 2026-12-31",
      consequenceLevel: "HIGH",
      parameters: {
        renewalSetting: "MANUAL",
        termMonths: 12,
        seatCount: 10,
      },
    },
    domain: {
      packId: "saas_it_spend",
      payload: {
        vendor: {
          id: "approved-vendor",
          name: "Approved Vendor",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        subscription: {
          planId: "plan-business",
          planName: "Business Plan",
          termMonths: 12,
          renewalSetting: "MANUAL",
          seatCount: 10,
        },
        evidenceIds: [
          "approval-evidence",
          "seat-count-evidence",
          "term-renewal-evidence",
        ],
      },
    },
  };
}

function buildInvoiceRequest(rawText?: string): SdkWorkflowRequest {
  const workflowId = uniqueId("wf-live-demo-invoice");
  return {
    workflowId,
    idempotencyKey: uniqueId("idem-invoice"),
    adaptiveSubjectId: "live-demo-invoice-subject",
    intent: {
      kind: "RAW",
      principalId: "live-demo-web",
      id: uniqueId("intent-live-demo-invoice"),
      createdAt: isoNow(),
      rawText:
        rawText ??
        "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026.",
    },
    action: {
      capability: "pay_invoice",
      merchant: "approved-payee",
      product: "INV-2026-001",
      quantity: 1,
      amount: 24000,
      currency: "USD",
      deliveryTerms: "settle invoice before 2026-11-30",
      consequenceLevel: "HIGH",
      parameters: {
        invoiceId: "INV-2026-001",
        remittanceReference: "remit-1",
      },
    },
    domain: {
      packId: "invoice_vendor_payment",
      payload: {
        payee: {
          id: "approved-payee",
          name: "Approved Payee",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        invoice: {
          invoiceId: "INV-2026-001",
          poReference: "PO-77",
          dueDate: "2026-11-20T00:00:00.000Z",
          duplicateCheckKey: "dup-1",
          remittanceReference: "remit-1",
        },
        evidenceIds: ["approval-evidence", "invoice-evidence"],
      },
    },
  };
}

function buildLogisticsRequest(rawText?: string): SdkWorkflowRequest {
  const workflowId = uniqueId("wf-live-demo-logistics");
  return {
    workflowId,
    idempotencyKey: uniqueId("idem-logistics"),
    adaptiveSubjectId: "live-demo-logistics-subject",
    intent: {
      kind: "RAW",
      principalId: "live-demo-web",
      id: uniqueId("intent-live-demo-logistics"),
      createdAt: isoNow(),
      rawText:
        rawText ??
        "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026.",
    },
    action: {
      capability: "arrange_fulfillment",
      merchant: "approved-carrier",
      product: "EXPRESS",
      quantity: 12,
      amount: 3500,
      currency: "USD",
      deliveryTerms: "ship to Mumbai Warehouse before 2026-10-01",
      consequenceLevel: "HIGH",
      parameters: {
        destination: "Mumbai Warehouse",
        serviceLevel: "EXPRESS",
        fulfillCount: 12,
      },
    },
    domain: {
      packId: "logistics_fulfillment",
      payload: {
        provider: {
          id: "approved-carrier",
          name: "Approved Carrier",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        shipment: {
          serviceLevel: "EXPRESS",
          destination: "Mumbai Warehouse",
          shipBy: "2026-09-20T00:00:00.000Z",
          fulfillCount: 12,
        },
        evidenceIds: [
          "approval-evidence",
          "fulfill-count-evidence",
          "shipment-evidence",
        ],
      },
    },
  };
}

export function resolveCustomPackId(
  domainId: LiveDemoDomainId,
  customPackId?: RealPackId,
): RealPackId {
  if (domainId !== "custom_intent") return domainId;
  return customPackId ?? DEFAULT_CUSTOM_PACK;
}

export function buildLiveDemoWorkflowRequest(
  domainId: LiveDemoDomainId,
  options: {
    readonly rawText?: string;
    readonly customPackId?: RealPackId;
  } = {},
): SdkWorkflowRequest {
  const packId = resolveCustomPackId(domainId, options.customPackId);
  switch (packId) {
    case "procurement":
      return buildProcurementRequest(options.rawText);
    case "travel":
      return buildTravelRequest(options.rawText);
    case "saas_it_spend":
      return buildSaasRequest(options.rawText);
    case "invoice_vendor_payment":
      return buildInvoiceRequest(options.rawText);
    case "logistics_fulfillment":
      return buildLogisticsRequest(options.rawText);
  }
}

export function outcomeActionsForDomain(
  domainId: LiveDemoDomainId,
  customPackId?: RealPackId,
): readonly OutcomeEvidenceAction[] {
  const packId = resolveCustomPackId(domainId, customPackId);
  switch (packId) {
    case "travel":
      return [
        {
          id: "success",
          label: "Successful stay",
          description: "Submit real candidate outcome evidence for a completed, compliant stay.",
        },
        {
          id: "failure",
          label: "Failed / unmet outcome",
          description: "Submit real candidate outcome evidence for a breached or partial stay.",
        },
      ];
    case "procurement":
      return [
        {
          id: "success",
          label: "Successful delivery",
          description: "Submit candidate receipt evidence through the real governed evidence route.",
        },
        {
          id: "failure",
          label: "Short delivery",
          description: "Submit candidate receipt evidence showing the outcome diverged from the contract.",
        },
      ];
    case "saas_it_spend":
      return [
        {
          id: "success",
          label: "Subscription active",
          description: "Submit candidate evidence that the purchased plan is active as intended.",
        },
        {
          id: "failure",
          label: "Renewal / policy mismatch",
          description: "Submit candidate evidence for a non-satisfied subscription outcome.",
        },
      ];
    case "invoice_vendor_payment":
      return [
        {
          id: "success",
          label: "Invoice settled",
          description: "Submit candidate remittance outcome evidence through the public evidence seam.",
        },
        {
          id: "failure",
          label: "Invoice mismatch",
          description: "Submit candidate evidence for a non-satisfied invoice outcome.",
        },
      ];
    case "logistics_fulfillment":
      return [
        {
          id: "success",
          label: "Fulfillment delivered",
          description: "Submit candidate delivery evidence for the governed logistics outcome.",
        },
        {
          id: "failure",
          label: "Destination / quantity mismatch",
          description: "Submit candidate evidence for a non-satisfied logistics outcome.",
        },
      ];
  }
}

function evidenceEnvelopeId(packId: RealPackId, actionId: string): string {
  return uniqueId(`ev-live-demo-${packId}-${actionId}`);
}

function evidenceClaimId(packId: RealPackId, concept: string): string {
  return uniqueId(`cl-live-demo-${packId}-${concept}`);
}

export function buildOutcomeEvidenceSubmission(
  domainId: LiveDemoDomainId,
  actionId: string,
  context: OutcomeEvidenceContext,
  customPackId?: RealPackId,
): unknown {
  const packId = resolveCustomPackId(domainId, customPackId);
  const evidenceId = evidenceEnvelopeId(packId, actionId);
  const base = {
    envelopes: [
      {
        id: evidenceId,
        source: `live-demo-${packId}-${actionId}`,
        contentHash: uniqueId("hash"),
        captureTime: isoNow(),
        mimeType: "application/json",
      },
    ],
    lineage: {
      workflowId: context.workflowId,
      ...(context.intentId ? { intentId: context.intentId } : {}),
      ...(context.intentStateId ? { intentStateId: context.intentStateId } : {}),
      outcomeContractId: context.outcomeContractId,
    },
  };

  switch (packId) {
    case "travel":
      return {
        ...base,
        claims: actionId === "success"
          ? [
              {
                id: evidenceClaimId(packId, "booking_confirmed"),
                evidenceId,
                concept: "booking_confirmed",
                value: true,
                confidence: 0.99,
              },
              {
                id: evidenceClaimId(packId, "refundable"),
                evidenceId,
                concept: "refundable",
                value: true,
                confidence: 0.95,
              },
              {
                id: evidenceClaimId(packId, "traveler_count"),
                evidenceId,
                concept: "traveler_count",
                value: 2,
                confidence: 0.99,
              },
              {
                id: evidenceClaimId(packId, "check_out_date"),
                evidenceId,
                concept: "check_out_date",
                value: "2026-12-22T00:00:00.000Z",
                confidence: 0.98,
              },
            ]
          : [
              {
                id: evidenceClaimId(packId, "booking_confirmed"),
                evidenceId,
                concept: "booking_confirmed",
                value: true,
                confidence: 0.99,
              },
              {
                id: evidenceClaimId(packId, "traveler_count"),
                evidenceId,
                concept: "traveler_count",
                value: 1,
                confidence: 0.95,
              },
              {
                id: evidenceClaimId(packId, "refundability_issue"),
                evidenceId,
                concept: "refundable",
                value: false,
                confidence: 0.95,
              },
            ],
      };
    case "procurement":
      return {
        ...base,
        claims: actionId === "success"
          ? [
              {
                id: evidenceClaimId(packId, "quantity_received"),
                evidenceId,
                concept: "quantity_received",
                value: 500,
                confidence: 0.99,
              },
            ]
          : [
              {
                id: evidenceClaimId(packId, "quantity_received"),
                evidenceId,
                concept: "quantity_received",
                value: 450,
                confidence: 0.99,
              },
            ],
      };
    case "saas_it_spend":
      return {
        ...base,
        claims: actionId === "success"
          ? [
              {
                id: evidenceClaimId(packId, "saas_plan_active"),
                evidenceId,
                concept: "saas_plan_active",
                value: true,
                confidence: 0.99,
              },
            ]
          : [
              {
                id: evidenceClaimId(packId, "renewal_setting"),
                evidenceId,
                concept: "renewal_setting",
                value: "AUTO",
                confidence: 0.95,
              },
            ],
      };
    case "invoice_vendor_payment":
      return {
        ...base,
        claims: actionId === "success"
          ? [
              {
                id: evidenceClaimId(packId, "invoice_settled_exactly_once"),
                evidenceId,
                concept: "invoice_settled_exactly_once",
                value: true,
                confidence: 0.99,
              },
            ]
          : [
              {
                id: evidenceClaimId(packId, "invoice_identity"),
                evidenceId,
                concept: "invoice_identity",
                value: "INV-2026-999",
                confidence: 0.95,
              },
            ],
      };
    case "logistics_fulfillment":
      return {
        ...base,
        claims: actionId === "success"
          ? [
              {
                id: evidenceClaimId(packId, "logistics_destination_correct"),
                evidenceId,
                concept: "logistics_destination_correct",
                value: true,
                confidence: 0.99,
              },
            ]
          : [
              {
                id: evidenceClaimId(packId, "destination"),
                evidenceId,
                concept: "destination",
                value: "Delhi Hub",
                confidence: 0.95,
              },
            ],
      };
  }
}
