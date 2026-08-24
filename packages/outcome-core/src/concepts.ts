export interface OutcomeConceptFamily {
  readonly canonical: string;
  readonly aliases: readonly string[];
}

export function normalizeOutcomeConcept(value: string): string {
  return value.trim().toLowerCase();
}

export const OUTCOME_CLAIM_FAMILIES: readonly OutcomeConceptFamily[] = [
  {
    canonical: "counterparty",
    aliases: [
      "merchant_observed",
      "merchant",
      "supplier",
      "supplier_name",
      "supplier_identity",
      "provider",
      "provider_name",
      "booking_provider",
      "service_provider",
      "vendor",
      "vendor_name",
      "vendor_identity",
      "payee",
      "payee_name",
      "carrier",
      "carrier_name",
    ],
  },
  {
    canonical: "provider_approval",
    aliases: [
      "approved_provider",
      "approved_supplier",
      "supplier_approved",
      "provider_approval_status",
      "approved_vendor",
      "approved_payee",
      "approved_carrier",
    ],
  },
  {
    canonical: "booking_confirmed",
    aliases: [
      "travel_booking_confirmed",
      "booking_confirmed",
      "booking_status",
    ],
  },
  {
    canonical: "quantity",
    aliases: [
      "quantity_received",
      "quantity",
      "stay_quantity",
      "traveler_count_confirmed",
      "traveler_count",
      "hotel_stay_count",
      "stay_count",
      "seat_count",
      "license_count",
      "saas_seat_quantity",
      "logistics_quantity_fulfilled",
      "fulfill_count",
      "shipment_quantity",
    ],
  },
  {
    canonical: "amount",
    aliases: [
      "price_paid",
      "amount_paid",
      "total_amount",
      "total_price",
      "price",
      "travel_price_within",
      "saas_billing_amount",
      "invoice_amount_correct",
      "logistics_price_within",
      "budget",
      "travel_budget",
      "invoice_amount",
    ],
  },
  {
    canonical: "refundability",
    aliases: [
      "travel_refundable",
      "refundable",
      "refundability",
      "refundable_rate",
      "cancellation_policy",
    ],
  },
  {
    canonical: "date",
    aliases: [
      "travel_date_correct",
      "travel_date",
      "stay_date",
      "stay_start_date",
      "check_in",
      "check_in_date",
    ],
  },
  {
    canonical: "end_date",
    aliases: [
      "stay_end_date",
      "check_out",
      "check_out_date",
      "checkout_date",
    ],
  },
  {
    canonical: "deadline",
    aliases: [
      "completion_deadline",
      "booking_completion_deadline",
      "booking_execution_deadline",
      "deadline",
      "due_date",
      "invoice_due_date",
      "ship_by",
      "delivery_deadline",
      "subscription_deadline",
    ],
  },
  {
    canonical: "property",
    aliases: [
      "lodging_property",
      "hotel_property",
      "property_name",
      "lodging_identity",
      "lodging_name",
      "lodging_property_name",
      "hotel",
      "hotel_name",
      "property",
      "travel_property",
    ],
  },
  {
    canonical: "product",
    aliases: [
      "product_observed",
      "product",
      "item_specification",
      "product_matches",
    ],
  },
  {
    canonical: "certificate",
    aliases: [
      "certificate_valid",
      "food_grade",
      "material_standard",
      "food_grade_certificate",
      "food_grade_certified",
    ],
  },
  {
    canonical: "plan",
    aliases: [
      "saas_plan_active",
      "plan_name",
      "subscription_plan",
      "plan_identity",
    ],
  },
  {
    canonical: "term",
    aliases: [
      "saas_term_months",
      "term_months",
      "subscription_term",
    ],
  },
  {
    canonical: "renewal",
    aliases: [
      "saas_renewal_setting",
      "renewal_setting",
      "renewal",
    ],
  },
  {
    canonical: "invoice_identity",
    aliases: [
      "invoice_identity_match",
      "invoice_identity",
      "invoice_id",
      "invoice",
    ],
  },
  {
    canonical: "remittance",
    aliases: [
      "invoice_remittance_reference",
      "remittance_reference",
    ],
  },
  {
    canonical: "settled_once",
    aliases: [
      "invoice_settled_exactly_once",
      "settled_exactly_once",
    ],
  },
  {
    canonical: "dispatch",
    aliases: [
      "logistics_dispatch_confirmed",
      "dispatch_confirmed",
    ],
  },
  {
    canonical: "destination",
    aliases: [
      "logistics_destination_correct",
      "destination",
      "delivery_destination",
    ],
  },
  {
    canonical: "service_level",
    aliases: [
      "logistics_service_level",
      "service_level",
      "delivery_service_level",
    ],
  },
];

const FAMILY_BY_ALIAS = new Map<string, string>();
for (const family of OUTCOME_CLAIM_FAMILIES) {
  FAMILY_BY_ALIAS.set(normalizeOutcomeConcept(family.canonical), family.canonical);
  for (const alias of family.aliases) {
    FAMILY_BY_ALIAS.set(normalizeOutcomeConcept(alias), family.canonical);
  }
}

export function outcomeConceptFamilyFor(
  value: string,
): string | undefined {
  return FAMILY_BY_ALIAS.get(normalizeOutcomeConcept(value));
}

export function familyAliases(canonical: string): readonly string[] {
  const normalized = normalizeOutcomeConcept(canonical);
  const found = OUTCOME_CLAIM_FAMILIES.find(
    (family) => normalizeOutcomeConcept(family.canonical) === normalized,
  );
  return found
    ? [found.canonical, ...found.aliases].map(normalizeOutcomeConcept)
    : [normalized];
}
