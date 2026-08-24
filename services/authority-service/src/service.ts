import {
  createPreparedAction,
  assertPreparedActionIntegrity,
  InMemoryExposureLedger,
  InMemoryGrantStore,
  isCapabilityScopeSubset,
  loadAndValidateGrantForExecution,
  assertStickyConstraintsPreserved,
  type ExposureLedger,
  type GrantStore,
} from "@truemandate/authority";
import { generateNonce, hashCanonical } from "@truemandate/crypto";
import type { IntentService } from "@truemandate/intent-service";
import { logStructured } from "@truemandate/observability/structured-log";
import {
  NoopPubSubPublisherPort,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";
import {
  AuthorityDecision,
  ApprovalRequestStatus,
  ErrorCode,
  GrantConsumptionState,
  asAuthorityGrantId,
  asAuthorityRequestId,
  err,
  ok,
  type ApprovalRequest,
  type AuthorityGrant,
  type CapabilityScope,
  type Constraint,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import type { AuthorityEvaluationRecord } from "@truemandate/authority";
import {
  AuthorityGrantSchema,
  AuthorityRequestSchema,
  CapabilityScopeSchema,
  PreparedActionSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { z } from "zod";
import { publishAuthorityDecisionEvent } from "./analytics-events.js";
const ValidateDelegationRequestSchema = z
  .object({
    parentScope: CapabilityScopeSchema,
    childScope: CapabilityScopeSchema,
    parentConstraints: z.array(z.unknown()).optional(),
    childConstraints: z.array(z.unknown()).optional(),
  })
  .strict();

const CreateGrantRequestSchema = z
  .object({
    request: AuthorityRequestSchema,
    preparedAction: PreparedActionSchema,
    decision: z.enum([
      "ALLOW",
      "ALLOW_WITH_MONITORING",
      "REQUIRE_APPROVAL",
      "BLOCK",
    ]),
    expiresAt: z.string().min(1),
    id: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();

const PrepareActionRequestSchema = z
  .object({
    id: z.string().min(1).optional(),
    actionId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
    agentId: z.string().min(1),
    capability: z.string().min(1),
    parameters: z
      .object({
        merchant: z.string().optional(),
        product: z.string().optional(),
        quantity: z.number().optional(),
        amount: z.number().optional(),
        currency: z.string().optional(),
        refundability: z.boolean().optional(),
        deliveryTerms: z.string().optional(),
        toolParameters: z.record(z.unknown()),
      })
      .strict(),
    createdAt: z.string().min(1).optional(),
    bundleId: z.string().optional(),
  })
  .strict();

export class AuthorityService {
  constructor(
    private readonly intents: IntentService,
    private readonly grants: GrantStore = new InMemoryGrantStore(),
    private readonly exposure: ExposureLedger = new InMemoryExposureLedger(),
    /** Wave 3.5: fail-open governance analytics publisher (default noop). */
    private readonly publisher: PubSubPublisherPort = new NoopPubSubPublisherPort(),
    /**
     * Wave 4.3: optional MonitoringContract choke-point for future privileged
     * mints on a workflow that already has an escalated/frozen contract.
     */
    private readonly monitoring?: {
      assertPrivilegedActionAllowed(
        workflowId: string,
      ): Promise<Result<{ readonly requiresApproval: boolean }>>;
    },
  ) {}

  getGrantStore(): GrantStore {
    return this.grants;
  }

  getExposureLedger(): ExposureLedger {
    return this.exposure;
  }

  getIntentService(): IntentService {
    return this.intents;
  }

  validateDelegation(raw: unknown): Result<void> {
    const parsed = parseWithSchema(
      ValidateDelegationRequestSchema,
      raw,
      "ValidateDelegationRequest",
    );
    if (!parsed.ok) return parsed;

    const subset = isCapabilityScopeSubset(
      parsed.value.childScope as CapabilityScope,
      parsed.value.parentScope as CapabilityScope,
    );
    if (!subset.ok) return subset;

    if (parsed.value.parentConstraints && parsed.value.childConstraints) {
      return assertStickyConstraintsPreserved(
        parsed.value.parentConstraints as Constraint[],
        parsed.value.childConstraints as Constraint[],
      );
    }
    return ok();
  }

  async evaluateAuthorityRequest(raw: unknown): Promise<Result<{
    readonly decision: AuthorityDecision;
    readonly reasons: readonly string[];
  }>> {
    const parsed = parseWithSchema(AuthorityRequestSchema, raw, "AuthorityRequest");
    if (!parsed.ok) return parsed;
    const request = parsed.value;

    const tip = await this.intents.getCurrentIntentState(request.intentId);
    if (!tip.ok) return tip;
    if (tip.value.id !== request.intentStateId) {
      return err(
        ErrorCode.GRANT_INTENT_STATE_MISMATCH,
        "Authority request IntentState is stale relative to tip",
      );
    }

    const decide = (
      decision: AuthorityDecision,
      reasons: readonly string[],
    ): Result<{ decision: AuthorityDecision; reasons: readonly string[] }> => {
      logStructured("info", {
        event: "tm.authority.decision",
        service: "authority-service",
        decision,
        intentId: request.intentId,
        capability: request.capability,
        reasons,
      });
      publishAuthorityDecisionEvent(this.publisher, {
        decision,
        intentId: request.intentId,
        capability: String(request.capability),
        agentId: request.agentId,
        reasons,
        requestId: request.id,
      });
      return ok({ decision, reasons });
    };

    const scope = request.scope as CapabilityScope;
    const cap = scope.capabilities[request.capability];
    if (cap === AuthorityDecision.BLOCK || cap === undefined) {
      return decide(AuthorityDecision.BLOCK, ["capability blocked or absent in scope"]);
    }

    if (
      request.amount !== undefined &&
      scope.maxAmount !== undefined &&
      request.amount > scope.maxAmount
    ) {
      return decide(AuthorityDecision.BLOCK, ["amount exceeds scope.maxAmount"]);
    }

    if (
      request.merchant &&
      scope.allowedMerchants &&
      !scope.allowedMerchants.includes(request.merchant)
    ) {
      return decide(AuthorityDecision.BLOCK, ["merchant not in allowedMerchants"]);
    }

    if (request.amount !== undefined && request.currency) {
      const exposure = await this.exposure.evaluate({
        threshold: scope.maxAmount ?? Number.POSITIVE_INFINITY,
        currency: request.currency,
        proposedAmount: request.amount,
        relatedGroupId: `${request.intentId}:${request.currency}`,
      });
      if (!exposure.ok) {
        return decide(AuthorityDecision.BLOCK, ["cumulative exposure exceeded"]);
      }
    }

    if (cap === AuthorityDecision.REQUIRE_APPROVAL) {
      return decide(AuthorityDecision.REQUIRE_APPROVAL, ["capability requires approval"]);
    }

    return decide(
      cap === AuthorityDecision.ALLOW_WITH_MONITORING
        ? AuthorityDecision.ALLOW_WITH_MONITORING
        : AuthorityDecision.ALLOW,
      ["deterministic scope checks passed"],
    );
  }

  async createPreparedAction(raw: unknown): Promise<Result<PreparedAction>> {
    const parsed = parseWithSchema(
      PrepareActionRequestSchema,
      raw,
      "PrepareActionRequest",
    );
    if (!parsed.ok) return parsed;
    const tip = await this.intents.getCurrentIntentState(parsed.value.intentId);
    if (!tip.ok) return tip;
    if (tip.value.id !== parsed.value.intentStateId) {
      return err(
        ErrorCode.GRANT_INTENT_STATE_MISMATCH,
        "PreparedAction IntentState is stale",
      );
    }
    return createPreparedAction({
      id: parsed.value.id ?? `prep-${hashCanonical(parsed.value).slice(0, 12)}`,
      actionId: parsed.value.actionId as PreparedAction["actionId"],
      intentId: parsed.value.intentId as PreparedAction["intentId"],
      intentStateId: parsed.value.intentStateId as PreparedAction["intentStateId"],
      agentId: parsed.value.agentId as PreparedAction["agentId"],
      capability: parsed.value.capability,
      parameters: parsed.value.parameters,
      createdAt: parsed.value.createdAt ?? new Date().toISOString(),
      bundleId: parsed.value.bundleId,
    });
  }

  async createGrant(raw: unknown): Promise<Result<AuthorityGrant>> {
    const parsed = parseWithSchema(CreateGrantRequestSchema, raw, "CreateGrantRequest");
    if (!parsed.ok) return parsed;

    if (
      parsed.value.decision === AuthorityDecision.BLOCK ||
      parsed.value.decision === AuthorityDecision.REQUIRE_APPROVAL
    ) {
      return err(
        ErrorCode.AUTHORITY_BLOCKED,
        "Cannot issue executable grant for BLOCK/REQUIRE_APPROVAL decision",
      );
    }

    const request = parsed.value.request;
    const prepared = parsed.value.preparedAction as PreparedAction;
    const tip = await this.intents.getCurrentIntentState(request.intentId);
    if (!tip.ok) return tip;
    if (tip.value.id !== request.intentStateId || tip.value.id !== prepared.intentStateId) {
      return err(
        ErrorCode.GRANT_INTENT_STATE_MISMATCH,
        "Grant IntentState must match current tip and PreparedAction",
      );
    }

    const createdAt = parsed.value.createdAt ?? new Date().toISOString();
    const grant: AuthorityGrant = {
      id: asAuthorityGrantId(parsed.value.id ?? `grant-${hashCanonical(request.id).slice(0, 12)}`),
      requestId: asAuthorityRequestId(request.id),
      principalId: request.principalId as AuthorityGrant["principalId"],
      agentId: request.agentId as AuthorityGrant["agentId"],
      intentId: request.intentId as AuthorityGrant["intentId"],
      intentStateId: tip.value.id,
      actionId: prepared.actionId,
      preparedActionId: prepared.id,
      capability: request.capability,
      merchant: request.merchant,
      amount: request.amount,
      currency: request.currency,
      scope: request.scope as CapabilityScope,
      decision: parsed.value.decision as AuthorityGrant["decision"],
      expiresAt: parsed.value.expiresAt,
      nonce: generateNonce(),
      stateHash: tip.value.stateHash,
      preparedActionHash: prepared.preparedActionHash,
      consumptionState: GrantConsumptionState.ACTIVE,
      createdAt,
      transferable: false,
    };

    const validated = parseWithSchema(AuthorityGrantSchema, grant, "AuthorityGrant");
    if (!validated.ok) return validated;

    return this.grants.put(grant);
  }

  /** Trusted post-PREPARE primitive. It is intentionally not a raw HTTP DTO:
   * callers must have resolved the owner records before calling it. */
  async mintGrantFromEvaluation(input: {
    readonly evaluation: AuthorityEvaluationRecord;
    readonly preparedAction: PreparedAction;
    readonly outcomeContract: { readonly id: string; readonly definitionHash: string; readonly preExecutionBinding?: { readonly workflowId: string; readonly actionId: string; readonly actionHash: string; readonly evaluationId: string; readonly evaluationHash: string; readonly evaluatedIntentStateId: string; readonly evaluatedIntentStateHash: string; readonly evaluatedIntentStateVersion: number } };
    readonly idempotencyKey: string;
    /** Validated APPROVED approval that unlocks a REQUIRE_APPROVAL evaluation. */
    readonly approval?: ApprovalRequest;
  }): Promise<Result<AuthorityGrant>> {
    const { evaluation, preparedAction: prepared, outcomeContract } = input;

    // Approval gate: a REQUIRE_APPROVAL evaluation becomes executable ONLY
    // with a valid APPROVED ApprovalRequest bound to this exact evaluation,
    // scope and IntentState hash. Approval never widens anything.
    const approvalBindingValid =
      input.approval !== undefined &&
      input.approval.status === ApprovalRequestStatus.APPROVED &&
      input.approval.authorityEvaluationId === evaluation.id &&
      input.approval.workflowId === evaluation.workflowId &&
      input.approval.intentStateHash === evaluation.evaluatedIntentState.hash &&
      input.approval.requestedCapability === evaluation.capability &&
      input.approval.requestedScope.amount === (evaluation.amount ?? 0) &&
      input.approval.requestedScope.merchant === (evaluation.merchant ?? "") &&
      input.approval.requestedScope.currency === (evaluation.currency ?? "");

    const approvalUnlocks =
      approvalBindingValid &&
      evaluation.decision === AuthorityDecision.REQUIRE_APPROVAL &&
      evaluation.materializationReason === "PENDING_APPROVAL";

    // Wave 4.3: ALLOW_WITH_MONITORING is immediately executable (same as ALLOW).
    // Monitoring escalation gates FUTURE mints via the monitoring port below —
    // it never blocks the initial ALLOW_WITH_MONITORING materialization.
    const immediatelyExecutable =
      (evaluation.decision === AuthorityDecision.ALLOW ||
        evaluation.decision === AuthorityDecision.ALLOW_WITH_MONITORING) &&
      evaluation.materializationEligible;

    // Forward-looking MonitoringContract gate (remedy / subsequent mints).
    if (this.monitoring) {
      const gate = await this.monitoring.assertPrivilegedActionAllowed(
        evaluation.workflowId,
      );
      if (!gate.ok) return gate;
      if (gate.value.requiresApproval && !approvalBindingValid) {
        return err(
          ErrorCode.MONITORING_ESCALATION_REQUIRES_APPROVAL,
          "MonitoringContract escalated — subsequent privileged mint requires approval",
          { workflowId: evaluation.workflowId },
        );
      }
    }

    const executable = approvalUnlocks || immediatelyExecutable;
    if (!executable || !evaluation.expiresAt || Date.parse(evaluation.expiresAt) <= Date.now()) return err(ErrorCode.AUTHORITY_BLOCKED, "EvaluationRecord is not executable");
    const preparedIntegrity = assertPreparedActionIntegrity(prepared);
    if (!preparedIntegrity.ok) return preparedIntegrity;
    if (prepared.evaluationRecordId !== evaluation.id || prepared.evaluationRecordHash !== evaluation.recordHash || prepared.outcomeContractId !== outcomeContract.id || prepared.outcomeContractHash !== outcomeContract.definitionHash || prepared.workflowId !== evaluation.workflowId || prepared.actionProposalId !== evaluation.action.id || prepared.actionContentHash !== evaluation.action.hash || prepared.intentStateId !== evaluation.evaluatedIntentState.id || prepared.intentStateHash !== evaluation.evaluatedIntentState.hash || prepared.evaluatedIntentStateVersion !== evaluation.evaluatedIntentState.version) return err(ErrorCode.VALIDATION_FAILED, "PreparedAction lineage mismatch");
    if (outcomeContract.preExecutionBinding?.evaluationId !== evaluation.id || outcomeContract.preExecutionBinding.evaluationHash !== evaluation.recordHash || outcomeContract.preExecutionBinding.workflowId !== evaluation.workflowId || outcomeContract.preExecutionBinding.actionId !== evaluation.action.id || outcomeContract.preExecutionBinding.actionHash !== evaluation.action.hash || outcomeContract.preExecutionBinding.evaluatedIntentStateId !== evaluation.evaluatedIntentState.id || outcomeContract.preExecutionBinding.evaluatedIntentStateHash !== evaluation.evaluatedIntentState.hash || outcomeContract.preExecutionBinding.evaluatedIntentStateVersion !== evaluation.evaluatedIntentState.version) return err(ErrorCode.VALIDATION_FAILED, "OutcomeContract lineage mismatch");
    if (prepared.parameters.amount !== evaluation.amount || prepared.parameters.currency !== evaluation.currency || prepared.parameters.merchant !== evaluation.merchant || !prepared.authorityScope || hashCanonical(prepared.authorityScope) !== hashCanonical(evaluation.scope) || (prepared.expiresAt && Date.parse(prepared.expiresAt) > Date.parse(evaluation.expiresAt))) return err(ErrorCode.VALIDATION_FAILED, "PreparedAction exceeds evaluated bounds");
    const tip = await this.intents.getCurrentIntentState(prepared.intentId);
    if (!tip.ok || tip.value.id !== evaluation.evaluatedIntentState.id || tip.value.stateHash !== evaluation.evaluatedIntentState.hash) return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Evaluation IntentState is stale");
    const grant: AuthorityGrant = { id: asAuthorityGrantId(`grant-${hashCanonical({ evaluation: evaluation.id, prepared: prepared.preparedActionHash, idempotencyKey: input.idempotencyKey }).slice(0, 16)}`), requestId: asAuthorityRequestId(`evaluation-${evaluation.id}`), principalId: prepared.principalId!, agentId: prepared.agentId, intentId: prepared.intentId, intentStateId: prepared.intentStateId, actionId: prepared.actionId, preparedActionId: prepared.id, capability: prepared.capability, merchant: prepared.parameters.merchant, amount: prepared.parameters.amount, currency: prepared.parameters.currency, scope: evaluation.scope, decision: AuthorityDecision.ALLOW, expiresAt: evaluation.expiresAt, nonce: generateNonce(), stateHash: evaluation.evaluatedIntentState.hash as AuthorityGrant["stateHash"], preparedActionHash: prepared.preparedActionHash, consumptionState: GrantConsumptionState.ACTIVE, createdAt: evaluation.createdAt, transferable: false, evaluationRecordId: evaluation.id, evaluationRecordHash: evaluation.recordHash as AuthorityGrant["evaluationRecordHash"], outcomeContractId: outcomeContract.id, outcomeContractHash: outcomeContract.definitionHash as AuthorityGrant["outcomeContractHash"], workflowId: evaluation.workflowId, actionContentHash: evaluation.action.hash as AuthorityGrant["actionContentHash"], evaluatedIntentStateVersion: evaluation.evaluatedIntentState.version };
    const validated = parseWithSchema(AuthorityGrantSchema, grant, "PreparedActionBoundGrant");
    if (!validated.ok) return validated;
    return this.grants.put(grant);
  }

  async revokeGrant(grantId: string, now?: string): Promise<Result<AuthorityGrant>> {
    return this.grants.revoke(grantId, now ?? new Date().toISOString());
  }

  async consumeGrant(grantId: string, now?: string): Promise<Result<AuthorityGrant>> {
    return this.grants.consume(grantId, now ?? new Date().toISOString());
  }

  async checkCumulativeExposure(input: {
    readonly threshold: number;
    readonly currency: string;
    readonly proposedAmount: number;
    readonly relatedGroupId: string;
  }): Promise<Result<{ readonly projected: number }>> {
    return this.exposure.evaluate(input);
  }

  async recordExposure(entry: Parameters<ExposureLedger["add"]>[0]): Promise<Result<unknown>> {
    return this.exposure.add(entry);
  }

  async validateExecution(raw: unknown): Promise<Result<AuthorityGrant>> {
    const schema = z
      .object({
        grantId: z.string().min(1),
        agentId: z.string().min(1),
        intentStateId: z.string().min(1),
        preparedAction: PreparedActionSchema,
        now: z.string().min(1).optional(),
      })
      .strict();
    const parsed = parseWithSchema(schema, raw, "ValidateExecutionRequest");
    if (!parsed.ok) return parsed;

    const tip = await this.intents.getIntentState(parsed.value.intentStateId);
    if (!tip.ok) return tip;
    const currentTip = await this.intents.getCurrentIntentState(tip.value.intentId);
    if (!currentTip.ok) return currentTip;
    if (currentTip.value.id !== tip.value.id) {
      return err(
        ErrorCode.GRANT_INTENT_STATE_MISMATCH,
        "Execution IntentState is not the current tip",
      );
    }

    const prepared = parsed.value.preparedAction as PreparedAction;
    const grantResult = await loadAndValidateGrantForExecution(
      this.grants,
      parsed.value.grantId,
      {
        now: parsed.value.now ?? new Date().toISOString(),
        currentIntentState: currentTip.value,
        preparedAction: prepared,
      },
    );
    if (!grantResult.ok) return grantResult;

    if (grantResult.value.agentId !== parsed.value.agentId) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "Agent identity mismatch", {
        expected: grantResult.value.agentId,
        actual: parsed.value.agentId,
      });
    }

    return ok(grantResult.value);
  }
}
