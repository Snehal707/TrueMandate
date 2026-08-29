/**
 * Server-owned canonical concept vocabulary, one entry per domain pack.
 *
 * This is the single source of truth for "what is this domain's concept
 * called" — consumed by two independent callers that must never disagree:
 *   - intent-compiler, to constrain Gemini's structured-output schema to a
 *     closed enum and to give the model enough semantic context to choose
 *     correctly (see the `description` field);
 *   - agent-runtime's domain packs, to build the `conceptFamilies` they pass
 *     to @truemandate/semantic-readiness for proof matching and action
 *     fidelity.
 *
 * `aliases` and `factFamilies` exist for backward compatibility only: they
 * let the SAME ontology data resolve concept strings emitted by legacy /
 * free-form compilations (pre-dating domain-aware compilation, or compiled
 * through the packId-less /v1/intents path) to their canonical concept. A
 * domain-aware compilation constrained by `canonicalConcept` enum values
 * never needs the aliases — it emits canonical identifiers directly.
 *
 * This package depends on nothing else in the workspace. intent-compiler
 * must never depend on agent-runtime, so the ontology lives here instead of
 * in either.
 */

export interface OntologyConceptFamily {
  readonly canonicalConcept: string;
  /** Short enough to embed directly in a compiler prompt; explains what this concept means, not how to spell it. */
  readonly description: string;
  /** Backward-compatibility only — never emitted by domain-aware compilation. */
  readonly aliases: readonly string[];
  readonly factFamilies?: readonly { readonly factType: string; readonly aliases: readonly string[] }[];
  readonly defaultFactType?: string;
}

export interface DomainOntology {
  readonly packId: string;
  readonly concepts: readonly OntologyConceptFamily[];
}

const PROCUREMENT_ONTOLOGY: DomainOntology = {
  packId: "procurement",
  concepts: [
    {
      canonicalConcept: "supplier",
      description:
        "Whether the counterparty supplying the goods is an approved/qualified supplier. Applies to any constraint about supplier identity or approval status, however the raw text phrases it (\"approved supplier\", \"vendor qualification\", \"supplier eligibility\").",
      aliases: ["supplier", "approved_supplier", "supplier_approved", "supplier_status"],
      factFamilies: [
        { factType: "approval", aliases: ["approved_supplier", "supplier_approved"] },
      ],
    },
    {
      canonicalConcept: "material",
      description:
        "The required specification/grade/characteristic of the item being purchased (e.g. \"food-grade containers\"). This is a description of what the item must be, not a yes/no flag.",
      aliases: ["material", "food_grade", "food_grade_certificate", "food_grade_certified", "item_specification"],
    },
    {
      canonicalConcept: "quantity",
      description: "The number of units being purchased.",
      aliases: ["quantity", "quantity_min"],
    },
    {
      canonicalConcept: "budget",
      description: "The maximum monetary amount the purchase may cost, as a plain finite number in the raw text's currency.",
      aliases: ["budget", "budget_max", "budget_per_kg", "max_total_budget", "total_cost", "total_price", "price", "amount", "budget_limit"],
    },
    {
      canonicalConcept: "delivery_deadline",
      description: "The latest point in time by which delivery/execution must complete.",
      aliases: ["delivery_deadline", "execution_deadline", "delivery_before", "arrive_before", "deadline"],
    },
  ],
};

const TRAVEL_ONTOLOGY: DomainOntology = {
  packId: "travel",
  concepts: [
    {
      canonicalConcept: "provider",
      description: "Whether the travel provider/booking channel is approved.",
      aliases: [
        "provider", "approved_provider", "provider_approval", "provider_approval_status",
        "booking_provider", "booking_channel", "booking_provider_approval", "service_provider",
        "travel_provider", "travel_provider_approval",
      ],
      factFamilies: [
        {
          factType: "approval",
          aliases: ["approved_provider", "provider_approval", "provider_approval_status", "booking_provider_approval", "travel_provider_approval"],
        },
      ],
    },
    {
      canonicalConcept: "property",
      description: "The specific lodging/accommodation property being booked.",
      aliases: [
        "property", "property_name", "accommodation_vendor", "lodging_facility", "lodging_name",
        "lodging_property", "lodging_property_name", "hotel", "hotel_name", "lodging",
        "hotel_property", "accommodation_name",
      ],
    },
    {
      canonicalConcept: "refundability",
      description: "Whether the booking must be refundable/cancellable.",
      aliases: ["refund", "refundable", "refundability", "refundable_policy", "refundable_rate", "cancellation_policy"],
    },
    {
      canonicalConcept: "stay_count",
      description: "The number of travelers, rooms, or stays being booked.",
      aliases: [
        "booking_count", "booking_quantity", "stay_count", "hotel_stay_count", "stay_quantity",
        "hotel_booking_quantity", "hotel_stay_quantity", "traveler_count", "room_quantity",
      ],
    },
    {
      canonicalConcept: "stay_start",
      description: "The check-in / travel start date.",
      aliases: ["stay_date", "stay_start_date", "travel_date", "check_in", "check_in_date", "checkin_date"],
    },
    {
      canonicalConcept: "stay_end",
      description: "The check-out / travel end date.",
      aliases: ["stay_end_date", "check_out", "check_out_date", "checkout_date"],
    },
    {
      canonicalConcept: "completion_deadline",
      description: "The latest point in time by which the booking must be completed.",
      aliases: [
        "completion_deadline", "booking_completion_deadline", "booking_execution_deadline",
        "booking_deadline", "execution_deadline", "deadline",
      ],
    },
    {
      canonicalConcept: "budget",
      description: "The maximum monetary amount the booking may cost, as a plain finite number in the raw text's currency.",
      aliases: ["budget", "travel_budget", "total_budget", "total_cost_budget", "total_cost", "total_cost_usd", "total_price", "price"],
    },
  ],
};

