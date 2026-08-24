import {
  assertNoUnresolvedReservation,
  assertPreparedActionIntegrity,
  assertPreparedActionNotExpired,
  assertPreparedActionUnmodified,
  isGrantExpired,
  assertStickyConstraintsPreserved,
  createPreparedAction,
  DEFAULT_MATERIAL_KEYS,
  InMemoryEconomicReservationStore,
  InMemoryPreparedActionStore,
  SnapshotExternalStateProvider,
  revalidateExternalState,
  validateCommit,
  type CriticalExternalState,
  type CriticalExternalStateProvider,
  type PreparedActionStore,
  InMemoryCommitTokenStore,
  type CommitTokenStore,
  type EconomicReservationStore,
} from "@truemandate/authority";
import {
  issueAndStoreCommitToken,
  type AuthorityService,
} from "@truemandate/authority-service";
import { randomUUID } from "node:crypto";
import {
  hashCanonical,
  InMemoryIdempotencyStore,
  InMemoryNonceStore,
  type IdempotencyStorePort,
  type NonceStore,
} from "@truemandate/crypto";
import { hashActionProposal } from "@truemandate/guardian-core";
import type { IntentService } from "@truemandate/intent-service";
import {
  AuthorityDecision,
  ErrorCode,
  ExecutionState,
  GrantConsumptionState,
  PreparedActionLifecycle,
  ProvenanceNodeKind,
  ReconciliationState,
  SemanticRelation,
  ToolPrivilegeClass,
  TrustClass,
  WorkflowStage,
  WorkflowStageEventStatus,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type ActionProposal,
  type AuthorityGrant,
  type CapabilityScope,
  type CommitToken,
  type Constraint,
  type GuardianVerdict,
  type HashDigest,
  type OutcomeContract,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { emptyTaint } from "@truemandate/provenance";
import {
  InMemorySideEffectLedger,
  type SideEffectLedger,
} from "@truemandate/side-effect-ledger";
import {
  ToolRegistry,
  defaultToolRegistry,
} from "@truemandate/tool-registry";
import type { OutcomeService } from "@truemandate/outcome-service";
import {
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import { logStructured } from "@truemandate/observability/structured-log";
import { MockPaymentAdapter, type MockAdapterMode } from "./mock-adapter.js";
import { assertAuthorityProvenanceComplete, reconstructExecutionAuthorityPath, type ProvenanceOwnerReadPort } from "./execution-provenance.js";

/**
 * Fail-open, best-effort stage timing emission. A telemetry write must
 * never throw into or delay PREPARE/AUTHORIZE/COMMIT.
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
    // Fail-open: stage timing telemetry must never affect the gateway.
  }
}

/** Port for validating OutcomeContract binding (production: OutcomeService). */
export interface OutcomeContractBindingPort {
  assertBinding(input: {
    readonly outcomeContractId?: string;
    readonly outcomeContractHash?: string;
  }): Promise<Result<OutcomeContract>>;
}

export interface TwoPhaseGatewayOptions {
  readonly intents: IntentService;
  readonly authority: AuthorityService;
  readonly provenance: ProvenanceService;
  /**
   * Authorize-time Authority-provenance completeness gate port. Missing in
   * production wiring fails closed: AUTHORIZE refuses to mint a CommitToken
   * without a reconstructable durable Authority provenance.
   */
  readonly provenanceOwner?: ProvenanceOwnerReadPort;
  /** Required for production T2/T3 — missing port fails closed. */
  readonly outcomeBinding: OutcomeContractBindingPort;
  readonly registry?: ToolRegistry;
  readonly ledger?: SideEffectLedger;
  readonly tokenStore?: CommitTokenStore;
  readonly nonceStore?: NonceStore;
  readonly idempotencyStore?: IdempotencyStorePort;
  readonly reservations?: EconomicReservationStore;
  readonly preparedActionStore?: PreparedActionStore;
  readonly externalStateProvider?: CriticalExternalStateProvider;
  /**
   * TEST-ONLY. Never part of production wiring.
   * When true, skips T2/T3 OutcomeContract binding (legacy Phase 3/7 harness).
   */
  readonly allowUnboundEconomicCommit?: boolean;
  /**
   * Wave 2 observability: optional stage-timing sink for PREPARE/AUTHORIZE/
   * COMMIT. Best-effort/fail-open — never awaited in a way that can fail or
   * delay two-phase execution (see `recordStage` above).
   */
  readonly stageRecorder?: WorkflowStageRecorder;
}

export interface PrepareInput {
  readonly action: ActionProposal;
  readonly verdict: GuardianVerdict;
  readonly principalId: string;
  readonly toolId: string;
  readonly agentCapabilities: CapabilityScope["capabilities"];
  readonly authorityScope?: CapabilityScope;
  readonly externalState: CriticalExternalState;
  readonly idempotencyKey: string;
  readonly planId?: string;
  readonly planVersion?: number;
  /** Owner-computed ACTION artifact hash for reference-only preparation.
   * Direct domain/test preparation falls back to the ActionProposal hash. */
  readonly actionContentHash?: HashDigest;
  readonly expiresAt: string;
  readonly createdAt?: string;
  readonly id?: string;
  /** Agent-claimed privilege — registry ignores elevation attempts. */
  readonly claimedPrivilegeClass?: string;
  readonly outcomeContractId?: string;
  readonly outcomeContractHash?: string;
  readonly evaluationRecordId?: string;
  readonly evaluationRecordHash?: string;
  readonly workflowId?: string;
  readonly workflowHash?: string;
  readonly evaluatedIntentStateVersion?: number;
}

export interface AuthorizeInput {
  readonly preparedActionId: string;
  readonly grantId: string;
  readonly expiresAt: string;
  readonly createdAt?: string;
  readonly commitTokenId?: string;
}

export interface CommitInput {
  readonly preparedAction: PreparedAction;
  readonly grantId: string;
  readonly commitToken: CommitToken;
  readonly agentId: string;
  readonly actionNodeId: string;
  readonly authorityNodeId: string;
  readonly now?: string;
  readonly adapterMode?: MockAdapterMode;
  readonly relatedGroupId?: string;
  readonly exposureThreshold?: number;
  /**
   * Additional ROOT cumulative-exposure scope: an execution scoped to its own
   * group (e.g. remedy spend) must ALSO reserve against the root
   * intent/policy group so related cumulative exposure can never be evaded.
   */
  readonly rootExposure?: {
    readonly relatedGroupId: string;
    readonly threshold: number;
  };
  readonly verdict?: GuardianVerdict;
  /** Sticky HARD/SAFETY_CRITICAL constraints from grant-era IntentState. */
  readonly grantEraConstraints?: readonly Constraint[];
  /** Ignored at commit — trusted CriticalExternalStateProvider refreshes state. */
  readonly externalState?: CriticalExternalState;
  /** Bound OutcomeContract id — must equal the persisted PreparedAction binding. */
  readonly outcomeContractId?: string;
  readonly outcomeContractHash?: string;
}

export interface ReconcileUnknownInput {
  readonly executionId?: string;
  readonly idempotencyKey?: string;
  readonly sideEffectOccurred: boolean;
  readonly now: string;
}

export interface CommitResult {
  readonly status: "SUCCESS" | "FAILED" | "UNKNOWN" | "IDEMPOTENT_REPLAY";
  readonly resultRef?: string;
  readonly grantId: string;
  readonly executionId?: string;
  readonly reconciliationRequired?: boolean;
}

/**
 * Two-phase Tool Gateway: PREPARE → AUTHORIZE → COMMIT.
 * Gemini never calls the adapter directly.
 * Production path always requires OutcomeContract binding for T2/T3.
 */
export class TwoPhaseGateway {
  private readonly adapter = new MockPaymentAdapter();
  private readonly intents: IntentService;
  private readonly authority: AuthorityService;
  private readonly provenance: ProvenanceService;
  private readonly registry: ToolRegistry;
  private readonly ledger: SideEffectLedger;
  private readonly tokenStore: CommitTokenStore;
  private readonly nonceStore: NonceStore;
  private readonly idempotencyStore: IdempotencyStorePort;
  private readonly reservations: EconomicReservationStore;
  private readonly provenanceOwner: ProvenanceOwnerReadPort | undefined;
  private readonly preparedActionStore: PreparedActionStore;
  private readonly externalStateProvider: CriticalExternalStateProvider;
  private readonly outcomeBinding: OutcomeContractBindingPort | undefined;
  private readonly outcomeService: OutcomeService | undefined;
  /** Production: false. Only set via createForUnboundLegacyTests. */
  private readonly allowUnboundEconomicCommit: boolean;
  private readonly stageRecorder: WorkflowStageRecorder | undefined;

  constructor(options: TwoPhaseGatewayOptions) {
    this.intents = options.intents;
    this.authority = options.authority;
    this.provenance = options.provenance;
    this.provenanceOwner = options.provenanceOwner;
    this.registry = options.registry ?? defaultToolRegistry();
    this.ledger = options.ledger ?? new InMemorySideEffectLedger();
    this.tokenStore = options.tokenStore ?? new InMemoryCommitTokenStore();
    this.nonceStore = options.nonceStore ?? new InMemoryNonceStore();
    this.idempotencyStore =
      options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.reservations =
      options.reservations ?? new InMemoryEconomicReservationStore();
    this.preparedActionStore =
      options.preparedActionStore ?? new InMemoryPreparedActionStore();
    this.externalStateProvider =
      options.externalStateProvider ?? new SnapshotExternalStateProvider();
    this.outcomeBinding = options.outcomeBinding;
    this.outcomeService =
      options.outcomeBinding &&
      "onPaymentSuccess" in options.outcomeBinding
        ? (options.outcomeBinding as OutcomeService)
        : undefined;
    this.allowUnboundEconomicCommit = options.allowUnboundEconomicCommit === true;
    this.stageRecorder = options.stageRecorder;
  }

  /**
   * TEST-ONLY factory for Phase 3/7 harnesses that predate OutcomeContract binding.
   * Not a production API — unbound T2/T3 is forbidden on the normal constructor path.
   */
  static createForUnboundLegacyTests(input: {
    readonly intents: IntentService;
    readonly authority: AuthorityService;
    readonly provenance: ProvenanceService;
    readonly registry?: ToolRegistry;
    readonly stageRecorder?: WorkflowStageRecorder;
  }): TwoPhaseGateway {
    return new TwoPhaseGateway({
      intents: input.intents,
      authority: input.authority,
      provenance: input.provenance,
      // The authority-provenance gate reads from the same in-memory service;
      // legacy harnesses must seed the binding records before AUTHORIZE.
      provenanceOwner: {
        getNode: async (id) => input.provenance.getNode(id),
        getEdge: async (id) => input.provenance.getEdge(id),
      },
      registry: input.registry,
      // Dummy port — never consulted when allowUnboundEconomicCommit is true
      outcomeBinding: {
        assertBinding: async () =>
          err(
            ErrorCode.OUTCOME_CONTRACT_REQUIRED,
            "Legacy unbound test gateway must not validate outcome binding",
          ),
      },
      allowUnboundEconomicCommit: true,
      stageRecorder: input.stageRecorder,
    });
  }

  private requiresOutcomeBinding(toolId: string | undefined): boolean {
    if (this.allowUnboundEconomicCommit) return false;
    if (!toolId) return true; // fail closed for unknown economic path
    const tool = this.registry.getTool(toolId);
    if (!tool.ok) return true;
    return (
      tool.value.privilegeClass === ToolPrivilegeClass.T2_ECONOMIC_WRITE ||
      tool.value.privilegeClass === ToolPrivilegeClass.T3_HIGH_CONSEQUENCE
    );
  }

  private async assertOutcomeBound(input: {
    readonly toolId?: string;
    readonly outcomeContractId?: string;
    readonly outcomeContractHash?: string;
  }): Promise<Result<void>> {
    if (!this.requiresOutcomeBinding(input.toolId)) return ok();
    if (!this.outcomeBinding) {
      return err(
        ErrorCode.OUTCOME_CONTRACT_REQUIRED,
        "OutcomeContract binding port missing — T2/T3 fail closed",
      );
    }
    const bound = await this.outcomeBinding.assertBinding({
      outcomeContractId: input.outcomeContractId,
      outcomeContractHash: input.outcomeContractHash,
    });
    if (!bound.ok) return bound;
    return ok();
  }

  getToolRegistry(): ToolRegistry {
    return this.registry;
  }

  getSideEffectLedger(): SideEffectLedger {
    return this.ledger;
  }

  getCommitTokenStore(): CommitTokenStore {
    return this.tokenStore;
  }

  getIdempotencyStore(): IdempotencyStorePort {
    return this.idempotencyStore;
  }

  getPreparedActionStore(): PreparedActionStore {
    return this.preparedActionStore;
  }

  getExternalStateProvider(): CriticalExternalStateProvider {
    return this.externalStateProvider;
  }

  getReservationStore(): EconomicReservationStore {
    return this.reservations;
  }

  listVisibleTools(capabilities: CapabilityScope["capabilities"]) {
    return this.registry.listVisibleTools(capabilities);
  }

  async prepare(input: PrepareInput): Promise<Result<PreparedAction>> {
    const started = Date.now();
    const workflowId = input.workflowId ?? input.action.id;
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: input.action.intentId,
      stage: WorkflowStage.PREPARE,
      status: WorkflowStageEventStatus.STARTED,
    });
    const result = await this.prepareInternal(input);
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: input.action.intentId,
      stage: WorkflowStage.PREPARE,
      status: result.ok
        ? WorkflowStageEventStatus.COMPLETED
        : WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return result;
  }

  private async prepareInternal(input: PrepareInput): Promise<Result<PreparedAction>> {
    const tool = this.registry.assertInvocable(
      input.toolId,
      input.agentCapabilities,
      input.claimedPrivilegeClass,
    );
    if (!tool.ok) return tool;

    if (this.registry.requiresPreparedAction(tool.value) && !input.verdict) {
      return err(
        ErrorCode.GUARDIAN_VERDICT_REQUIRED,
        "T2/T3 prepare requires GuardianVerdict",
      );
    }

    const tip = await this.intents.getCurrentIntentState(input.action.intentId);
    if (!tip.ok) return tip;
    if (tip.value.id !== input.action.intentStateId) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Action IntentState stale");
    }
    if (input.verdict.intentStateId !== tip.value.id) {
      return err(ErrorCode.GUARDIAN_VERDICT_STALE, "Verdict not on tip");
    }
    if (input.verdict.intentStateHash !== tip.value.stateHash) {
      return err(ErrorCode.GUARDIAN_VERDICT_STALE, "Verdict IntentState hash stale");
    }
    const actionHash = hashActionProposal(input.action);
    if (input.verdict.actionContentHash !== actionHash) {
      return err(
        ErrorCode.ACTION_PROPOSAL_MISMATCH,
        "Verdict not bound to this ActionProposal",
      );
    }
    if (
      input.verdict.criticalFailure ||
      input.verdict.decision === AuthorityDecision.BLOCK
    ) {
      return err(
        ErrorCode.SEMANTIC_GATE_BLOCKED,
        "Cannot prepare from guardian BLOCK/critical failure",
      );
    }

    const binding = await this.assertOutcomeBound({
      toolId: tool.value.toolId,
      outcomeContractId: input.outcomeContractId,
      outcomeContractHash: input.outcomeContractHash,
    });
    if (!binding.ok) return binding;

    const createdAt = input.createdAt ?? new Date().toISOString();
    const cert =
      input.externalState.certificationRef ??
      (typeof input.action.parameters.certificationRef === "string"
        ? input.action.parameters.certificationRef
        : undefined);

    const created = createPreparedAction({
      id: input.id ?? `prep-${actionHash.slice(0, 12)}`,
      actionId: input.action.id,
      intentId: input.action.intentId,
      intentStateId: tip.value.id,
      agentId: input.action.agentId,
      capability: tool.value.requiredCapability,
      authorityScope: input.authorityScope,
      parameters: {
        merchant: input.externalState.merchant ?? input.action.merchant,
        product: input.externalState.product ?? input.action.product,
        quantity: input.externalState.quantity ?? input.action.quantity,
        amount: input.externalState.amount ?? input.action.amount,
        currency: input.externalState.currency ?? input.action.currency,
        refundability:
          input.externalState.refundability ?? input.action.refundable,
        deliveryTerms:
          input.externalState.deliveryTerms ?? input.action.deliveryTerms,
        toolParameters: {
          ...input.action.parameters,
          certificationRef: cert,
          sku: input.externalState.sku,
          foodGradeEvidenceRef: cert,
        },
      },
      createdAt,
      intentStateHash: tip.value.stateHash,
      planId: (input.planId ?? input.action.planId) as PreparedAction["planId"],
      planVersion: input.planVersion,
      actionProposalId: input.action.id,
      actionContentHash: input.actionContentHash ?? actionHash,
      guardianVerdictId: input.verdict.id,
      guardianVerdictHash: input.verdict.verdictHash,
      principalId: input.principalId as PreparedAction["principalId"],
      toolId: tool.value.toolId,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      outcomeContractId: input.outcomeContractId,
      outcomeContractHash: input.outcomeContractHash as PreparedAction["outcomeContractHash"],
      evaluationRecordId: input.evaluationRecordId,
      evaluationRecordHash: input.evaluationRecordHash as PreparedAction["evaluationRecordHash"],
      workflowId: input.workflowId,
      workflowHash: input.workflowHash as PreparedAction["workflowHash"],
      evaluatedIntentStateVersion: input.evaluatedIntentStateVersion,
      externalStateSnapshot: {
        merchant: input.externalState.merchant ?? input.action.merchant,
        product: input.externalState.product ?? input.action.product,
        quantity: input.externalState.quantity ?? input.action.quantity,
        amount: input.externalState.amount ?? input.action.amount,
        currency: input.externalState.currency ?? input.action.currency,
        refundability:
          input.externalState.refundability ?? input.action.refundable,
        deliveryTerms:
          input.externalState.deliveryTerms ?? input.action.deliveryTerms,
        certificationRef: cert,
        counterparty: input.externalState.counterparty ?? input.action.merchant,
        sku: input.externalState.sku,
      },
    });
    if (!created.ok) return created;

    const persisted = await this.preparedActionStore.putIfAbsent({
      preparedAction: created.value,
      action: input.action,
      verdict: input.verdict,
      externalStateSnapshot: created.value.externalStateSnapshot ?? {},
      lifecycle: PreparedActionLifecycle.PREPARED,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    });
    if (!persisted.ok) return persisted;
    return ok(persisted.value.preparedAction);
  }

  async authorize(input: AuthorizeInput): Promise<Result<{
    readonly decision: AuthorityDecision;
    readonly grant?: AuthorityGrant;
    readonly commitToken?: CommitToken;
    readonly reasons: readonly string[];
  }>> {
    const started = Date.now();
    // AUTHORIZE's own input carries no workflowId/intentId; the durable
    // PreparedAction lookup that would resolve them is the internal method's
    // first read. Using preparedActionId as the stage-event workflowId keeps
    // this wrapper a single fail-open, non-blocking read of `result` only.
    const workflowId = input.preparedActionId;
    await recordStage(this.stageRecorder, {
      workflowId,
      stage: WorkflowStage.AUTHORIZE,
      status: WorkflowStageEventStatus.STARTED,
    });
    const result = await this.authorizeInternal(input);
    await recordStage(this.stageRecorder, {
      workflowId,
      stage: WorkflowStage.AUTHORIZE,
      status: result.ok
        ? WorkflowStageEventStatus.COMPLETED
        : WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return result;
  }

  private async authorizeInternal(input: AuthorizeInput): Promise<Result<{
    readonly decision: AuthorityDecision;
    readonly grant?: AuthorityGrant;
    readonly commitToken?: CommitToken;
    readonly reasons: readonly string[];
  }>> {
    const recordRead = await this.preparedActionStore.get(input.preparedActionId);
    if (!recordRead.ok) return recordRead;
    const record = recordRead.value;
    if (!record) {
      return err(ErrorCode.PREPARED_ACTION_REQUIRED, "Unknown preparedActionId", {
        preparedActionId: input.preparedActionId,
      });
    }
    const prepared = record.preparedAction;
    const integrity = assertPreparedActionIntegrity(prepared);
    if (!integrity.ok) return integrity;

    const unresolved = await assertNoUnresolvedReservation(
      this.reservations,
      prepared.preparedActionHash,
    );
    if (!unresolved.ok) return unresolved;

    const grantRead = await this.authority.getGrantStore().get(input.grantId);
    if (!grantRead.ok) return grantRead;
    const grant = grantRead.value;
    if (!grant) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown grant", {
        grantId: input.grantId,
      });
    }
    if (grant.preparedActionId !== prepared.id) {
      return err(
        ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
        "Grant is not bound to this PreparedAction",
      );
    }
    if (grant.preparedActionHash !== prepared.preparedActionHash) {
      return err(
        ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
        "Grant PreparedAction hash mismatch",
      );
    }
    if (isGrantExpired(grant, new Date().toISOString())) {
      return err(ErrorCode.GRANT_EXPIRED, "Grant expired before authorization");
    }
    if (
      grant.capability !== prepared.capability ||
      (prepared.authorityScope && hashCanonical(grant.scope) !== hashCanonical(prepared.authorityScope)) ||
      grant.merchant !== prepared.parameters.merchant ||
      grant.amount !== prepared.parameters.amount ||
      grant.currency !== prepared.parameters.currency
    ) {
      return err(
        ErrorCode.AUTHORITY_BLOCKED,
        "Grant bounds do not match the exact PreparedAction",
      );
    }
    if (grant.decision === AuthorityDecision.BLOCK) {
      return ok({
        decision: AuthorityDecision.BLOCK,
        reasons: ["grant decision is BLOCK"],
      });
    }
    if (grant.decision === AuthorityDecision.REQUIRE_APPROVAL) {
      return ok({
        decision: AuthorityDecision.REQUIRE_APPROVAL,
        reasons: ["grant is not executable"],
      });
    }

    // Authorize-time authority-provenance gate (v4 orphan repair): a durable
    // grant is not usable economic authority until its Authority provenance
    // (stable principal, grant-scoped Authority node, INTRODUCED_BY and
    // AUTHORIZES edges) is durably complete and reconstructable. Missing
    // port, missing records, or divergent records all fail closed. Skipped
    // only in the TEST-ONLY allowUnboundEconomicCommit lane (legacy Phase
    // 3/7 harnesses whose grants predate the production lineage) — never in
    // production wiring.
    if (!this.allowUnboundEconomicCommit) {
      if (!this.provenanceOwner) {
        return err(
          ErrorCode.PRIVILEGED_PATH_INCOMPLETE,
          "Authority provenance verification unavailable",
        );
      }
      // First authorization only: the durable provenance gate is mandatory
      // when the token is first issued. A replay of an already-authorized
      // prepared action converges on the existing CommitToken — the gate
      // passed at first issuance, and the grant's consumption state
      // legitimately progresses after COMMIT while the mint-time provenance
      // metadata stays canonical. Skipping the re-verification never widens
      // authority: the token store converges, nothing new is minted.
      if (record.lifecycle === PreparedActionLifecycle.PREPARED) {
        const authorityProvenance = await assertAuthorityProvenanceComplete({
          grant,
          preparedAction: prepared,
          provenance: this.provenanceOwner,
        });
        if (!authorityProvenance.ok) return authorityProvenance;
      }
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    // A caller may narrow a token lifetime, never extend either durable bound.
    const expiresAt = [input.expiresAt, grant.expiresAt, prepared.expiresAt]
      .filter((value): value is string => value !== undefined)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0]!;
    const token = await issueAndStoreCommitToken(this.tokenStore, {
      grant,
      preparedAction: prepared,
      expiresAt,
      createdAt,
      id: input.commitTokenId,
    });
    if (!token.ok) return token;

    logStructured("info", {
      event: "tm.commit_token.issued",
      service: "gateway-service",
      commitTokenId: token.value.id,
      preparedActionId: prepared.id,
      grantId: grant.id,
      workflowId: prepared.workflowId ?? prepared.id,
    });

    if (record.lifecycle === PreparedActionLifecycle.PREPARED) {
      const transitioned = await this.preparedActionStore.transition({
        id: prepared.id,
        from: PreparedActionLifecycle.PREPARED,
        to: PreparedActionLifecycle.AUTHORIZED,
        expectedVersion: record.version,
        patch: { grantId: grant.id, commitTokenId: token.value.id },
        now: createdAt,
      });
      if (!transitioned.ok) return transitioned;
    }

    return ok({
      decision: grant.decision,
      grant,
      commitToken: token.value,
      reasons: ["authority-owned grant verified"],
    });
  }

  async commit(input: CommitInput): Promise<Result<CommitResult>> {
    const started = Date.now();
    const workflowId = input.preparedAction.workflowId ?? input.preparedAction.id;
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: input.preparedAction.intentId,
      stage: WorkflowStage.COMMIT,
      status: WorkflowStageEventStatus.STARTED,
    });
    const result = await this.commitInternal(input);
    await recordStage(this.stageRecorder, {
      workflowId,
      intentId: input.preparedAction.intentId,
      stage: WorkflowStage.COMMIT,
      status: result.ok
        ? WorkflowStageEventStatus.COMPLETED
        : WorkflowStageEventStatus.FAILED,
      durationMs: Date.now() - started,
    });
    return result;
  }

  private async commitInternal(input: CommitInput): Promise<Result<CommitResult>> {
    const now = input.now ?? new Date().toISOString();
    const inputIntegrity = assertPreparedActionIntegrity(input.preparedAction);
    if (!inputIntegrity.ok) return inputIntegrity;

    const recordRead = await this.preparedActionStore.get(input.preparedAction.id);
    if (!recordRead.ok) return recordRead;
    const record = recordRead.value;
    if (!record) {
      return err(
        ErrorCode.PREPARED_ACTION_REQUIRED,
        "Unknown preparedActionId — durable session required",
        { preparedActionId: input.preparedAction.id },
      );
    }
    const prepared = record.preparedAction;
    const integrity = assertPreparedActionIntegrity(prepared);
    if (!integrity.ok) return integrity;
    if (input.preparedAction.preparedActionHash !== prepared.preparedActionHash) {
      return err(
        ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
        "Caller PreparedAction hash does not match durable prepared session",
      );
    }

    if (
      input.outcomeContractId !== undefined &&
      input.outcomeContractId !== prepared.outcomeContractId
    ) {
      return err(
        ErrorCode.OUTCOME_CONTRACT_STALE,
        "Commit OutcomeContract id must equal the persisted PreparedAction binding",
      );
    }
    if (
      input.outcomeContractHash !== undefined &&
      input.outcomeContractHash !== prepared.outcomeContractHash
    ) {
      return err(
        ErrorCode.OUTCOME_CONTRACT_STALE,
        "Commit OutcomeContract hash must equal the persisted PreparedAction binding",
      );
    }

    const idemKey = prepared.idempotencyKey;
    if (!idemKey) {
      return err(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, "PreparedAction missing idempotency key");
    }

    const keyResult = this.idempotencyStore.requireKey(String(idemKey));
    if (!keyResult.ok) return keyResult;

    const existing = await this.idempotencyStore.get(keyResult.value);
    if (existing?.state === ExecutionState.SUCCESS) {
      return ok({
        status: "IDEMPOTENT_REPLAY",
        resultRef: existing.resultRef,
        grantId: input.grantId,
      });
    }
    if (existing?.state === ExecutionState.UNKNOWN) {
      return err(
        ErrorCode.UNKNOWN_EXECUTION_CANNOT_RETRY,
        "UNKNOWN execution state cannot be blindly retried",
      );
    }

    const tip = await this.intents.getCurrentIntentState(prepared.intentId);
    if (!tip.ok) return tip;

    const binding = await this.assertOutcomeBound({
      toolId: prepared.toolId,
      outcomeContractId: prepared.outcomeContractId,
      outcomeContractHash: prepared.outcomeContractHash,
    });
    if (!binding.ok) return binding;

    const expiry = assertPreparedActionNotExpired(prepared, now);
    if (!expiry.ok) return expiry;

    const paramsUnmodified = assertPreparedActionUnmodified(
      prepared,
      prepared.parameters,
    );
    if (!paramsUnmodified.ok) return paramsUnmodified;

    const storedVerdict = record.verdict;
    if (
      prepared.guardianVerdictHash &&
      storedVerdict.verdictHash !== prepared.guardianVerdictHash
    ) {
      return err(ErrorCode.GUARDIAN_VERDICT_STALE, "GuardianVerdict changed after prepare");
    }
    if (storedVerdict.intentStateHash !== tip.value.stateHash) {
      return err(ErrorCode.GUARDIAN_VERDICT_STALE, "GuardianVerdict stale at commit");
    }
    if (storedVerdict.stale) {
      return err(ErrorCode.GUARDIAN_VERDICT_STALE, "GuardianVerdict marked stale");
    }
    if (input.verdict) {
      if (
        prepared.guardianVerdictHash &&
        input.verdict.verdictHash !== prepared.guardianVerdictHash
      ) {
        return err(ErrorCode.GUARDIAN_VERDICT_STALE, "GuardianVerdict changed after prepare");
      }
    }

    let materialKeys: readonly string[] = DEFAULT_MATERIAL_KEYS;
    if (prepared.toolId) {
      const tool = this.registry.getTool(prepared.toolId);
      if (!tool.ok) return tool;
      if (this.registry.requiresPreparedAction(tool.value) && !prepared.parameterHash) {
        return err(ErrorCode.PREPARED_ACTION_REQUIRED, "T2/T3 requires PreparedAction");
      }
      if (tool.value.revalidateExternalState) {
        materialKeys = [...new Set([...DEFAULT_MATERIAL_KEYS, ...tool.value.materialParameterKeys])];
      }
    }

    const refreshed = await this.externalStateProvider.refresh({
      preparedAction: prepared,
      materialKeys,
    });
    if (!refreshed.ok) return refreshed;
    const externalState = refreshed.value;
    if (materialKeys.length > 0) {
      const toctou = revalidateExternalState(prepared, externalState, materialKeys);
      if (!toctou.ok) return toctou;
    }

    const tokenRead = await this.tokenStore.get(input.commitToken.id);
    if (!tokenRead.ok) return tokenRead;
    const freshToken = tokenRead.value;
    if (!freshToken) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown CommitToken");
    }

    const gate = await validateCommit({
      now,
      currentIntentState: tip.value,
      preparedAction: prepared,
      grantId: input.grantId,
      grantStore: this.authority.getGrantStore(),
      commitToken: freshToken,
      externalState,
      materialKeys,
      idempotencyKey: String(idemKey),
      idempotencyStore: this.idempotencyStore,
      nonceStore: this.nonceStore,
    });
    if (!gate.ok) return gate;

    if (input.agentId !== prepared.agentId) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "wrong executing agent");
    }

    if (input.grantEraConstraints) {
      const tipConstraints = tip.value.constraints;
      const sticky = assertStickyConstraintsPreserved(
        input.grantEraConstraints,
        tipConstraints,
      );
      if (!sticky.ok) return sticky;
    }

    const grantRead = await this.authority.getGrantStore().get(input.grantId);
    if (!grantRead.ok) return grantRead;
    const grant = grantRead.value;
    if (!grant) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown grant");
    }
    if (input.agentId !== grant.agentId || prepared.agentId !== grant.agentId) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "agentId does not match grant");
    }
    if (grant.consumptionState === GrantConsumptionState.PENDING_RECONCILIATION) {
      return err(
        ErrorCode.RECONCILIATION_REQUIRED,
        "Grant locked pending UNKNOWN execution reconciliation",
        { grantId: grant.id },
      );
    }
    if (grant.capability !== prepared.capability) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "wrong capability");
    }
    if (
      prepared.parameters.currency &&
      grant.currency &&
      prepared.parameters.currency !== grant.currency
    ) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "currency mismatch");
    }
    if (
      prepared.parameters.amount !== undefined &&
      grant.amount !== undefined &&
      prepared.parameters.amount > grant.amount
    ) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "amount expansion");
    }
    if (
      grant.scope.allowedMerchants &&
      prepared.parameters.merchant &&
      !grant.scope.allowedMerchants.includes(prepared.parameters.merchant)
    ) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "merchant expansion");
    }

    // Durable privileged-path reconstruction (v5 repair). The adapter may be
    // invoked only when the full Principal → Intent → Authority → Action
    // provenance path is durably reconstructable from canonical records —
    // never from caller payloads or a process-local graph. This runs BEFORE
    // the exposure reservation so deterministic provenance failures leave
    // zero economic state (no reservation, no consumption, no adapter).
    if (!this.allowUnboundEconomicCommit) {
      if (!this.provenanceOwner) {
        return err(
          ErrorCode.PRIVILEGED_PATH_INCOMPLETE,
          "Authority provenance verification unavailable",
        );
      }
      const durablePath = await reconstructExecutionAuthorityPath({
        token: freshToken,
        preparedAction: prepared,
        grant,
        provenance: this.provenanceOwner,
      });
      if (!durablePath.ok) return durablePath;
    } else {
      const path = this.provenance.assertPrivilegedPath(input.actionNodeId);
      if (!path.ok) return path;
      const canAuth = this.provenance.assertCanCreateAuthority(input.authorityNodeId);
      if (!canAuth.ok) return canAuth;
    }

    const threshold =
      input.exposureThreshold ?? grant.scope.maxAmount ?? grant.amount;
    const relatedGroupId =
      input.relatedGroupId ??
      `${prepared.intentId}:${prepared.parameters.currency ?? "NA"}`;
    const exposureEntryId = `exp-inflight-${String(idemKey)}`;
    if (
      threshold !== undefined &&
      prepared.parameters.amount !== undefined &&
      prepared.parameters.currency
    ) {
      const reserved = await this.authority.getExposureLedger().reserveIfUnderThreshold({
        entry: {
          id: exposureEntryId,
          amount: prepared.parameters.amount,
          currency: prepared.parameters.currency,
          relatedGroupId,
          status: "IN_FLIGHT",
        },
        threshold,
        currency: prepared.parameters.currency,
        proposedAmount: prepared.parameters.amount,
        relatedGroupId,
      });
      if (!reserved.ok) return reserved;
    }

    // Root cumulative-exposure reservation (remedy executions): the
    // mandate-scoped group alone would let repeated remedies evade the root
    // intent/policy exposure limit. On root overflow the mandate-scoped entry
    // is released and nothing else is touched.
    const rootEntryId = `exp-inflight-root-${String(idemKey)}`;
    if (
      input.rootExposure &&
      prepared.parameters.amount !== undefined &&
      prepared.parameters.currency
    ) {
      const rootReserved = await this.authority
        .getExposureLedger()
        .reserveIfUnderThreshold({
          entry: {
            id: rootEntryId,
            amount: prepared.parameters.amount,
            currency: prepared.parameters.currency,
            relatedGroupId: input.rootExposure.relatedGroupId,
            status: "IN_FLIGHT",
          },
          threshold: input.rootExposure.threshold,
          currency: prepared.parameters.currency,
          proposedAmount: prepared.parameters.amount,
          relatedGroupId: input.rootExposure.relatedGroupId,
        });
      if (!rootReserved.ok) {
        await this.authority
          .getExposureLedger()
          .updateStatus(exposureEntryId, "RELEASED");
        return rootReserved;
      }
    }

    const tokenConsume = await this.tokenStore.consume(freshToken.id, now);
    if (!tokenConsume.ok) return tokenConsume;

    if (
      record.lifecycle === PreparedActionLifecycle.AUTHORIZED ||
      record.lifecycle === PreparedActionLifecycle.PREPARED
    ) {
      await this.preparedActionStore.transition({
        id: prepared.id,
        from: record.lifecycle,
        to: PreparedActionLifecycle.COMMITTING,
        expectedVersion: record.version,
        now,
      });
    }

    const adapterResult = this.adapter.invoke({
      preparedAction: prepared,
      idempotencyKey: String(idemKey),
      mode: input.adapterMode,
    });
    if (!adapterResult.ok) {
      await this.authority.getExposureLedger().updateStatus(exposureEntryId, "RELEASED");
      if (input.rootExposure) {
        await this.authority.getExposureLedger().updateStatus(rootEntryId, "RELEASED");
      }
      await this.idempotencyStore.complete(keyResult.value, ExecutionState.FAILED, now);
      await this.preparedActionStore.transition({
        id: prepared.id,
        from: PreparedActionLifecycle.COMMITTING,
        to: PreparedActionLifecycle.FAILED,
        expectedVersion: record.version + 1,
        now,
      });
      return adapterResult;
    }

    const executionId = `exec-${String(idemKey)}`;
    const authHash = prepared.preparedActionHash;

    if (adapterResult.value.state === ExecutionState.UNKNOWN) {
      if (this.outcomeService && prepared.outcomeContractId) {
        await this.outcomeService.onPaymentUnknown(String(prepared.outcomeContractId), now);
      }
      await this.idempotencyStore.markUnknown(
        keyResult.value,
        now,
        adapterResult.value.externalReference,
      );
      const locked = await this.authority
        .getGrantStore()
        .markPendingReconciliation(grant.id, now);
      if (!locked.ok) return locked;

      const reservation = await this.reservations.put({
        key: authHash,
        preparedActionHash: authHash,
        grantId: grant.id,
        exposureEntryId,
        amount: prepared.parameters.amount ?? 0,
        currency: prepared.parameters.currency ?? "",
        relatedGroupId,
        idempotencyKey: String(idemKey),
        executionId,
        createdAt: now,
      });
      if (!reservation.ok) return reservation;

      await this.ledger.append({
        executionId,
        preparedActionId: prepared.id,
        preparedActionHash: authHash,
        commitTokenId: freshToken.id,
        grantId: grant.id,
        toolId: prepared.toolId ?? "payment.execute",
        counterparty: prepared.parameters.merchant,
        amount: prepared.parameters.amount,
        currency: prepared.parameters.currency,
        idempotencyKey: String(idemKey),
        requestTimestamp: now,
        resultState: ExecutionState.UNKNOWN,
        externalReference: adapterResult.value.externalReference,
        reconciliationState: ReconciliationState.REQUIRED,
      });
      await this.recordExecutionProvenance(
        input.actionNodeId,
        executionId,
        now,
        "UNKNOWN",
      );
      await this.preparedActionStore.transition({
        id: prepared.id,
        from: PreparedActionLifecycle.COMMITTING,
        to: PreparedActionLifecycle.UNKNOWN,
        expectedVersion: record.version + 1,
        now,
      });
      logStructured("warn", {
        event: "tm.execution.result",
        service: "gateway-service",
        status: "UNKNOWN",
        preparedActionId: prepared.id,
        grantId: grant.id,
        executionId,
        workflowId: prepared.workflowId ?? prepared.id,
      });
      return ok({
        status: "UNKNOWN",
        grantId: grant.id,
        executionId,
        resultRef: adapterResult.value.externalReference,
        reconciliationRequired: true,
      });
    }

    if (adapterResult.value.state === ExecutionState.FAILED) {
      if (this.outcomeService && prepared.outcomeContractId) {
        await this.outcomeService.onPaymentFailed(String(prepared.outcomeContractId), now);
      }
      await this.authority.getExposureLedger().updateStatus(exposureEntryId, "RELEASED");
      if (input.rootExposure) {
        await this.authority.getExposureLedger().updateStatus(rootEntryId, "RELEASED");
      }
      await this.idempotencyStore.complete(keyResult.value, ExecutionState.FAILED, now);
      await this.ledger.append({
        executionId,
        preparedActionId: prepared.id,
        preparedActionHash: authHash,
        commitTokenId: freshToken.id,
        grantId: grant.id,
        toolId: prepared.toolId ?? "payment.execute",
        counterparty: prepared.parameters.merchant,
        amount: prepared.parameters.amount,
        currency: prepared.parameters.currency,
        idempotencyKey: String(idemKey),
        requestTimestamp: now,
        resultState: ExecutionState.FAILED,
        reconciliationState: ReconciliationState.NOT_REQUIRED,
      });
      await this.preparedActionStore.transition({
        id: prepared.id,
        from: PreparedActionLifecycle.COMMITTING,
        to: PreparedActionLifecycle.FAILED,
        expectedVersion: record.version + 1,
        now,
      });
      return ok({
        status: "FAILED",
        grantId: grant.id,
        executionId,
      });
    }

    const consumed = await this.authority.consumeGrant(grant.id, now);
    if (!consumed.ok) return consumed;

    if (
      prepared.parameters.amount !== undefined &&
      prepared.parameters.currency
    ) {
      const committedExposure = await this.authority
        .getExposureLedger()
        .updateStatus(exposureEntryId, "COMMITTED");
      if (!committedExposure.ok) return committedExposure;
      if (input.rootExposure) {
        const committedRoot = await this.authority
          .getExposureLedger()
          .updateStatus(rootEntryId, "COMMITTED");
        if (!committedRoot.ok) return committedRoot;
      }
    }

    const resultRef =
      adapterResult.value.externalReference ?? `mock-pay-${String(idemKey)}`;
    await this.idempotencyStore.complete(
      keyResult.value,
      ExecutionState.SUCCESS,
      now,
      resultRef,
    );

    await this.ledger.append({
      executionId,
      preparedActionId: prepared.id,
      preparedActionHash: prepared.preparedActionHash,
      commitTokenId: freshToken.id,
      grantId: grant.id,
      toolId: prepared.toolId ?? "payment.execute",
      counterparty: prepared.parameters.merchant,
      amount: prepared.parameters.amount,
      currency: prepared.parameters.currency,
      idempotencyKey: String(idemKey),
      requestTimestamp: now,
      resultState: ExecutionState.SUCCESS,
      externalReference: resultRef,
      reconciliationState: ReconciliationState.NOT_REQUIRED,
    });

    await this.recordExecutionProvenance(input.actionNodeId, executionId, now, "SUCCESS");

    await this.preparedActionStore.transition({
      id: prepared.id,
      from: PreparedActionLifecycle.COMMITTING,
      to: PreparedActionLifecycle.SUCCEEDED,
      expectedVersion: record.version + 1,
      now,
    });

    if (this.outcomeService && prepared.outcomeContractId) {
      await this.outcomeService.onPaymentSuccess(String(prepared.outcomeContractId), now);
    }

    logStructured("info", {
      event: "tm.execution.result",
      service: "gateway-service",
      status: "SUCCESS",
      preparedActionId: prepared.id,
      grantId: grant.id,
      executionId,
      workflowId: prepared.workflowId ?? prepared.id,
    });

    return ok({
      status: "SUCCESS",
      resultRef,
      grantId: grant.id,
      executionId,
    });
  }

  /**
   * Deterministic reconciliation for UNKNOWN executions (no agent).
   * sideEffectOccurred=false → release IN_FLIGHT exposure; grant remains non-issuable for that prepared hash.
   * sideEffectOccurred=true → convert IN_FLIGHT → COMMITTED; mark grant CONSUMED.
   */
  async reconcileUnknownExecution(input: ReconcileUnknownInput): Promise<Result<{
    readonly reservationKey: string;
    readonly sideEffectOccurred: boolean;
    readonly grantId: string;
  }>> {
    const unresolved = await this.reservations.listUnresolved();
    const open = unresolved.find((r) => {
      if (input.executionId && r.executionId === input.executionId) return true;
      if (input.idempotencyKey && r.idempotencyKey === input.idempotencyKey)
        return true;
      return false;
    });
    if (!open) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "No unresolved UNKNOWN reservation for reconciliation",
        {
          executionId: input.executionId,
          idempotencyKey: input.idempotencyKey,
        },
      );
    }

    const resolved = await this.reservations.resolve(
      open.key,
      input.sideEffectOccurred,
      input.now,
    );
    if (!resolved.ok) return resolved;

    const ledger = this.authority.getExposureLedger();
    if (input.sideEffectOccurred) {
      if (open.amount > 0 && open.currency) {
        const committed = await ledger.updateStatus(open.exposureEntryId, "COMMITTED");
        if (!committed.ok) return committed;
      }
      const consumed = await this.authority.consumeGrant(open.grantId, input.now);
      if (!consumed.ok) return consumed;
      const keyOk = this.idempotencyStore.requireKey(open.idempotencyKey);
      if (!keyOk.ok) return keyOk;
      await this.idempotencyStore.complete(
        keyOk.value,
        ExecutionState.SUCCESS,
        input.now,
        `reconciled-${open.executionId}`,
      );
    } else {
      if (open.amount > 0 && open.currency) {
        const released = await ledger.updateStatus(open.exposureEntryId, "RELEASED");
        if (!released.ok) return released;
      }
      const keyOk = this.idempotencyStore.requireKey(open.idempotencyKey);
      if (!keyOk.ok) return keyOk;
      await this.idempotencyStore.complete(keyOk.value, ExecutionState.FAILED, input.now);
    }

    return ok({
      reservationKey: open.key,
      sideEffectOccurred: input.sideEffectOccurred,
      grantId: open.grantId,
    });
  }

  private async recordExecutionProvenance(
    actionNodeId: string,
    executionId: string,
    now: string,
    label: string,
  ): Promise<void> {
    const execNode = asProvenanceNodeId(`execution-${executionId}`);
    if (!(await this.provenance.getNode(execNode)).ok) {
      await this.provenance.recordNode({
        id: execNode,
        kind: ProvenanceNodeKind.EXECUTION,
        label: `execution:${label}`,
        createdAt: now,
        trustClass: TrustClass.TRUSTED_SYSTEM,
        taint: emptyTaint(),
        metadata: { executionId, recommendationOnly: false },
      });
    }
    const sideNode = asProvenanceNodeId(`side-effect-${executionId}`);
    if (!(await this.provenance.getNode(sideNode)).ok) {
      await this.provenance.recordNode({
        id: sideNode,
        kind: ProvenanceNodeKind.SIDE_EFFECT,
        label: "side-effect",
        createdAt: now,
        trustClass: TrustClass.TRUSTED_SYSTEM,
        taint: emptyTaint(),
      });
    }
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId(`e-${actionNodeId}-${execNode}`),
      from: asProvenanceNodeId(actionNodeId),
      to: execNode,
      relation: SemanticRelation.RESULTED_IN,
      createdAt: now,
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId(`e-${execNode}-${sideNode}`),
      from: execNode,
      to: sideNode,
      relation: SemanticRelation.RESULTED_IN,
      createdAt: now,
    });
  }
}
