import type { CloudEventEnvelope } from "@truemandate/cloud-pubsub";
import {
  triggerIdentityForContract,
  type ObservationFacts,
  type ResolutionTriggerKind,
} from "@truemandate/outcome-core";
import type { OutcomeService } from "@truemandate/outcome-service";
import {
  ErrorCode,
  OutcomeContractState,
  OutcomeEventType,
  PaymentStatus,
  err,
  ok,
  type IntentState,
  type OutcomeContract,
  type OutcomeEvent,
  type Result,
} from "@truemandate/protocol";
import { parseWithSchema } from "@truemandate/schemas";
import { z } from "zod";
import type { ResolutionService } from "./service.js";

export interface OutcomeResolutionPorts {
  readonly outcomes: OutcomeService;
  readonly resolution: ResolutionService;
  readonly getIntentState: (id: string) => Promise<IntentState | undefined>;
}

const AppliedPaymentStatusSchema = z.enum(["SUCCESS", "FAILED", "UNKNOWN"]);

const ExecutionPayloadSchema = z
  .object({
    contractId: z.string().min(1).optional(),
    outcomeContractId: z.string().min(1).optional(),
    status: AppliedPaymentStatusSchema.optional(),
    paymentStatus: AppliedPaymentStatusSchema.optional(),
    executionState: AppliedPaymentStatusSchema.optional(),
    now: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
  })
  .strict();

const ObservationFactsSchema = z
  .object({
    paymentSettled: z.boolean().optional(),
    quantityReceived: z.number().optional(),
    quantityOrdered: z.number().optional(),
    pricePaid: z.number().optional(),
    budgetMax: z.number().optional(),
    merchantObserved: z.string().optional(),
    merchantExpected: z.string().optional(),
    productObserved: z.string().optional(),
    productExpected: z.string().optional(),
    certificateValid: z.boolean().optional(),
    deliveryBeforeDeadline: z.boolean().optional(),
    deliveryEta: z.string().optional(),
    deadline: z.string().optional(),
    now: z.string().optional(),
    observedValues: z.record(z.unknown()).optional(),
    semanticMatch: z.union([z.boolean(), z.literal("UNKNOWN")]).optional(),
  })
  .strict();

const EvidencePayloadSchema = z
  .object({
    contractId: z.string().min(1).optional(),
    outcomeContractId: z.string().min(1).optional(),
    facts: ObservationFactsSchema.optional(),
    conflictedConcepts: z.array(z.string().min(1)).optional(),
    awaitingEvidence: z.boolean().optional(),
    principalId: z.string().min(1).optional(),
    now: z.string().min(1).optional(),
    occurredAt: z.string().min(1).optional(),
    paymentSettled: z.boolean().optional(),
    quantityReceived: z.number().optional(),
    quantityOrdered: z.number().optional(),
    pricePaid: z.number().optional(),
    budgetMax: z.number().optional(),
    merchantObserved: z.string().optional(),
    merchantExpected: z.string().optional(),
    productObserved: z.string().optional(),
    productExpected: z.string().optional(),
    certificateValid: z.boolean().optional(),
    deliveryBeforeDeadline: z.boolean().optional(),
    deliveryEta: z.string().optional(),
    deadline: z.string().optional(),
    semanticMatch: z.union([z.boolean(), z.literal("UNKNOWN")]).optional(),
  })
  .strict();

const TRIGGER_BY_STATE: Partial<
  Record<OutcomeContractState, ResolutionTriggerKind>
> = {
  [OutcomeContractState.PARTIAL]: "OUTCOME_PARTIAL",
  [OutcomeContractState.AT_RISK]: "OUTCOME_AT_RISK",
  [OutcomeContractState.BREACHED]: "OUTCOME_BREACHED",
  [OutcomeContractState.CONFLICTED]: "EVIDENCE_CONFLICT",
};

const TRIGGER_EVENT_TYPE: Record<ResolutionTriggerKind, string> = {
  OUTCOME_PARTIAL: OutcomeEventType.OUTCOME_PARTIAL,
  OUTCOME_AT_RISK: OutcomeEventType.OUTCOME_AT_RISK,
  OUTCOME_BREACHED: OutcomeEventType.OUTCOME_BREACHED,
  EVIDENCE_CONFLICT: OutcomeEventType.EVIDENCE_CONFLICT,
};

function contractIdFrom(
  payload: { contractId?: string; outcomeContractId?: string },
  envelope: CloudEventEnvelope,
): string | undefined {
  const id = payload.contractId ?? payload.outcomeContractId ?? envelope.aggregateId;
  return id && id.trim() !== "" ? id : undefined;
}

function observationFactsFromEvidence(payload: z.infer<typeof EvidencePayloadSchema>): {
  readonly facts: ObservationFacts;
  readonly hasSnapshot: boolean;
} {
  const nested = payload.facts ?? {};
  const facts: ObservationFacts = {
    paymentSettled: nested.paymentSettled ?? payload.paymentSettled,
    quantityReceived: nested.quantityReceived ?? payload.quantityReceived,
    quantityOrdered: nested.quantityOrdered ?? payload.quantityOrdered,
    pricePaid: nested.pricePaid ?? payload.pricePaid,
    budgetMax: nested.budgetMax ?? payload.budgetMax,
    merchantObserved: nested.merchantObserved ?? payload.merchantObserved,
    merchantExpected: nested.merchantExpected ?? payload.merchantExpected,
    productObserved: nested.productObserved ?? payload.productObserved,
    productExpected: nested.productExpected ?? payload.productExpected,
    certificateValid: nested.certificateValid ?? payload.certificateValid,
    deliveryBeforeDeadline:
      nested.deliveryBeforeDeadline ?? payload.deliveryBeforeDeadline,
    deliveryEta: nested.deliveryEta ?? payload.deliveryEta,
    deadline: nested.deadline ?? payload.deadline,
    now: nested.now ?? payload.now,
    observedValues: nested.observedValues,
    semanticMatch: nested.semanticMatch ?? payload.semanticMatch,
  };
  const hasSnapshot =
    payload.facts !== undefined ||
    payload.conflictedConcepts !== undefined ||
    Object.values(facts).some((value) => value !== undefined);
  return { facts, hasSnapshot };
}

