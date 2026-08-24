import {
  ConstraintOperator,
  OutcomeRequirementState,
  type OutcomeRequirement,
} from "@truemandate/protocol";
import {
  familyAliases,
  normalizeOutcomeConcept,
  outcomeConceptFamilyFor,
} from "./concepts.js";

export interface ObservationFacts {
  readonly paymentSettled?: boolean;
  readonly quantityReceived?: number;
  readonly quantityOrdered?: number;
  readonly pricePaid?: number;
  readonly budgetMax?: number;
  readonly merchantObserved?: string;
  readonly merchantExpected?: string;
  readonly productObserved?: string;
  readonly productExpected?: string;
  readonly certificateValid?: boolean;
  readonly deliveryBeforeDeadline?: boolean;
  readonly deliveryEta?: string;
  readonly deadline?: string;
  readonly now?: string;
  readonly observedValues?: Readonly<Record<string, unknown>>;
  /** Semantic findings only - never rewrite criticality. */
  readonly semanticMatch?: boolean | "UNKNOWN";
}

const QUANTITY_KEYS = new Set([
  "quantity_received",
  "quantity",
  "stay_quantity",
  "traveler_count_confirmed",
  "traveler_count",
  "hotel_stay_count",
  "stay_count",
  "seat_count",
  "saas_seat_quantity",
  "logistics_quantity_fulfilled",
  "shipment_quantity",
  "fulfillment_count",
]);
const AMOUNT_KEYS = new Set([
  "price_within",
  "budget_limit",
  "budget_max",
  "max_total_budget",
  "travel_price_within",
  "travel_budget",
  "total_budget",
  "saas_billing_amount",
  "invoice_amount_correct",
  "invoice_amount",
  "logistics_price_within",
  "amount",
  "price",
  "total_price",
  "total_cost",
  "budget",
]);
const COUNTERPARTY_MATCH_KEYS = new Set([
  "merchant_matches",
  "supplier_approved",
  "supplier_identity",
  "supplier",
  "travel_provider_match",
  "saas_vendor_match",
  "invoice_payee_match",
  "logistics_provider_match",
]);
const APPROVAL_BOOLEAN_KEYS = new Set([
  "approved_provider",
  "approved_supplier",
  "provider_approval_status",
  "approved_vendor",
  "approved_payee",
  "approved_carrier",
]);
const CERTIFICATE_KEYS = new Set([
  "certificate_valid",
  "food_grade",
  "material_standard",
]);
const BOOKING_KEYS = new Set(["travel_booking_confirmed", "booking_confirmed"]);
const REFUND_KEYS = new Set([
  "travel_refundable",
  "refundable",
  "refundability",
  "refundable_rate",
  "cancellation_policy",
]);
const DATE_KEYS = new Set([
  "travel_date_correct",
  "travel_date",
  "stay_date",
  "stay_start_date",
  "check_in",
  "check_in_date",
]);
const END_DATE_KEYS = new Set([
  "stay_end_date",
  "check_out",
  "check_out_date",
  "checkout_date",
]);
const DEADLINE_KEYS = new Set([
  "completion_deadline",
  "booking_completion_deadline",
  "booking_execution_deadline",
  "deadline",
  "due_date",
  "invoice_due_date",
  "ship_by",
  "delivery_deadline",
  "subscription_deadline",
]);
const PROPERTY_KEYS = new Set([
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
]);
const PLAN_KEYS = new Set([
  "saas_plan_active",
  "plan_name",
  "subscription_plan",
  "plan_identity",
]);
const TERM_KEYS = new Set(["saas_term_months", "term_months", "subscription_term"]);
const RENEWAL_KEYS = new Set([
  "saas_renewal_setting",
  "renewal_setting",
  "renewal",
]);
const INVOICE_IDENTITY_KEYS = new Set([
  "invoice_identity_match",
  "invoice_identity",
  "invoice_id",
  "invoice",
]);
const REMITTANCE_KEYS = new Set([
  "invoice_remittance_reference",
  "remittance_reference",
]);
const SETTLEMENT_KEYS = new Set([
  "invoice_settled_exactly_once",
  "settled_exactly_once",
]);
const DISPATCH_KEYS = new Set([
  "logistics_dispatch_confirmed",
  "dispatch_confirmed",
]);
const DESTINATION_KEYS = new Set([
  "logistics_destination_correct",
  "destination",
  "delivery_destination",
]);
const SERVICE_LEVEL_KEYS = new Set([
  "logistics_service_level",
  "service_level",
  "delivery_service_level",
]);
const PRODUCT_KEYS = new Set([
  "product_matches",
  "product_observed",
  "product",
  "item_specification",
]);

