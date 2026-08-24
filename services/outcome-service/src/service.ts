import { randomUUID } from "node:crypto";
import {
  OutcomeEventBus,
  type EvidenceService,
} from "@truemandate/evidence-service";
import {
  aggregateRequirementStates,
  applyPaymentFailed,
  applyPaymentSuccess,
  applyPaymentUnknown,
  assertCriticalityLocked,
  assertTransitionAllowed,
  evaluatePredicate,
  hashOutcomeContract,
  triggerIdentityForContract,
  type ObservationFacts,
  type ResolutionTriggerKind,
  type OutcomeContractStore,
} from "@truemandate/outcome-core";
import {
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import { logStructured } from "@truemandate/observability/structured-log";
import type { PubSubPublisherPort } from "@truemandate/cloud-pubsub";
import {
  ErrorCode,
  OutcomeContractState,
  OutcomeEventType,
  OutcomeRequirementState,
  PaymentStatus,
  WorkflowStage,
  WorkflowStageEventStatus,
  err,
  ok,
  type IntentState,
  type OutcomeContract,
  type OutcomeEvent,
  type OutcomeRequirement,
  type OutcomeRiskSignal,
  type OutcomeStateTransition,
  type OutcomeVerification,
  type Result,
} from "@truemandate/protocol";
import {
  createInvoiceVendorPaymentContract,
  createLogisticsFulfillmentContract,
  createProcurementContract,
  createSaasItSpendContract,
  createTravelContract,
} from "./templates.js";
import { publishOutcomeAnalyticsEvent } from "./analytics-events.js";

/**
 * Domain-keyed OutcomeContract builders. Unknown domains fail closed.
 */
type OutcomeContractBuilderInput = {
  readonly id: string;
  readonly intentState: IntentState;
  readonly principalId: string;
  readonly merchant: string;
  readonly quantity: number;
  readonly budgetMax: number;
  readonly product?: string;
  readonly preparedActionId?: string;
  readonly preparedActionHash?: string;
  readonly actionProposalId?: string;
  readonly actionContentHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  readonly createdAt: string;
};

const OUTCOME_CONTRACT_BUILDERS: Readonly<
  Record<string, (input: OutcomeContractBuilderInput) => OutcomeContract>
> = {
  procurement: createProcurementContract,
  travel: createTravelContract,
  saas_it_spend: createSaasItSpendContract,
  invoice_vendor_payment: createInvoiceVendorPaymentContract,
  logistics_fulfillment: createLogisticsFulfillmentContract,
};

/**
 * Fail-open stage timing. Telemetry must never throw into outcome verification.
 */
async function recordStage(
  recorder: WorkflowStageRecorder | undefined,
  event: Omit<WorkflowStageEvent, "id" | "occurredAt">,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.recordStage({
      id: `${event.workflowId}-${event.stage}-${event.status}-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      ...event,
    });
  } catch {
    // Fail-open.
  }
}

/** Prefer pre-execution workflowId; fall back to contractId as a stable proxy. */
function outcomeWorkflowId(contract: OutcomeContract): string {
  return contract.preExecutionBinding?.workflowId ?? String(contract.id);
}

export interface DurableKeyValue<T> {
  put(id: string, value: T): Promise<void>;
  get(id: string): Promise<T | undefined>;
  putIfAbsent(id: string, value: T): Promise<boolean>;
}

export class OutcomeService {
  private readonly contracts = new Map<string, OutcomeContract>();
  private readonly transitions: OutcomeStateTransition[] = [];
  private readonly events: OutcomeEvent[] = [];
  private readonly seenDedupe = new Set<string>();
  private readonly riskSignals: OutcomeRiskSignal[] = [];
  readonly bus = new OutcomeEventBus();

  constructor(
    private readonly _evidence?: EvidenceService,
    private readonly durable?: {
      readonly contracts?: DurableKeyValue<unknown>;
      /** Narrow owner-only immutable definition store. */
      readonly immutableContracts?: OutcomeContractStore;
      readonly events?: DurableKeyValue<unknown>;
    },
    /** Wave 2: optional fail-open workflow stage recorder. */
    private readonly stageRecorder?: WorkflowStageRecorder,
    /** Wave 3.5: fail-open governance analytics publisher. */
    private readonly publisher?: PubSubPublisherPort,
  ) {
    void this._evidence;
  }

  async createContractFromIntent(input: {
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
    readonly domain?: string;
  }): Promise<Result<OutcomeContract>> {
    const domain = input.domain ?? "procurement";
    const build = OUTCOME_CONTRACT_BUILDERS[domain];
    if (!build) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Unknown outcome contract domain",
        { domain },
      );
    }
    const contract = build(input);
    return ok(await this.put(contract));
  }

  /** Owner-only pre-execution creation. All business fields must already be
   * derived from durable authoritative records by the caller boundary. */
  async createPreExecutionContract(input: {
    readonly id: string;
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly merchant: string;
    readonly quantity: number;
    readonly budgetMax: number;
    readonly product?: string;
    readonly domain?: string;
    readonly parameters?: Record<string, unknown>;
    readonly actionProposalId: string;
    readonly actionContentHash: string;
    readonly planId?: string;
    readonly planVersion?: number;
    readonly createdAt: string;
    readonly preExecutionBinding: NonNullable<OutcomeContract["preExecutionBinding"]>;
    /** Wave 4.3: optional MonitoringContract link for ALLOW_WITH_MONITORING. */
    readonly monitoringContractId?: string;
  }): Promise<Result<OutcomeContract>> {
    const domain = input.domain ?? "procurement";
    const build = OUTCOME_CONTRACT_BUILDERS[domain];
    if (!build) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Unknown outcome contract domain",
        { domain },
      );
    }
    const contract = build(input);
    const bound: OutcomeContract = {
      ...contract,
      preExecutionBinding: input.preExecutionBinding,
      ...(input.monitoringContractId
        ? { monitoringContractId: input.monitoringContractId }
        : {}),
    };
    const definitionHash = hashOutcomeContract(bound);
    const final = { ...bound, definitionHash, contractHash: definitionHash };
    if (this.durable?.immutableContracts) {
      const inserted = await this.durable.immutableContracts.putIfAbsent(final.id, final);
      if (!inserted.ok) return inserted as Result<OutcomeContract>;
      if (!inserted.value) {
        const loaded = await this.durable.immutableContracts.get(final.id);
        if (!loaded.ok) return loaded as Result<OutcomeContract>;
        const existing = loaded.value;
        if (!existing || existing.definitionHash !== definitionHash) {
          return err(ErrorCode.OUTCOME_CONTRACT_STALE, "OutcomeContract immutable conflict");
        }
        this.contracts.set(existing.id, existing);
        return ok(existing);
      }
    } else if (this.durable?.contracts) {
      // Legacy non-authoritative test/lifecycle storage only.
      const inserted = await this.durable.contracts.putIfAbsent(final.id, final);
      if (!inserted) return err(ErrorCode.OUTCOME_CONTRACT_STALE, "OutcomeContract immutable store unavailable");
    }
    this.contracts.set(final.id, final);
    return ok(final);
  }

  async createPreExecutionProcurementContract(input: {
    readonly id: string;
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly merchant: string;
    readonly quantity: number;
    readonly budgetMax: number;
    readonly product?: string;
    readonly actionProposalId: string;
    readonly actionContentHash: string;
    readonly planId?: string;
    readonly planVersion?: number;
    readonly createdAt: string;
    readonly preExecutionBinding: NonNullable<OutcomeContract["preExecutionBinding"]>;
    readonly monitoringContractId?: string;
  }): Promise<Result<OutcomeContract>> {
    return this.createPreExecutionContract({
      ...input,
      domain: "procurement",
    });
  }

  /**
   * Durable-authoritative contract read (Phase C v5 repair). When a durable
   * repository is wired, every read goes through it and the local map is
   * only a refreshed mirror — a warm instance can never shadow a newer
   * durable version written by another instance. All mutation paths enter
   * through this read, so transitions are always evaluated against the
   * latest durable state. Without a durable repository (tests), the local
   * map remains the source of truth.
   */
  async getContract(id: string): Promise<Result<OutcomeContract>> {
    if (this.durable?.contracts) {
      const durable = (await this.durable.contracts.get(id)) as
        | OutcomeContract
        | undefined;
      if (durable) {
        this.contracts.set(id, durable);
        return ok(durable);
      }
    }
    const c = this.contracts.get(id);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown OutcomeContract", { id });
    }
    return ok(c);
  }

  async assertBinding(input: {
    readonly outcomeContractId?: string;
    readonly outcomeContractHash?: string;
  }): Promise<Result<OutcomeContract>> {
    if (!input.outcomeContractId || !input.outcomeContractHash) {
      return err(
        ErrorCode.OUTCOME_CONTRACT_REQUIRED,
        "T2/T3 commit requires bound OutcomeContract id+hash",
      );
    }
    const loaded = await this.getContract(input.outcomeContractId);
    if (!loaded.ok) {
      return err(ErrorCode.OUTCOME_CONTRACT_REQUIRED, "Unknown OutcomeContract", {
        id: input.outcomeContractId,
      });
    }
    const c = loaded.value;
    const expected =
      c.definitionHash ?? c.contractHash ?? hashOutcomeContract(c);
    if (expected !== input.outcomeContractHash) {
      return err(ErrorCode.OUTCOME_CONTRACT_STALE, "OutcomeContract hash mismatch", {
        expected,
        provided: input.outcomeContractHash,
      });
    }
    return ok(c);
  }

  private async put(contract: OutcomeContract): Promise<OutcomeContract> {
    // Preserve immutable definitionHash/contractHash; do not rehash with PA fields
    const definitionHash =
      contract.definitionHash ?? hashOutcomeContract(contract);
    const hashed = {
      ...contract,
      definitionHash,
      contractHash: contract.contractHash ?? definitionHash,
    };
    if (this.durable?.contracts) {
      await this.durable.contracts.put(hashed.id, hashed);
    }
    this.contracts.set(hashed.id, hashed);
    return hashed;
  }

  private recordTransition(
    from: OutcomeContractState,
    to: OutcomeContractState,
    contractId: OutcomeContract["id"],
    reason: string,
    now: string,
  ): void {
    if (from === to) return;
    this.transitions.push({
      id: `ost-${this.transitions.length + 1}`,
      contractId,
      fromState: from,
      toState: to,
      reason,
      at: now,
    });
  }

  private paymentSettledEvent(
    contractId: OutcomeContract["id"],
    now: string,
  ): OutcomeEvent {
    return {
      id: `ev-pay-${contractId}`,
      contractId,
      type: OutcomeEventType.PAYMENT_SETTLED,
      observedAt: now,
      payload: { paymentStatus: PaymentStatus.SUCCESS },
      dedupeKey: `payment_settled:${contractId}`,
    };
  }

  async onPaymentSuccess(contractId: string, now: string): Promise<Result<OutcomeContract>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    if (c.paymentStatus === PaymentStatus.SUCCESS) {
      await this.publishEvent(this.paymentSettledEvent(c.id, now));
      return ok(c);
    }
    const applied = applyPaymentSuccess(c, now);
    if (!applied.ok) return applied;
    this.recordTransition(c.state, applied.value.state, c.id, "payment_success", now);
    const stored = await this.put(applied.value);
    await this.publishEvent(this.paymentSettledEvent(c.id, now));
    return ok(stored);
  }

  async onPaymentUnknown(contractId: string, now: string): Promise<Result<OutcomeContract>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    if (c.paymentStatus === PaymentStatus.UNKNOWN) {
      return ok(c);
    }
    const applied = applyPaymentUnknown(c, now);
    if (!applied.ok) return applied;
    if (c.state !== applied.value.state) {
      this.recordTransition(c.state, applied.value.state, c.id, "payment_unknown", now);
    }
    return ok(await this.put(applied.value));
  }

  async onPaymentFailed(contractId: string, now: string): Promise<Result<OutcomeContract>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    if (c.paymentStatus === PaymentStatus.FAILED) {
      return ok(c);
    }
    const applied = applyPaymentFailed(c, now);
    if (!applied.ok) return applied;
    this.recordTransition(c.state, applied.value.state, c.id, "payment_failed", now);
    return ok(await this.put(applied.value));
  }

  async publishEvent(event: OutcomeEvent): Promise<Result<OutcomeEvent>> {
    if (event.dedupeKey && this.seenDedupe.has(event.dedupeKey)) {
      return ok(event);
    }
    if (this.durable?.events) {
      const inserted = await this.durable.events.putIfAbsent(
        event.id ?? event.dedupeKey ?? `evt-${this.events.length}`,
        event,
      );
      if (!inserted) {
        if (event.dedupeKey) this.seenDedupe.add(event.dedupeKey);
        return ok(event);
      }
    }
    if (event.dedupeKey) this.seenDedupe.add(event.dedupeKey);
    this.events.push(event);
    this.bus.publish(event);
    // Wave 3.5: mirror outcome governance events to analytics (fail-open).
    // Merchant is only included when present on the event payload (from contract).
    const payload = event.payload as Record<string, unknown>;
    const linked = this.contracts.get(String(event.contractId));
    publishOutcomeAnalyticsEvent(this.publisher, {
      type: String(event.type),
      contractId: event.contractId,
      intentId:
        typeof payload.intentId === "string" ? payload.intentId : linked?.intentId,
      merchant:
        typeof payload.merchant === "string" ? payload.merchant : linked?.merchant,
      state: typeof payload.state === "string" ? payload.state : linked?.state,
      observedAt: event.observedAt,
      dedupeKey:
        event.dedupeKey ??
        event.id ??
        `${event.contractId}:${event.type}:${event.observedAt}`,
      ...(linked?.monitoringContractId
        ? { monitoringContractId: linked.monitoringContractId }
        : {}),
    });
    return ok(event);
  }

  async applyObservations(
    contractId: string,
    facts: ObservationFacts,
    now: string,
    opts?: {
      readonly conflictedConcepts?: readonly string[];
      readonly awaitingEvidence?: boolean;
    },
  ): Promise<Result<{
    readonly contract: OutcomeContract;
    readonly verification: OutcomeVerification;
  }>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    const workflowId = outcomeWorkflowId(c);
    const started = Date.now();
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.OUTCOME_VERIFICATION,
      status: WorkflowStageEventStatus.STARTED,
    });

    const updatedReqs: OutcomeRequirement[] = c.requirements.map((req) => {
      if (opts?.conflictedConcepts?.includes(req.concept)) {
        return { ...req, state: OutcomeRequirementState.CONFLICTED };
      }
      return { ...req, state: evaluatePredicate(req, facts) };
    });

    if (!assertCriticalityLocked(c.requirements, updatedReqs)) {
      await recordStage(this.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.OUTCOME_VERIFICATION,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return err(
        ErrorCode.OUTCOME_MUTATION_FORBIDDEN,
        "Requirement criticality is locked to IntentState/contract creation",
      );
    }

    void opts?.awaitingEvidence;
    const agg = aggregateRequirementStates(updatedReqs);
    let target = agg.overallState;

    if (
      c.state === OutcomeContractState.AWAITING_OUTCOME &&
      target === OutcomeContractState.AWAITING_EVIDENCE
    ) {
      // ok
    }

    if (c.state !== target) {
      const gate = assertTransitionAllowed(c.state, target);
      if (!gate.ok) {
        await recordStage(this.stageRecorder, {
          workflowId,
          intentId: c.intentId,
          stage: WorkflowStage.OUTCOME_VERIFICATION,
          status: WorkflowStageEventStatus.FAILED,
          durationMs: Date.now() - started,
        });
        return gate;
      }
    }

    this.recordTransition(c.state, target, c.id, "observation_aggregate", now);
    const next: OutcomeContract = {
      ...c,
      requirements: updatedReqs,
      state: target,
      updatedAt: now,
    };
    const final = await this.put(next);

    if (target === OutcomeContractState.AT_RISK) {
      const signal: OutcomeRiskSignal = {
        contractId: c.id,
        basis: facts.deliveryEta
          ? `ETA ${facts.deliveryEta} after deadline ${facts.deadline}`
          : "at_risk",
        confidence: 0.9,
        horizon: facts.deadline,
        emittedAt: now,
      };
      this.riskSignals.push(signal);
      await this.publishTriggerEvent(final, "OUTCOME_AT_RISK", now, { ...signal });
    }

    await this.emitPhase9Triggers(final, now);

    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.OUTCOME_VERIFICATION,
      status: WorkflowStageEventStatus.COMPLETED,
      durationMs: Date.now() - started,
    });

    return ok({
      contract: final,
      verification: {
        contractId: c.id,
        requirementResults: updatedReqs,
        overallState: target,
        criticalFailure: agg.criticalFailure,
        verifiedAt: now,
      },
    });
  }

  private async publishTriggerEvent(
    contract: OutcomeContract,
    triggerKind: ResolutionTriggerKind,
    now: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Result<OutcomeEvent>> {
    const { triggerIdentity, conditionKey } = triggerIdentityForContract(
      contract,
      triggerKind,
    );
    const typeMap: Record<ResolutionTriggerKind, string> = {
      OUTCOME_PARTIAL: OutcomeEventType.OUTCOME_PARTIAL,
      OUTCOME_AT_RISK: OutcomeEventType.OUTCOME_AT_RISK,
      OUTCOME_BREACHED: OutcomeEventType.OUTCOME_BREACHED,
      EVIDENCE_CONFLICT: OutcomeEventType.EVIDENCE_CONFLICT,
    };
    return this.publishEvent({
      id: `ev-${triggerKind}-${contract.id}-${triggerIdentity.slice(0, 12)}`,
      contractId: contract.id,
      type: typeMap[triggerKind],
      observedAt: now,
      payload: {
        ...payload,
        state: contract.state,
        conditionKey,
        ...(contract.merchant ? { merchant: contract.merchant } : {}),
      },
      dedupeKey: `trigger:${triggerIdentity}`,
      triggerIdentity,
      conditionKey,
    });
  }

  private async emitPhase9Triggers(contract: OutcomeContract, now: string): Promise<void> {
    if (contract.state === OutcomeContractState.PARTIAL) {
      await this.publishTriggerEvent(contract, "OUTCOME_PARTIAL", now, {
        state: contract.state,
      });
    }
    if (contract.state === OutcomeContractState.BREACHED) {
      await this.publishTriggerEvent(contract, "OUTCOME_BREACHED", now, {
        state: contract.state,
      });
      logStructured("warn", {
        event: "tm.outcome.breach",
        service: "outcome-service",
        contractId: contract.id,
        workflowId: outcomeWorkflowId(contract),
        intentId: contract.intentId,
        state: contract.state,
      });
    }
    if (contract.state === OutcomeContractState.CONFLICTED) {
      await this.publishTriggerEvent(contract, "EVIDENCE_CONFLICT", now, {
        state: contract.state,
      });
    }
    // Analytics-only: SATISFIED is not a Resolution trigger, but the Wave 3.4
    // counterparty query expects OUTCOME_SATISFIED when known. Real state only.
    if (contract.state === OutcomeContractState.SATISFIED) {
      publishOutcomeAnalyticsEvent(this.publisher, {
        type: "OUTCOME_SATISFIED",
        contractId: contract.id,
        intentId: contract.intentId,
        merchant: contract.merchant,
        state: contract.state,
        observedAt: now,
        dedupeKey: `outcome-satisfied:${contract.id}`,
        ...(contract.monitoringContractId
          ? { monitoringContractId: contract.monitoringContractId }
          : {}),
      });
    }
  }

  /**
   * Owner-side close. Legal only from SATISFIED / RESOLVED / MONITORING /
   * BREACHED (see transitions) — the caller route additionally guards that a
   * SATISFIED contract has no open ResolutionCase. Terminal: never reopens.
   */
  async closeContract(contractId: string, now: string): Promise<Result<OutcomeContract>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    const workflowId = outcomeWorkflowId(c);
    const started = Date.now();
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.CLOSURE,
      status: WorkflowStageEventStatus.STARTED,
    });
    if (c.state === OutcomeContractState.CLOSED) {
      await recordStage(this.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.CLOSURE,
        status: WorkflowStageEventStatus.COMPLETED,
        durationMs: Date.now() - started,
      });
      return ok(c);
    }
    const gate = assertTransitionAllowed(c.state, OutcomeContractState.CLOSED);
    if (!gate.ok) {
      await recordStage(this.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.CLOSURE,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return gate;
    }
    this.recordTransition(c.state, OutcomeContractState.CLOSED, c.id, "contract_closed", now);
    const closed: OutcomeContract = { ...c, state: OutcomeContractState.CLOSED, updatedAt: now };
    const put = await this.put(closed);
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.CLOSURE,
      status: WorkflowStageEventStatus.COMPLETED,
      durationMs: Date.now() - started,
    });
    return ok(put);
  }

  listTransitions(contractId: string): readonly OutcomeStateTransition[] {
    return this.transitions.filter((t) => t.contractId === contractId);
  }

  listEvents(contractId: string): readonly OutcomeEvent[] {
    return this.events.filter((e) => e.contractId === contractId);
  }

  listRiskSignals(contractId: string): readonly OutcomeRiskSignal[] {
    return this.riskSignals.filter((r) => r.contractId === contractId);
  }

  async supersedeContract(
    contractId: string,
    nextIntentState: IntentState,
    now: string,
  ): Promise<Result<OutcomeContract>> {
    const loaded = await this.getContract(contractId);
    if (!loaded.ok) return loaded;
    const c = loaded.value;
    if (!c.executionBegunAt) {
      return err(
        ErrorCode.OUTCOME_MUTATION_FORBIDDEN,
        "Supersede after execution begins; recreate before commit otherwise",
      );
    }
    return this.createContractFromIntent({
      id: `${contractId}-v${(c.version ?? 1) + 1}`,
      intentState: nextIntentState,
      principalId: String(c.principalId ?? "principal"),
      merchant: String(
        c.requirements.find((r) => r.concept === "supplier_approved")?.value ??
          "merchant",
      ),
      quantity: Number(
        c.requirements.find((r) => r.concept === "quantity_received")?.value ?? 0,
      ),
      budgetMax: Number(
        c.requirements.find((r) => r.concept === "price_within")?.value ?? 0,
      ),
      createdAt: now,
    });
  }
}
