import { randomUUID } from "node:crypto";
import { hashCanonical, proofObligationId } from "@truemandate/crypto";
import {
  classifyRequiredProofCoverage,
  deriveRequiredProofObligations,
} from "@truemandate/semantic-readiness";
import { executionActionProvenance, semanticActionProvenance } from "@truemandate/provenance";
import { evaluateActionProposal } from "@truemandate/guardian";
import { hashActionProposal } from "@truemandate/guardian-core";
import { planIntent } from "@truemandate/planner";
import { verifyPlan } from "@truemandate/plan-verifier";
import type { AuthorityS2SClient, EvidenceS2SClient, IntentProvenanceS2SClient, MonitoringS2SClient, OutcomeS2SClient } from "@truemandate/cloud-runtime";
import type { GatewayS2SClient } from "@truemandate/cloud-runtime";
import type { ModelPort } from "@truemandate/model";
import { ErrorCode, ProvenanceNodeKind, SemanticRelation, TrustClass, TaintClass, AuthorityDecision, err, ok, type ActionProposal, type IntentState, type Result } from "@truemandate/protocol";
import type { ProvenanceService } from "@truemandate/provenance-service";
import {
  WorkflowStage,
  WorkflowStageEventStatus,
  type WorkflowStageEvent,
  type WorkflowStageRecorder,
} from "@truemandate/observability/workflow-stage";
import { logStructured } from "@truemandate/observability/structured-log";
import type { PubSubPublisherPort } from "@truemandate/cloud-pubsub";
import { z } from "zod";
import {
  AuthoritativeProofSummarySchema,
  SemanticArtifactKindSchema,
  parseWithSchema,
  type SemanticArtifactKind,
} from "@truemandate/schemas";
import type { AuthoritativeIntentService } from "./authoritative-intent-service.js";
import {
  publishGuardianVerdictEvent,
  publishPlanCreatedEvent,
} from "./analytics-events.js";
import type { DomainPack, WorkflowRequestBase } from "./domain-pack.js";

/**
 * Fail-open, best-effort stage timing emission. A telemetry write must
 * never throw into or delay the workflow it observes.
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
    // Fail-open: stage timing telemetry must never affect the workflow.
  }
}

type ArtifactKind = SemanticArtifactKind;
type Artifact = { id: string; kind: ArtifactKind; contentHash: string; payload: Record<string, unknown>; predecessors: readonly { id: string; kind: string; contentHash: string }[] };
type ProofStatus = "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
type EvaluatedProofRow = {
  readonly constraintId?: string;
  readonly sourceObligationId?: string;
  readonly sourceProofArtifactId?: string;
  readonly obligationId: string;
  readonly evidenceRefs: readonly { readonly id: string; readonly hash: string }[];
  readonly status: ProofStatus;
  readonly method: string;
};

/** The owner-hash-resolved semantic reference set handed to Authority/Gateway. */
interface SemanticReferences {
  readonly workflowId: string;
  readonly intentStateId: string;
  readonly intentStateHash: string;
  readonly workflow: { readonly id: string; readonly hash: string };
  readonly plan: { readonly id: string; readonly hash: string };
  readonly planVerification: { readonly id: string; readonly hash: string };
  readonly action: { readonly id: string; readonly hash: string };
  readonly guardian: { readonly id: string; readonly hash: string };
  readonly proofs: readonly { readonly id: string; readonly hash: string }[];
  readonly idempotencyKey: string;
}

/**
 * Engine-owned dependencies. Authority / Gateway / Outcomes ports are
 * deliberately absent from DomainPack — packs cannot mint grants, issue
 * CommitTokens, or call Gateway commit.
 */
export interface GenericWorkflowEngineDeps<TInput extends WorkflowRequestBase> {
  readonly pack: DomainPack<TInput>;
  readonly intents: AuthoritativeIntentService;
  readonly owner: IntentProvenanceS2SClient;
  readonly evidence: Pick<EvidenceS2SClient, "getEnvelope" | "getClaim">;
  readonly authority: Pick<AuthorityS2SClient, "evaluateWorkflow" | "bindAndMint" | "createApproval" | "getApproval">;
  readonly outcomes?: Pick<OutcomeS2SClient, "createContract">;
  readonly gateway?: Pick<GatewayS2SClient, "prepareFromReferences" | "authorize" | "commit">;
  /** Wave 4.3: optional MonitoringContract creation for ALLOW_WITH_MONITORING. */
  readonly monitoring?: Pick<MonitoringS2SClient, "createContract">;
  readonly model: ModelPort;
  readonly provenance: ProvenanceService;
  readonly now?: () => string;
  readonly stageRecorder?: WorkflowStageRecorder;
  readonly publisher?: PubSubPublisherPort;
}

function ref(a: Artifact) { return { id: a.id, kind: a.kind, contentHash: a.contentHash }; }

function ownerArtifact(raw: unknown): Result<Artifact> {
  if (!raw || typeof raw !== "object") return err(ErrorCode.VALIDATION_FAILED, "Malformed owner semantic artifact");
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !SemanticArtifactKindSchema.safeParse(row.kind).success || typeof row.contentHash !== "string" || !row.payload || typeof row.payload !== "object" || !Array.isArray(row.predecessors)) return err(ErrorCode.VALIDATION_FAILED, "Malformed owner semantic artifact");
  return ok(row as unknown as Artifact);
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function zeroEvidenceRef() {
  return [{ id: "missing-evidence", hash: "0".repeat(64) }] as const satisfies readonly {
    readonly id: string;
    readonly hash: string;
  }[];
}

