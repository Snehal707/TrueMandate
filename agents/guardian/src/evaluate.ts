import { runContradictionJudge } from "@truemandate/contradiction-judge";
import { runDevilsAdvocate } from "@truemandate/devils-advocate";
import { runEvidenceJudge } from "@truemandate/evidence-judge";
import { runFidelityJudge } from "@truemandate/fidelity-judge";
import {
  aggregateGuardianVerdict,
  hashActionProposal,
} from "@truemandate/guardian-core";
import type { IntentService } from "@truemandate/intent-service";
import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  err,
  ok,
  type ActionProposal,
  type EvidenceClaim,
  type EvidenceEnvelope,
  type GuardianVerdict,
  type PlanGraph,
  type Result,
} from "@truemandate/protocol";
import { runProvenanceJudge } from "@truemandate/provenance-judge";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { emptyTaint } from "@truemandate/provenance";

export interface EvaluateActionProposalInput {
  readonly action: ActionProposal;
  readonly evidenceEnvelopes?: readonly EvidenceEnvelope[];
  readonly evidenceClaims?: readonly EvidenceClaim[];
  readonly plan?: PlanGraph;
  readonly actionNodeId?: string;
  readonly expectedActionHash?: string;
  readonly claimedFacts?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
}

export interface EvaluateActionProposalDeps {
  readonly model: ModelPort;
  readonly intents: IntentService;
  readonly provenance: ProvenanceService;
  /** Optional per-schema model ports; default uses deps.model for all judges. */
  readonly models?: Partial<{
    fidelity: ModelPort;
    contradiction: ModelPort;
    devilsAdvocate: ModelPort;
    provenance: ModelPort;
    evidence: ModelPort;
  }>;
}

/**
 * Semantic Guardian orchestrator: validate binding → independent judges →
 * deterministic aggregate → provenance. Recommendation only — no grants/gateway.
 */
