import {
  assertNoUnknownViewKeys,
  pickAllowlisted,
  VIEW_KEY_ALLOWLISTS,
} from "@truemandate/read-model";
import type { IntentWorkspaceView } from "@truemandate/read-model";

/** Allowlisted evidence fields safe for public read (no signature / lineage secrets). */
export const PUBLIC_EVIDENCE_ALLOWLIST = [
  "id",
  "source",
  "contentHash",
  "trustClass",
  "captureTime",
  "eventTime",
  "freshnessDeadline",
  "mimeType",
] as const;

export interface PublicEvidenceView {
  readonly id: string;
  readonly source: string;
  readonly contentHash: string;
  readonly trustClass: string;
  readonly captureTime: string;
  readonly eventTime?: string;
  readonly freshnessDeadline?: string;
  readonly mimeType?: string;
}

export function toPublicEvidenceView(raw: Record<string, unknown>): PublicEvidenceView {
  const picked = pickAllowlisted(raw, PUBLIC_EVIDENCE_ALLOWLIST);
  assertNoUnknownViewKeys(picked, PUBLIC_EVIDENCE_ALLOWLIST);
  return picked as unknown as PublicEvidenceView;
}

export function toPublicWorkspaceView(raw: IntentWorkspaceView): IntentWorkspaceView {
  const workspaceAllowlist = [
    ...VIEW_KEY_ALLOWLISTS.IntentWorkspaceView,
    ...VIEW_KEY_ALLOWLISTS.IntentSummaryView,
    ...VIEW_KEY_ALLOWLISTS.SemanticStateView,
    ...VIEW_KEY_ALLOWLISTS.ConstraintView,
    ...VIEW_KEY_ALLOWLISTS.PlanView,
    ...VIEW_KEY_ALLOWLISTS.PlanStepView,
    ...VIEW_KEY_ALLOWLISTS.GuardianView,
    ...VIEW_KEY_ALLOWLISTS.JudgeView,
    ...VIEW_KEY_ALLOWLISTS.AuthorityView,
    ...VIEW_KEY_ALLOWLISTS.ExecutionView,
    ...VIEW_KEY_ALLOWLISTS.OutcomeView,
    ...VIEW_KEY_ALLOWLISTS.OutcomeRequirementView,
    ...VIEW_KEY_ALLOWLISTS.ResolutionView,
    ...VIEW_KEY_ALLOWLISTS.RemedyOptionView,
    ...VIEW_KEY_ALLOWLISTS.ProvenanceGraphView,
    ...VIEW_KEY_ALLOWLISTS.ProvenanceNodeView,
    ...VIEW_KEY_ALLOWLISTS.ProvenanceEdgeView,
    ...VIEW_KEY_ALLOWLISTS.TimelineView,
    ...VIEW_KEY_ALLOWLISTS.TimelineEventView,
    ...VIEW_KEY_ALLOWLISTS.LifecycleView,
    ...VIEW_KEY_ALLOWLISTS.LifecycleStageView,
    "decision",
    "semanticStatus",
    "criticalFailure",
    "overallFidelity",
    "start",
    "end",
  ];
  assertNoUnknownViewKeys(raw, workspaceAllowlist);
  return raw;
}

/** Allowlisted durable-approval fields (never exposes hash material beyond
 * the row's own integrity hash, and never scope construction). */
export const PUBLIC_APPROVAL_ALLOWLIST = [
  "id",
  "workflowId",
  "intentId",
  "intentStateId",
  "status",
  "requestedCapability",
  "requestedScope",
  // Nested requestedScope fields (the deep view walk re-checks every level).
  "amount",
  "currency",
  "merchant",
  "quantity",
  "requestedAt",
  "expiresAt",
  "decidedAt",
  "decidedBy",
  "decision",
  "reason",
] as const;

export interface PublicApprovalView {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly status: string;
  readonly requestedCapability: string;
  readonly requestedScope: {
    readonly amount: number;
    readonly currency: string;
    readonly merchant: string;
    readonly quantity?: number;
  };
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly decision?: string;
  readonly reason?: string;
}

export function toPublicApprovalView(raw: Record<string, unknown>): PublicApprovalView {
  const picked = pickAllowlisted(raw, PUBLIC_APPROVAL_ALLOWLIST);
  assertNoUnknownViewKeys(picked, PUBLIC_APPROVAL_ALLOWLIST);
  return picked as unknown as PublicApprovalView;
}

/** Allowlisted resolution-case fields (state inspection, never attribution
 * mutation or remedy authority). */
export const PUBLIC_RESOLUTION_CASE_ALLOWLIST = [
  "id",
  "contractId",
  "intentId",
  "intentStateId",
  "openedAt",
  "responsibilityState",
  "state",
  "updatedAt",
] as const;

export interface PublicResolutionCaseView {
  readonly id: string;
  readonly contractId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly openedAt: string;
  readonly responsibilityState: string;
  readonly state: string;
  readonly updatedAt?: string;
}

export function toPublicResolutionCaseView(raw: Record<string, unknown>): PublicResolutionCaseView {
  const picked = pickAllowlisted(raw, PUBLIC_RESOLUTION_CASE_ALLOWLIST);
  assertNoUnknownViewKeys(picked, PUBLIC_RESOLUTION_CASE_ALLOWLIST);
  return picked as unknown as PublicResolutionCaseView;
}

export const PUBLIC_OUTCOME_ALLOWLIST = [
  "id",
  "workflowId",
  "intentId",
  "intentStateId",
  "domain",
  "state",
  "paymentStatus",
  "monitoringContractId",
  "resolutionCaseId",
  "updatedAt",
] as const;

export interface PublicOutcomeView {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly domain: string;
  readonly state: string;
  readonly paymentStatus: string;
  readonly monitoringContractId?: string;
  readonly resolutionCaseId?: string;
  readonly updatedAt?: string;
}

export function toPublicOutcomeView(raw: Record<string, unknown>): PublicOutcomeView {
  const picked = pickAllowlisted(raw, PUBLIC_OUTCOME_ALLOWLIST);
  assertNoUnknownViewKeys(picked, PUBLIC_OUTCOME_ALLOWLIST);
  return picked as unknown as PublicOutcomeView;
}
