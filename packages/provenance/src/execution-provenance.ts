import { hashCanonical } from "@truemandate/crypto";
import { ProvenanceNodeKind, SemanticRelation, TrustClass, type ProvenanceEdge, type ProvenanceNode } from "@truemandate/protocol";
import { z } from "zod";
import { emptyTaint } from "./graph.js";

export type ExecutionLineage = Readonly<{
  preparedActionId: string; preparedActionHash: string; actionId: string; actionHash: string;
  workflowId: string; evaluationId: string; evaluationHash: string; outcomeContractId: string;
  outcomeContractHash: string; intentStateId: string; intentStateHash: string; intentStateVersion: number;
}>;

/** Immutable lineage carried by every pre-execution provenance record. */
export const ExecutionLineageSchema = z.object({
  preparedActionId: z.string().min(1), preparedActionHash: z.string().regex(/^[a-f0-9]{64}$/i),
  actionId: z.string().min(1), actionHash: z.string().regex(/^[a-f0-9]{64}$/i),
  workflowId: z.string().min(1), evaluationId: z.string().min(1), evaluationHash: z.string().regex(/^[a-f0-9]{64}$/i),
  outcomeContractId: z.string().min(1), outcomeContractHash: z.string().regex(/^[a-f0-9]{64}$/i),
  intentStateId: z.string().min(1), intentStateHash: z.string().regex(/^[a-f0-9]{64}$/i), intentStateVersion: z.number().int().nonnegative(),
}).strict();

export const executionActionNodeId = (lineage: Pick<ExecutionLineage, "preparedActionId">) => `execution-action-${lineage.preparedActionId}`;
export const semanticActionNodeId = (lineage: Pick<ExecutionLineage, "workflowId">) => `action-provenance-${lineage.workflowId}`;

/**
 * Compilation candidate-scoped provenance identities. A constraint/assumption
 * provenance node represents an occurrence inside one particular compilation
 * candidate, so its deterministic ID binds the candidate content hash plus the
 * constraint/assumption identity. Distinct compilation attempts therefore
 * never collide on immutable provenance rows, while lineage to the source
 * intent is preserved by the recorded DERIVED_FROM edges.
 */
export const candidateConstraintProvenanceNodeId = (candidateHash: string, constraintId: string) =>
  `cand-c-${candidateHash}-${constraintId}`;
export const candidateAssumptionProvenanceNodeId = (candidateHash: string, assumptionId: string) =>
  `cand-a-${candidateHash}-${assumptionId}`;
export const authorityGrantNodeId = (grantId: string) => `authority-grant-${grantId}`;
export const executionActionEdgeId = (lineage: ExecutionLineage) => `execution-action-derived-${hashCanonical({ action: lineage.actionId, prepared: lineage.preparedActionId }).slice(0, 24)}`;

export function semanticActionProvenance(lineage: Pick<ExecutionLineage, "actionId" | "actionHash" | "workflowId" | "intentStateId" | "intentStateHash" | "intentStateVersion">, createdAt: string): ProvenanceNode {
  return {
    id: semanticActionNodeId(lineage) as never,
    kind: ProvenanceNodeKind.ACTION,
    label: `semantic-action:${lineage.actionId}`,
    createdAt,
    trustClass: TrustClass.TRUSTED_SYSTEM,
    taint: emptyTaint(),
    metadata: { actionId: lineage.actionId, actionHash: lineage.actionHash, workflowId: lineage.workflowId, intentStateId: lineage.intentStateId, intentStateHash: lineage.intentStateHash, intentStateVersion: lineage.intentStateVersion },
  };
}

export function executionActionProvenance(lineage: ExecutionLineage, createdAt: string): { node: ProvenanceNode; edge: ProvenanceEdge } {
  ExecutionLineageSchema.parse(lineage);
  const node: ProvenanceNode = { id: executionActionNodeId(lineage) as never, kind: ProvenanceNodeKind.ACTION, label: `execution-action:${lineage.preparedActionId}`, createdAt, trustClass: TrustClass.TRUSTED_SYSTEM, taint: emptyTaint(), metadata: { ...lineage } };
  return { node, edge: { id: executionActionEdgeId(lineage) as never, from: semanticActionNodeId(lineage) as never, to: node.id, relation: SemanticRelation.DERIVED_FROM, createdAt, metadata: { workflowId: lineage.workflowId, actionHash: lineage.actionHash, preparedActionHash: lineage.preparedActionHash } } };
}

export type AuthorityExecutionLineage = ExecutionLineage & Readonly<{ grantId: string; grantHash: string; principalId: string }>;
export const AuthorityExecutionLineageSchema = ExecutionLineageSchema.extend({
  grantId: z.string().min(1), grantHash: z.string().regex(/^[a-f0-9]{64}$/i), principalId: z.string().min(1),
}).strict();

/**
 * PRINCIPAL = stable actor identity. The principal node id is derived from
 * the principal id alone and is shared by every authorization the actor
 * participates in; the per-authorization occurrence lives in the
 * authority-grant-{grantId} node and the AUTHORIZES/INTRODUCED_BY edges.
 * The first legitimate occurrence creates the canonical principal node;
 * later authorizations reuse and verify it — they must never rewrite its
 * identity attributes or timestamps. This is the canonical shared
 * derivation used by the Authority binding route and by Gateway's
 * reconstruction (byte-for-byte equivalent ids).
 */
export const principalNodeId = (principalId: string) => `principal-${principalId}`;

/** Stable PRINCIPAL identity content — intentionally excludes the occurrence
 * createdAt, which is a first-creation fact and not part of the identity. */
export function principalIdentityMatches(node: ProvenanceNode, principalId: string): boolean {
  return node.id === principalNodeId(principalId)
    && node.kind === ProvenanceNodeKind.PRINCIPAL
    && node.label === `principal:${principalId}`
    && hashCanonical(node.metadata) === hashCanonical({ principalId });
}

export function authorityExecutionProvenance(lineage: AuthorityExecutionLineage, createdAt: string): { principal: ProvenanceNode; authority: ProvenanceNode; principalEdge: ProvenanceEdge; authorizes: ProvenanceEdge } {
  AuthorityExecutionLineageSchema.parse(lineage);
  const principalId = principalNodeId(lineage.principalId);
  const authorityId = authorityGrantNodeId(lineage.grantId);
  const principal: ProvenanceNode = { id: principalId as never, kind: ProvenanceNodeKind.PRINCIPAL, label: `principal:${lineage.principalId}`, createdAt, trustClass: TrustClass.TRUSTED_HUMAN, taint: emptyTaint(), metadata: { principalId: lineage.principalId } };
  const authority: ProvenanceNode = { id: authorityId as never, kind: ProvenanceNodeKind.AUTHORITY, label: `authority-grant:${lineage.grantId}`, createdAt, trustClass: TrustClass.TRUSTED_SYSTEM, taint: emptyTaint(), metadata: { ...lineage } };
  const principalEdge: ProvenanceEdge = { id: `principal-authority-${hashCanonical({ principalId, authorityId }).slice(0, 24)}` as never, from: principal.id, to: authority.id, relation: SemanticRelation.INTRODUCED_BY, createdAt, metadata: { grantId: lineage.grantId, grantHash: lineage.grantHash } };
  const authorizes: ProvenanceEdge = { id: `authorizes-${hashCanonical({ authorityId, execution: executionActionNodeId(lineage) }).slice(0, 24)}` as never, from: authority.id, to: executionActionNodeId(lineage) as never, relation: SemanticRelation.AUTHORIZES, createdAt, metadata: { ...lineage } };
  return { principal, authority, principalEdge, authorizes };
}