function requirementKey(requirement: OutcomeRequirement): string {
  return normalizeOutcomeConcept(requirement.predicate ?? requirement.concept);
}

function observedValues(facts: ObservationFacts): Readonly<Record<string, unknown>> {
  return facts.observedValues ?? {};
}

function readObserved(
  facts: ObservationFacts,
  keys: readonly string[],
): unknown | undefined {
  const observed = observedValues(facts);
  for (const key of keys.map(normalizeOutcomeConcept)) {
    if (key in observed) return observed[key];
    const family = outcomeConceptFamilyFor(key);
    if (family && family in observed) return observed[family];
  }
  return undefined;
}

function readNumber(
  facts: ObservationFacts,
  keys: readonly string[],
  fallbacks: readonly (number | undefined)[] = [],
): number | undefined {
  const direct = readObserved(facts, keys);
  if (typeof direct === "number") return direct;
  return fallbacks.find((value): value is number => typeof value === "number");
}

function readString(
  facts: ObservationFacts,
  keys: readonly string[],
  fallbacks: readonly (string | undefined)[] = [],
): string | undefined {
  const direct = readObserved(facts, keys);
  if (typeof direct === "string") return direct;
  return fallbacks.find((value): value is string => typeof value === "string");
}

function readBoolean(
  facts: ObservationFacts,
  keys: readonly string[],
  fallbacks: readonly (boolean | undefined)[] = [],
): boolean | undefined {
  const direct = readObserved(facts, keys);
  if (typeof direct === "boolean") return direct;
  if (typeof direct === "string") {
    if (direct.toLowerCase() === "true") return true;
    if (direct.toLowerCase() === "false") return false;
    if (direct.toLowerCase() === "confirmed") return true;
  }
  return fallbacks.find((value): value is boolean => typeof value === "boolean");
}

function compareNumeric(
  operator: ConstraintOperator,
  required: number,
  observed: number,
): OutcomeRequirementState {
  switch (operator) {
    case ConstraintOperator.LT:
      return observed < required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case ConstraintOperator.LTE:
      return observed <= required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case ConstraintOperator.GT:
      if (observed > required) return OutcomeRequirementState.SATISFIED;
      if (observed > 0) return OutcomeRequirementState.PARTIAL;
      return OutcomeRequirementState.BREACHED;
    case ConstraintOperator.GTE:
      if (observed >= required) return OutcomeRequirementState.SATISFIED;
      if (observed > 0) return OutcomeRequirementState.PARTIAL;
      return OutcomeRequirementState.BREACHED;
    case ConstraintOperator.NEQ:
      return observed !== required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case ConstraintOperator.EQ:
    case ConstraintOperator.REQUIRE:
    default:
      return observed === required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
  }
}

