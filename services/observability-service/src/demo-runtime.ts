import { createApprovalArtifact, createPreparedAction } from "@truemandate/authority";
import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { ProvenanceService } from "@truemandate/provenance-service";
import { ResolutionService } from "@truemandate/resolution-service";
import { emptyTaint } from "@truemandate/provenance";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ExecutionState,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  MeaningClass,
  OutcomeRequirementState,
  PROTOCOL_VERSION,
  ProvenanceNodeKind,
  ReconciliationState,
  SemanticRelation,
  SourceType,
  TrustClass,
  asActionId,
  asAgentId,
  asAuthorityGrantId,
  asCommitTokenId,
  asConstraintId,
  asHashDigest,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  type ApprovalArtifact,
  type ApprovalDecision,
  type GuardianVerdict,
  type Intent,
  type IntentState,
  type OutcomeContract,
  type PreparedAction,
  type ResolutionCase,
  type SideEffectRecord,
} from "@truemandate/protocol";
import {
  InProcessObservabilityBus,
  assembleWorkspace,
  mergeTimeline,
  projectAuthority,
  projectExecution,
  projectGuardian,
  projectIntentSummary,
  projectOutcome,
  projectProvenanceGraph,
  projectResolution,
  projectSemanticState,
  type GraphFilter,
  type IntentWorkspaceView,
  type ObservabilityEventPort,
} from "@truemandate/read-model";

const NOW = "2026-06-04T12:00:00.000Z";

type SeededAuthorityInput = Parameters<typeof projectAuthority>[0];

/**
 * In-process demo runtime. Frontend commands go through this — never mint grants directly.
 */
export class DemoRuntime {
  private readonly intents = new IntentService();
  private readonly outcomes = new OutcomeService();
  private readonly provenance = new ProvenanceService();
  private readonly resolution = new ResolutionService(this.outcomes);
  private readonly events: ObservabilityEventPort = new InProcessObservabilityBus();
  private tipState: IntentState | undefined;
  private intent: Intent | undefined;
  private contractIds: string[] = [];
  private pendingApproval: ApprovalArtifact | undefined;
  private pendingPrepared: PreparedAction | undefined;

  private seededGuardian: GuardianVerdict | null = null;
  private seededAuthority: SeededAuthorityInput | undefined;
  private seededPrepared: PreparedAction | undefined;
  private seededSideEffects: SideEffectRecord[] = [];
  private firstDivergence: string | undefined;

  getEventPort(): ObservabilityEventPort {
    return this.events;
  }

  async getCanonicalOutcome(intentId: string): Promise<OutcomeContract | undefined> {
    for (const c of this.contractIds) {
      const got = await this.outcomes.getContract(c);
      if (got.ok && got.value.intentId === intentId) {
        return got.value;
      }
    }
    return undefined;
  }

  async getCanonicalResolutionCase(intentId: string): Promise<ResolutionCase | undefined> {
    const contract = await this.getCanonicalOutcome(intentId);
    if (!contract) return undefined;
    return this.resolution.listCasesForContract(contract.id)[0];
  }

