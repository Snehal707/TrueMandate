import { randomUUID } from "node:crypto";
import {
  DEFAULT_RESOLUTION_BOUNDS,
  accusationAloneCannotEstablish,
  assertResolutionTransition,
  assertWithinBounds,
  buildCausalTimeline,
  buildResolutionCase,
  describeFirstDivergence,
  isTerminalResolutionState,
  proposeProcurementRemedies,
  rankEvidenceCandidates,
  toEvidenceRequest,
  type ResolutionBounds,
} from "@truemandate/resolution-core";
import type { OutcomeService } from "@truemandate/outcome-service";
import {
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import { logStructured } from "@truemandate/observability/structured-log";
import type { PubSubPublisherPort } from "@truemandate/cloud-pubsub";
import {
  ErrorCode,
  OutcomeContractState,
  ResolutionCaseState,
  ResolutionEventType,
  ResponsibilityState,
  RootCauseCode,
  WorkflowStage,
  WorkflowStageEventStatus,
  asOutcomeContractId,
  err,
  ok,
  type CausalTimelineEvent,
  type EvidenceRequest,
  type IntentState,
  type OutcomeContract,
  type OutcomeEvent,
  type RemediationMandate,
  type RemedyProposal,
  type ResolutionCase,
  type ResolutionEvent,
  type ResponsibilityHypothesis,
  type Result,
} from "@truemandate/protocol";
import {
  assertIndependentRemedyAuthority,
  assertRemediationMandateValid,
  issueRemediationMandate,
  markMandateConsumed,
} from "@truemandate/authority";
import { publishRemedyCompletedEvent } from "./analytics-events.js";

const TRIGGER_TYPES = new Set([
  "OUTCOME_PARTIAL",
  "OUTCOME_AT_RISK",
  "OUTCOME_BREACHED",
  "EVIDENCE_CONFLICT",
]);

/**
 * Fail-open stage timing. Telemetry must never throw into resolution/remedy.
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

/**
 * ResolutionCase has no workflowId field. Derive from the linked
 * OutcomeContract.preExecutionBinding.workflowId, falling back to contractId.
 */
function resolutionWorkflowId(contract: OutcomeContract): string {
  return contract.preExecutionBinding?.workflowId ?? String(contract.id);
}

export class ResolutionService {
  private readonly cases = new Map<string, ResolutionCase>();
  private readonly byTrigger = new Map<string, string>();
  private readonly events: ResolutionEvent[] = [];
  private readonly seenEventDedupe = new Set<string>();
  private readonly timelines = new Map<string, CausalTimelineEvent[]>();
  private readonly hypotheses = new Map<string, ResponsibilityHypothesis[]>();
  private readonly evidenceRequests = new Map<string, EvidenceRequest[]>();
  private readonly remedies = new Map<string, RemedyProposal[]>();
  private readonly mandates = new Map<string, RemediationMandate>();
  private readonly counters = new Map<
    string,
    {
      remedyAttempts: number;
      economicExposure: number;
      evidenceRequests: number;
    }
  >();

  constructor(
    private readonly outcomes: OutcomeService,
    private readonly bounds: ResolutionBounds = DEFAULT_RESOLUTION_BOUNDS,
    private readonly durable?: {
      readonly cases?: {
        put(id: string, value: unknown): Promise<void>;
        get(id: string): Promise<unknown | undefined>;
        putIfAbsent(id: string, value: unknown): Promise<boolean>;
      };
      readonly triggers?: {
        putIfAbsent(
          id: string,
          value: { seenAt: string; caseId?: string },
        ): Promise<boolean>;
        get(id: string): Promise<{ seenAt: string; caseId?: string } | undefined>;
      };
      readonly mandates?: {
        put(id: string, value: unknown): Promise<void>;
        get(id: string): Promise<unknown | undefined>;
      };
      /** Append-only resolution event log (history/audit; never mutated). */
      readonly events?: {
        putIfAbsent(id: string, value: unknown): Promise<boolean>;
        get(id: string): Promise<unknown | undefined>;
      };
      /** Single-slot mandate execution claims (ACTIVE → CLAIMED → …). */
      readonly mandateClaims?: {
        putIfAbsent(id: string, value: unknown): Promise<boolean>;
        get(id: string): Promise<unknown | undefined>;
        put(id: string, value: unknown): Promise<void>;
      };
    },
    private readonly context?: {
      getIntentState(id: string): Promise<IntentState | undefined>;
      /** Wave 2: optional fail-open workflow stage recorder. */
      readonly stageRecorder?: WorkflowStageRecorder;
      /** Wave 3.5: fail-open governance analytics publisher. */
      readonly publisher?: PubSubPublisherPort;
    },
  ) {
    this.outcomes.bus.subscribe("*", (ev) => {
      void this.onOutcomeEvent(ev);
    });
  }

  private readonly evidenceRequestsByCase = new Map<string, EvidenceRequest[]>();

  getEvidenceRequests(caseId: string): readonly EvidenceRequest[] {
    return this.evidenceRequestsByCase.get(String(caseId)) ?? [];
  }

  /**
   * Owner-side trigger lifecycle: a PARTIAL/BREACHED trigger opens the
   * durable ResolutionCase (idempotent by trigger identity) and plans the
   * canonical discriminating evidence requests. Responsibility stays UNKNOWN
   * until discriminating evidence proves otherwise — the owner never blames
   * from the trigger alone.
   */
  private async onOutcomeEvent(ev: OutcomeEvent): Promise<void> {
    if (!TRIGGER_TYPES.has(String(ev.type))) return;
    if (!ev.triggerIdentity) return;
    const contract = await this.outcomes.getContract(String(ev.contractId));
    if (!contract.ok) return;
    const intentState = await this.context?.getIntentState(contract.value.intentStateId);
    if (!intentState) return;
    const opened = await this.openCaseFromTrigger({
      intentState,
      principalId: contract.value.principalId ?? "owner",
      contractId: contract.value.id,
      triggerEvent: ev,
      actionProposalId: contract.value.actionProposalId,
      preparedActionId: contract.value.preparedActionId,
      now: ev.observedAt,
    });
    if (!opened.ok) return;
    // Canonical shortfall discrimination candidates — evidence requests are
    // non-economic by construction (requiresAuthority: false).
    const requests = rankEvidenceCandidates([
      {
        evidenceSought: "supplier pickup weight/count",
        targetSource: "supplier-pickup-record",
        questionResolved: "was the full ordered quantity handed to the carrier at pickup?",
        hypothesesDistinguished: ["supplier short-shipped", "carrier lost units"],
        distinguishesHypotheses: true,
        independent: true,
        timely: true,
        trustworthy: 0.8,
        canChangeRemedy: true,
        requiresAuthority: false,
        urgency: "HIGH" as const,
      },
      {
        evidenceSought: "carrier acceptance count/weight",
        targetSource: "carrier-acceptance-record",
        questionResolved: "did the carrier accept the full ordered quantity?",
        hypothesesDistinguished: ["supplier short-shipped", "carrier lost units"],
        distinguishesHypotheses: true,
        independent: false,
        timely: true,
        trustworthy: 0.7,
        canChangeRemedy: true,
        requiresAuthority: false,
        urgency: "MEDIUM" as const,
      },
      {
        evidenceSought: "warehouse receiving record",
        targetSource: "warehouse-receiving-record",
        questionResolved: "what quantity was actually received at the destination?",
        hypothesesDistinguished: ["supplier short-shipped", "carrier lost units", "warehouse miscounted"],
        distinguishesHypotheses: true,
        independent: true,
        timely: true,
        trustworthy: 0.9,
        canChangeRemedy: true,
        requiresAuthority: false,
        urgency: "HIGH" as const,
      },
    ]).map((candidate, index) =>
      toEvidenceRequest(opened.value.id, candidate, ev.observedAt, `phase-c-request-${index + 1}`),
    );
    this.evidenceRequestsByCase.set(opened.value.id, [...requests]);
  }

  /**
   * Open or return existing case for a trigger identity (idempotent).
   */
  async openCaseFromTrigger(input: {
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly contractId: string;
    readonly triggerEvent: OutcomeEvent;
    readonly actionProposalId?: string;
    readonly preparedActionId?: string;
    readonly sideEffectExecutionId?: string;
    readonly provenanceRootId?: string;
    readonly firstDivergenceNodeId?: string;
    readonly parentCaseId?: string;
    readonly recursionDepth?: number;
    readonly now: string;
  }): Promise<Result<ResolutionCase>> {
    const started = Date.now();
    const identity = input.triggerEvent.triggerIdentity;
    if (!identity) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Trigger event missing triggerIdentity",
      );
    }
    // Assumption (Wave 2): ResolutionCase has no workflowId; use contractId as
    // a provisional correlation key until the contract is loaded below.
    let workflowId = String(input.contractId);
    await recordStage(this.context?.stageRecorder, {
      workflowId,
      intentId: input.intentState.intentId,
      stage: WorkflowStage.RESOLUTION,
      status: WorkflowStageEventStatus.STARTED,
    });

    const identityKey = String(identity);
    let existingId = this.byTrigger.get(identityKey);
    if (!existingId && this.durable?.triggers) {
      const seen = await this.durable.triggers.get(identityKey);
      if (seen && "caseId" in seen && typeof seen.caseId === "string") {
        existingId = seen.caseId;
        this.byTrigger.set(identityKey, seen.caseId);
      }
    }
    if (existingId) {
      let existing = this.cases.get(existingId);
      if (!existing && this.durable?.cases) {
        existing = (await this.durable.cases.get(existingId)) as
          | ResolutionCase
          | undefined;
        if (existing) this.cases.set(existingId, existing);
      }
      if (existing && !isTerminalResolutionState(existing.state)) {
        await recordStage(this.context?.stageRecorder, {
          workflowId,
          intentId: existing.intentId,
          stage: WorkflowStage.RESOLUTION,
          status: WorkflowStageEventStatus.COMPLETED,
          durationMs: Date.now() - started,
        });
        return ok(existing);
      }
      // Terminal — allow new case only for new identity; same identity stays idempotent
      if (existing) {
        await recordStage(this.context?.stageRecorder, {
          workflowId,
          intentId: existing.intentId,
          stage: WorkflowStage.RESOLUTION,
          status: WorkflowStageEventStatus.FAILED,
          durationMs: Date.now() - started,
        });
        return err(
          ErrorCode.RESOLUTION_TRIGGER_DUPLICATE,
          "Trigger identity already resolved/closed",
          { triggerIdentity: identity, caseId: existing.id },
        );
      }
    }

    const contract = await this.outcomes.getContract(input.contractId);
    if (!contract.ok) {
      await recordStage(this.context?.stageRecorder, {
        workflowId,
        intentId: input.intentState.intentId,
        stage: WorkflowStage.RESOLUTION,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return contract;
    }
    workflowId = resolutionWorkflowId(contract.value);

    if (input.parentCaseId) {
      const depth = input.recursionDepth ?? 0;
      const bound = assertWithinBounds(this.bounds, {
        remedyAttempts: 0,
        economicExposure: 0,
        recursionDepth: depth,
        evidenceRequests: 0,
      });
      if (!bound.ok) {
        await recordStage(this.context?.stageRecorder, {
          workflowId,
          intentId: input.intentState.intentId,
          stage: WorkflowStage.RESOLUTION,
          status: WorkflowStageEventStatus.FAILED,
          durationMs: Date.now() - started,
        });
        return this.escalateParent(input.parentCaseId, input.now, "recursion_limit");
      }
    }

    const built = buildResolutionCase({
      principalId: input.principalId,
      intentState: input.intentState,
      contract: contract.value,
      triggerEvent: input.triggerEvent,
      actionProposalId: input.actionProposalId,
      preparedActionId: input.preparedActionId,
      sideEffectExecutionId: input.sideEffectExecutionId,
      provenanceRootId: input.provenanceRootId,
      firstDivergenceNodeId: input.firstDivergenceNodeId,
      parentCaseId: input.parentCaseId,
      recursionDepth: input.recursionDepth ?? 0,
      now: input.now,
    });

    if (this.durable?.triggers) {
      const inserted = await this.durable.triggers.putIfAbsent(identityKey, {
        seenAt: input.now,
        caseId: built.id,
      });
      if (!inserted) {
        const seen = await this.durable.triggers.get(identityKey);
        const caseId =
          seen && "caseId" in seen && typeof seen.caseId === "string"
            ? seen.caseId
            : built.id;
        let raced = this.cases.get(caseId);
        if (!raced && this.durable.cases) {
          raced = (await this.durable.cases.get(caseId)) as
            | ResolutionCase
            | undefined;
        }
        if (raced && !isTerminalResolutionState(raced.state)) {
          this.cases.set(raced.id, raced);
          this.byTrigger.set(identityKey, raced.id);
          await recordStage(this.context?.stageRecorder, {
            workflowId,
            intentId: raced.intentId,
            stage: WorkflowStage.RESOLUTION,
            status: WorkflowStageEventStatus.COMPLETED,
            durationMs: Date.now() - started,
          });
          return ok(raced);
        }
        if (raced) {
          await recordStage(this.context?.stageRecorder, {
            workflowId,
            intentId: raced.intentId,
            stage: WorkflowStage.RESOLUTION,
            status: WorkflowStageEventStatus.FAILED,
            durationMs: Date.now() - started,
          });
          return err(
            ErrorCode.RESOLUTION_TRIGGER_DUPLICATE,
            "Trigger identity already resolved/closed",
            { triggerIdentity: identity, caseId: raced.id },
          );
        }
        // Trigger recorded, case not yet durable — continue to persist `built`.
      }
    }
    if (this.durable?.cases) {
      await this.durable.cases.put(built.id, built);
    }
    this.cases.set(built.id, built);
    this.byTrigger.set(identityKey, built.id);
    this.counters.set(built.id, {
      remedyAttempts: 0,
      economicExposure: 0,
      evidenceRequests: 0,
    });
    this.timelines.set(
      built.id,
      buildCausalTimeline({
        contract: contract.value,
        events: this.outcomes.listEvents(input.contractId),
        now: input.now,
      }),
    );
    this.hypotheses.set(built.id, [
      {
        id: `hyp-unknown-${built.id}`,
        assertedCause: RootCauseCode.UNKNOWN,
        supportingEvidenceIds: [],
        contradictoryEvidenceIds: [],
        missingEvidence: ["carrier_weight", "supplier_packing_record"],
        confidence: 0,
        status: ResponsibilityState.UNKNOWN,
        createdAt: input.now,
      },
    ]);
    this.appendEvent({
      id: `re-${built.id}-opened`,
      resolutionCaseId: built.id,
      type: ResolutionEventType.CASE_OPENED,
      at: input.now,
      payload: {
        triggerIdentity: identity,
        divergence: describeFirstDivergence(contract.value),
      },
      dedupeKey: `opened:${identity}`,
    });
    this.appendEvent({
      id: `re-${built.id}-div`,
      resolutionCaseId: built.id,
      type: ResolutionEventType.DIVERGENCE_IDENTIFIED,
      at: input.now,
      payload: describeFirstDivergence(contract.value),
      dedupeKey: `div:${built.id}`,
    });

    await recordStage(this.context?.stageRecorder, {
      workflowId,
      intentId: built.intentId,
      stage: WorkflowStage.RESOLUTION,
      status: WorkflowStageEventStatus.COMPLETED,
      durationMs: Date.now() - started,
    });
    logStructured("info", {
      event: "tm.resolution.case_opened",
      service: "resolution-service",
      caseId: built.id,
      contractId: input.contractId,
      workflowId,
      intentId: built.intentId,
      triggerIdentity: String(identity),
    });
    return ok(built);
  }

  private escalateParent(
    parentId: string,
    now: string,
    reason: string,
  ): Result<ResolutionCase> {
    return this.transition(parentId, ResolutionCaseState.ESCALATED, now, reason);
  }

  transition(
    caseId: string,
    to: ResolutionCaseState,
    now: string,
    reason: string,
  ): Result<ResolutionCase> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase", { caseId });
    }
    const gate = assertResolutionTransition(c.state, to);
    if (!gate.ok) return gate;
    const next: ResolutionCase = { ...c, state: to, updatedAt: now };
    this.cases.set(caseId, next);
    this.persistCaseState(caseId);
    if (to === ResolutionCaseState.ESCALATED) {
      this.appendEvent({
        id: `re-${caseId}-esc-${now}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.CASE_ESCALATED,
        at: now,
        payload: { reason },
        dedupeKey: `esc:${caseId}:${reason}`,
      });
    }
    if (to === ResolutionCaseState.RESOLVED) {
      this.appendEvent({
        id: `re-${caseId}-res-${now}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.CASE_RESOLVED,
        at: now,
        payload: { reason },
        dedupeKey: `resolved:${caseId}`,
      });
    }
    return ok(next);
  }

  getCaseByContract(contractId: string): Result<ResolutionCase> {
    const found = [...this.cases.values()].find((c) => c.contractId === contractId);
    if (found) return ok(found);
    return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase for contract", { contractId });
  }

  getCase(caseId: string): Result<ResolutionCase> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase", { caseId });
    }
    return ok(c);
  }

  listCasesForContract(contractId: string): readonly ResolutionCase[] {
    return [...this.cases.values()].filter((c) => c.contractId === contractId);
  }

  getTimeline(caseId: string): readonly CausalTimelineEvent[] {
    return this.timelines.get(caseId) ?? [];
  }

  getHypotheses(caseId: string): readonly ResponsibilityHypothesis[] {
    return this.hypotheses.get(caseId) ?? [];
  }

  /**
   * Model may propose hypotheses; ESTABLISHED requires independent multi-source policy.
   */
  proposeHypothesis(
    caseId: string,
    hypothesis: ResponsibilityHypothesis,
  ): Result<ResponsibilityHypothesis> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId });
    }
    if (
      hypothesis.status === ResponsibilityState.ESTABLISHED &&
      accusationAloneCannotEstablish(hypothesis.supportingEvidenceIds)
    ) {
      const downgraded: ResponsibilityHypothesis = {
        ...hypothesis,
        status: ResponsibilityState.POSSIBLE,
        confidence: Math.min(hypothesis.confidence, 0.4),
      };
      const list = this.hypotheses.get(caseId) ?? [];
      this.hypotheses.set(caseId, [...list, downgraded]);
      this.appendEvent({
        id: `re-${caseId}-hyp-${hypothesis.id}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.HYPOTHESIS_PROPOSED,
        at: hypothesis.createdAt,
        payload: { ...downgraded, downgraded: true },
        dedupeKey: `hyp:${hypothesis.id}`,
      });
      return ok(downgraded);
    }
    const list = this.hypotheses.get(caseId) ?? [];
    this.hypotheses.set(caseId, [...list, hypothesis]);
    this.appendEvent({
      id: `re-${caseId}-hyp-${hypothesis.id}`,
      resolutionCaseId: c.id,
      type: ResolutionEventType.HYPOTHESIS_PROPOSED,
      at: hypothesis.createdAt,
      payload: { ...hypothesis },
      dedupeKey: `hyp:${hypothesis.id}`,
    });
    return ok(hypothesis);
  }

  planEvidenceRequests(caseId: string, now: string): Result<readonly EvidenceRequest[]> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId });
    }
    const counters = this.counters.get(caseId)!;
    const candidates = rankEvidenceCandidates([
      {
        evidenceSought: "carrier pickup and delivery weight",
        targetSource: "carrier",
        questionResolved: "supplier underpack vs transit loss",
        hypothesesDistinguished: ["MERCHANT_FAILURE", "LOGISTICS_FAILURE"],
        distinguishesHypotheses: true,
        independent: true,
        timely: true,
        trustworthy: 0.8,
        canChangeRemedy: true,
        requiresAuthority: false,
        urgency: "HIGH",
      },
      {
        evidenceSought: "merchant packing photo copy",
        targetSource: "merchant",
        questionResolved: "repeat merchant claim",
        hypothesesDistinguished: ["MERCHANT_FAILURE"],
        distinguishesHypotheses: false,
        independent: false,
        timely: true,
        trustworthy: 0.3,
        canChangeRemedy: false,
        requiresAuthority: false,
        urgency: "LOW",
      },
    ]);
    const reqs = candidates.slice(0, 2).map((cand, i) => {
      counters.evidenceRequests += 1;
      return toEvidenceRequest(c.id, cand, now, `ereq-${caseId}-${i}`);
    });
    const bound = assertWithinBounds(this.bounds, {
      ...counters,
      recursionDepth: c.recursionDepth ?? 0,
    });
    if (!bound.ok) {
      this.transition(caseId, ResolutionCaseState.ESCALATED, now, "evidence_limit");
      return bound;
    }
    this.evidenceRequests.set(caseId, [
      ...(this.evidenceRequests.get(caseId) ?? []),
      ...reqs,
    ]);
    this.transition(caseId, ResolutionCaseState.GATHERING_EVIDENCE, now, "evidence_plan");
    for (const r of reqs) {
      this.appendEvent({
        id: `re-${r.id}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.EVIDENCE_REQUESTED,
        at: now,
        payload: { ...r },
        dedupeKey: `ereq:${r.id}`,
      });
    }
    return ok(reqs);
  }

  /**
   * Advance through a legal multi-step path when a single hop is not allowed.
   */
  private ensureState(
    caseId: string,
    target: ResolutionCaseState,
    now: string,
    reason: string,
  ): Result<ResolutionCase> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase", { caseId });
    }
    if (c.state === target) return ok(c);
    const direct = assertResolutionTransition(c.state, target);
    if (direct.ok) {
      return this.transition(caseId, target, now, reason);
    }
    // Common analysis path: OPEN → ANALYZING → REMEDY_PROPOSED
    if (
      c.state === ResolutionCaseState.OPEN &&
      target === ResolutionCaseState.REMEDY_PROPOSED
    ) {
      const mid = this.transition(
        caseId,
        ResolutionCaseState.ANALYZING,
        now,
        `${reason}:analyzing`,
      );
      if (!mid.ok) return mid;
      return this.transition(caseId, target, now, reason);
    }
    if (
      c.state === ResolutionCaseState.GATHERING_EVIDENCE &&
      target === ResolutionCaseState.REMEDY_PROPOSED
    ) {
      const mid = this.transition(
        caseId,
        ResolutionCaseState.ANALYZING,
        now,
        `${reason}:analyzing`,
      );
      if (!mid.ok) return mid;
      return this.transition(caseId, target, now, reason);
    }
    return err(
      ErrorCode.RESOLUTION_TRANSITION_INVALID,
      `Cannot advance ${c.state} → ${target}`,
      { from: c.state, to: target },
    );
  }

  async planRemedies(caseId: string, now: string): Promise<Result<readonly RemedyProposal[]>> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId });
    }
    const contract = await this.outcomes.getContract(c.contractId);
    if (!contract.ok) return contract;
    const remedies = proposeProcurementRemedies({
      contract: contract.value,
      caseId: c.id,
      now,
      altSupplierExtraCost: 6000,
      altSupplierBeforeDeadline: true,
    });
    this.remedies.set(caseId, [...remedies]);
    const advanced = this.ensureState(
      caseId,
      ResolutionCaseState.REMEDY_PROPOSED,
      now,
      "remedies",
    );
    if (!advanced.ok) return advanced;
    this.persistCaseState(caseId);
    for (const r of remedies) {
      this.appendEvent({
        id: `re-remedy-${r.id}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.REMEDY_PROPOSED,
        at: now,
        payload: { ...r },
        dedupeKey: `remedy:${r.id}`,
      });
    }
    return ok(remedies);
  }

  /**
   * Issue a RemediationMandate (scope prerequisite). Does not mint an execution grant.
   */
  async issueMandate(input: {
    readonly caseId: string;
    readonly remedy: RemedyProposal;
    readonly principalId: string;
    readonly maxAmount: number;
    readonly currency: string;
    readonly allowedCapabilities: readonly string[];
    readonly allowedMerchants: readonly string[];
    readonly expiresAt: string;
    readonly now: string;
  }): Promise<Result<{
    readonly mandate: RemediationMandate;
    readonly remedy: RemedyProposal;
    readonly case: ResolutionCase;
  }>> {
    const c = this.cases.get(input.caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", {
        caseId: input.caseId,
      });
    }
    const mandate = issueRemediationMandate({
      resolutionCaseId: c.id,
      remedyProposalId: input.remedy.id,
      principalId: input.principalId,
      maxAmount: input.maxAmount,
      currency: input.currency,
      allowedCapabilities: input.allowedCapabilities,
      allowedMerchants: input.allowedMerchants,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    });
    if (this.durable?.mandates) {
      await this.durable.mandates.put(mandate.id, mandate);
    }
    this.mandates.set(mandate.id, mandate);
    const remedy: RemedyProposal = {
      ...input.remedy,
      requiredRemediationMandateId: mandate.id,
    };
    const list = this.remedies.get(input.caseId) ?? [];
    this.remedies.set(
      input.caseId,
      list.map((r) => (r.id === remedy.id ? remedy : r)),
    );
    this.persistCaseState(input.caseId);
    this.appendEvent({
      id: `re-mandate-${mandate.id}`,
      resolutionCaseId: c.id,
      type: ResolutionEventType.MANDATE_ISSUED,
      at: input.now,
      payload: {
        mandateId: mandate.id,
        remedyId: remedy.id,
        note: "RemediationMandate is prerequisite only; Gateway mints execution grant",
      },
      dedupeKey: `mandate:${mandate.id}`,
    });
    logStructured("info", {
      event: "tm.remedy.mandate_issued",
      service: "resolution-service",
      mandateId: mandate.id,
      remedyId: remedy.id,
      caseId: input.caseId,
      maxAmount: input.maxAmount,
      currency: input.currency,
    });
    const awaiting = this.transition(
      input.caseId,
      ResolutionCaseState.AWAITING_AUTHORITY,
      input.now,
      "mandate_issued",
    );
    if (!awaiting.ok) {
      // Already AWAITING or legal same-state
      const cur = this.cases.get(input.caseId)!;
      return ok({ mandate, remedy, case: cur });
    }
    return ok({ mandate, remedy, case: awaiting.value });
  }

  async getMandate(mandateId: string): Promise<Result<RemediationMandate>> {
    const local = this.mandates.get(mandateId);
    if (local) return ok(local);
    if (!this.durable?.mandates) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown RemediationMandate", {
        mandateId,
      });
    }
    const row = await this.durable.mandates.get(mandateId);
    if (row === undefined) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown RemediationMandate", {
        mandateId,
      });
    }
    this.mandates.set(mandateId, row as RemediationMandate);
    return ok(row as RemediationMandate);
  }

  /**
   * Wave 3.6: derive the remedyType of the remedy actually bound to this
   * case's mandate (the one that was authorized and executed), never a
   * guess. Returns undefined when no mandate/remedy binding or taxonomy
   * value exists — the caller must not fabricate a value in that case.
   */
  private findRemedyTypeForCase(caseId: string): RemedyProposal["remedyType"] {
    const mandate = [...this.mandates.values()]
      .filter((m) => String(m.resolutionCaseId) === String(caseId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1);
    if (!mandate) return undefined;
    const remedy = (this.remedies.get(caseId) ?? []).find(
      (r) => String(r.id) === String(mandate.remedyProposalId),
    );
    return remedy?.remedyType;
  }

  /** The single remedy proposal a mandate was issued for. */
  getRemedy(caseId: string, remedyId: string): Result<RemedyProposal> {
    const list = this.remedies.get(caseId) ?? [];
    const remedy = list.find((r) => r.id === remedyId);
    if (!remedy) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown RemedyProposal", {
        caseId,
        remedyId,
      });
    }
    return ok(remedy);
  }

  /**
   * Bind a remedy to its issued mandate after the route has validated the
   * binding (mandate.resolutionCaseId === caseId, mandate.remedyProposalId
   * === remedyId). Server-derived — never caller-supplied. Durable so the
   * independent Authority evaluation observes the binding on restart too.
   */
  bindRemedyToMandate(caseId: string, remedyId: string, mandateId: string): Result<RemedyProposal> {
    const list = this.remedies.get(caseId) ?? [];
    const remedy = list.find((r) => r.id === remedyId);
    if (!remedy) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown RemedyProposal", {
        caseId,
        remedyId,
      });
    }
    if (remedy.requiredRemediationMandateId === mandateId) return ok(remedy);
    const bound: RemedyProposal = { ...remedy, requiredRemediationMandateId: mandateId as never };
    this.remedies.set(
      caseId,
      list.map((r) => (r.id === remedyId ? bound : r)),
    );
    this.persistCaseState(caseId);
    return ok(bound);
  }

  private readonly mandateClaims = new Map<string, {
    readonly idempotencyKey: string;
    readonly caseId: string;
    readonly remedyId: string;
    readonly claimedAt: string;
    readonly status: "CLAIMED" | "RELEASED";
    readonly releasedAt?: string;
  }>();

  /**
   * Single-slot claim for a mandate-bound execution. The claim slot is atomic
   * per mandate: only one execution attempt (identified by its deterministic
   * idempotency key) may hold it. A concurrent duplicate of the SAME attempt
   * continues (it converges on the same grant/token identities); a DIFFERENT
   * attempt while the slot is CLAIMED is rejected before any economic state
   * exists. Release happens only for FAILED/UNKNOWN executions; the consumed
   * mandate closes the lifecycle permanently.
   */
  async claimMandateForExecution(
    mandateId: string,
    claim: {
      readonly idempotencyKey: string;
      readonly caseId: string;
      readonly remedyId: string;
      readonly claimedAt: string;
    },
  ): Promise<Result<"CLAIMED" | "CONTINUATION">> {
    const matches = (existing: { idempotencyKey: string; caseId: string; remedyId: string }) =>
      existing.idempotencyKey === claim.idempotencyKey &&
      existing.caseId === claim.caseId &&
      existing.remedyId === claim.remedyId;
    const existing = this.mandateClaims.get(mandateId);
    if (existing) {
      if (existing.status === "CLAIMED" && !matches(existing)) {
        return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "RemediationMandate already claimed by a different execution", { mandateId });
      }
      if (existing.status === "CLAIMED" && matches(existing)) {
        return ok("CONTINUATION");
      }
      // RELEASED tombstone: only the identical attempt may re-claim
      // (reconciliation retry); a different attempt stays rejected.
      if (!matches(existing)) {
        return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "RemediationMandate released only for its own execution retry", { mandateId });
      }
    }
    if (this.durable?.mandateClaims) {
      const inserted = await this.durable.mandateClaims.putIfAbsent(mandateId, { ...claim, status: "CLAIMED" });
      if (!inserted) {
        const durableClaim = await this.durable.mandateClaims.get(mandateId);
        if (durableClaim && matches(durableClaim as { idempotencyKey: string; caseId: string; remedyId: string })) {
          this.mandateClaims.set(mandateId, { ...claim, status: "CLAIMED" });
          return ok("CONTINUATION");
        }
        return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "RemediationMandate already claimed", { mandateId });
      }
    }
    this.mandateClaims.set(mandateId, { ...claim, status: "CLAIMED" });
    return ok("CLAIMED");
  }

  /** FAILED/UNKNOWN only: release the claim back to its own attempt. */
  async releaseMandateClaim(mandateId: string, idempotencyKey: string, now: string): Promise<Result<void>> {
    const existing = this.mandateClaims.get(mandateId);
    if (!existing) return err(ErrorCode.VALIDATION_FAILED, "No claim held for mandate", { mandateId });
    if (existing.idempotencyKey !== idempotencyKey) {
      return err(ErrorCode.REMEDIATION_MANDATE_INVALID, "Claim is held by a different execution", { mandateId });
    }
    this.mandateClaims.set(mandateId, { ...existing, status: "RELEASED", releasedAt: now });
    if (this.durable?.mandateClaims) {
      await this.durable.mandateClaims.put(mandateId, { ...existing, status: "RELEASED", releasedAt: now });
    }
    return ok();
  }

  /**
   * Consumption happens ONLY after the bounded execution actually ran: the
   * mandate stays ACTIVE through the authority evaluation of the execution,
   * and becomes single-use once the remedy tool executed.
   */
  async consumeMandate(mandateId: string, now: string): Promise<Result<RemediationMandate>> {
    const current = this.mandates.get(mandateId);
    if (!current) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown RemediationMandate", {
        mandateId,
      });
    }
    const consumed = markMandateConsumed(current, now);
    if (this.durable?.mandates) {
      await this.durable.mandates.put(consumed.id, consumed);
    }
    this.mandates.set(consumed.id, consumed);
    this.appendEvent({
      id: `re-mcons-${consumed.id}`,
      resolutionCaseId: current.resolutionCaseId as never,
      type: ResolutionEventType.MANDATE_CONSUMED,
      at: now,
      payload: {
        mandateId: consumed.id,
        note: "Mandate consumed after execution; execution grant was minted independently",
      },
      dedupeKey: `mcons:${consumed.id}`,
    });
    return ok(consumed);
  }

  /**
   * Economic remedy requires validated RemediationMandate — never original purchase grant.
   * Mandate is NOT an execution AuthorityGrant.
   */
  requireRemedyAuthority(input: {
    readonly caseId: string;
    readonly remedy: RemedyProposal;
    readonly originalPaymentGrantId: string;
    readonly now: string;
    readonly proposedMerchant?: string;
    readonly proposedCapability?: string;
    readonly proposedAmount?: number;
  }): Result<ResolutionCase> {
    if (
      input.remedy.requiresFinancialAction &&
      !input.remedy.requiredRemediationMandateId
    ) {
      const awaiting = this.transition(
        input.caseId,
        ResolutionCaseState.AWAITING_AUTHORITY,
        input.now,
        "mandate_required",
      );
      if (awaiting.ok) {
        this.appendEvent({
          id: `re-auth-${input.caseId}-${input.now}`,
          resolutionCaseId: awaiting.value.id,
          type: ResolutionEventType.AUTHORITY_REQUESTED,
          at: input.now,
          payload: { remedyId: input.remedy.id },
          dedupeKey: `auth:${input.remedy.id}`,
        });
      }
      return awaiting;
    }

    const mandateId = input.remedy.requiredRemediationMandateId!;
    const mandate = this.mandates.get(String(mandateId));
    if (!mandate) {
      return err(ErrorCode.REMEDIATION_MANDATE_REQUIRED, "Unknown mandate", {
        mandateId,
      });
    }

    const indep = assertIndependentRemedyAuthority(
      input.remedy,
      input.originalPaymentGrantId as never,
      mandate,
    );
    if (!indep.ok) return indep;

    const scoped = assertRemediationMandateValid(mandate, {
      remedy: input.remedy,
      resolutionCaseId: input.caseId,
      now: input.now,
      originalPaymentGrantId: input.originalPaymentGrantId as never,
      proposedMerchant: input.proposedMerchant,
      proposedCapability: input.proposedCapability,
      proposedAmount: input.proposedAmount,
    });
    if (!scoped.ok) return scoped;

    // The mandate stays ACTIVE through the execution's own authority
    // evaluation; it is consumed only after the bounded execution ran
    // (consumeMandate). Consumption here would reject the independent
    // authority evaluation of the very execution it unlocks.

    return this.transition(
      input.caseId,
      ResolutionCaseState.REMEDIATING,
      input.now,
      "mandate_valid",
    );
  }

  /**
   * Tool SUCCESS on remedy does not resolve the case — needs remedy OutcomeContract verification.
   */
  observeRemedyToolSuccess(input: {
    readonly caseId: string;
    readonly remedyOutcomeContractId: string;
    readonly now: string;
  }): Result<ResolutionCase> {
    const c = this.cases.get(input.caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId: input.caseId });
    }
    const counters = this.counters.get(input.caseId)!;
    counters.remedyAttempts += 1;
    const bound = assertWithinBounds(this.bounds, {
      ...counters,
      recursionDepth: c.recursionDepth ?? 0,
    });
    if (!bound.ok) {
      return this.transition(input.caseId, ResolutionCaseState.ESCALATED, input.now, "bounds");
    }
    this.appendEvent({
      id: `re-rexec-${input.caseId}-${input.now}`,
      resolutionCaseId: c.id,
      type: ResolutionEventType.REMEDY_EXECUTED,
      at: input.now,
      payload: {
        remedyOutcomeContractId: input.remedyOutcomeContractId,
        note: "tool SUCCESS ≠ case RESOLVED",
      },
      dedupeKey: `rexec:${input.remedyOutcomeContractId}`,
    });
    return this.transition(
      input.caseId,
      ResolutionCaseState.VERIFYING_REMEDY,
      input.now,
      "await_remedy_outcome",
    );
  }

  /**
   * Resolve only after remedy OutcomeContract SATISFIED or explicit human variance.
   */
  resolveFromRemedyOutcome(input: {
    readonly caseId: string;
    readonly remedyContractState: string;
    readonly now: string;
    readonly humanAcceptedVariance?: boolean;
  }): Result<ResolutionCase> {
    const c = this.cases.get(input.caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId: input.caseId });
    }
    // Assumption (Wave 2): ResolutionCase has no workflowId; use contractId as proxy.
    const workflowId = String(c.contractId);
    const started = Date.now();
    void recordStage(this.context?.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.CLOSURE,
      status: WorkflowStageEventStatus.STARTED,
    });
    // Original OutcomeContract must remain immutable — we never rewrite it here
    if (input.humanAcceptedVariance) {
      this.appendEvent({
        id: `re-var-${input.caseId}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.VARIANCE_ACCEPTED,
        at: input.now,
        payload: { note: "original requirements preserved" },
        dedupeKey: `var:${input.caseId}`,
      });
      const closed = this.transition(input.caseId, ResolutionCaseState.RESOLVED, input.now, "variance");
      void recordStage(this.context?.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.CLOSURE,
        status: closed.ok ? WorkflowStageEventStatus.COMPLETED : WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return closed;
    }
    if (input.remedyContractState === OutcomeContractState.SATISFIED) {
      this.appendEvent({
        id: `re-rout-${input.caseId}`,
        resolutionCaseId: c.id,
        type: ResolutionEventType.REMEDY_OUTCOME_OBSERVED,
        at: input.now,
        payload: { state: input.remedyContractState },
        dedupeKey: `rout:${input.caseId}:satisfied`,
      });
      const closed = this.transition(input.caseId, ResolutionCaseState.RESOLVED, input.now, "restored");
      publishRemedyCompletedEvent(this.context?.publisher, {
        caseId: input.caseId,
        contractId: String(c.contractId),
        restored: true,
        remedyType: this.findRemedyTypeForCase(input.caseId),
        at: input.now,
      });
      void recordStage(this.context?.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.CLOSURE,
        status: closed.ok ? WorkflowStageEventStatus.COMPLETED : WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return closed;
    }
    if (input.remedyContractState === OutcomeContractState.BREACHED) {
      const depth = (c.recursionDepth ?? 0) + 1;
      const bound = assertWithinBounds(this.bounds, {
        remedyAttempts: this.counters.get(input.caseId)?.remedyAttempts ?? 0,
        economicExposure: this.counters.get(input.caseId)?.economicExposure ?? 0,
        recursionDepth: depth,
        evidenceRequests: this.counters.get(input.caseId)?.evidenceRequests ?? 0,
      });
      if (!bound.ok) {
        const escalated = this.transition(input.caseId, ResolutionCaseState.ESCALATED, input.now, "child_limit");
        void recordStage(this.context?.stageRecorder, {
          workflowId,
          intentId: c.intentId,
          stage: WorkflowStage.CLOSURE,
          status: WorkflowStageEventStatus.FAILED,
          durationMs: Date.now() - started,
        });
        return escalated;
      }
      // Parent stays unresolved; caller may open child case
      void recordStage(this.context?.stageRecorder, {
        workflowId,
        intentId: c.intentId,
        stage: WorkflowStage.CLOSURE,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - started,
      });
      return ok(c);
    }
    void recordStage(this.context?.stageRecorder, {
      workflowId,
      intentId: c.intentId,
      stage: WorkflowStage.CLOSURE,
      status: WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Cannot RESOLVE without verified restoration or accepted variance",
      { remedyContractState: input.remedyContractState },
    );
  }

  /** Resolution agent cannot mutate OutcomeContract — enforced here. */
  forbidContractMutation(): Result<void> {
    return err(
      ErrorCode.RESOLUTION_AGENT_MUTATION_FORBIDDEN,
      "ResolutionAgent cannot mutate OutcomeContract",
    );
  }

  async createRemedyOutcomeContractStub(input: {
    readonly caseId: string;
    readonly kind: "refund" | "replacement";
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly now: string;
  }): Promise<Result<{ readonly outcomeContractId: string; readonly definitionHash: string }>> {
    const c = this.cases.get(input.caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId: input.caseId });
    }
    const created = await this.outcomes.createContractFromIntent({
      id: `oc-remedy-${input.caseId}-${input.kind}`,
      intentState: input.intentState,
      principalId: input.principalId,
      merchant: "remedy-counterparty",
      quantity: input.kind === "replacement" ? 50 : 1,
      budgetMax: input.kind === "replacement" ? 6000 : 20000,
      createdAt: input.now,
    });
    if (!created.ok) return created;
    return ok({
      outcomeContractId: asOutcomeContractId(created.value.id),
      definitionHash: String(created.value.definitionHash ?? created.value.contractHash),
    });
  }

  listEvents(caseId: string): readonly ResolutionEvent[] {
    return this.events.filter((e) => e.resolutionCaseId === caseId);
  }

  listEvidenceRequests(caseId: string): readonly EvidenceRequest[] {
    return this.evidenceRequests.get(caseId) ?? [];
  }

  listRemedies(caseId: string): readonly RemedyProposal[] {
    return this.remedies.get(caseId) ?? [];
  }

  /**
   * Cumulative remediative exposure — separate from original purchase, still bounded.
   */
  recordRemediationSpend(
    caseId: string,
    amount: number,
    now: string,
  ): Result<ResolutionCase> {
    const c = this.cases.get(caseId);
    if (!c) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown case", { caseId });
    }
    const counters = this.counters.get(caseId)!;
    counters.economicExposure += amount;
    const bound = assertWithinBounds(this.bounds, {
      ...counters,
      recursionDepth: c.recursionDepth ?? 0,
    });
    if (!bound.ok) {
      return this.transition(caseId, ResolutionCaseState.ESCALATED, now, "exposure");
    }
    return ok(c);
  }

  getCounters(caseId: string): {
    readonly remedyAttempts: number;
    readonly economicExposure: number;
    readonly evidenceRequests: number;
  } | undefined {
    return this.counters.get(caseId);
  }

  /**
   * Failed remedy: open child case; parent stays unresolved; history immutable.
   */
  async openChildCaseAfterFailedRemedy(input: {
    readonly parentCaseId: string;
    readonly intentState: IntentState;
    readonly principalId: string;
    readonly triggerEvent: OutcomeEvent;
    readonly now: string;
  }): Promise<Result<ResolutionCase>> {
    const parent = this.cases.get(input.parentCaseId);
    if (!parent) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown parent case", {
        caseId: input.parentCaseId,
      });
    }
    const depth = (parent.recursionDepth ?? 0) + 1;
    const bound = assertWithinBounds(this.bounds, {
      remedyAttempts: this.counters.get(parent.id)?.remedyAttempts ?? 0,
      economicExposure: this.counters.get(parent.id)?.economicExposure ?? 0,
      recursionDepth: depth,
      evidenceRequests: this.counters.get(parent.id)?.evidenceRequests ?? 0,
    });
    if (!bound.ok) {
      return this.transition(
        input.parentCaseId,
        ResolutionCaseState.ESCALATED,
        input.now,
        "recursion_limit",
      );
    }
    // Distinct trigger identity for child (append depth) — avoid colliding with parent
    const childTrigger: OutcomeEvent = {
      ...input.triggerEvent,
      id: `${input.triggerEvent.id ?? parent.id}:child:${depth}`,
      triggerIdentity: `${String(input.triggerEvent.triggerIdentity)}:d${depth}`,
      conditionKey: `${input.triggerEvent.conditionKey ?? "child"}:d${depth}`,
      dedupeKey: `child:${parent.id}:${depth}`,
    };
    return this.openCaseFromTrigger({
      intentState: input.intentState,
      principalId: input.principalId,
      contractId: parent.contractId,
      triggerEvent: childTrigger,
      parentCaseId: parent.id,
      recursionDepth: depth,
      now: input.now,
    });
  }

  private readonly pendingEventWrites: Promise<void>[] = [];
  private readonly pendingCaseWrites: Promise<void>[] = [];

  /**
   * Persist the current in-memory case row with its planned remedies embedded.
   * The embedded remedies are the restart-safe source for the remedy
   * lifecycle: hydrated instances serve planned remedies without re-planning.
   */
  private persistCaseState(caseId: string): void {
    if (!this.durable?.cases) return;
    const c = this.cases.get(caseId);
    if (!c) return;
    const plannedRemedies = this.remedies.get(caseId);
    const row = {
      ...c,
      ...(plannedRemedies ? { plannedRemedies: [...plannedRemedies] } : {}),
    };
    this.pendingCaseWrites.push(
      this.durable.cases
        .put(caseId, row)
        .catch(() => undefined)
        .then(() => undefined),
    );
  }

  /** Await all durable case-state writes (restart-safe reads, checkpoints). */
  async flushCases(): Promise<void> {
    await Promise.all(this.pendingCaseWrites.splice(0));
  }

  /**
   * Restart-safe case read (Wave 1 durable reads): a deployed revision or
   * recycled instance must still serve the remedy lifecycle for cases opened
   * by earlier instances. Falls back to the durable case row and restores the
   * embedded planned remedies together with the case.
   */
  async hydrateCase(caseId: string): Promise<Result<ResolutionCase>> {
    const local = this.cases.get(caseId);
    if (local) return ok(local);
    if (!this.durable?.cases) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase", {
        caseId,
      });
    }
    const row = (await this.durable.cases.get(caseId)) as
      | (ResolutionCase & { plannedRemedies?: unknown })
      | undefined;
    if (!row) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown ResolutionCase", {
        caseId,
      });
    }
    const { plannedRemedies, ...c } = row;
    this.cases.set(c.id, c);
    if (Array.isArray(plannedRemedies) && plannedRemedies.length > 0) {
      this.remedies.set(c.id, plannedRemedies as RemedyProposal[]);
    }
    // Per-case in-instance counters must exist for the remedy lifecycle
    // (fresh instance, same semantics as openCaseFromTrigger).
    if (!this.counters.has(c.id)) {
      this.counters.set(c.id, {
        remedyAttempts: 0,
        economicExposure: 0,
        evidenceRequests: 0,
      });
    }
    return ok(c);
  }

  private appendEvent(event: ResolutionEvent): void {
    if (event.dedupeKey && this.seenEventDedupe.has(event.dedupeKey)) return;
    if (event.dedupeKey) this.seenEventDedupe.add(event.dedupeKey);
    this.events.push(event);
    // Append-only durability: events are persisted as they occur; the local
    // log remains the ordered reconstruction source of truth.
    if (this.durable?.events) {
      this.pendingEventWrites.push(
        this.durable.events
          .putIfAbsent(event.id, event)
          .catch(() => undefined)
          .then(() => undefined),
      );
    }
  }

  /** Await all durable event writes (reconstruction/acceptance checkpoints). */
  async flushEvents(): Promise<void> {
    await Promise.all(this.pendingEventWrites.splice(0));
  }

  /** The complete append-only event log across all cases, in append order. */
  listAllEvents(): readonly ResolutionEvent[] {
    return [...this.events];
  }
}