export async function evaluateActionProposal(
  input: EvaluateActionProposalInput,
  deps: EvaluateActionProposalDeps,
): Promise<Result<GuardianVerdict>> {
  const tip = await deps.intents.getCurrentIntentState(input.action.intentId);
  if (!tip.ok) return tip;

  const state = await deps.intents.getIntentState(input.action.intentStateId);
  if (!state.ok) return state;

  if (state.value.id !== tip.value.id) {
    return err(
      ErrorCode.GUARDIAN_VERDICT_STALE,
      "ActionProposal IntentState is not the current tip",
      { tip: tip.value.id, proposalState: state.value.id },
    );
  }

  const intent = await deps.intents.getIntent(input.action.intentId);
  if (!intent.ok) return intent;

  const envelopes = input.evidenceEnvelopes ?? [];
  const claims = input.evidenceClaims ?? [];
  const createdAt = input.createdAt ?? new Date().toISOString();
  const actionHash = hashActionProposal(input.action);

  // Record ActionProposal node for provenance binding (idempotent-ish by id)
  const actionNodeId = asProvenanceNodeId(
    input.actionNodeId ?? `action-${input.action.id}`,
  );
  if (!(await deps.provenance.getNode(actionNodeId)).ok) {
    await deps.provenance.recordNode({
      id: actionNodeId,
      kind: ProvenanceNodeKind.ACTION,
      label: `proposal:${input.action.capability}`,
      createdAt,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
      metadata: {
        actionId: input.action.id,
        actionContentHash: actionHash,
        intentStateId: input.action.intentStateId,
      },
    });
  }

  const shared = {
    rawIntent: intent.value.rawText,
    intentState: state.value,
    constraints: state.value.constraints,
    plan: input.plan,
    action: input.action,
    evidenceClaims: claims,
    assumptions: state.value.assumptions,
  };

  const [
    fidelity,
    contradiction,
    devil,
    provenanceResult,
    evidence,
  ] = await Promise.all([
    runFidelityJudge(shared, {
      model: deps.models?.fidelity ?? deps.model,
    }),
    runContradictionJudge(
      {
        constraints: state.value.constraints,
        action: input.action,
        evidenceClaims: claims,
        evidenceEnvelopes: envelopes,
      },
      { model: deps.models?.contradiction ?? deps.model },
    ),
    runDevilsAdvocate(shared, {
      model: deps.models?.devilsAdvocate ?? deps.model,
    }),
    runProvenanceJudge(
      { action: input.action, actionNodeId },
      {
        model: deps.models?.provenance ?? deps.model,
        provenance: deps.provenance,
      },
    ),
    runEvidenceJudge(
      {
        action: input.action,
        evidenceEnvelopes: envelopes,
        evidenceClaims: claims,
        claimedFacts: input.claimedFacts,
      },
      { model: deps.models?.evidence ?? deps.model },
    ),
  ]);

  const judgeResults = [
    fidelity,
    contradiction,
    devil,
    provenanceResult,
    evidence,
  ];

  // Provenance FINDING nodes per judge (independent of aggregation)
  for (const jr of judgeResults) {
    for (const [i, f] of jr.findings.entries()) {
      const findingId = asProvenanceNodeId(
        `finding-${input.action.id}-${jr.judgeId}-${i}`,
      );
      await deps.provenance.recordNode({
        id: findingId,
        kind: ProvenanceNodeKind.FINDING,
        label: `${jr.judgeId}:${f.code}`,
        createdAt,
        trustClass: TrustClass.TRUSTED_SYSTEM,
        taint: emptyTaint(),
        metadata: {
          judgeId: jr.judgeId,
          code: f.code,
          severity: f.severity,
          status: jr.status,
        },
      });
      await deps.provenance.recordEdge({
        id: asProvenanceEdgeId(`e-${actionNodeId}-${findingId}`),
        from: actionNodeId,
        to: findingId,
        relation: SemanticRelation.SUPPORTS,
        createdAt,
      });
    }
  }

  const aggregated = aggregateGuardianVerdict({
    action: input.action,
    intentState: state.value,
    tipIntentStateId: tip.value.id,
    expectedActionHash: input.expectedActionHash,
    evidenceEnvelopes: envelopes,
    evidenceClaims: claims,
    judgeResults,
    planId: input.plan?.id ?? input.action.planId,
    planVersion: input.plan?.version,
    createdAt,
  });

  if (!aggregated.ok) return aggregated;

  const verdict = aggregated.value;
  const verdictNodeId = asProvenanceNodeId(`guardian-${verdict.id}`);
  await deps.provenance.recordNode({
    id: verdictNodeId,
    kind: ProvenanceNodeKind.DECISION,
    label: `guardian:${verdict.decision}`,
    createdAt,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: emptyTaint(),
    metadata: {
      semanticStatus: verdict.semanticStatus,
      criticalFailure: verdict.criticalFailure,
      actionContentHash: verdict.actionContentHash,
      verdictHash: verdict.verdictHash,
      recommendationOnly: true,
    },
  });
  await deps.provenance.recordEdge({
    id: asProvenanceEdgeId(`e-${actionNodeId}-${verdictNodeId}`),
    from: actionNodeId,
    to: verdictNodeId,
    relation: SemanticRelation.RESULTED_IN,
    createdAt,
  });

  return ok(verdict);
}

export interface VerdictFreshnessContext {
  readonly tipIntentStateId: string;
  readonly intentStateHash: string;
  readonly evidenceSnapshotHash?: string;
  readonly planId?: string;
  readonly planVersion?: number;
}

/** True when any material bound input has drifted since the verdict was issued. */
export function isVerdictStale(
  verdict: GuardianVerdict,
  action: ActionProposal,
  ctx: VerdictFreshnessContext | string,
): boolean {
  const tip =
    typeof ctx === "string"
      ? { tipIntentStateId: ctx, intentStateHash: verdict.intentStateHash }
      : ctx;
  if (verdict.stale) return true;
  if (verdict.intentStateId !== tip.tipIntentStateId) return true;
  if (verdict.intentStateHash !== tip.intentStateHash) return true;
  if (verdict.actionContentHash !== hashActionProposal(action)) return true;
  if (
    tip.evidenceSnapshotHash !== undefined &&
    verdict.evidenceSnapshotHash !== tip.evidenceSnapshotHash
  ) {
    return true;
  }
  if (tip.planId !== undefined && verdict.planId !== tip.planId) return true;
  if (
    tip.planVersion !== undefined &&
    verdict.planVersion !== tip.planVersion
  ) {
    return true;
  }
  return false;
}
