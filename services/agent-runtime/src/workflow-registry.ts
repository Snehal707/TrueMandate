import { err, ok, ErrorCode, type Result } from "@truemandate/protocol";
import { validateConceptContract } from "@truemandate/semantic-readiness";
import type {
  GenericWorkflowRequest,
  WorkflowActionDraft,
} from "@truemandate/schemas";
import type { DomainPack, WorkflowRequestBase } from "./domain-pack.js";
import {
  InvoiceVendorPaymentDomainPack,
  InvoiceVendorPaymentWorkflowDomainPayloadSchema,
  type InvoiceVendorPaymentInput,
} from "./invoice-vendor-payment-domain-pack.js";
import {
  LogisticsFulfillmentDomainPack,
  LogisticsFulfillmentWorkflowDomainPayloadSchema,
  type LogisticsFulfillmentInput,
} from "./logistics-fulfillment-domain-pack.js";
import {
  parseProcurementWorkflowRequest,
  ProcurementDomainPack,
  ProcurementWorkflowDomainPayloadSchema,
  type ProcurementInput,
} from "./procurement-domain-pack.js";
import {
  SaasItSpendDomainPack,
  SaasItSpendWorkflowDomainPayloadSchema,
  type SaasItSpendInput,
} from "./saas-it-spend-domain-pack.js";
import {
  TravelDomainPack,
  TravelWorkflowDomainPayloadSchema,
  type TravelInput,
} from "./travel-domain-pack.js";

export interface WorkflowPackAdapter<TInput extends WorkflowRequestBase> {
  readonly packId: string;
  readonly pack: DomainPack<TInput>;
  toEngineInput(request: GenericWorkflowRequest): Result<TInput>;
  fromLegacyRequest?(raw: unknown): Result<GenericWorkflowRequest>;
}

type CoreActionFields = {
  readonly capability: string;
  readonly merchant: string;
  readonly product: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
  readonly refundable?: boolean;
  readonly deliveryTerms?: string;
  readonly parameters: Record<string, unknown>;
  readonly consequenceLevel: "LOW" | "MEDIUM" | "HIGH";
};

function requireCoreActionFields(
  action: WorkflowActionDraft,
): Result<CoreActionFields> {
  if (
    typeof action.capability !== "string" ||
    typeof action.merchant !== "string" ||
    typeof action.product !== "string" ||
    typeof action.quantity !== "number" ||
    typeof action.amount !== "number" ||
    typeof action.currency !== "string" ||
    (action.consequenceLevel !== "LOW" &&
      action.consequenceLevel !== "MEDIUM" &&
      action.consequenceLevel !== "HIGH") ||
    !action.parameters ||
    typeof action.parameters !== "object"
  ) {
    return err(
      ErrorCode.SCHEMA_PARSE_FAILED,
      "Workflow action requires capability, merchant, product, quantity, amount, currency, parameters, and a supported consequenceLevel",
    );
  }
  return ok({
    capability: action.capability,
    merchant: action.merchant,
    product: action.product,
    quantity: action.quantity,
    amount: action.amount,
    currency: action.currency,
    refundable: action.refundable,
    deliveryTerms: action.deliveryTerms,
    parameters: action.parameters,
    consequenceLevel: action.consequenceLevel,
  });
}

function referenceIntent(request: GenericWorkflowRequest) {
  return request.intent.kind === "REFERENCE" ? request.intent : undefined;
}