function compareStringLike(
  operator: ConstraintOperator,
  required: string,
  observed: string,
): OutcomeRequirementState {
  const requiredMs = Date.parse(required);
  const observedMs = Date.parse(observed);
  if (Number.isFinite(requiredMs) && Number.isFinite(observedMs)) {
    switch (operator) {
      case ConstraintOperator.LT:
        return observedMs < requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      case ConstraintOperator.LTE:
        return observedMs <= requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      case ConstraintOperator.GT:
        return observedMs > requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      case ConstraintOperator.GTE:
        return observedMs >= requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      case ConstraintOperator.NEQ:
        return observedMs !== requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      case ConstraintOperator.EQ:
      case ConstraintOperator.REQUIRE:
      default:
        return observedMs === requiredMs
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
    }
  }
  switch (operator) {
    case ConstraintOperator.NEQ:
      return observed !== required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case ConstraintOperator.EQ:
    case ConstraintOperator.REQUIRE:
    default:
      return observed === required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
  }
}

function compareBoolean(
  operator: ConstraintOperator,
  required: boolean,
  observed: boolean,
): OutcomeRequirementState {
  switch (operator) {
    case ConstraintOperator.FORBID:
      return observed
        ? OutcomeRequirementState.BREACHED
        : OutcomeRequirementState.SATISFIED;
    case ConstraintOperator.NEQ:
      return observed !== required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case ConstraintOperator.EQ:
    case ConstraintOperator.REQUIRE:
    default:
      return observed === required
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
  }
}

function normalizeRefundabilityRequirement(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    normalized.includes("non refundable") ||
    normalized.includes("non-refundable") ||
    normalized.includes("not refundable")
  ) {
    return false;
  }
  if (
    normalized.includes("refundable") ||
    normalized.includes("refundable rate") ||
    normalized.includes("free cancellation")
  ) {
    return true;
  }
  return undefined;
}

function genericCompare(
  requirement: OutcomeRequirement,
  observed: unknown,
): OutcomeRequirementState {
  if (observed === undefined) return OutcomeRequirementState.PENDING;
  const key = requirementKey(requirement);
  if (REFUND_KEYS.has(key) && typeof observed === "boolean") {
    const normalizedRequired = normalizeRefundabilityRequirement(requirement.value);
    if (normalizedRequired !== undefined) {
      return compareBoolean(requirement.operator, normalizedRequired, observed);
    }
  }
  if (typeof requirement.value === "number" && typeof observed === "number") {
    return compareNumeric(requirement.operator, requirement.value, observed);
  }
  if (typeof requirement.value === "boolean" && typeof observed === "boolean") {
    return compareBoolean(requirement.operator, requirement.value, observed);
  }
  if (typeof requirement.value === "string" && typeof observed === "string") {
    return compareStringLike(requirement.operator, requirement.value, observed);
  }
  if (requirement.operator === ConstraintOperator.REQUIRE && typeof observed === "boolean") {
    return observed
      ? OutcomeRequirementState.SATISFIED
      : OutcomeRequirementState.BREACHED;
  }
  return OutcomeRequirementState.PENDING;
}

