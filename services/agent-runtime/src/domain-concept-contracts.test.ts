import { describe, expect, it } from "vitest";
import {
  resolveCanonicalConcept,
  resolveCanonicalSemanticFact,
  validateConceptContract,
} from "@truemandate/semantic-readiness";
import { ProcurementDomainPack } from "./procurement-domain-pack.js";
import { TravelDomainPack } from "./travel-domain-pack.js";
import { SaasItSpendDomainPack } from "./saas-it-spend-domain-pack.js";
import { InvoiceVendorPaymentDomainPack } from "./invoice-vendor-payment-domain-pack.js";
import { LogisticsFulfillmentDomainPack } from "./logistics-fulfillment-domain-pack.js";

const packs = [
  ProcurementDomainPack,
  TravelDomainPack,
  SaasItSpendDomainPack,
  InvoiceVendorPaymentDomainPack,
  LogisticsFulfillmentDomainPack,
] as const;

describe("DomainPack canonical concept contracts", () => {
  it.each(packs.map((pack) => [pack.id, pack] as const))("validates %s", (_id, pack) => {
    expect(validateConceptContract(pack.planning)).toEqual({ ok: true, value: undefined });
  });

  it.each([
    [ProcurementDomainPack, "supplier_approved", "supplier"],
    [ProcurementDomainPack, "delivery_deadline", "delivery_deadline"],
    [TravelDomainPack, "booking_provider_approval", "provider"],
    [TravelDomainPack, "booking_channel", "provider"],
    [TravelDomainPack, "travel_provider", "provider"],
    [TravelDomainPack, "travel_provider_approval", "provider"],
    [TravelDomainPack, "stay_start_date", "stay_start"],
    [TravelDomainPack, "checkin_date", "stay_start"],
    [TravelDomainPack, "checkout_date", "stay_end"],
    [TravelDomainPack, "accommodation_vendor", "property"],
    [TravelDomainPack, "lodging_name", "property"],
    [TravelDomainPack, "lodging_property", "property"],
    [TravelDomainPack, "hotel_property", "property"],
    [TravelDomainPack, "accommodation_name", "property"],
    [TravelDomainPack, "refundable_policy", "refundability"],
    [TravelDomainPack, "hotel_booking_quantity", "stay_count"],
    [TravelDomainPack, "hotel_stay_quantity", "stay_count"],
    [TravelDomainPack, "booking_completion_deadline", "completion_deadline"],
    [TravelDomainPack, "booking_deadline", "completion_deadline"],
    [TravelDomainPack, "execution_deadline", "completion_deadline"],
    [SaasItSpendDomainPack, "renewal_setting", "renewal"],
    [SaasItSpendDomainPack, "subscription_deadline", "subscription_deadline"],
    [InvoiceVendorPaymentDomainPack, "invoice_due_date", "due_date"],
    [InvoiceVendorPaymentDomainPack, "invoice_identity", "invoice_identity"],
    [LogisticsFulfillmentDomainPack, "approved_carrier", "provider"],
    [LogisticsFulfillmentDomainPack, "fulfill_count", "fulfillment_count"],
  ])("resolves declared vocabulary for $id", (pack, concept, canonical) => {
    expect(resolveCanonicalConcept(concept, pack.planning.conceptFamilies)).toBe(canonical);
  });

  it("does not classify an undeclared near-match", () => {
    expect(resolveCanonicalConcept(
      "pre_stay_start_date_note",
      TravelDomainPack.planning.conceptFamilies,
    )).toBeUndefined();
  });

  it("keeps identity and approval facts separate inside shared vocabularies", () => {
    expect(
      resolveCanonicalSemanticFact(
        "booking_provider",
        TravelDomainPack.planning.conceptFamilies,
        { value: "Meridian Travel Partners" },
      ),
    ).toMatchObject({ factKey: "provider.identity" });
    expect(
      resolveCanonicalSemanticFact(
        "booking_provider_approval",
        TravelDomainPack.planning.conceptFamilies,
        { value: { approved: true, provider: "Meridian Travel Partners" } },
      ),
    ).toMatchObject({ factKey: "provider.approval" });
    expect(
      resolveCanonicalSemanticFact(
        "approved_supplier",
        ProcurementDomainPack.planning.conceptFamilies,
        { value: true },
      ),
    ).toMatchObject({ factKey: "supplier.approval" });
    expect(
      resolveCanonicalSemanticFact(
        "vendor_identity",
        InvoiceVendorPaymentDomainPack.planning.conceptFamilies,
        { value: "INV-001" },
      ),
    ).toMatchObject({ factKey: "payee.identity" });
  });
});