const ProcurementPackAdapter: WorkflowPackAdapter<ProcurementInput> = {
  packId: "procurement",
  pack: ProcurementDomainPack,
  toEngineInput(request) {
    const required = requireCoreActionFields(request.action);
    if (!required.ok) return required as Result<ProcurementInput>;
    const payload = ProcurementWorkflowDomainPayloadSchema.safeParse(
      request.domain.payload,
    );
    if (!payload.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Invalid procurement domain payload",
        { issues: payload.error.issues },
      );
    }
    if (
      payload.data.supplier.id &&
      payload.data.supplier.id !== required.value.merchant
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Procurement payload supplier.id must match action.merchant",
      );
    }
    if (
      payload.data.item?.specification &&
      payload.data.item.specification !== required.value.product
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Procurement payload item.specification must match action.product",
      );
    }
    const ref = referenceIntent(request);
    return ok({
      intentId: ref?.intentId ?? "",
      workflowId: request.workflowId,
      expectedIntentStateId: ref?.expectedIntentStateId,
      expectedIntentStateHash: ref?.expectedIntentStateHash,
      adaptiveSubjectId: request.adaptiveSubjectId,
      idempotencyKey: request.idempotencyKey,
      approvalId: undefined,
      capability: required.value.capability,
      supplier: {
        id: required.value.merchant,
        name: payload.data.supplier.name,
        approved: payload.data.supplier.approved,
        approvalEvidenceId: payload.data.supplier.approvalEvidenceId,
      },
      item: {
        specification: required.value.product,
        sku: payload.data.item?.sku,
      },
      quantity: required.value.quantity,
      totalAmount: required.value.amount,
      currency: required.value.currency,
      refundable: required.value.refundable,
      foodGradeEvidenceId: payload.data.foodGradeEvidenceId,
      delivery: {
        deadline: payload.data.delivery?.deadline,
        terms: required.value.deliveryTerms ?? payload.data.delivery?.terms,
      },
      parameters: required.value.parameters,
      consequenceLevel: required.value.consequenceLevel,
      evidenceIds: payload.data.evidenceIds,
    });
  },
  fromLegacyRequest(raw) {
    const parsed = parseProcurementWorkflowRequest(raw);
    if (!parsed.ok) return parsed as Result<GenericWorkflowRequest>;
    return ok({
      intent: {
        kind: "REFERENCE",
        intentId: parsed.value.intentId,
        expectedIntentStateId: parsed.value.expectedIntentStateId,
        expectedIntentStateHash: parsed.value.expectedIntentStateHash,
      },
      action: {
        capability: parsed.value.capability,
        merchant: parsed.value.supplier.id,
        product: parsed.value.item.specification,
        quantity: parsed.value.quantity,
        amount: parsed.value.totalAmount,
        currency: parsed.value.currency,
        refundable: parsed.value.refundable,
        deliveryTerms: parsed.value.delivery?.terms,
        parameters: parsed.value.parameters,
        consequenceLevel: parsed.value.consequenceLevel,
      },
      domain: {
        packId: "procurement",
        payload: {
          supplier: parsed.value.supplier,
          item: parsed.value.item,
          foodGradeEvidenceId: parsed.value.foodGradeEvidenceId,
          delivery: parsed.value.delivery,
          evidenceIds: parsed.value.evidenceIds,
        },
      },
      workflowId: parsed.value.workflowId,
      adaptiveSubjectId: parsed.value.adaptiveSubjectId,
      idempotencyKey: parsed.value.idempotencyKey,
    });
  },
};

const TravelPackAdapter: WorkflowPackAdapter<TravelInput> = {
  packId: "travel",
  pack: TravelDomainPack,
  toEngineInput(request) {
    const required = requireCoreActionFields(request.action);
    if (!required.ok) return required as Result<TravelInput>;
    const payload = TravelWorkflowDomainPayloadSchema.safeParse(
      request.domain.payload,
    );
    if (!payload.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Invalid travel domain payload",
        { issues: payload.error.issues },
      );
    }
    if (
      payload.data.provider.id &&
      payload.data.provider.id !== required.value.merchant
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Travel payload provider.id must match action.merchant",
      );
    }
    if (
      payload.data.booking.lodgingName &&
      payload.data.booking.lodgingName !== required.value.product
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Travel payload booking.lodgingName must match action.product",
      );
    }
    if (payload.data.booking.travelerCount !== required.value.quantity) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Travel payload booking.travelerCount must match action.quantity",
      );
    }
    const ref = referenceIntent(request);
    return ok({
      intentId: ref?.intentId ?? "",
      workflowId: request.workflowId,
      expectedIntentStateId: ref?.expectedIntentStateId,
      expectedIntentStateHash: ref?.expectedIntentStateHash,
      adaptiveSubjectId: request.adaptiveSubjectId,
      idempotencyKey: request.idempotencyKey,
      capability: required.value.capability,
      provider: {
        id: required.value.merchant,
        name: payload.data.provider.name,
        approved: payload.data.provider.approved,
        approvalEvidenceId: payload.data.provider.approvalEvidenceId,
      },
      booking: payload.data.booking,
      totalAmount: required.value.amount,
      currency: required.value.currency,
      refundable:
        required.value.refundable ??
        payload.data.policy?.refundableRequired,
      deliveryTerms: required.value.deliveryTerms,
      parameters: required.value.parameters,
      consequenceLevel: required.value.consequenceLevel,
      evidenceIds: payload.data.evidenceIds,
    });
  },
};