const SAAS_ONTOLOGY: DomainOntology = {
  packId: "saas_it_spend",
  concepts: [
    {
      canonicalConcept: "vendor",
      description: "Whether the SaaS vendor is approved/preferred.",
      aliases: ["vendor", "approved_vendor", "preferred_vendor", "vendor_identity"],
      factFamilies: [
        { factType: "approval", aliases: ["approved_vendor", "preferred_vendor"] },
      ],
    },
    {
      canonicalConcept: "plan",
      description: "The specific subscription plan being purchased.",
      aliases: ["plan", "plan_name", "subscription", "subscription_plan"],
    },
    {
      canonicalConcept: "seat_count",
      description: "The number of seats/licenses being purchased.",
      aliases: ["seat_count", "license", "license_count"],
    },
    {
      canonicalConcept: "term",
      description: "The subscription term length (e.g. months).",
      aliases: ["term", "term_months", "subscription_term"],
    },
    {
      canonicalConcept: "renewal",
      description: "The renewal setting (e.g. manual vs automatic).",
      aliases: ["renewal", "renewal_setting"],
    },
    {
      canonicalConcept: "budget",
      description: "The maximum monetary amount the subscription may cost, as a plain finite number in the raw text's currency.",
      aliases: ["budget", "saas_budget", "total_cost", "total_price", "price", "amount"],
    },
    {
      canonicalConcept: "subscription_deadline",
      description: "The latest point in time by which the subscription must be activated.",
      aliases: ["subscription_deadline", "completion_deadline", "deadline"],
    },
  ],
};

const INVOICE_ONTOLOGY: DomainOntology = {
  packId: "invoice_vendor_payment",
  concepts: [
    {
      canonicalConcept: "payee",
      description: "Whether the payee/vendor being paid is approved.",
      aliases: ["payee", "approved_payee", "vendor", "vendor_identity"],
      factFamilies: [
        { factType: "approval", aliases: ["approved_payee"] },
      ],
    },
    {
      canonicalConcept: "invoice_identity",
      description: "The specific invoice identifier being paid.",
      aliases: ["invoice_identity", "invoice_id", "invoice"],
    },
    {
      canonicalConcept: "duplicate_payment",
      description: "A constraint asserting this payment must not duplicate a prior one.",
      aliases: ["duplicate", "duplicate_payment"],
    },
    {
      canonicalConcept: "due_date",
      description: "The invoice due date / latest point in time payment must complete.",
      aliases: ["due_date", "invoice_due_date"],
    },
    {
      canonicalConcept: "amount",
      description: "The maximum monetary amount the payment may total, as a plain finite number in the raw text's currency.",
      aliases: ["amount", "invoice_amount", "invoice_budget", "budget", "total_cost", "price"],
    },
  ],
};

const LOGISTICS_ONTOLOGY: DomainOntology = {
  packId: "logistics_fulfillment",
  concepts: [
    {
      canonicalConcept: "provider",
      description: "Whether the carrier/fulfillment provider is approved.",
      aliases: ["provider", "approved_carrier", "carrier"],
      factFamilies: [
        { factType: "approval", aliases: ["approved_carrier"] },
      ],
    },
    {
      canonicalConcept: "destination",
      description: "The delivery destination.",
      aliases: ["destination", "delivery_destination"],
    },
    {
      canonicalConcept: "service_level",
      description: "The delivery service level (e.g. EXPRESS).",
      aliases: ["service_level", "delivery_service_level"],
    },
    {
      canonicalConcept: "shipment_deadline",
      description: "The latest point in time by which the shipment must ship/deliver.",
      aliases: ["shipment_deadline", "ship_by", "delivery_deadline"],
    },
    {
      canonicalConcept: "fulfillment_count",
      description: "The number of shipments/units being fulfilled.",
      aliases: ["fulfill_count", "fulfillment_count", "shipment_quantity", "quantity"],
    },
    {
      canonicalConcept: "budget",
      description: "The maximum monetary amount the fulfillment may cost, as a plain finite number in the raw text's currency.",
      aliases: ["budget", "total_cost", "total_price", "price", "amount"],
    },
  ],
};

export const DOMAIN_ONTOLOGIES: Readonly<Record<string, DomainOntology>> = {
  procurement: PROCUREMENT_ONTOLOGY,
  travel: TRAVEL_ONTOLOGY,
  saas_it_spend: SAAS_ONTOLOGY,
  invoice_vendor_payment: INVOICE_ONTOLOGY,
  logistics_fulfillment: LOGISTICS_ONTOLOGY,
};

export function domainOntology(packId: string): DomainOntology | undefined {
  return DOMAIN_ONTOLOGIES[packId];
}

/** The closed set of concept identifiers Gemini may emit for this domain's constraints. Undefined for an unknown packId. */
export function canonicalConceptNames(packId: string): readonly string[] | undefined {
  return domainOntology(packId)?.concepts.map((concept) => concept.canonicalConcept);
}
