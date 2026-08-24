import { ok, type OutcomeContract, type Result } from "@truemandate/protocol";
import {
  familyAliases,
  normalizeOutcomeConcept,
  outcomeConceptFamilyFor,
} from "./concepts.js";

/**
 * Evidence-grounded observation derivation (Phase C).
 *
 * The Outcome engine's applyObservations consumes ObservationFacts. Phase C
 * must not let a caller hand in authoritative outcome conclusions directly:
 * facts are derived ONLY from owner-accepted evidence claims, with source
 * identity, timestamps, trust class, and contradictions preserved.
 */

export interface AcceptedEvidenceClaim {
  readonly id: string;
  readonly concept: string;
  readonly value: unknown;
  readonly source: string;
  readonly trustClass: string;
  readonly capturedAt: string;
}

export interface DerivedObservations {
  readonly facts: {
    readonly quantityReceived?: number;
    readonly quantityOrdered?: number;
    readonly pricePaid?: number;
    readonly budgetMax?: number;
    readonly observedValues?: Readonly<Record<string, unknown>>;
    readonly merchantObserved?: string;
    readonly merchantExpected?: string;
    readonly certificateValid?: boolean;
    readonly productObserved?: string;
    readonly productExpected?: string;
    readonly paymentSettled?: boolean;
  };
  /** Concepts or canonical concept families with contradictory accepted claims. */
  readonly conflictedConcepts: readonly string[];
  /** True when no accepted claim established any deterministic observation. */
  readonly awaitingEvidence: boolean;
  /** First confirmed divergence for quantity-like obligations, when present. */
  readonly divergence: {
    readonly requiredQuantity: number;
    readonly verifiedReceived: number;
    readonly shortfall: number;
    readonly evidenceIds: readonly string[];
  } | undefined;
  readonly contributingClaimIds: readonly string[];
}

const QUANTITY_REQUIREMENT_KEYS = new Set([
  "quantity_received",
  "quantity",
  "stay_quantity",
  "traveler_count_confirmed",
  "traveler_count",
  "hotel_stay_count",
  "seat_count",
  "saas_seat_quantity",
  "logistics_quantity_fulfilled",
  "shipment_quantity",
  "fulfillment_count",
]);

function jsonKey(value: unknown): string {
  return JSON.stringify(value);
}

function singleResolvedValue(
  values: readonly unknown[],
): { readonly conflicted: boolean; readonly value: unknown | undefined } {
  if (values.length === 0) {
    return { conflicted: false, value: undefined };
  }
  const distinct = new Set(values.map(jsonKey));
  if (distinct.size > 1) {
    return { conflicted: true, value: undefined };
  }
  return { conflicted: false, value: values[0] };
}

function numericValue(values: readonly unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number");
}