const SaasItSpendPackAdapter: WorkflowPackAdapter<SaasItSpendInput> = {
  packId: "saas_it_spend",
  pack: SaasItSpendDomainPack,
  toEngineInput(request) {
    const required = requireCoreActionFields(request.action);
    if (!required.ok) return required as Result<SaasItSpendInput>;
    const payload = SaasItSpendWorkflowDomainPayloadSchema.safeParse(
      request.domain.payload,
    );
    if (!payload.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Invalid SaaS/IT spend domain payload",
        { issues: payload.error.issues },
      );
    }
    if (
      payload.data.vendor.id &&
      payload.data.vendor.id !== required.value.merchant
    ) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "SaaS payload vendor.id must match action.merchant",
      );
    }
    if (payload.data.subscription.planName !== required.value.product) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "SaaS payload subscription.planName must match action.product",
      );
    }
    if (payload.data.subscription.seatCount !== required.value.quantity) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "SaaS payload subscription.seatCount must match action.quantity",
      );
    }
    const ref = referenceIntent(request);
    return ok({
      intentId: ref?.intentId ?? "",
      workflowId: request.workflowId,
      expectedIntentStateId: ref?.expectedIntentStateId,
      expectedIntentStateHash: ref?.expectedIntentStateHash,
      adaptiveSubjectId: request.adaptiveSubjectId,
      idempotencyKey: request.idempotencyKey,
      capability: required.value.capability,
      vendor: {
        id: required.value.merchant,
        name: payload.data.vendor.name,
        approved: payload.data.vendor.approved,
        approvalEvidenceId: payload.data.vendor.approvalEvidenceId,
      },
      subscription: payload.data.subscription,
      totalAmount: required.value.amount,
      currency: required.value.currency,
      refundable: required.value.refundable,
      deliveryTerms: required.value.deliveryTerms,
      parameters: required.value.parameters,
      consequenceLevel: required.value.consequenceLevel,
      evidenceIds: payload.data.evidenceIds,
    });
  },
};

const InvoiceVendorPaymentPackAdapter: WorkflowPackAdapter<InvoiceVendorPaymentInput> =
  {
    packId: "invoice_vendor_payment",
    pack: InvoiceVendorPaymentDomainPack,
    toEngineInput(request) {
      const required = requireCoreActionFields(request.action);
      if (!required.ok) return required as Result<InvoiceVendorPaymentInput>;
      const payload = InvoiceVendorPaymentWorkflowDomainPayloadSchema.safeParse(
        request.domain.payload,
      );
      if (!payload.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "Invalid invoice/vendor payment domain payload",
          { issues: payload.error.issues },
        );
      }
      if (
        payload.data.payee.id &&
        payload.data.payee.id !== required.value.merchant
      ) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Invoice payload payee.id must match action.merchant",
        );
      }
      if (payload.data.invoice.invoiceId !== required.value.product) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Invoice payload invoice.invoiceId must match action.product",
        );
      }
      if (required.value.quantity !== 1) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Invoice/vendor payment workflows require action.quantity = 1",
        );
      }
      const ref = referenceIntent(request);
      return ok({
        intentId: ref?.intentId ?? "",
        workflowId: request.workflowId,
        expectedIntentStateId: ref?.expectedIntentStateId,
        expectedIntentStateHash: ref?.expectedIntentStateHash,
        adaptiveSubjectId: request.adaptiveSubjectId,
        idempotencyKey: request.idempotencyKey,
        capability: required.value.capability,
        payee: {
          id: required.value.merchant,
          name: payload.data.payee.name,
          approved: payload.data.payee.approved,
          approvalEvidenceId: payload.data.payee.approvalEvidenceId,
        },
        invoice: payload.data.invoice,
        totalAmount: required.value.amount,
        currency: required.value.currency,
        parameters: required.value.parameters,
        consequenceLevel: required.value.consequenceLevel,
        evidenceIds: payload.data.evidenceIds,
      });
    },
  };