/**
 * Domain-agnostic governed workflow engine.
 *
 * Lifecycle: Intent/IntentState → ActionProposal → Guardian → Authority →
 * approval/monitoring state → PREPARE → AUTHORIZE → COMMIT → OutcomeContract → Resolution.
 *
 * Domain-specific semantics come exclusively from DomainPack. The pack never
 * owns this pipeline and never receives privileged clients.
 */
export class GenericWorkflowEngine<TInput extends WorkflowRequestBase> {
  constructor(private readonly deps: GenericWorkflowEngineDeps<TInput>) {}

  private async append(input: { id: string; intentId: string; workflowId: string; kind: ArtifactKind; payload: Record<string, unknown>; predecessors?: readonly ReturnType<typeof ref>[]; createdAt: string }): Promise<Result<Artifact>> {
    const saved = await this.deps.owner.putSemanticArtifact({ ...input, predecessors: input.predecessors ?? [] });
    if (!saved.ok) return saved as Result<Artifact>;
    return ownerArtifact(saved.value);
  }

  private async existing(workflowId: string): Promise<Result<readonly Artifact[]>> {
    const rows = await this.deps.owner.listWorkflowArtifacts(workflowId);
    if (!rows.ok) return rows as Result<readonly Artifact[]>;
    const parsed: Artifact[] = [];
    for (const row of rows.value) { const value = ownerArtifact(row); if (!value.ok) return value; parsed.push(value.value); }
    return ok(parsed);
  }

  private async resolveAuthoritativeProofRows(input: {
    readonly workflowId: string;
    readonly state: IntentState;
    readonly packId: string;
    readonly requiredObligations: readonly { readonly constraintId?: string }[];
    readonly planObligations: readonly { readonly constraintId?: string; readonly verificationStep: string; readonly requiredEvidence: string; readonly enforcingService: string }[];
  }): Promise<Result<{ readonly proofRows: readonly EvaluatedProofRow[]; readonly completeProofs: boolean }>> {
    const artifact = await this.deps.intents.getVerificationArtifactForState(input.state);
    const currentCoverage = classifyRequiredProofCoverage(input.state.constraints, {
      temporalAuthority: input.state.temporalAuthority,
      conceptContract: this.deps.pack.planning,
    });
    const currentRequiredConstraintIds = currentCoverage.map((row) => row.constraintId).sort();
    const currentRequiredProofObligationIds = input.requiredObligations
      .map((obligation) => proofObligationId(obligation))
      .sort();
    const invalidRows = input.requiredObligations.map((obligation) => ({
      obligation,
      status: "UNKNOWN" as const,
      evidenceRefs: zeroEvidenceRef(),
    }));
    if (!artifact.ok) {
      return ok({
        completeProofs: false,
        proofRows: invalidRows.map(({ obligation, status, evidenceRefs }) => ({
          obligationId: proofObligationId(
            input.planObligations.find((row) => row.constraintId === obligation.constraintId) ?? obligation,
          ),
          constraintId: obligation.constraintId,
          evidenceRefs,
          status,
          method: "authoritative-proof-handoff-missing",
        })),
      });
    }

    const summary = parseWithSchema(
      AuthoritativeProofSummarySchema,
      artifact.value.payload.proofSummary,
      "AuthoritativeProofSummary",
    );
    if (!summary.ok) {
      return ok({
        completeProofs: false,
        proofRows: invalidRows.map(({ obligation, status, evidenceRefs }) => ({
          obligationId: proofObligationId(
            input.planObligations.find((row) => row.constraintId === obligation.constraintId) ?? obligation,
          ),
          constraintId: obligation.constraintId,
          evidenceRefs,
          status,
          method: "authoritative-proof-handoff-invalid",
        })),
      });
    }
    const summaryValue = summary.value;
    const invalidReason =
      summaryValue.packId !== input.packId ||
      summaryValue.intentId !== input.state.intentId ||
      summaryValue.intentStateId !== input.state.id ||
      summaryValue.intentStateHash !== input.state.stateHash ||
      !sameStringSet(summaryValue.coverage.requiredConstraintIds, currentRequiredConstraintIds) ||
      !sameStringSet(summaryValue.requiredProofObligationIds, currentRequiredProofObligationIds) ||
      !summaryValue.coverage.allRequiredCovered
        ? "authoritative-proof-handoff-stale"
        : undefined;

    if (invalidReason) {
      return ok({
        completeProofs: false,
        proofRows: invalidRows.map(({ obligation, status, evidenceRefs }) => ({
          obligationId: proofObligationId(
            input.planObligations.find((row) => row.constraintId === obligation.constraintId) ?? obligation,
          ),
          constraintId: obligation.constraintId,
          evidenceRefs,
          status,
          method: invalidReason,
        })),
      });
    }

    const rowsByConstraintId = new Map(
      summaryValue.proofRows
        .filter((row) => typeof row.constraintId === "string")
        .map((row) => [row.constraintId as string, row] as const),
    );
    const verifiedEvidenceRefs = summaryValue.verifiedEvidenceRefs ?? [];
    const verifiedEvidence = new Map(verifiedEvidenceRefs.map((row) => [row.id, row] as const));
    let summaryValid = true;
    for (const row of summaryValue.proofRows) {
      if (!row.evidenceId) {
        if (row.proofMechanism === "DETERMINISTIC_RULE" && row.status === "SATISFIED") continue;
        summaryValid = false;
        break;
      }
      const envelope = await this.deps.evidence.getEnvelope(row.evidenceId);
      if (!envelope.ok || envelope.value.trustClass === TrustClass.UNTRUSTED_EXTERNAL) {
        summaryValid = false;
        break;
      }
      if (
        row.evidenceTrustClass !== undefined &&
        row.evidenceTrustClass !== envelope.value.trustClass
      ) {
        summaryValid = false;
        break;
      }
      const verifiedRef = verifiedEvidence.get(row.evidenceId);
      if (
        verifiedRef &&
        verifiedRef.hash !== envelope.value.contentHash
      ) {
        summaryValid = false;
        break;
      }
      if (row.claimId) {
        const claim = await this.deps.evidence.getClaim(row.claimId);
        if (!claim.ok || claim.value.evidenceId !== row.evidenceId) {
          summaryValid = false;
          break;
        }
      }
    }

    const proofRows = await Promise.all(
      input.requiredObligations.map(async (obligation, index) => {
        const planMatch = input.planObligations.find((row) => row.constraintId === obligation.constraintId);
        const source = obligation.constraintId ? rowsByConstraintId.get(obligation.constraintId) : undefined;
        const obligationId = proofObligationId(planMatch ?? obligation);
        if (!summaryValid || !source) {
          return {
            obligationId,
            constraintId: obligation.constraintId,
            status: "UNKNOWN" as const,
            evidenceRefs: zeroEvidenceRef(),
            method: summaryValid
              ? "authoritative-proof-handoff-incomplete"
              : "authoritative-proof-handoff-invalid-lineage",
            sourceProofArtifactId: `proof-${input.workflowId}-${index}`,
          };
        }
        let evidenceRefs: readonly { readonly id: string; readonly hash: string }[] =
          zeroEvidenceRef();
        if (source.evidenceId) {
          const envelope = await this.deps.evidence.getEnvelope(source.evidenceId);
          if (envelope.ok) {
            evidenceRefs = [{ id: source.evidenceId, hash: envelope.value.contentHash }];
          }
        }
        return {
          obligationId,
          constraintId: source.constraintId,
          sourceObligationId: source.obligationId,
          sourceProofArtifactId: `proof-${input.workflowId}-${index}`,
          status: source.status,
          evidenceRefs,
          method: "authoritative-proof-handoff",
        };
      }),
    );

    const completeProofs =
      summaryValid &&
      proofRows.length > 0 &&
      proofRows.every((row) => row.status === "SATISFIED");
    return ok({ proofRows, completeProofs });
  }

