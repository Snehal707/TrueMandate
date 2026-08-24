import {
  ConstraintKind,
  ConstraintOperator,
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  OutcomeRequirementType,
  PaymentStatus,
  asConstraintId,
  asOutcomeContractId,
  asOutcomeRequirementId,
  type Constraint,
  type IntentState,
  type OutcomeContract,
  type OutcomeRequirement,
} from "@truemandate/protocol";
import { hashOutcomeContract } from "@truemandate/outcome-core";

type CommercialInput = {
  readonly quantity: number;
  readonly budgetMax: number;
  readonly merchant: string;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
};

function mapCriticality(kind: ConstraintKind): OutcomeRequirementCriticality {
  if (kind === ConstraintKind.SAFETY_CRITICAL) {
    return OutcomeRequirementCriticality.SAFETY_CRITICAL;
  }
  if (kind === ConstraintKind.HARD || kind === ConstraintKind.LEGAL) {
    return OutcomeRequirementCriticality.HARD;
  }
  if (kind === ConstraintKind.SOFT || kind === ConstraintKind.PREFERENCE) {
    return OutcomeRequirementCriticality.SOFT;
  }
  return OutcomeRequirementCriticality.OPTIONAL;
}

function pushConstraintRequirements(
  reqs: OutcomeRequirement[],
  constraints: readonly Constraint[],
  options: {
    readonly skipConcepts?: readonly string[];
    readonly semanticConcepts?: readonly string[];
  } = {},
): void {
  const skip = new Set(options.skipConcepts ?? []);
  const semantic = new Set(options.semanticConcepts ?? []);
  for (const c of constraints) {
    if (skip.has(c.concept) || reqs.some((r) => r.concept === c.concept)) continue;
    if (
      c.kind !== ConstraintKind.HARD &&
      c.kind !== ConstraintKind.SAFETY_CRITICAL &&
      c.kind !== ConstraintKind.LEGAL
    ) {
      continue;
    }
    const useSemantic = semantic.has(c.concept);
    reqs.push({
      id: asOutcomeRequirementId(`req-${c.concept}`),
      concept: c.concept,
      operator: c.operator,
      value: c.value,
      criticality: mapCriticality(c.kind),
      state: OutcomeRequirementState.PENDING,
      type: useSemantic
        ? OutcomeRequirementType.SEMANTIC
        : OutcomeRequirementType.BOOLEAN,
      predicate: c.concept,
      sourceConstraintId: c.id,
      evaluationMethod: useSemantic ? "HYBRID" : "DETERMINISTIC",
    });
  }
}

