import type {
  AuthorityS2SClient,
  GatewayS2SClient,
  IntentProvenanceS2SClient,
} from "@truemandate/cloud-runtime";
import type { OutcomeService } from "@truemandate/outcome-service";
import { hashCanonical } from "@truemandate/crypto";
import { executionActionProvenance, semanticActionProvenance } from "@truemandate/provenance";
import {
  AuthorityDecision,
  ErrorCode,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  PROTOCOL_VERSION,
  SemanticRelation,
  asHashDigest,
  err,
  ok,
  type ActionProposal,
  type GuardianVerdict,
  type PreparedAction,
} from "@truemandate/protocol";
import type { PrivilegedRemedyPort } from "./remedy-pipeline.js";
import type { ResolutionService } from "./service.js";

/** Same null-normalizing canonical binding as @truemandate/guardian-core. */
function hashActionProposal(action: ActionProposal): string {
  return hashCanonical({
    id: action.id,
    intentId: action.intentId,
    intentStateId: action.intentStateId,
    agentId: action.agentId,
    capability: action.capability,
    merchant: action.merchant ?? null,
    product: action.product ?? null,
    quantity: action.quantity ?? null,
    amount: action.amount ?? null,
    currency: action.currency ?? null,
    refundable: action.refundable ?? null,
    deliveryTerms: action.deliveryTerms ?? null,
    parameters: action.parameters,
    consequenceLevel: action.consequenceLevel,
    planId: action.planId ?? null,
    planStepId: action.planStepId ?? null,
  });
}

/**
 * Production remedy execution port: the FULL independent authority chain over
 * the deployed owner routes —
 *
 *   fresh remedy semantic artifacts (owner)
 *   → mandate-validated independent Authority evaluation (INV_023)
 *   → binding-carrying OutcomeContract
 *   → Gateway PREPARE
 *   → Authority bind-and-mint (fresh AuthorityGrant, never the mandate)
 *   → Gateway AUTHORIZE → CommitToken
 *   → reference-only COMMIT
 *
 * Resolution never mints grants or calls the payment adapter itself; every
 * economic step is gated by its owner service.
 */