  async run(raw: unknown): Promise<Result<unknown>> {
    const parsed = this.deps.pack.requestSchema.safeParse(raw);
    if (!parsed.success) {
      return err(ErrorCode.SCHEMA_PARSE_FAILED, `Invalid ${this.deps.pack.id} workflow request`, { issues: parsed.error.issues });
    }
    const input = parsed.data;
    const state = await this.deps.intents.getCurrentStateForIntent(input.intentId, input.expectedIntentStateId);
    if (!state.ok) return state;
    if (input.expectedIntentStateHash && input.expectedIntentStateHash !== state.value.stateHash) return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Expected IntentState hash is stale");
    const workflowId = this.deps.pack.assertWorkflowId(input, state.value.stateHash);
    if (!workflowId.ok) return workflowId;
    const existing = await this.existing(workflowId.value);
    if (!existing.ok) return existing;
    if (existing.value.length) return ok({ workflowId: workflowId.value, state: (existing.value.find((a) => a.kind === "WORKFLOW")?.payload as Record<string, unknown>).state ?? "SEMANTIC_EVALUATING", artifacts: existing.value.map((a) => ({ id: a.id, hash: a.contentHash, kind: a.kind })) });

    const verification = await this.deps.intents.getVerificationForState(state.value);
    if (!verification.ok) return verification;
    const createdAt = this.deps.now?.() ?? new Date().toISOString();
    const offerNodeId = `external-offer-${workflowId.value}`;
    const offerMeta = this.deps.pack.buildExternalOfferNode(input, {
      workflowId: workflowId.value,
      intentStateId: state.value.id,
      offerHash: hashCanonical(input),
    });
    // Trust/taint classification is engine-owned (security invariant), never pack-supplied.
    const offerNode = await this.deps.provenance.recordNode({
      id: offerNodeId,
      kind: ProvenanceNodeKind.EXTERNAL,
      label: offerMeta.label,
      createdAt,
      trustClass: TrustClass.UNTRUSTED_EXTERNAL,
      taint: { classes: [TaintClass.EXTERNAL_CONTENT, TaintClass.UNVERIFIED_CLAIM], origins: [offerNodeId] },
      metadata: offerMeta.metadata,
    });
    if (!offerNode.ok) return offerNode;

    const intent = await this.deps.intents.getIntent(input.intentId);
    if (!intent.ok) return intent;
    const previewAction = this.deps.pack.buildActionProposal(input, {
      workflowId: workflowId.value,
      intentId: input.intentId,
      intentStateId: state.value.id,
      createdAt,
      offerNodeId,
    });
    const planningContext = {
      domainId: this.deps.pack.id,
      executionCapability: this.deps.pack.planning.executionCapability,
      executionLabel: this.deps.pack.planning.executionLabel,
      requiredPhases: this.deps.pack.planning.requiredPhases,
      conceptFamilies: this.deps.pack.planning.conceptFamilies,
      executionCriticalConceptRules: this.deps.pack.planning.executionCriticalConceptRules,
      authoritativeActionSummary: {
        capability: previewAction.capability,
        merchant: previewAction.merchant,
        product: previewAction.product,
        quantity: previewAction.quantity,
        amount: previewAction.amount,
        currency: previewAction.currency,
        refundable: previewAction.refundable,
        deliveryTerms: previewAction.deliveryTerms,
      },
    } as const;
    const planResult = await planIntent(intent.value, state.value, verification.value, {
      model: this.deps.model,
      requestId: workflowId.value,
      planningContext,
    });
    if (!planResult.ok) return planResult;
    const plan = await this.append({ id: `plan-${workflowId.value}`, intentId: input.intentId, workflowId: workflowId.value, kind: "PLAN", createdAt, payload: { intentStateId: state.value.id, intentStateHash: state.value.stateHash, plan: planResult.value, proofObligations: planResult.value.proofObligations, provenanceNodeId: offerNodeId } });
    if (!plan.ok) return plan;
    const checked = await verifyPlan(intent.value, state.value, planResult.value, verification.value, {
      model: this.deps.model,
      requestId: `${workflowId.value}-verify`,
      planningContext,
    });
    if (!checked.ok) return checked;
    const planVerification = await this.append({ id: `plan-verification-${workflowId.value}`, intentId: input.intentId, workflowId: workflowId.value, kind: "PLAN_VERIFICATION", createdAt, predecessors: [ref(plan.value)], payload: { intentStateId: state.value.id, intentStateHash: state.value.stateHash, verification: checked.value } });
    if (!planVerification.ok) return planVerification;
    publishPlanCreatedEvent(this.deps.publisher, {
      workflowId: workflowId.value,
      intentId: input.intentId,
      planId: planResult.value.id,
      ambiguityClass: planResult.value.ambiguityClassAtPlan,
    });

    // Required obligations are derived deterministically from the authoritative
    // IntentState — planner output cannot create, omit, or rename them. The
    // pack never participates in obligation derivation.
    const requiredObligations = deriveRequiredProofObligations(state.value.constraints, {
      temporalAuthority: state.value.temporalAuthority,
      conceptContract: this.deps.pack.planning,
    });
    const planObligations = planResult.value.proofObligations;
    const requiredProofObligationIds = planObligations.map(proofObligationId).sort();
    const domainAction = previewAction;
    const action: ActionProposal = {
      id: `action-${workflowId.value}` as ActionProposal["id"],
      intentId: input.intentId as ActionProposal["intentId"],
      intentStateId: state.value.id,
      agentId: "agent-runtime" as ActionProposal["agentId"],
      capability: domainAction.capability,
      merchant: domainAction.merchant,
      product: domainAction.product,
      quantity: domainAction.quantity,
      amount: domainAction.amount,
      currency: domainAction.currency,
      deliveryTerms: domainAction.deliveryTerms,
      refundable: domainAction.refundable,
      parameters: domainAction.parameters,
      consequenceLevel: domainAction.consequenceLevel,
      createdAt,
      planId: planResult.value.id,
    };
    const expiresAt = state.value.temporalAuthority?.executionNotAfter;
    const actionFidelity = this.deps.pack.evaluateActionFidelity(
      input,
      state.value,
      action,
    );
    // The capability permission is authoritative IntentState policy (absent =
    // bounded ALLOW framing); business input / pack can never elevate it.
    const capabilityPermission = state.value.capabilities?.[domainAction.capability] ?? AuthorityDecision.ALLOW;
    const actionPayload: Record<string, unknown> = {
      intentStateId: state.value.id,
      intentStateHash: state.value.stateHash,
      action,
      deterministicActionFidelity: actionFidelity,
      requiredProofObligationIds,
      temporalAuthority: state.value.temporalAuthority,
      authorityRequest: {
        id: `authority-${workflowId.value}`,
        principalId: intent.value.principalId,
        adaptiveSubjectId: input.adaptiveSubjectId,
        agentId: "agent-runtime",
        intentId: input.intentId,
        intentStateId: state.value.id,
        actionId: action.id,
        capability: domainAction.capability,
        scope: {
          capabilities: { [domainAction.capability]: capabilityPermission },
          maxAmount: domainAction.amount,
          currency: domainAction.currency,
          allowedMerchants: [domainAction.merchant],
          ...(expiresAt ? { expiresAt } : {}),
        },
        merchant: domainAction.merchant,
        amount: domainAction.amount,
        currency: domainAction.currency,
        createdAt,
      },
    };
    const actionArtifact = await this.append({ id: action.id, intentId: input.intentId, workflowId: workflowId.value, kind: "ACTION", createdAt, predecessors: [ref(plan.value), ref(planVerification.value)], payload: actionPayload });
    if (!actionArtifact.ok) return actionArtifact;
    const semanticAction = semanticActionProvenance({
      actionId: actionArtifact.value.id, actionHash: actionArtifact.value.contentHash,
      workflowId: workflowId.value, intentStateId: state.value.id,
      intentStateHash: state.value.stateHash, intentStateVersion: state.value.version,
    }, createdAt);
    const actionNode = await this.deps.provenance.recordNode(semanticAction);
    if (!actionNode.ok) return actionNode;
    const actionIntentEdge = await this.deps.provenance.recordEdge({
      id: `semantic-action-intent-${workflowId.value}`, from: `intent-node-${input.intentId}`,
      to: semanticAction.id, relation: SemanticRelation.DERIVED_FROM, createdAt,
      metadata: { actionHash: actionArtifact.value.contentHash, workflowId: workflowId.value },
    });
    if (!actionIntentEdge.ok) return actionIntentEdge;
    const actionOfferEdge = await this.deps.provenance.recordEdge({
      id: `semantic-action-offer-${workflowId.value}`, from: offerNodeId, to: semanticAction.id,
      relation: SemanticRelation.INFLUENCED_BY, createdAt,
      metadata: { workflowId: workflowId.value },
    });
    if (!actionOfferEdge.ok) return actionOfferEdge;

    const proofRows: Artifact[] = [];
    const evaluatedProofs = await this.resolveAuthoritativeProofRows({
      workflowId: workflowId.value,
      state: state.value,
      packId: this.deps.pack.id,
      requiredObligations,
      planObligations,
    });
    if (!evaluatedProofs.ok) return evaluatedProofs;
    for (const [index, proofRow] of evaluatedProofs.value.proofRows.entries()) {
      const proof = await this.append({ id: `proof-${workflowId.value}-${index}`, intentId: input.intentId, workflowId: workflowId.value, kind: "PROOF", createdAt, predecessors: [ref(actionArtifact.value)], payload: { intentStateId: state.value.id, intentStateHash: state.value.stateHash, schemaVersion: "1", proofId: `proof-${workflowId.value}-${index}`, obligationId: proofRow.obligationId, actionArtifactId: actionArtifact.value.id, actionPayloadHash: actionArtifact.value.contentHash, status: proofRow.status, evidenceRefs: proofRow.evidenceRefs, evaluatedAt: createdAt, method: proofRow.method, constraintId: proofRow.constraintId, sourceObligationId: proofRow.sourceObligationId } });
      if (!proof.ok) return proof; proofRows.push(proof.value);
    }
    const completeProofs = evaluatedProofs.value.completeProofs;
    const guardianStarted = Date.now();
    await recordStage(this.deps.stageRecorder, {
      workflowId: workflowId.value,
      intentId: input.intentId as ActionProposal["intentId"],
      stage: WorkflowStage.GUARDIAN,
      status: WorkflowStageEventStatus.STARTED,
    });
    const guardianResult = await evaluateActionProposal({ action, plan: planResult.value, actionNodeId: `action-provenance-${workflowId.value}`, expectedActionHash: hashActionProposal(action), createdAt }, { model: this.deps.model, intents: this.deps.intents, provenance: this.deps.provenance });
    if (!guardianResult.ok) {
      await recordStage(this.deps.stageRecorder, {
        workflowId: workflowId.value,
        intentId: input.intentId as ActionProposal["intentId"],
        stage: WorkflowStage.GUARDIAN,
        status: WorkflowStageEventStatus.FAILED,
        durationMs: Date.now() - guardianStarted,
      });
      return guardianResult;
    }
    await recordStage(this.deps.stageRecorder, {
      workflowId: workflowId.value,
      intentId: input.intentId as ActionProposal["intentId"],
      stage: WorkflowStage.GUARDIAN,
      status: WorkflowStageEventStatus.COMPLETED,
      durationMs: Date.now() - guardianStarted,
    });
    logStructured("info", {
      event: "tm.guardian.decision",
      service: "agent-runtime",
      decision: guardianResult.value.decision,
      workflowId: workflowId.value,
      intentId: input.intentId,
      criticalFailure: guardianResult.value.criticalFailure,
      semanticStatus: guardianResult.value.semanticStatus,
    });
    publishGuardianVerdictEvent(this.deps.publisher, {
      workflowId: workflowId.value,
      intentId: input.intentId,
      agentId: action.agentId,
      decision: guardianResult.value.decision,
      criticalFailure: guardianResult.value.criticalFailure,
      semanticStatus: guardianResult.value.semanticStatus,
    });
    const guardian = await this.append({ id: `guardian-${workflowId.value}`, intentId: input.intentId, workflowId: workflowId.value, kind: "GUARDIAN", createdAt, predecessors: [ref(plan.value), ref(planVerification.value), ref(actionArtifact.value), ...proofRows.map(ref)], payload: { intentStateId: state.value.id, intentStateHash: state.value.stateHash, verdict: guardianResult.value, actionArtifactId: actionArtifact.value.id, actionArtifactHash: actionArtifact.value.contentHash, evaluatedProofs: proofRows.map((p) => ({ id: p.id, hash: p.contentHash, obligationId: p.payload.obligationId })).sort((a, b) => a.id.localeCompare(b.id)) } });
    if (!guardian.ok) return guardian;
    const privilegedReady =
      verification.value.readiness === "ACTIONABLE" ||
      verification.value.readiness === "EXECUTABLE";
    const actionPreservesIntent = actionFidelity.preservesIntent;
    const eligible = checked.value.status === "VERIFIED" && completeProofs && actionPreservesIntent && guardianResult.value.decision !== AuthorityDecision.BLOCK && !guardianResult.value.criticalFailure && privilegedReady;
    const workflow = await this.append({ id: workflowId.value, intentId: input.intentId, workflowId: workflowId.value, kind: "WORKFLOW", createdAt, predecessors: [ref(guardian.value)], payload: { intentStateId: state.value.id, intentStateHash: state.value.stateHash, packId: this.deps.pack.id, state: eligible ? "AUTHORITY_EVALUATION" : "BLOCKED" } });
    if (!workflow.ok) return workflow;
    const references = { workflowId: workflowId.value, intentStateId: state.value.id, intentStateHash: state.value.stateHash, workflow: { id: workflow.value.id, hash: workflow.value.contentHash }, plan: { id: plan.value.id, hash: plan.value.contentHash }, planVerification: { id: planVerification.value.id, hash: planVerification.value.contentHash }, action: { id: actionArtifact.value.id, hash: actionArtifact.value.contentHash }, guardian: { id: guardian.value.id, hash: guardian.value.contentHash }, proofs: proofRows.map((p) => ({ id: p.id, hash: p.contentHash })), idempotencyKey: input.idempotencyKey };
    if (!eligible) return ok({ workflowId: workflowId.value, state: "BLOCKED", artifacts: references });
    const authority = await this.deps.authority.evaluateWorkflow(references);
    if (!authority.ok) return authority;
    const evaluation = authority.value as { decision?: string; evaluation?: { id?: string; hash?: string; materializationEligible?: boolean; materializationReason?: string; expiresAt?: string } };
    const evaluationRef = evaluation.evaluation;
    if (evaluation.decision === AuthorityDecision.REQUIRE_APPROVAL && !input.approvalId) {
      if (!evaluationRef?.id || evaluationRef.materializationReason !== "PENDING_APPROVAL" || !evaluationRef.expiresAt || Date.parse(evaluationRef.expiresAt) <= Date.parse(createdAt)) {
        return err(ErrorCode.AUTHORITY_BLOCKED, "REQUIRE_APPROVAL evaluation is not approval-materializable", { materializationReason: evaluationRef?.materializationReason });
      }
      const approval = await this.deps.authority.createApproval({
        id: `approval-${workflowId.value}`,
        evaluationId: evaluationRef.id,
        intentId: input.intentId,
        actionId: actionArtifact.value.id,
        requestedAt: createdAt,
        expiresAt: evaluationRef.expiresAt,
      });
      if (!approval.ok) return approval;
      return ok({ workflowId: workflowId.value, state: "AWAITING_APPROVAL", artifacts: references, evaluation: authority.value, approval: approval.value });
    }
    const evaluationReference = evaluationRef?.id && evaluationRef?.hash ? { id: evaluationRef.id, hash: evaluationRef.hash } : undefined;
    const materializable = (evaluationRef?.materializationEligible === true || (evaluation.decision === AuthorityDecision.REQUIRE_APPROVAL && Boolean(input.approvalId))) && evaluationReference !== undefined;
    if (!materializable || !evaluationReference) {
      return ok({ workflowId: workflowId.value, state: "AUTHORITY_EVALUATION", artifacts: references, evaluation: authority.value });
    }
    return this.materializeEvaluatedExecution({
      intentId: input.intentId,
      references,
      evaluation: evaluationReference,
      evaluationBody: authority.value,
      actionArtifact: { id: actionArtifact.value.id, contentHash: actionArtifact.value.contentHash },
      intentState: { id: state.value.id, stateHash: state.value.stateHash, version: state.value.version },
      idempotencyKey: input.idempotencyKey,
      approvalId: input.approvalId,
      createdAt,
    });
  }