function stringParam(
  parameters: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = parameters?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberParam(
  parameters: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = parameters?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanParam(
  parameters: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = parameters?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function finalizeContract(
  input: {
    readonly id: string;
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly merchant: string;
    readonly preparedActionId?: string;
    readonly preparedActionHash?: string;
    readonly actionProposalId?: string;
    readonly actionContentHash?: string;
    readonly planId?: string;
    readonly planVersion?: number;
    readonly createdAt: string;
  },
  requirements: OutcomeRequirement[],
): OutcomeContract {
  const base: OutcomeContract = {
    id: asOutcomeContractId(input.id),
    intentId: input.intentState.intentId,
    intentStateId: input.intentState.id,
    intentStateHash: input.intentState.stateHash,
    principalId: input.principalId as OutcomeContract["principalId"],
    merchant: input.merchant,
    preparedActionId: input.preparedActionId as OutcomeContract["preparedActionId"],
    preparedActionHash: input.preparedActionHash as OutcomeContract["preparedActionHash"],
    actionProposalId: input.actionProposalId as OutcomeContract["actionProposalId"],
    actionContentHash: input.actionContentHash as OutcomeContract["actionContentHash"],
    planId: input.planId as OutcomeContract["planId"],
    planVersion: input.planVersion,
    requirements,
    state: OutcomeContractState.CREATED,
    paymentStatus: PaymentStatus.PENDING,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    version: 1,
  };
  const definitionHash = hashOutcomeContract(base);
  return { ...base, definitionHash, contractHash: definitionHash };
}

export function buildProcurementRequirements(
  constraints: readonly Constraint[],
  commercial: CommercialInput,
): OutcomeRequirement[] {
  const reqs: OutcomeRequirement[] = [
    {
      id: asOutcomeRequirementId("req-supplier"),
      concept: "supplier_approved",
      operator: ConstraintOperator.EQ,
      value: commercial.merchant,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "supplier_approved",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-qty"),
      concept: "quantity_received",
      operator: ConstraintOperator.GTE,
      value: commercial.quantity,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "quantity_received",
      evaluationMethod: "DETERMINISTIC",
      evidencePolicy: { note: "received != ordered" },
    },
    {
      id: asOutcomeRequirementId("req-price"),
      concept: "price_within",
      operator: ConstraintOperator.LTE,
      value: commercial.budgetMax,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "price_within",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-product"),
      concept: "product_matches",
      operator: ConstraintOperator.EQ,
      value: commercial.product ?? true,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "product_matches",
      evaluationMethod: "HYBRID",
    },
  ];

  for (const c of constraints) {
    if (
      c.concept === "food_grade" ||
      c.concept === "food_grade_containers" ||
      c.concept === "food_grade_compliance"
    ) {
      if (reqs.some((r) => r.concept === "food_grade")) continue;
      reqs.push({
        id: asOutcomeRequirementId("req-food-grade"),
        concept: "food_grade",
        operator: c.operator,
        value: true,
        criticality: OutcomeRequirementCriticality.SAFETY_CRITICAL,
        state: OutcomeRequirementState.PENDING,
        type: OutcomeRequirementType.BOOLEAN,
        predicate: "food_grade",
        sourceConstraintId: c.id ?? asConstraintId("c-food"),
        evaluationMethod: "DETERMINISTIC",
        evidencePolicy: { requiresCertification: true },
      });
      continue;
    }
  }
  pushConstraintRequirements(reqs, constraints, {
    skipConcepts: [
      "quantity",
      "quantity_received",
      "item_quantity",
      "supplier_name",
      "supplier_selection",
      "supplier",
      "supplier_identity",
      "food_grade_containers",
      "food_grade_compliance",
      "food_grade",
      ...(commercial.product !== undefined
        ? ["item_specification", "product_specification", "product"]
        : []),
    ],
  });
  return reqs;
}

export function buildTravelRequirements(
  constraints: readonly Constraint[],
  commercial: CommercialInput,
): OutcomeRequirement[] {
  const parameters = commercial.parameters;
  const reqs: OutcomeRequirement[] = [
    {
      id: asOutcomeRequirementId("req-travel-provider"),
      concept: "travel_provider_match",
      operator: ConstraintOperator.EQ,
      value: commercial.merchant,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "travel_provider_match",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-travel-booking"),
      concept: "travel_booking_confirmed",
      operator: ConstraintOperator.EQ,
      value: true,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "travel_booking_confirmed",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-travel-count"),
      concept: "traveler_count_confirmed",
      operator: ConstraintOperator.GTE,
      value: commercial.quantity,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "traveler_count_confirmed",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-travel-price"),
      concept: "travel_price_within",
      operator: ConstraintOperator.LTE,
      value: commercial.budgetMax,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "travel_price_within",
      evaluationMethod: "DETERMINISTIC",
    },
  ];
  const refundable = booleanParam(parameters, "refundableRequired");
  if (refundable !== undefined) {
    reqs.push({
      id: asOutcomeRequirementId("req-travel-refundable"),
      concept: "travel_refundable",
      operator: ConstraintOperator.EQ,
      value: refundable,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "travel_refundable",
      evaluationMethod: "DETERMINISTIC",
    });
  }
  const travelDate = stringParam(parameters, "travelDate");
  if (travelDate) {
    reqs.push({
      id: asOutcomeRequirementId("req-travel-date"),
      concept: "travel_date_correct",
      operator: ConstraintOperator.EQ,
      value: travelDate,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "travel_date_correct",
      evaluationMethod: "HYBRID",
    });
  }
  pushConstraintRequirements(reqs, constraints, {
    semanticConcepts: [
      "travel_date",
      "stay_start_date",
      "check_in",
      "check_in_date",
      "stay_end_date",
      "check_out",
      "check_out_date",
      "checkout_date",
      "lodging_identity",
      "hotel_name",
      "quiet_hotel",
    ],
  });
  return reqs;
}

export function buildSaasItSpendRequirements(
  constraints: readonly Constraint[],
  commercial: CommercialInput,
): OutcomeRequirement[] {
  const parameters = commercial.parameters;
  const reqs: OutcomeRequirement[] = [
    {
      id: asOutcomeRequirementId("req-saas-vendor"),
      concept: "saas_vendor_match",
      operator: ConstraintOperator.EQ,
      value: commercial.merchant,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "saas_vendor_match",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-saas-plan"),
      concept: "saas_plan_active",
      operator: ConstraintOperator.EQ,
      value: commercial.product ?? true,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "saas_plan_active",
      evaluationMethod: "HYBRID",
    },
    {
      id: asOutcomeRequirementId("req-saas-seats"),
      concept: "saas_seat_quantity",
      operator: ConstraintOperator.GTE,
      value: commercial.quantity,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "saas_seat_quantity",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-saas-price"),
      concept: "saas_billing_amount",
      operator: ConstraintOperator.LTE,
      value: commercial.budgetMax,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "saas_billing_amount",
      evaluationMethod: "DETERMINISTIC",
    },
  ];
  const termMonths = numberParam(parameters, "termMonths");
  if (termMonths !== undefined) {
    reqs.push({
      id: asOutcomeRequirementId("req-saas-term"),
      concept: "saas_term_months",
      operator: ConstraintOperator.EQ,
      value: termMonths,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "saas_term_months",
      evaluationMethod: "DETERMINISTIC",
    });
  }
  const renewal = stringParam(parameters, "renewalSetting");
  if (renewal) {
    reqs.push({
      id: asOutcomeRequirementId("req-saas-renewal"),
      concept: "saas_renewal_setting",
      operator: ConstraintOperator.EQ,
      value: renewal,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "saas_renewal_setting",
      evaluationMethod: "DETERMINISTIC",
    });
  }
  pushConstraintRequirements(reqs, constraints, {
    semanticConcepts: ["subscription_plan", "plan_identity"],
  });
  return reqs;
}

export function buildInvoiceVendorPaymentRequirements(
  constraints: readonly Constraint[],
  commercial: CommercialInput,
): OutcomeRequirement[] {
  const parameters = commercial.parameters;
  const reqs: OutcomeRequirement[] = [
    {
      id: asOutcomeRequirementId("req-invoice-payee"),
      concept: "invoice_payee_match",
      operator: ConstraintOperator.EQ,
      value: commercial.merchant,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "invoice_payee_match",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-invoice-amount"),
      concept: "invoice_amount_correct",
      operator: ConstraintOperator.LTE,
      value: commercial.budgetMax,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "invoice_amount_correct",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-invoice-settlement"),
      concept: "invoice_settled_exactly_once",
      operator: ConstraintOperator.EQ,
      value: true,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "invoice_settled_exactly_once",
      evaluationMethod: "DETERMINISTIC",
    },
  ];
  const invoiceId = stringParam(parameters, "invoiceId");
  if (invoiceId) {
    reqs.push({
      id: asOutcomeRequirementId("req-invoice-id"),
      concept: "invoice_identity_match",
      operator: ConstraintOperator.EQ,
      value: invoiceId,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "invoice_identity_match",
      evaluationMethod: "HYBRID",
    });
  }
  const remittance = stringParam(parameters, "remittanceReference");
  if (remittance) {
    reqs.push({
      id: asOutcomeRequirementId("req-invoice-remittance"),
      concept: "invoice_remittance_reference",
      operator: ConstraintOperator.EQ,
      value: remittance,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "invoice_remittance_reference",
      evaluationMethod: "DETERMINISTIC",
    });
  }
  pushConstraintRequirements(reqs, constraints, {
    semanticConcepts: ["invoice_identity", "payee_identity"],
  });
  return reqs;
}

export function buildLogisticsFulfillmentRequirements(
  constraints: readonly Constraint[],
  commercial: CommercialInput,
): OutcomeRequirement[] {
  const parameters = commercial.parameters;
  const reqs: OutcomeRequirement[] = [
    {
      id: asOutcomeRequirementId("req-logistics-provider"),
      concept: "logistics_provider_match",
      operator: ConstraintOperator.EQ,
      value: commercial.merchant,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "logistics_provider_match",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-logistics-dispatch"),
      concept: "logistics_dispatch_confirmed",
      operator: ConstraintOperator.EQ,
      value: true,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.BOOLEAN,
      predicate: "logistics_dispatch_confirmed",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-logistics-quantity"),
      concept: "logistics_quantity_fulfilled",
      operator: ConstraintOperator.GTE,
      value: commercial.quantity,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "logistics_quantity_fulfilled",
      evaluationMethod: "DETERMINISTIC",
    },
    {
      id: asOutcomeRequirementId("req-logistics-price"),
      concept: "logistics_price_within",
      operator: ConstraintOperator.LTE,
      value: commercial.budgetMax,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.NUMERIC,
      predicate: "logistics_price_within",
      evaluationMethod: "DETERMINISTIC",
    },
  ];
  const destination = stringParam(parameters, "destination");
  if (destination) {
    reqs.push({
      id: asOutcomeRequirementId("req-logistics-destination"),
      concept: "logistics_destination_correct",
      operator: ConstraintOperator.EQ,
      value: destination,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "logistics_destination_correct",
      evaluationMethod: "HYBRID",
    });
  }
  const serviceLevel = stringParam(parameters, "serviceLevel");
  if (serviceLevel) {
    reqs.push({
      id: asOutcomeRequirementId("req-logistics-service"),
      concept: "logistics_service_level",
      operator: ConstraintOperator.EQ,
      value: serviceLevel,
      criticality: OutcomeRequirementCriticality.HARD,
      state: OutcomeRequirementState.PENDING,
      type: OutcomeRequirementType.SEMANTIC,
      predicate: "logistics_service_level",
      evaluationMethod: "HYBRID",
    });
  }
  pushConstraintRequirements(reqs, constraints, {
    semanticConcepts: ["destination", "service_level", "provider_identity"],
  });
  return reqs;
}

export function createTravelContract(input: {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}): OutcomeContract {
  return finalizeContract(
    input,
    buildTravelRequirements(input.intentState.constraints, input),
  );
}

export function createProcurementContract(input: {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}): OutcomeContract {
  return finalizeContract(
    input,
    buildProcurementRequirements(input.intentState.constraints, input),
  );
}

export function createSaasItSpendContract(input: {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}): OutcomeContract {
  return finalizeContract(
    input,
    buildSaasItSpendRequirements(input.intentState.constraints, input),
  );
}

export function createInvoiceVendorPaymentContract(input: {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}): OutcomeContract {
  return finalizeContract(
    input,
    buildInvoiceVendorPaymentRequirements(
      input.intentState.constraints,
      input,
    ),
  );
}

export function createLogisticsFulfillmentContract(input: {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
}): OutcomeContract {
  return finalizeContract(
    input,
    buildLogisticsFulfillmentRequirements(
      input.intentState.constraints,
      input,
    ),
  );
}