export function createRemedyExecutionPort(deps: {
  readonly owner: Pick<IntentProvenanceS2SClient, "putSemanticArtifact" | "recordNode" | "recordEdge">;
  readonly authority: Pick<AuthorityS2SClient, "evaluateRemedyProcurement" | "bindAndMint">;
  readonly gateway: Pick<GatewayS2SClient, "prepareFromReferences" | "authorize" | "commit">;
  readonly outcomes: OutcomeService;
  readonly resolution: ResolutionService;
}): PrivilegedRemedyPort {
  return {
    executeBoundEconomicAction: async (input) => {
      const { owner, authority, gateway, outcomes, resolution } = deps;
      const mandateResult = await resolution.getMandate(input.remediationMandateId);
      if (!mandateResult.ok) return mandateResult;
      const mandate = mandateResult.value;
      const remedyResult = resolution.getRemedy(String(mandate.resolutionCaseId), String(mandate.remedyProposalId));
      if (!remedyResult.ok) return remedyResult;

      // Deterministic per-mandate workflow identity: replays rebuild the same
      // immutable artifacts and reuse the same grant/token identities. Every
      // provenance timestamp in the chain is pinned to the immutable mandate
      // (mandate.createdAt) so a replay produces byte-identical artifacts —
      // the owner's immutable-artifact contract fails closed on divergence,
      // and economic freshness is enforced by mandate.expiresAt, not by
      // provenance clocks.
      const workflowId = `wf-remedy-${input.remediationMandateId}`;
      const chainTime = mandate.createdAt;
      const action: ActionProposal = {
        id: `action-${workflowId}` as ActionProposal["id"],
        intentId: input.intentState.intentId,
        intentStateId: input.intentState.id,
        agentId: "resolution-service" as ActionProposal["agentId"],
        capability: input.capability,
        merchant: input.merchant,
        product: "remedy",
        quantity: input.quantity,
        amount: input.amount,
        currency: input.currency,
        refundable: true,
        parameters: { remedy: true, remediationMandateId: input.remediationMandateId },
        consequenceLevel: "HIGH",
        createdAt: chainTime,
      };
      const actionContentHash = asHashDigest(hashActionProposal(action));
      const verdict: GuardianVerdict = {
        id: `guardian-verdict-${workflowId}`,
        actionId: action.id,
        intentId: action.intentId,
        intentStateId: action.intentStateId,
        intentStateHash: input.intentState.stateHash as GuardianVerdict["intentStateHash"],
        actionContentHash,
        evidenceSnapshotHash: "remedy-mandate-bound" as GuardianVerdict["evidenceSnapshotHash"],
        decision: AuthorityDecision.ALLOW,
        semanticStatus: GuardianSemanticStatus.CLEAR,
        overallFidelity: 1,
        constraintClaims: [],
        contradictions: [],
        uncertainty: 0,
        criticalFailure: false,
        judgeResults: [
          { judgeId: JudgeId.FIDELITY, status: JudgeInvocationStatus.OK, findings: [] },
        ],
        protocolVersion: PROTOCOL_VERSION,
        promptVersions: {},
        schemaVersions: {},
        stale: false,
        createdAt: chainTime,
        verdictHash: actionContentHash,
      };

      const guardianId = `guardian-${workflowId}`;
      const actionId = action.id;
      // The remedy lane has no intent-state guardian proof obligations; the
      // institutional obligation discharged here is the RemediationMandate
      // itself. The strict owner schema requires an evaluated immutable proof
      // set, so the mandate-bound authority evaluation is materialized as a
      // PROOF artifact and the GUARDIAN evaluates exactly that proof.
      const mandateObligationId = `mandate:${mandate.id}`;
      const mandateContentHash = hashCanonical({
        id: mandate.id,
        resolutionCaseId: mandate.resolutionCaseId,
        remedyProposalId: mandate.remedyProposalId,
        principalId: mandate.principalId,
        maxAmount: mandate.maxAmount,
        currency: mandate.currency,
        allowedCapabilities: [...mandate.allowedCapabilities],
        allowedMerchants: [...mandate.allowedMerchants],
        expiresAt: mandate.expiresAt,
        createdAt: mandate.createdAt,
        status: mandate.status,
        consumedAt: mandate.consumedAt ?? null,
      });
      const actionPayload = {
        intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash,
        action,
        requiredProofObligationIds: [mandateObligationId],
        authorityRequest: {
          id: `authority-${workflowId}`,
          principalId: input.principalId,
          agentId: "resolution-service",
          intentId: input.intentState.intentId,
          intentStateId: input.intentState.id,
          actionId: action.id,
          capability: input.capability,
          scope: {
            capabilities: { execute_payment: AuthorityDecision.ALLOW },
            maxAmount: input.grantScopeMaxAmount,
            currency: input.currency,
            allowedMerchants: [input.merchant],
            expiresAt: input.expiresAt,
          },
          merchant: input.merchant,
          amount: input.amount,
          currency: input.currency,
          createdAt: chainTime,
        },
      };
      const workflowPayload = {
        intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash,
        state: "REMEDY_EXECUTION",
      };
      // Creation order satisfies the owner's immutable predecessor validation:
      // ACTION → PROOF → GUARDIAN → WORKFLOW.
      const actionArtifact = await owner.putSemanticArtifact({
        id: actionId,
        intentId: input.intentState.intentId,
        workflowId,
        kind: "ACTION",
        payload: actionPayload,
        predecessors: [],
        createdAt: chainTime,
      });
      if (!actionArtifact.ok) return actionArtifact;
      const actionArtifactHash = String((actionArtifact.value as { contentHash?: string }).contentHash);
      const proofId = `proof-${workflowId}-mandate`;
      const proofArtifact = await owner.putSemanticArtifact({
        id: proofId,
        intentId: input.intentState.intentId,
        workflowId,
        kind: "PROOF",
        payload: {
          intentStateId: input.intentState.id,
          intentStateHash: input.intentState.stateHash,
          schemaVersion: "1",
          proofId,
          obligationId: mandateObligationId,
          actionArtifactId: actionId,
          actionPayloadHash: actionContentHash,
          status: "SATISFIED",
          evidenceRefs: [{ id: mandate.id, hash: mandateContentHash }],
          evaluatedAt: chainTime,
          method: "mandate-bound-authority-evaluation",
        },
        predecessors: [{ id: actionId, kind: "ACTION", contentHash: actionArtifactHash }],
        createdAt: chainTime,
      });
      if (!proofArtifact.ok) return proofArtifact;
      const proofArtifactHash = String((proofArtifact.value as { contentHash?: string }).contentHash);
      const guardianPayload = {
        intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash,
        verdict,
        actionArtifactId: actionId,
        actionArtifactHash: actionContentHash,
        evaluatedProofs: [{ id: proofId, hash: proofArtifactHash, obligationId: mandateObligationId }],
      };
      const guardianArtifact = await owner.putSemanticArtifact({
        id: guardianId,
        intentId: input.intentState.intentId,
        workflowId,
        kind: "GUARDIAN",
        payload: guardianPayload,
        predecessors: [
          { id: actionId, kind: "ACTION", contentHash: actionArtifactHash },
          { id: proofId, kind: "PROOF", contentHash: proofArtifactHash },
        ],
        createdAt: chainTime,
      });
      if (!guardianArtifact.ok) return guardianArtifact;
      const workflowArtifact = await owner.putSemanticArtifact({
        id: workflowId,
        intentId: input.intentState.intentId,
        workflowId,
        kind: "WORKFLOW",
        payload: workflowPayload,
        predecessors: [{ id: guardianId, kind: "GUARDIAN", contentHash: String((guardianArtifact.value as { contentHash?: string }).contentHash) }],
        createdAt: chainTime,
      });
      if (!workflowArtifact.ok) return workflowArtifact;

      const references = {
        workflowId,
        intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash,
        workflow: { id: workflowId, hash: String((workflowArtifact.value as { contentHash?: string }).contentHash) },
        action: { id: actionId, hash: String((actionArtifact.value as { contentHash?: string }).contentHash) },
        guardian: { id: guardianId, hash: String((guardianArtifact.value as { contentHash?: string }).contentHash) },
        mandateId: input.remediationMandateId,
        resolutionCaseId: String(mandate.resolutionCaseId),
        originalPaymentGrantId: input.originalPaymentGrantId,
        idempotencyKey: input.idempotencyKey,
      };

      // Independent authority evaluation: the Authority owner re-validates the
      // mandate and its case/remedy bindings, then creates the executable record.
      const evaluationResult = await authority.evaluateRemedyProcurement(references);
      if (!evaluationResult.ok) return evaluationResult;
      const evaluation = (evaluationResult.value as { evaluation?: { id?: string; hash?: string; expiresAt?: string } }).evaluation;
      if (!evaluation?.id || !evaluation?.hash) {
        return err(ErrorCode.AUTHORITY_BLOCKED, "Remedy evaluation missing record reference");
      }

      // The remedy OutcomeContract IS the execution contract (binding-carrying).
      const contractId = `outcome-remedy-${evaluation.id}`;
      const binding = {
        workflowId,
        workflowHash: references.workflow.hash as never,
        actionId,
        actionHash: references.action.hash as never,
        evaluationId: evaluation.id,
        evaluationHash: evaluation.hash as never,
        evaluatedIntentStateId: input.intentState.id,
        evaluatedIntentStateHash: input.intentState.stateHash as never,
        evaluatedIntentStateVersion: input.intentState.version,
      };
      const contractResult = await outcomes.createPreExecutionProcurementContract({
        id: contractId,
        intentState: input.intentState,
        principalId: input.principalId,
        merchant: input.merchant,
        quantity: input.quantity,
        budgetMax: Math.max(input.grantScopeMaxAmount, input.amount),
        product: "remedy",
        actionProposalId: actionId,
        actionContentHash: references.action.hash as never,
        createdAt: chainTime,
        preExecutionBinding: binding,
      });
      if (!contractResult.ok) return contractResult;
      const contract = contractResult.value;

      const preparedResult = await gateway.prepareFromReferences({
        evaluation: { id: evaluation.id, hash: evaluation.hash },
        outcomeContract: { id: contract.id, hash: String(contract.definitionHash) },
        workflow: references.workflow,
        action: references.action,
        idempotencyKey: input.idempotencyKey,
      });
      if (!preparedResult.ok) return preparedResult;
      const prepared = preparedResult.value as PreparedAction;

      // Semantic-action provenance is owner-derived from the immutable remedy
      // ACTION artifact (established before the execution edge).
      const semanticAction = semanticActionProvenance({
        actionId, actionHash: references.action.hash,
        workflowId, intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash, intentStateVersion: input.intentState.version,
      }, chainTime);
      const semanticNode = await owner.recordNode(semanticAction);
      if (!semanticNode.ok) return semanticNode;
      // The commit-time reconstruction requires the semantic action ← intent
      // derivation edge with its canonical identity.
      const actionIntentEdge = await owner.recordEdge({
        id: `semantic-action-intent-${workflowId}`,
        from: `intent-node-${input.intentState.intentId}`,
        to: semanticAction.id,
        relation: SemanticRelation.DERIVED_FROM,
        createdAt: chainTime,
        metadata: { actionHash: references.action.hash, workflowId },
      });
      if (!actionIntentEdge.ok) return actionIntentEdge;
      // Execution provenance: the Gateway commit path requires the durable
      // execution-action node (and its edge) to exist before COMMIT.
      const execution = executionActionProvenance({
        preparedActionId: prepared.id, preparedActionHash: prepared.preparedActionHash,
        actionId, actionHash: references.action.hash,
        workflowId, evaluationId: evaluation.id,
        evaluationHash: evaluation.hash, outcomeContractId: contract.id,
        outcomeContractHash: String(contract.definitionHash), intentStateId: input.intentState.id,
        intentStateHash: input.intentState.stateHash, intentStateVersion: input.intentState.version,
      }, chainTime);
      const executionNode = await owner.recordNode(execution.node);
      if (!executionNode.ok) return executionNode;
      const executionEdge = await owner.recordEdge(execution.edge);
      if (!executionEdge.ok) return executionEdge;

      const mintResult = await authority.bindAndMint({
        evaluation: { id: evaluation.id, hash: evaluation.hash },
        preparedAction: { id: prepared.id, hash: prepared.preparedActionHash },
        outcomeContract: { id: contract.id, hash: String(contract.definitionHash) },
        idempotencyKey: input.idempotencyKey,
      });
      if (!mintResult.ok) return mintResult;
      const grant = mintResult.value as { id?: string; expiresAt?: string };
      if (!grant.id || !grant.expiresAt) {
        return err(ErrorCode.AUTHORITY_BLOCKED, "Remedy grant mint missing reference");
      }

      const authorizedResult = await gateway.authorize({
        preparedActionId: prepared.id,
        grantId: grant.id,
        expiresAt: grant.expiresAt,
      });
      if (!authorizedResult.ok) return authorizedResult;
      const authorization = authorizedResult.value as { commitToken?: { id?: string } };
      const tokenId = authorization.commitToken?.id;
      if (!tokenId) {
        return err(ErrorCode.VALIDATION_FAILED, "Remedy authorize missing CommitToken");
      }

      const commitResult = await gateway.commit({ commitTokenId: tokenId });
      if (!commitResult.ok) return commitResult;
      const commit = commitResult.value as {
        status?: "SUCCESS" | "FAILED" | "UNKNOWN" | "IDEMPOTENT_REPLAY";
        sideEffect?: { id?: string };
      };
      // IDEMPOTENT_REPLAY is the durable confirmation that THIS execution
      // (same idempotency key) already succeeded — converge, never re-execute.
      const status = commit.status === "IDEMPOTENT_REPLAY" ? "SUCCESS" : (commit.status ?? "UNKNOWN");
      return ok({
        status,
        preparedActionId: prepared.id,
        preparedActionHash: prepared.preparedActionHash,
        executionGrantId: grant.id,
        sideEffectId: commit.sideEffect?.id,
        executionOutcomeContractId: contract.id,
        executionOutcomeContractHash: String(contract.definitionHash),
      });
    },
  };
}