function observedForRequirement(
  requirement: OutcomeRequirement,
  facts: ObservationFacts,
): unknown | undefined {
  const key = requirementKey(requirement);
  if (QUANTITY_KEYS.has(key)) {
    return readNumber(
      facts,
      [key, ...familyAliases("quantity")],
      [facts.quantityReceived, facts.quantityOrdered],
    );
  }
  if (AMOUNT_KEYS.has(key)) {
    return readNumber(
      facts,
      [key, ...familyAliases("amount")],
      [facts.pricePaid],
    );
  }
  if (COUNTERPARTY_MATCH_KEYS.has(key)) {
    return readString(
      facts,
      [key, ...familyAliases("counterparty")],
      [facts.merchantObserved],
    );
  }
  if (APPROVAL_BOOLEAN_KEYS.has(key)) {
    return readBoolean(
      facts,
      [key, ...familyAliases("provider_approval")],
    );
  }
  if (CERTIFICATE_KEYS.has(key)) {
    return readBoolean(
      facts,
      [key, ...familyAliases("certificate")],
      [facts.certificateValid],
    );
  }
  if (BOOKING_KEYS.has(key)) {
    return readBoolean(
      facts,
      [key, ...familyAliases("booking_confirmed")],
    );
  }
  if (REFUND_KEYS.has(key)) {
    return readBoolean(
      facts,
      [key, ...familyAliases("refundability")],
    );
  }
  if (DATE_KEYS.has(key)) {
    return readString(
      facts,
      [key, ...familyAliases("date")],
    );
  }
  if (END_DATE_KEYS.has(key)) {
    return readString(
      facts,
      [key, ...familyAliases("end_date")],
    );
  }
  if (DEADLINE_KEYS.has(key)) {
    return readString(
      facts,
      [key, ...familyAliases("deadline")],
      [facts.deadline],
    );
  }
  if (PROPERTY_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("property")]);
  }
  if (PLAN_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("plan")]);
  }
  if (TERM_KEYS.has(key)) {
    return readNumber(facts, [key, ...familyAliases("term")]);
  }
  if (RENEWAL_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("renewal")]);
  }
  if (INVOICE_IDENTITY_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("invoice_identity")]);
  }
  if (REMITTANCE_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("remittance")]);
  }
  if (SETTLEMENT_KEYS.has(key)) {
    return readBoolean(
      facts,
      [key, ...familyAliases("settled_once")],
      [facts.paymentSettled],
    );
  }
  if (DISPATCH_KEYS.has(key)) {
    return readBoolean(facts, [key, ...familyAliases("dispatch")]);
  }
  if (DESTINATION_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("destination")]);
  }
  if (SERVICE_LEVEL_KEYS.has(key)) {
    return readString(facts, [key, ...familyAliases("service_level")]);
  }
  if (PRODUCT_KEYS.has(key)) {
    return readString(
      facts,
      [key, ...familyAliases("product")],
      [facts.productObserved],
    );
  }

  const direct = readObserved(facts, [key]);
  if (direct !== undefined) return direct;
  const family = outcomeConceptFamilyFor(key);
  if (family) return readObserved(facts, [family]);
  return undefined;
}

export function evaluatePredicate(
  requirement: OutcomeRequirement,
  facts: ObservationFacts,
): OutcomeRequirementState {
  const key = requirementKey(requirement);
  switch (key) {
    case "payment_settled":
      if (facts.paymentSettled === undefined) return OutcomeRequirementState.PENDING;
      return facts.paymentSettled
        ? OutcomeRequirementState.SATISFIED
        : OutcomeRequirementState.BREACHED;
    case "delivery_before": {
      if (facts.deliveryBeforeDeadline !== undefined) {
        return facts.deliveryBeforeDeadline
          ? OutcomeRequirementState.SATISFIED
          : OutcomeRequirementState.BREACHED;
      }
      if (facts.deliveryEta && (facts.deadline || requirement.deadline)) {
        const deadline = facts.deadline ?? requirement.deadline!;
        if (facts.now && Date.parse(facts.now) < Date.parse(deadline)) {
          if (Date.parse(facts.deliveryEta) > Date.parse(deadline)) {
            return OutcomeRequirementState.AT_RISK;
          }
        }
        if (facts.now && Date.parse(facts.now) >= Date.parse(deadline)) {
          return Date.parse(facts.deliveryEta) <= Date.parse(deadline)
            ? OutcomeRequirementState.SATISFIED
            : OutcomeRequirementState.BREACHED;
        }
        return OutcomeRequirementState.PENDING;
      }
      return OutcomeRequirementState.PENDING;
    }
    default:
      break;
  }

  if (facts.semanticMatch === "UNKNOWN") {
    return OutcomeRequirementState.UNKNOWN;
  }
  const observed = observedForRequirement(requirement, facts);
  const evaluated = genericCompare(requirement, observed);
  if (evaluated !== OutcomeRequirementState.PENDING) {
    return evaluated;
  }
  if (facts.semanticMatch !== undefined) {
    return facts.semanticMatch
      ? OutcomeRequirementState.SATISFIED
      : OutcomeRequirementState.BREACHED;
  }
  return OutcomeRequirementState.PENDING;
}
