import type { SdkWorkflowRequest } from "@truemandate/sdk-core";
import type { BenchmarkV2Domain } from "@truemandate/safe-benchmark";

function ids(domain: BenchmarkV2Domain, sequence: number, now: string) {
  const suffix = `${domain}-${sequence}-${now.replace(/\D/g, "")}`;
  return {
    workflowId: `wf-benchmark-v2-${suffix}`,
    intentId: `intent-benchmark-v2-${suffix}`,
    idempotencyKey: `idem-benchmark-v2-${suffix}`,
  };
}

export function buildBenchmarkWorkflowRequest(
  domain: BenchmarkV2Domain,
  sequence: number,
  now = new Date().toISOString(),
): SdkWorkflowRequest {
  const id = ids(domain, sequence, now);
  const common = {
    workflowId: id.workflowId,
    idempotencyKey: id.idempotencyKey,
    adaptiveSubjectId: `benchmark-v2-${domain}`,
    intent: { kind: "RAW" as const, principalId: "benchmark-v2", id: id.intentId, createdAt: now },
  };
  switch (domain) {
    case "procurement": return {
      ...common,
      intent: { ...common.intent, rawText: "Buy 500 food-grade containers from an approved supplier for under INR 800000 before December 31, 2026." },
      action: { capability: "execute_payment", merchant: "approved-supplier", product: "food-grade containers", quantity: 500, amount: 742000, currency: "INR", deliveryTerms: "deliver before 2026-12-30", consequenceLevel: "HIGH", parameters: {} },
      domain: { packId: domain, payload: { supplier: { id: "approved-supplier", name: "Approved Supplier", approved: true, approvalEvidenceId: "approval-evidence" }, item: { specification: "food-grade containers" }, foodGradeEvidenceId: "food-evidence", evidenceIds: ["food-evidence", "quote-evidence", "approval-evidence", "quantity-evidence"], delivery: { terms: "deliver before 2026-12-30", deadline: "2026-12-30T23:59:59.000Z" } } },
    };
    case "travel": return {
      ...common,
      intent: { ...common.intent, rawText: "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5000 before December 31, 2026, with check-in on December 20 and checkout on December 22." },
      action: { capability: "book_travel", merchant: "Meridian Travel Partners", product: "Seaside Lodge", quantity: 2, amount: 3200, currency: "USD", refundable: true, deliveryTerms: "check in on 2026-12-20 and check out on 2026-12-22", consequenceLevel: "HIGH", parameters: { provider: "Meridian Travel Partners", providerApproved: true, lodgingName: "Seaside Lodge", travelerCount: 2, checkInDate: "2026-12-20T00:00:00.000Z", checkOutDate: "2026-12-22T00:00:00.000Z" } },
      domain: { packId: domain, payload: { provider: { id: "Meridian Travel Partners", name: "Meridian Travel Partners", approved: true, approvalEvidenceId: "approval-evidence" }, booking: { itineraryId: `itin-${sequence}`, lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", checkInDate: "2026-12-20T00:00:00.000Z", checkOutDate: "2026-12-22T00:00:00.000Z", travelerCount: 2 }, policy: { refundableRequired: true }, evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence", "hotel-offer-evidence"] } },
    };
    case "saas_it_spend": return {
      ...common,
      intent: { ...common.intent, rawText: "Purchase 10 seats of the Business Plan from an approved vendor with manual renewal and 12 month term for under USD 12000 before December 31, 2026." },
      action: { capability: "manage_saas_subscription", merchant: "approved-vendor", product: "Business Plan", quantity: 10, amount: 9000, currency: "USD", deliveryTerms: "activate subscription before 2026-12-31", consequenceLevel: "HIGH", parameters: { renewalSetting: "MANUAL", termMonths: 12, seatCount: 10 } },
      domain: { packId: domain, payload: { vendor: { id: "approved-vendor", name: "Approved Vendor", approved: true, approvalEvidenceId: "approval-evidence" }, subscription: { planId: "plan-business", planName: "Business Plan", termMonths: 12, renewalSetting: "MANUAL", seatCount: 10 }, evidenceIds: ["approval-evidence", "seat-count-evidence", "term-renewal-evidence"] } },
    };
    case "invoice_vendor_payment": return {
      ...common,
      intent: { ...common.intent, rawText: "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026." },
      action: { capability: "pay_invoice", merchant: "approved-payee", product: "INV-2026-001", quantity: 1, amount: 24000, currency: "USD", deliveryTerms: "settle invoice before 2026-11-30", consequenceLevel: "HIGH", parameters: { invoiceId: "INV-2026-001", remittanceReference: "remit-1" } },
      domain: { packId: domain, payload: { payee: { id: "approved-payee", name: "Approved Payee", approved: true, approvalEvidenceId: "approval-evidence" }, invoice: { invoiceId: "INV-2026-001", poReference: "PO-77", dueDate: "2026-11-20T00:00:00.000Z", duplicateCheckKey: `dup-${sequence}`, remittanceReference: "remit-1" }, evidenceIds: ["approval-evidence", "invoice-evidence"] } },
    };
    case "logistics_fulfillment": return {
      ...common,
      intent: { ...common.intent, rawText: "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026." },
      action: { capability: "arrange_fulfillment", merchant: "approved-carrier", product: "EXPRESS", quantity: 12, amount: 3500, currency: "USD", deliveryTerms: "ship to Mumbai Warehouse before 2026-10-01", consequenceLevel: "HIGH", parameters: { destination: "Mumbai Warehouse", serviceLevel: "EXPRESS", fulfillCount: 12 } },
      domain: { packId: domain, payload: { provider: { id: "approved-carrier", name: "Approved Carrier", approved: true, approvalEvidenceId: "approval-evidence" }, shipment: { serviceLevel: "EXPRESS", destination: "Mumbai Warehouse", shipBy: "2026-09-20T00:00:00.000Z", fulfillCount: 12 }, evidenceIds: ["approval-evidence", "fulfill-count-evidence", "shipment-evidence"] } },
    };
  }
}