  /**
   * Shared materialization chain: OutcomeContract → Gateway PREPARE →
   * Authority bind-and-mint (approval-unlocked when approvalId is present) →
   * Gateway AUTHORIZE. The owner routes revalidate the durable records; the
   * engine never supplies executable parameters. DomainPack is not involved.
   */
  private async materializeEvaluatedExecution(input: {
    readonly intentId: string;
    readonly references: SemanticReferences;
    readonly evaluation: { readonly id: string; readonly hash: string };
    readonly evaluationBody: unknown;
    readonly actionArtifact: { readonly id: string; readonly contentHash: string };
    readonly intentState: { readonly id: string; readonly stateHash: string; readonly version: number };
    readonly idempotencyKey: string;
    readonly approvalId?: string;
    readonly createdAt: string;
  }): Promise<Result<unknown>> {
    const { intentId, references, evaluation, evaluationBody, actionArtifact, intentState, idempotencyKey, approvalId, createdAt } = input;
    if (!this.deps.outcomes) return err(ErrorCode.AUTHORITY_BLOCKED, "Outcome contract port unavailable for materialization");

    // Wave 4.3: ALLOW_WITH_MONITORING opens a MonitoringContract before Outcome
    // creation. Fail-open relative to already-decided execution — a monitoring
    // create failure must not block the grant/authorize path.
    let monitoringContract: unknown | undefined;
    let monitoringContractId: string | undefined;
    const decision =
      typeof evaluationBody === "object" &&
      evaluationBody !== null &&
      "decision" in evaluationBody
        ? String((evaluationBody as { decision?: string }).decision)
        : undefined;
    if (decision === AuthorityDecision.ALLOW_WITH_MONITORING && this.deps.monitoring) {
      try {
        const monitoringResult = await this.deps.monitoring.createContract({
          id: `monitoring-${references.workflowId}`,
          evaluationId: evaluation.id,
          intentId,
          intentStateId: intentState.id,
          workflowId: references.workflowId,
          createdAt,
        });
        if (monitoringResult.ok) {
          monitoringContract = monitoringResult.value;
          const row = monitoringResult.value as { id?: string };
          if (typeof row.id === "string") monitoringContractId = row.id;
        } else {
          logStructured("warn", {
            event: "tm.monitoring.create_failed",
            service: "agent-runtime",
            workflowId: references.workflowId,
            code: monitoringResult.code,
            message: monitoringResult.message,
          });
        }
      } catch {
        logStructured("warn", {
          event: "tm.monitoring.create_failed",
          service: "agent-runtime",
          workflowId: references.workflowId,
          message: "Monitoring create threw unexpectedly",
        });
      }
    }

    const outcome = await this.deps.outcomes.createContract({
      evaluation,
      workflow: references.workflow,
      action: references.action,
      idempotencyKey,
      ...(approvalId ? { approvalId } : {}),
      ...(monitoringContractId ? { monitoringContractId } : {}),
    });
    if (!outcome.ok) return outcome;
    const contract = outcome.value as { id?: string; definitionHash?: string };
    if (!this.deps.gateway || !contract.id || !contract.definitionHash) {
      return ok({
        workflowId: references.workflowId,
        state: "OUTCOME_CONTRACT_CREATED",
        artifacts: references,
        evaluation: evaluationBody,
        outcomeContract: outcome.value,
        ...(monitoringContract ? { monitoringContract } : {}),
      });
    }
    const prepared = await this.deps.gateway.prepareFromReferences({ evaluation, outcomeContract: { id: contract.id, hash: contract.definitionHash }, workflow: references.workflow, action: references.action, idempotencyKey, ...(approvalId ? { approvalId } : {}) });
    if (!prepared.ok) return prepared;
    const execution = executionActionProvenance({
      preparedActionId: prepared.value.id, preparedActionHash: prepared.value.preparedActionHash,
      actionId: actionArtifact.id, actionHash: actionArtifact.contentHash,
      workflowId: references.workflowId, evaluationId: evaluation.id,
      evaluationHash: evaluation.hash, outcomeContractId: contract.id,
      outcomeContractHash: contract.definitionHash, intentStateId: intentState.id,
      intentStateHash: intentState.stateHash, intentStateVersion: intentState.version,
    }, createdAt);
    const executionNode = await this.deps.provenance.recordNode(execution.node);
    if (!executionNode.ok) return executionNode;
    const executionEdge = await this.deps.provenance.recordEdge(execution.edge);
    if (!executionEdge.ok) return executionEdge;
    const minted = await this.deps.authority.bindAndMint({ evaluation, preparedAction: { id: prepared.value.id, hash: prepared.value.preparedActionHash }, outcomeContract: { id: contract.id, hash: contract.definitionHash }, idempotencyKey, ...(approvalId ? { approvalId } : {}) });
    if (!minted.ok) return minted;
    const grant = minted.value as { id?: string; expiresAt?: string };
    if (!grant.id || !grant.expiresAt) {
      return ok({
        workflowId: references.workflowId,
        state: "OUTCOME_CONTRACT_CREATED",
        artifacts: references,
        evaluation: evaluationBody,
        outcomeContract: outcome.value,
        ...(monitoringContract ? { monitoringContract } : {}),
      });
    }
    const authorized = await this.deps.gateway.authorize({ preparedActionId: prepared.value.id, grantId: grant.id, expiresAt: grant.expiresAt });
    if (!authorized.ok) return authorized;
    const authorizationRow = authorized.value as {
      commitToken?: { id?: string };
      grant?: { id?: string };
    };
    const commitTokenId = authorizationRow.commitToken?.id;
    if (typeof commitTokenId === "string") {
      const authorizationArtifact = await this.append({
        id: `execution-authorization-${references.workflowId}`,
        intentId,
        workflowId: references.workflowId,
        kind: "EXECUTION_AUTHORIZATION",
        createdAt,
        predecessors: [
          {
            id: references.workflow.id,
            kind: "WORKFLOW",
            contentHash: references.workflow.hash,
          },
        ],
        payload: {
          intentStateId: intentState.id,
          intentStateHash: intentState.stateHash,
          workflowId: references.workflowId,
          packId: this.deps.pack.id,
          commitTokenId,
          preparedActionId: prepared.value.id,
          preparedActionHash: prepared.value.preparedActionHash,
          grantId: grant.id,
          outcomeContractId: contract.id,
          outcomeContractHash: contract.definitionHash,
        },
      });
      if (!authorizationArtifact.ok) return authorizationArtifact;
    }
    return ok({
      workflowId: references.workflowId,
      state: "AUTHORIZED",
      artifacts: references,
      evaluation: evaluationBody,
      outcomeContract: outcome.value,
      authorization: authorized.value,
      ...(monitoringContract ? { monitoringContract } : {}),
    });
  }