const LogisticsFulfillmentPackAdapter: WorkflowPackAdapter<LogisticsFulfillmentInput> =
  {
    packId: "logistics_fulfillment",
    pack: LogisticsFulfillmentDomainPack,
    toEngineInput(request) {
      const required = requireCoreActionFields(request.action);
      if (!required.ok) return required as Result<LogisticsFulfillmentInput>;
      const payload = LogisticsFulfillmentWorkflowDomainPayloadSchema.safeParse(
        request.domain.payload,
      );
      if (!payload.success) {
        return err(
          ErrorCode.SCHEMA_PARSE_FAILED,
          "Invalid logistics/fulfillment domain payload",
          { issues: payload.error.issues },
        );
      }
      if (
        payload.data.provider.id &&
        payload.data.provider.id !== required.value.merchant
      ) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Logistics payload provider.id must match action.merchant",
        );
      }
      if (payload.data.shipment.serviceLevel !== required.value.product) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Logistics payload shipment.serviceLevel must match action.product",
        );
      }
      if (payload.data.shipment.fulfillCount !== required.value.quantity) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Logistics payload shipment.fulfillCount must match action.quantity",
        );
      }
      const ref = referenceIntent(request);
      return ok({
        intentId: ref?.intentId ?? "",
        workflowId: request.workflowId,
        expectedIntentStateId: ref?.expectedIntentStateId,
        expectedIntentStateHash: ref?.expectedIntentStateHash,
        adaptiveSubjectId: request.adaptiveSubjectId,
        idempotencyKey: request.idempotencyKey,
        capability: required.value.capability,
        provider: {
          id: required.value.merchant,
          name: payload.data.provider.name,
          approved: payload.data.provider.approved,
          approvalEvidenceId: payload.data.provider.approvalEvidenceId,
        },
        shipment: payload.data.shipment,
        totalAmount: required.value.amount,
        currency: required.value.currency,
        deliveryTerms: required.value.deliveryTerms,
        parameters: required.value.parameters,
        consequenceLevel: required.value.consequenceLevel,
        evidenceIds: payload.data.evidenceIds,
      });
    },
  };

export class DomainPackRegistry {
  private readonly adapters = new Map<
    string,
    WorkflowPackAdapter<WorkflowRequestBase>
  >();

  constructor(entries: readonly WorkflowPackAdapter<WorkflowRequestBase>[]) {
    for (const entry of entries) {
      const conceptContract = validateConceptContract(entry.pack.planning);
      if (!conceptContract.ok) {
        throw new Error(`Invalid DomainPack concept contract for ${entry.packId}: ${conceptContract.message}`);
      }
      this.adapters.set(entry.packId, entry);
    }
  }

  get(packId: string): Result<WorkflowPackAdapter<WorkflowRequestBase>> {
    const adapter = this.adapters.get(packId);
    return adapter
      ? ok(adapter)
      : err(ErrorCode.VALIDATION_FAILED, "Unknown workflow domain pack", {
          packId,
        });
  }
}

export function createWave46DomainPackRegistry(): DomainPackRegistry {
  return new DomainPackRegistry([
    ProcurementPackAdapter as WorkflowPackAdapter<WorkflowRequestBase>,
    TravelPackAdapter as WorkflowPackAdapter<WorkflowRequestBase>,
    SaasItSpendPackAdapter as WorkflowPackAdapter<WorkflowRequestBase>,
    InvoiceVendorPaymentPackAdapter as WorkflowPackAdapter<WorkflowRequestBase>,
    LogisticsFulfillmentPackAdapter as WorkflowPackAdapter<WorkflowRequestBase>,
  ]);
}

export function createWave45DomainPackRegistry(): DomainPackRegistry {
  return createWave46DomainPackRegistry();
}