function triggerEventForContract(
  outcomes: OutcomeService,
  contract: OutcomeContract,
  kind: ResolutionTriggerKind,
  now: string,
): OutcomeEvent {
  const { triggerIdentity, conditionKey } = triggerIdentityForContract(contract, kind);
  const existing = outcomes
    .listEvents(contract.id)
    .find((event) => event.triggerIdentity === triggerIdentity);
  if (existing) return existing;
  return {
    id: `ev-${kind}-${contract.id}-${triggerIdentity.slice(0, 12)}`,
    contractId: contract.id,
    type: TRIGGER_EVENT_TYPE[kind],
    observedAt: now,
    payload: { state: contract.state, conditionKey },
    dedupeKey: `trigger:${triggerIdentity}`,
    triggerIdentity,
    conditionKey,
  };
}

async function openResolutionIfTriggered(
  ports: OutcomeResolutionPorts,
  contract: OutcomeContract,
  now: string,
): Promise<Result<unknown>> {
  const kind = TRIGGER_BY_STATE[contract.state];
  if (!kind) return ok({ contract });

  const intentState = await ports.getIntentState(contract.intentStateId);
  if (!intentState) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Unknown IntentState for resolution trigger",
      { intentStateId: contract.intentStateId, contractId: contract.id },
    );
  }

  const opened = await ports.resolution.openCaseFromTrigger({
    intentState,
    principalId: String(contract.principalId),
    contractId: contract.id,
    triggerEvent: triggerEventForContract(ports.outcomes, contract, kind, now),
    now,
  });
  if (!opened.ok && opened.code === ErrorCode.RESOLUTION_TRIGGER_DUPLICATE) {
    return ok({
      contract,
      duplicateTrigger: true,
      caseId: opened.details?.caseId,
    });
  }
  return opened;
}

export async function handleExecutionEvent(
  envelope: CloudEventEnvelope,
  ports: OutcomeResolutionPorts,
): Promise<Result<unknown>> {
  const parsed = parseWithSchema(
    ExecutionPayloadSchema,
    envelope.payload,
    "execution.events payload",
  );
  if (!parsed.ok) return parsed;

  const contractId = contractIdFrom(parsed.value, envelope);
  if (!contractId) {
    return err(ErrorCode.VALIDATION_FAILED, "Execution event missing contractId");
  }

  const status =
    parsed.value.status ?? parsed.value.paymentStatus ?? parsed.value.executionState;
  if (!status) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Execution event missing payment/execution status",
    );
  }

  const now = parsed.value.now ?? parsed.value.occurredAt ?? envelope.occurredAt;
  const hydrated = await ports.outcomes.getContract(contractId);
  if (!hydrated.ok) return hydrated;

  if (status === PaymentStatus.SUCCESS) {
    const applied = await ports.outcomes.onPaymentSuccess(contractId, now);
    if (!applied.ok) return applied;
    return ok({
      contract: applied.value,
      paymentStatus: applied.value.paymentStatus,
      outcomeState: applied.value.state,
    });
  }
  if (status === PaymentStatus.FAILED) {
    return ports.outcomes.onPaymentFailed(contractId, now);
  }
  return ports.outcomes.onPaymentUnknown(contractId, now);
}

export async function handleEvidenceEvent(
  envelope: CloudEventEnvelope,
  ports: OutcomeResolutionPorts,
): Promise<Result<unknown>> {
  const parsed = parseWithSchema(
    EvidencePayloadSchema,
    envelope.payload,
    "evidence.events payload",
  );
  if (!parsed.ok) return parsed;

  const contractId = contractIdFrom(parsed.value, envelope);
  if (!contractId) {
    return err(ErrorCode.VALIDATION_FAILED, "Evidence event missing contractId");
  }

  const { facts, hasSnapshot } = observationFactsFromEvidence(parsed.value);
  if (!hasSnapshot) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Evidence event missing observation snapshot",
    );
  }

  const now = parsed.value.now ?? parsed.value.occurredAt ?? envelope.occurredAt;
  const hydrated = await ports.outcomes.getContract(contractId);
  if (!hydrated.ok) return hydrated;

  const applied = await ports.outcomes.applyObservations(contractId, facts, now, {
    conflictedConcepts: parsed.value.conflictedConcepts,
    awaitingEvidence: parsed.value.awaitingEvidence,
  });
  if (!applied.ok) return applied;

  const opened = await openResolutionIfTriggered(
    ports,
    applied.value.contract,
    now,
  );
  if (!opened.ok) return opened;

  return ok({
    contract: applied.value.contract,
    verification: applied.value.verification,
    paymentStatus: applied.value.contract.paymentStatus,
    outcomeState: applied.value.contract.state,
  });
}