  /**
   * REQUIRE_APPROVAL resumption: after a durable human approval, the
   * engine re-evaluates against the CURRENT IntentState, re-asserts the
   * REQUIRE_APPROVAL decision, verifies the APPROVED request, and
   * materializes through the ordinary Outcome → PREPARE → mint
   * (approval-unlocked) → AUTHORIZE chain. Never invoked automatically from run().
   */
  async resumeWithApproval(raw: unknown): Promise<Result<unknown>> {
    const parsed = z.object({ workflowId: z.string().min(1), approvalId: z.string().min(1) }).strict().safeParse(raw);
    if (!parsed.success) return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid approval resumption request", { issues: parsed.error.issues });
    const { workflowId, approvalId } = parsed.data;
    const existing = await this.existing(workflowId);
    if (!existing.ok) return existing;
    const byKind = (kind: ArtifactKind): Artifact | undefined => existing.value.find((a) => a.kind === kind);
    const workflow = byKind("WORKFLOW");
    const plan = byKind("PLAN");
    const planVerification = byKind("PLAN_VERIFICATION");
    const actionArtifact = byKind("ACTION");
    const guardian = byKind("GUARDIAN");
    if (!workflow || !plan || !planVerification || !actionArtifact || !guardian) {
      return err(ErrorCode.VALIDATION_FAILED, "Workflow artifacts incomplete for approval resumption");
    }
    const workflowPayload = workflow.payload as Record<string, unknown>;
    const actionPayload = actionArtifact.payload as Record<string, unknown>;
    const action = actionPayload.action as Record<string, unknown> | undefined;
    const intentId = typeof action?.intentId === "string" ? action.intentId : "";
    const intentStateId = typeof workflowPayload.intentStateId === "string" ? workflowPayload.intentStateId : "";
    const intentStateHash = typeof workflowPayload.intentStateHash === "string" ? workflowPayload.intentStateHash : "";
    if (!intentId || !intentStateId || !intentStateHash) {
      return err(ErrorCode.VALIDATION_FAILED, "Workflow artifacts lack canonical IntentState bindings");
    }
    const state = await this.deps.intents.getCurrentStateForIntent(intentId, intentStateId);
    if (!state.ok) return state;
    if (state.value.stateHash !== intentStateHash) return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "IntentState changed since approval was requested");
    const references: SemanticReferences = {
      workflowId,
      intentStateId,
      intentStateHash,
      workflow: { id: workflow.id, hash: workflow.contentHash },
      plan: { id: plan.id, hash: plan.contentHash },
      planVerification: { id: planVerification.id, hash: planVerification.contentHash },
      action: { id: actionArtifact.id, hash: actionArtifact.contentHash },
      guardian: { id: guardian.id, hash: guardian.contentHash },
      proofs: existing.value.filter((a) => a.kind === "PROOF").map((p) => ({ id: p.id, hash: p.contentHash })),
      idempotencyKey: `approval:${workflowId}:${approvalId}`,
    };
    const authority = await this.deps.authority.evaluateWorkflow(references);
    if (!authority.ok) return authority;
    const evaluation = authority.value as { decision?: string; evaluation?: { id?: string; hash?: string; materializationReason?: string; expiresAt?: string } };
    const evaluationRef = evaluation.evaluation;
    if (evaluation.decision !== AuthorityDecision.REQUIRE_APPROVAL || !evaluationRef?.id || !evaluationRef?.hash) {
      return err(ErrorCode.AUTHORITY_BLOCKED, "Resumption evaluation is not REQUIRE_APPROVAL", { decision: evaluation.decision });
    }
    const approvalResult = await this.deps.authority.getApproval(approvalId);
    if (!approvalResult.ok) return approvalResult;
    const approval = approvalResult.value as { status?: string; intentStateHash?: string; workflowId?: string } | undefined;
    if (approval?.workflowId !== workflowId) {
      return err(ErrorCode.APPROVAL_FOREIGN_ACTION, "ApprovalRequest belongs to a different workflow", { approvalWorkflowId: approval?.workflowId });
    }
    if (approval?.status !== "APPROVED" || approval.intentStateHash !== intentStateHash) {
      return err(ErrorCode.APPROVAL_NOT_PENDING, "ApprovalRequest is not APPROVED for the current IntentState", { status: approval?.status });
    }
    const approvalCreatedAt = typeof action?.createdAt === "string" ? action.createdAt : undefined;
    if (!approvalCreatedAt) return err(ErrorCode.VALIDATION_FAILED, "Action lacks a createdAt");
    return this.materializeEvaluatedExecution({
      intentId,
      references,
      evaluation: { id: evaluationRef.id, hash: evaluationRef.hash },
      evaluationBody: authority.value,
      actionArtifact: { id: actionArtifact.id, contentHash: actionArtifact.contentHash },
      intentState: { id: state.value.id, stateHash: state.value.stateHash, version: state.value.version },
      idempotencyKey: references.idempotencyKey,
      approvalId,
      createdAt: approvalCreatedAt,
    });
  }

  /**
   * Phase B explicit path: reference-only COMMIT of an already authorized,
   * unconsumed CommitToken. Never invoked automatically from run() — Phase A
   * still terminates at the unconsumed token. Gateway remains the sole
   * economic executor. DomainPack is not involved.
   */
  async commitAuthorizedExecution(raw: unknown): Promise<Result<unknown>> {
    const parsed = z.object({ commitTokenId: z.string().min(1) }).strict().safeParse(raw);
    if (!parsed.success) return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid commit request");
    if (!this.deps.gateway || typeof this.deps.gateway.commit !== "function") {
      return err(ErrorCode.VALIDATION_FAILED, "Phase B execution path is not wired");
    }
    return this.deps.gateway.commit({ commitTokenId: parsed.data.commitTokenId });
  }
}