function stringValue(values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function booleanValue(values: readonly unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

export function deriveObservations(
  contract: OutcomeContract,
  claims: readonly AcceptedEvidenceClaim[],
): Result<DerivedObservations> {
  const claimsByConcept = new Map<string, AcceptedEvidenceClaim[]>();
  const claimsByFamily = new Map<string, AcceptedEvidenceClaim[]>();
  for (const claim of claims) {
    const concept = normalizeOutcomeConcept(claim.concept);
    claimsByConcept.set(concept, [...(claimsByConcept.get(concept) ?? []), claim]);
    const family = outcomeConceptFamilyFor(concept);
    if (family) {
      claimsByFamily.set(family, [...(claimsByFamily.get(family) ?? []), claim]);
    }
  }

  const observedValues: Record<string, unknown> = {};
  const conflictedConcepts: string[] = [];

  for (const [concept, conceptClaims] of claimsByConcept.entries()) {
    const resolved = singleResolvedValue(
      conceptClaims.map((claim) => claim.value),
    );
    if (resolved.conflicted) {
      conflictedConcepts.push(concept);
      continue;
    }
    if (resolved.value !== undefined) {
      observedValues[concept] = resolved.value;
    }
  }

  for (const [family, familyClaims] of claimsByFamily.entries()) {
    const resolved = singleResolvedValue(
      familyClaims.map((claim) => claim.value),
    );
    if (resolved.conflicted) {
      conflictedConcepts.push(family);
      continue;
    }
    if (resolved.value !== undefined) {
      observedValues[family] = resolved.value;
    }
  }

  const quantityRequirement = contract.requirements.find((requirement) => {
    const key = normalizeOutcomeConcept(
      requirement.predicate ?? requirement.concept,
    );
    if (QUANTITY_REQUIREMENT_KEYS.has(key)) return true;
    return outcomeConceptFamilyFor(key) === "quantity";
  });
  const requiredQuantity =
    quantityRequirement && typeof quantityRequirement.value === "number"
      ? quantityRequirement.value
      : undefined;
  const quantityAliases = familyAliases(
    quantityRequirement
      ? outcomeConceptFamilyFor(
          normalizeOutcomeConcept(
            quantityRequirement.predicate ?? quantityRequirement.concept,
          ),
        ) ??
          normalizeOutcomeConcept(
            quantityRequirement.predicate ?? quantityRequirement.concept,
          )
      : "quantity",
  );
  const quantityClaims = claims.filter((claim) =>
    quantityAliases.includes(normalizeOutcomeConcept(claim.concept)),
  );
  const quantityValues = quantityClaims.map((claim) => claim.value);
  const verifiedReceived = conflictedConcepts.includes("quantity")
    ? undefined
    : numericValue(quantityValues);

  const divergence =
    requiredQuantity !== undefined &&
    verifiedReceived !== undefined &&
    verifiedReceived < requiredQuantity
      ? {
          requiredQuantity,
          verifiedReceived,
          shortfall: requiredQuantity - verifiedReceived,
          evidenceIds: quantityClaims.map((claim) => claim.id),
        }
      : undefined;

  const amountValues = claimsByFamily.get("amount")?.map((claim) => claim.value) ?? [];
  const counterpartyValues =
    claimsByFamily.get("counterparty")?.map((claim) => claim.value) ?? [];
  const certificateValues =
    claimsByFamily.get("certificate")?.map((claim) => claim.value) ?? [];
  const productValues = claimsByFamily.get("product")?.map((claim) => claim.value) ?? [];

  const pricePaid = numericValue(amountValues);
  const merchantObserved = stringValue(counterpartyValues);
  const certificateValid = booleanValue(certificateValues);
  const productObserved = stringValue(productValues);
  const budgetRequirement = contract.requirements.find((req) =>
    ["price_within", "budget_limit", "budget_max", "max_total_budget"].includes(
      String(req.predicate),
    ),
  );
  const merchantRequirement = contract.requirements.find(
    (req) =>
      req.predicate === "merchant_matches" ||
      req.predicate === "supplier_approved" ||
      req.predicate === "supplier_identity" ||
      req.predicate === "supplier" ||
      req.concept === "supplier_name" ||
      req.concept === "supplier_approved" ||
      req.concept === "supplier_identity" ||
      req.concept === "supplier",
  );
  const productRequirement = contract.requirements.find(
    (req) =>
      req.predicate === "product_matches" || req.concept === "product_matches",
  );
  const budgetMax =
    typeof budgetRequirement?.value === "number"
      ? budgetRequirement.value
      : undefined;
  const merchantExpected =
    typeof merchantRequirement?.value === "string"
      ? merchantRequirement.value
      : undefined;
  const productExpected =
    typeof productRequirement?.value === "string"
      ? productRequirement.value
      : undefined;

  return ok({
    facts: {
      observedValues,
      ...(verifiedReceived !== undefined ? { quantityReceived: verifiedReceived } : {}),
      ...(requiredQuantity !== undefined ? { quantityOrdered: requiredQuantity } : {}),
      ...(pricePaid !== undefined ? { pricePaid } : {}),
      ...(budgetMax !== undefined ? { budgetMax } : {}),
      ...(merchantObserved !== undefined ? { merchantObserved } : {}),
      ...(merchantExpected !== undefined ? { merchantExpected } : {}),
      ...(certificateValid !== undefined ? { certificateValid } : {}),
      ...(productObserved !== undefined ? { productObserved } : {}),
      ...(productExpected !== undefined ? { productExpected } : {}),
      ...(contract.paymentStatus === "SUCCESS" ? { paymentSettled: true } : {}),
    },
    conflictedConcepts,
    awaitingEvidence: Object.keys(observedValues).length === 0,
    divergence,
    contributingClaimIds: claims.map((claim) => claim.id),
  });
}