  async seedProcurementPartial(): Promise<{ readonly intentId: string }> {
    this.resetSeededCanonical();
    const intent = await this.intents.createIntent({
      id: "intent-demo-proc",
      principalId: "principal-1",
      rawText:
        "Buy 500 food-grade containers from an approved supplier for under INR 800000",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    this.intent = intent.value;
    const foodStart = intent.value.rawText.indexOf("food-grade");
    const state = await this.intents.createIntentState({
      id: "state-demo-proc",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-food"),
          concept: "food_grade",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.SAFETY_CRITICAL,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          sourceText: "food-grade",
          sourceSpan: {
            start: foodStart,
            end: foodStart + "food-grade".length,
          },
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error(state.message);
    this.tipState = state.value;

    const p = asProvenanceNodeId("node-principal");
    const i = asProvenanceNodeId("node-intent");
    const a = asProvenanceNodeId("node-action");
    const auth = asProvenanceNodeId("node-auth");
    const se = asProvenanceNodeId("node-side-effect");
    await this.provenance.recordNode({
      id: p,
      kind: ProvenanceNodeKind.PRINCIPAL,
      label: "principal-1",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_HUMAN,
      taint: emptyTaint(),
    });
    await this.provenance.recordNode({
      id: i,
      kind: ProvenanceNodeKind.INTENT,
      label: intent.value.rawText,
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_HUMAN,
      taint: emptyTaint(),
      subjectRef: intent.value.id,
    });
    await this.provenance.recordNode({
      id: auth,
      kind: ProvenanceNodeKind.AUTHORITY,
      label: "grant",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    await this.provenance.recordNode({
      id: a,
      kind: ProvenanceNodeKind.ACTION,
      label: "payment.execute",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    await this.provenance.recordNode({
      id: se,
      kind: ProvenanceNodeKind.SIDE_EFFECT,
      label: "payment SUCCESS",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId("e-p-i"),
      from: p,
      to: i,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId("e-p-a"),
      from: p,
      to: auth,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId("e-i-act"),
      from: i,
      to: a,
      relation: SemanticRelation.RESULTED_IN,
      createdAt: NOW,
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId("e-auth-act"),
      from: auth,
      to: a,
      relation: SemanticRelation.AUTHORIZES,
      createdAt: NOW,
    });
    await this.provenance.recordEdge({
      id: asProvenanceEdgeId("e-act-se"),
      from: a,
      to: se,
      relation: SemanticRelation.RESULTED_IN,
      createdAt: NOW,
    });

    const contract = await this.outcomes.createContractFromIntent({
      id: "oc-demo-proc",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    if (!contract.ok) throw new Error(contract.message);
    this.contractIds = [contract.value.id];
    await this.outcomes.onPaymentSuccess(contract.value.id, NOW);
    const observedQty = 450;
    const expectedQty = 500;
    await this.outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: observedQty,
        quantityOrdered: expectedQty,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: true,
        productObserved: "fg",
        productExpected: "fg",
      },
      NOW,
    );
    const trigger = this.outcomes
      .listEvents(contract.value.id)
      .find((e) => e.type === "OUTCOME_PARTIAL");
    if (!trigger) throw new Error("missing PARTIAL trigger");
    const opened = await this.resolution.openCaseFromTrigger({
      intentState: state.value,
      principalId: "principal-1",
      contractId: contract.value.id,
      triggerEvent: trigger,
      now: NOW,
    });
    if (!opened.ok) throw new Error(opened.message);
    await this.resolution.planRemedies(opened.value.id, NOW);

    const finalContract = await this.outcomes.getContract(contract.value.id);
    if (!finalContract.ok) throw new Error(finalContract.message);
    const partialQty = finalContract.value.requirements.find(
      (r) =>
        r.concept === "quantity_received" &&
        String(r.state) === OutcomeRequirementState.PARTIAL,
    );
    if (partialQty) {
      const expected =
        typeof partialQty.value === "number" ? partialQty.value : expectedQty;
      this.firstDivergence = `${partialQty.concept}:${observedQty}/${expected}`;
    }

    const actionId = asActionId("action-demo-proc");
    const guardian: GuardianVerdict = {
      id: "gv-demo-proc",
      actionId,
      intentId: intent.value.id,
      intentStateId: state.value.id,
      intentStateHash: state.value.stateHash,
      actionContentHash: asHashDigest("action-content-demo-proc"),
      evidenceSnapshotHash: asHashDigest("evidence-demo-proc"),
      decision: AuthorityDecision.ALLOW,
      semanticStatus: GuardianSemanticStatus.CLEAR,
      overallFidelity: 1,
      constraintClaims: [],
      contradictions: [],
      uncertainty: 0,
      criticalFailure: false,
      judgeResults: [
        {
          judgeId: JudgeId.FIDELITY,
          status: JudgeInvocationStatus.OK,
          findings: [],
        },
      ],
      verdictHash: asHashDigest("verdict-demo-proc"),
      protocolVersion: PROTOCOL_VERSION,
      promptVersions: {},
      schemaVersions: {},
      stale: false,
      createdAt: NOW,
    };
    this.seededGuardian = guardian;

    const preparedResult = createPreparedAction({
      id: "prep-demo-proc",
      actionId,
      intentId: intent.value.id,
      intentStateId: state.value.id,
      agentId: asAgentId("agent-1"),
      capability: "execute_payment",
      parameters: {
        merchant: "ApprovedFoodChem",
        amount: 700000,
        currency: "INR",
        quantity: 500,
        product: "fg",
        toolParameters: {},
      },
      createdAt: NOW,
      principalId: intent.value.principalId,
      outcomeContractId: contract.value.id,
      guardianVerdictId: guardian.id,
      guardianVerdictHash: guardian.verdictHash,
    });
    if (!preparedResult.ok) throw new Error(preparedResult.message);
    this.seededPrepared = preparedResult.value;

    const sideEffect: SideEffectRecord = {
      executionId: "exec-demo-proc",
      preparedActionId: preparedResult.value.id,
      preparedActionHash: preparedResult.value.parameterHash,
      commitTokenId: asCommitTokenId("ct-demo-proc"),
      grantId: asAuthorityGrantId("grant-demo-proc"),
      toolId: "payment.execute",
      counterparty: "ApprovedFoodChem",
      amount: 700000,
      currency: "INR",
      idempotencyKey: "idem-demo-proc",
      requestTimestamp: NOW,
      resultState: ExecutionState.SUCCESS,
      reconciliationState: ReconciliationState.NOT_REQUIRED,
    };
    this.seededSideEffects = [sideEffect];

    this.seededAuthority = {
      guardianDecision: guardian.decision,
      authorityDecision: guardian.decision,
      capability: preparedResult.value.capability,
      principalId: String(intent.value.principalId),
      agentId: String(preparedResult.value.agentId),
      merchant: preparedResult.value.parameters.merchant,
      amount: preparedResult.value.parameters.amount,
      currency: preparedResult.value.parameters.currency,
      grantState: "ACTIVE",
    };

    this.events.publish({
      id: "ev-partial",
      topic: "outcome",
      type: "OUTCOME_PARTIAL",
      at: NOW,
      payload: { contractId: contract.value.id, quantity: observedQty },
      dedupeKey: `partial:${contract.value.id}`,
    });
    this.events.publish({
      id: "ev-case",
      topic: "resolution",
      type: "CASE_OPENED",
      at: NOW,
      payload: { caseId: opened.value.id },
      dedupeKey: `case:${opened.value.id}`,
    });

    return { intentId: intent.value.id };
  }

  async seedAtRiskDelivery(): Promise<{ readonly intentId: string }> {
    this.resetSeededCanonical();
    const intent = await this.intents.createIntent({
      id: "intent-demo-risk",
      principalId: "principal-1",
      rawText: "Deliver before Friday",
      createdAt: NOW,
    });
    if (!intent.ok) throw new Error(intent.message);
    this.intent = intent.value;
    const state = await this.intents.createIntentState({
      id: "state-demo-risk",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-dl"),
          concept: "delivery_before",
          operator: ConstraintOperator.LTE,
          value: "2026-06-06T23:59:59.000Z",
          kind: ConstraintKind.HARD,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    if (!state.ok) throw new Error(state.message);
    this.tipState = state.value;
    const contract = await this.outcomes.createContractFromIntent({
      id: "oc-demo-risk",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "carrier",
      quantity: 1,
      budgetMax: 1000,
      createdAt: NOW,
      domain: "travel",
    });
    if (!contract.ok) throw new Error(contract.message);
    this.contractIds = [contract.value.id];
    await this.outcomes.onPaymentSuccess(contract.value.id, NOW);

    const actionId = asActionId("action-demo-risk");
    this.seededGuardian = null;

    const preparedResult = createPreparedAction({
      id: "prep-demo-risk",
      actionId,
      intentId: intent.value.id,
      intentStateId: state.value.id,
      agentId: asAgentId("agent-1"),
      capability: "execute_payment",
      parameters: {
        merchant: "carrier",
        amount: 1000,
        currency: "INR",
        quantity: 1,
        toolParameters: {},
      },
      createdAt: NOW,
      principalId: intent.value.principalId,
      outcomeContractId: contract.value.id,
    });
    if (!preparedResult.ok) throw new Error(preparedResult.message);
    this.seededPrepared = preparedResult.value;

    this.seededSideEffects = [
      {
        executionId: "exec-demo-risk",
        preparedActionId: preparedResult.value.id,
        preparedActionHash: preparedResult.value.parameterHash,
        commitTokenId: asCommitTokenId("ct-demo-risk"),
        grantId: asAuthorityGrantId("grant-demo-risk"),
        toolId: "payment.execute",
        counterparty: "carrier",
        amount: 1000,
        currency: "INR",
        idempotencyKey: "idem-demo-risk",
        requestTimestamp: NOW,
        resultState: ExecutionState.SUCCESS,
        reconciliationState: ReconciliationState.NOT_REQUIRED,
      },
    ];

    this.seededAuthority = {
      guardianDecision: AuthorityDecision.ALLOW,
      authorityDecision: AuthorityDecision.ALLOW,
      capability: preparedResult.value.capability,
      principalId: String(intent.value.principalId),
      agentId: String(preparedResult.value.agentId),
      merchant: preparedResult.value.parameters.merchant,
      amount: preparedResult.value.parameters.amount,
      currency: preparedResult.value.parameters.currency,
      grantState: "ACTIVE",
    };

    await this.outcomes.applyObservations(
      contract.value.id,
      {
        deliveryEta: "2026-06-07T12:00:00.000Z",
        deadline: "2026-06-06T23:59:59.000Z",
        now: NOW,
      },
      NOW,
    );
    const trigger = this.outcomes
      .listEvents(contract.value.id)
      .find((e) => e.type === "OUTCOME_AT_RISK");
    if (trigger) {
      await this.resolution.openCaseFromTrigger({
        intentState: state.value,
        principalId: "principal-1",
        contractId: contract.value.id,
        triggerEvent: trigger,
        now: NOW,
      });
    }
    return { intentId: intent.value.id };
  }

  async getWorkspace(
    intentId: string,
    opts?: { readonly graphFilter?: GraphFilter },
  ): Promise<IntentWorkspaceView> {
    if (!this.intent || this.intent.id !== intentId) {
      throw new Error("Unknown demo intent — seed a scenario first");
    }
    const state = this.tipState!;
    const outcomeContract = await this.getCanonicalOutcome(intentId);
    const rc = await this.getCanonicalResolutionCase(intentId);
    const graph = this.provenance.getGraph();
    const nodes = graph.listNodes();
    const edges = graph.listEdges();
    const sideEffectNode = nodes.find((n) => String(n.kind) === "SIDE_EFFECT");
    const trace = sideEffectNode
      ? walkToPrincipal(sideEffectNode.id, edges, nodes)
      : undefined;

    return assembleWorkspace({
      summary: projectIntentSummary({
        intent: this.intent,
        tipState: state,
        readiness: "EXECUTABLE",
      }),
      semantic: projectSemanticState({
        intent: this.intent,
        constraints: state.constraints,
      }),
      guardian: projectGuardian(this.seededGuardian),
      authority: projectAuthority(this.seededAuthority ?? {}),
      execution: projectExecution({
        prepared: this.seededPrepared,
        sideEffects: this.seededSideEffects,
        unknownPending: false,
        blockedRetry: false,
      }),
      outcome: projectOutcome(outcomeContract),
      resolution: rc
        ? projectResolution({
            case: rc,
            hypotheses: this.resolution.getHypotheses(rc.id),
            remedies: this.resolution.listRemedies(rc.id),
            firstDivergence: this.firstDivergence,
          })
        : undefined,
      graph: projectProvenanceGraph({
        nodes,
        edges,
        filter: opts?.graphFilter,
        tracePath: trace,
      }),
      timeline: mergeTimeline([
        {
          id: "t-intent",
          type: "INTENT_CREATED",
          at: this.intent.createdAt,
          summary: "Intent created",
          relatedObjectIds: [this.intent.id],
          dedupeKey: `intent:${this.intent.id}`,
        },
        {
          id: "t-pay",
          type: "PAYMENT_SUCCESS",
          at: NOW,
          summary: "Payment SUCCESS",
          relatedObjectIds: outcomeContract ? [outcomeContract.id] : [],
          dedupeKey: outcomeContract ? `pay:${outcomeContract.id}` : "pay",
        },
        {
          id: "t-out",
          type: outcomeContract ? String(outcomeContract.state) : "OUTCOME",
          at: NOW,
          summary: `Outcome ${outcomeContract?.state ?? "n/a"} (payment separate)`,
          relatedObjectIds: outcomeContract ? [outcomeContract.id] : [],
          dedupeKey: outcomeContract ? `out:${outcomeContract.id}` : "out",
        },
        {
          id: "t-res",
          type: "RESOLUTION_CASE",
          at: NOW,
          summary: rc
            ? `ResolutionCase ${rc.state}; responsibility ${rc.responsibilityState}`
            : "No resolution case",
          relatedObjectIds: rc ? [rc.id] : [],
          dedupeKey: rc ? `res:${rc.id}` : "res-none",
        },
      ]),
    });
  }

  submitApproval(input: {
    readonly prepared: PreparedAction;
    readonly principalId: string;
    readonly decision: ApprovalDecision;
  }): ApprovalArtifact {
    if (
      this.pendingPrepared &&
      this.pendingPrepared.preparedActionHash !== input.prepared.preparedActionHash
    ) {
      this.pendingApproval = undefined;
    }
    const artifact = createApprovalArtifact({
      id: `appr-${Date.now()}`,
      principalId: input.principalId,
      preparedAction: input.prepared,
      decision: input.decision,
      createdAt: new Date().toISOString(),
    });
    this.pendingApproval = artifact;
    this.pendingPrepared = input.prepared;
    this.events.publish({
      id: `ev-appr-${artifact.id}`,
      topic: "authority",
      type: "APPROVAL_RECORDED",
      at: artifact.createdAt,
      payload: {
        artifactId: artifact.id,
        decision: artifact.decision,
        preparedActionHash: artifact.preparedActionHash,
      },
      dedupeKey: `appr:${artifact.id}`,
    });
    return artifact;
  }

  getPendingApproval(): ApprovalArtifact | undefined {
    return this.pendingApproval;
  }

  forbidDirectGrantMint(): never {
    throw new Error("FRONTEND_CANNOT_MINT_AUTHORITY_GRANT");
  }

  forbidDirectResolveCase(): never {
    throw new Error("FRONTEND_CANNOT_RESOLVE_CASE");
  }

  private resetSeededCanonical(): void {
    this.seededGuardian = null;
    this.seededAuthority = undefined;
    this.seededPrepared = undefined;
    this.seededSideEffects = [];
    this.firstDivergence = undefined;
  }
}

function walkToPrincipal(
  startId: string,
  edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly relation: string;
  }[],
  nodes: readonly { readonly id: string; readonly kind: string }[],
): string[] {
  const path = [startId];
  let current = startId;
  for (let i = 0; i < 20; i++) {
    const inbound = edges.find(
      (e) =>
        e.to === current &&
        (String(e.relation) === "RESULTED_IN" ||
          String(e.relation) === "AUTHORIZES" ||
          String(e.relation) === "INTRODUCED_BY"),
    );
    if (!inbound) break;
    path.push(inbound.from);
    current = inbound.from;
    const n = nodes.find((x) => x.id === current);
    if (n && String(n.kind) === "PRINCIPAL") break;
  }
  return path;
}
