import { hashCanonical } from "@truemandate/crypto";
import { authorityGrantNodeId, executionActionEdgeId, executionActionNodeId, principalIdentityMatches, principalNodeId, semanticActionNodeId } from "@truemandate/provenance";
import { ErrorCode, ProvenanceNodeKind, SemanticRelation, err, ok, type AuthorityGrant, type CommitToken, type PreparedAction, type ProvenanceEdge, type ProvenanceNode, type Result } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";

export type ProvenanceOwnerReadPort = Readonly<{
  getNode(id: string): Promise<Result<ProvenanceNode>>;
  getEdge(id: string): Promise<Result<ProvenanceEdge>>;
}>;

function executionLineageFrom(preparedAction: PreparedAction) {
  return {
    preparedActionId: preparedAction.id, preparedActionHash: preparedAction.preparedActionHash,
    actionId: preparedAction.actionProposalId!, actionHash: preparedAction.actionContentHash!,
    workflowId: preparedAction.workflowId!, evaluationId: preparedAction.evaluationRecordId!, evaluationHash: preparedAction.evaluationRecordHash!,
    outcomeContractId: preparedAction.outcomeContractId!, outcomeContractHash: preparedAction.outcomeContractHash!,
    intentStateId: preparedAction.intentStateId, intentStateHash: preparedAction.intentStateHash ?? "",
    intentStateVersion: preparedAction.evaluatedIntentStateVersion ?? -1,
  };
}

/**
 * Authorize-time authority-provenance gate (2026-08-18 repair).
 *
 * A durable AuthorityGrant becomes usable economic authority only when its
 * required Authority provenance is durably complete and reconstructable:
 * the stable principal node, the grant-scoped Authority node, and the
 * canonical INTRODUCED_BY / AUTHORIZES edges. This closes the v4 orphan
 * window (grant durable, binding incomplete) deterministically — the
 * authority-binding route's own records are the single source of truth, and
 * every identity derives from the canonical durable lineage via the shared
 * provenance package. Missing or divergent records fail closed.
 */
export async function assertAuthorityProvenanceComplete(input: {
  readonly grant: AuthorityGrant;
  readonly preparedAction: PreparedAction;
  readonly provenance: ProvenanceOwnerReadPort;
}): Promise<Result<readonly ProvenanceNode[]>> {
  const { grant, preparedAction, provenance } = input;
  const lineage = executionLineageFrom(preparedAction);
  if (Object.values(lineage).some((value) => value === undefined || value === "")) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "PreparedAction lacks immutable execution lineage");
  }
  if (grant.preparedActionId !== preparedAction.id || grant.preparedActionHash !== preparedAction.preparedActionHash ||
    grant.workflowId !== lineage.workflowId || grant.actionContentHash !== lineage.actionHash ||
    grant.evaluationRecordId !== lineage.evaluationId || grant.evaluationRecordHash !== lineage.evaluationHash ||
    grant.outcomeContractId !== lineage.outcomeContractId || grant.outcomeContractHash !== lineage.outcomeContractHash ||
    grant.intentStateId !== lineage.intentStateId || grant.stateHash !== lineage.intentStateHash ||
    grant.evaluatedIntentStateVersion !== lineage.intentStateVersion) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Grant execution lineage mismatch");
  }
  const principalId = principalNodeId(grant.principalId);
  const authorityId = authorityGrantNodeId(grant.id);
  const principalEdgeId = `principal-authority-${hashCanonical({ principalId, authorityId }).slice(0, 24)}`;
  const authorizesEdgeId = `authorizes-${hashCanonical({ authorityId, execution: executionActionNodeId(lineage) }).slice(0, 24)}`;
  const expectedAuthority = { ...lineage, grantId: grant.id, grantHash: hashCanonical(grant), principalId: grant.principalId };

  const principal = await provenance.getNode(principalId);
  if (!principal.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Authority provenance incomplete: principal node missing");
  if (!principalIdentityMatches(principal.value, grant.principalId)) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable principal provenance identity mismatch");
  }
  const authority = await provenance.getNode(authorityId);
  if (!authority.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Authority provenance incomplete: Authority node missing");
  if (authority.value.kind !== ProvenanceNodeKind.AUTHORITY || hashCanonical(authority.value.metadata) !== hashCanonical(expectedAuthority)) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable Authority provenance metadata mismatch");
  }
  const principalEdge = await provenance.getEdge(principalEdgeId);
  if (!principalEdge.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Authority provenance incomplete: principal authority edge missing");
  if (principalEdge.value.from !== principalId || principalEdge.value.to !== authorityId || principalEdge.value.relation !== SemanticRelation.INTRODUCED_BY ||
    hashCanonical(principalEdge.value.metadata) !== hashCanonical({ grantId: grant.id, grantHash: hashCanonical(grant) })) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable principal authority edge mismatch");
  }
  const authorizes = await provenance.getEdge(authorizesEdgeId);
  if (!authorizes.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Authority provenance incomplete: AUTHORIZES edge missing");
  if (authorizes.value.from !== authorityId || authorizes.value.to !== executionActionNodeId(lineage) || authorizes.value.relation !== SemanticRelation.AUTHORIZES ||
    hashCanonical(authorizes.value.metadata) !== hashCanonical(expectedAuthority)) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable AUTHORIZES provenance edge mismatch");
  }
  return ok([principal.value, authority.value]);
}

/**
 * Phase-A reconstruction only. It deliberately receives no caller provenance
 * identifiers and is not wired into COMMIT until the prerequisite is closed.
 */
export async function reconstructExecutionAuthorityPath(input: {
  readonly token: CommitToken;
  readonly preparedAction: PreparedAction;
  readonly grant: AuthorityGrant;
  readonly provenance: ProvenanceOwnerReadPort;
}): Promise<Result<readonly ProvenanceNode[]>> {
  const { token, preparedAction, grant, provenance } = input;
  if (token.grantId !== grant.id || token.preparedActionId !== preparedAction.id || token.preparedActionHash !== preparedAction.preparedActionHash || grant.preparedActionId !== preparedAction.id || grant.preparedActionHash !== preparedAction.preparedActionHash) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "CommitToken, grant, and PreparedAction bindings differ");
  }
  const lineage = {
    preparedActionId: preparedAction.id, preparedActionHash: preparedAction.preparedActionHash,
    actionId: preparedAction.actionProposalId!, actionHash: preparedAction.actionContentHash!,
    workflowId: preparedAction.workflowId!, evaluationId: preparedAction.evaluationRecordId!, evaluationHash: preparedAction.evaluationRecordHash!,
    outcomeContractId: preparedAction.outcomeContractId!, outcomeContractHash: preparedAction.outcomeContractHash!,
    intentStateId: preparedAction.intentStateId, intentStateHash: preparedAction.intentStateHash ?? "",
    intentStateVersion: preparedAction.evaluatedIntentStateVersion ?? -1,
  };
  if (Object.values(lineage).some((value) => value === undefined || value === "")) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "PreparedAction lacks immutable execution lineage");
  if (grant.workflowId !== lineage.workflowId || grant.actionContentHash !== lineage.actionHash || grant.evaluationRecordId !== lineage.evaluationId || grant.evaluationRecordHash !== lineage.evaluationHash || grant.outcomeContractId !== lineage.outcomeContractId || grant.outcomeContractHash !== lineage.outcomeContractHash || grant.intentStateId !== lineage.intentStateId || grant.stateHash !== lineage.intentStateHash || grant.evaluatedIntentStateVersion !== lineage.intentStateVersion) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Grant execution lineage mismatch");
  const authorityId = authorityGrantNodeId(grant.id);
  const executionId = executionActionNodeId(lineage);
  const authEdgeId = `authorizes-${hashCanonical({ authorityId, execution: executionId }).slice(0, 24)}`;
  const principalId = principalNodeId(grant.principalId);
  const principalEdgeId = `principal-authority-${hashCanonical({ principalId, authorityId }).slice(0, 24)}`;
  const semanticId = semanticActionNodeId(lineage);
  const derivedId = executionActionEdgeId(lineage);
  const requiredNodes = [
    `intent-node-${grant.intentId}`, semanticId, executionId, principalId, authorityId,
  ];
  const requiredEdges = [
    `semantic-action-intent-${lineage.workflowId}`, derivedId, principalEdgeId, authEdgeId,
  ];
  const graph = new ProvenanceService();
  for (const id of requiredNodes) {
    const node = await provenance.getNode(id);
    if (!node.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable provenance record missing", { id });
    const saved = await graph.recordNode(node.value);
    if (!saved.ok) return saved as Result<readonly ProvenanceNode[]>;
  }
  for (const id of requiredEdges) {
    const edge = await provenance.getEdge(id);
    if (!edge.ok) return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable provenance record missing", { id });
    const saved = await graph.recordEdge(edge.value);
    if (!saved.ok) return saved as Result<readonly ProvenanceNode[]>;
  }
  const execution = graph.getNode(executionId);
  const authority = graph.getNode(authorityId);
  const semantic = graph.getNode(semanticId);
  const principal = graph.getNode(principalId);
  const derived = graph.getGraph().listEdges().find((edge) => edge.id === derivedId);
  const principalEdge = graph.getGraph().listEdges().find((edge) => edge.id === principalEdgeId);
  const authorizes = graph.getGraph().listEdges().find((edge) => edge.id === authEdgeId);
  const expectedAuthority = { ...lineage, grantId: grant.id, grantHash: hashCanonical(grant), principalId: grant.principalId };
  if (!execution.ok || !authority.ok || !semantic.ok || !principal.ok || !derived || !principalEdge || !authorizes ||
    execution.value.kind !== ProvenanceNodeKind.ACTION || semantic.value.kind !== ProvenanceNodeKind.ACTION || authority.value.kind !== ProvenanceNodeKind.AUTHORITY || principal.value.kind !== ProvenanceNodeKind.PRINCIPAL ||
    hashCanonical(semantic.value.metadata) !== hashCanonical({ actionId: lineage.actionId, actionHash: lineage.actionHash, workflowId: lineage.workflowId, intentStateId: lineage.intentStateId, intentStateHash: lineage.intentStateHash, intentStateVersion: lineage.intentStateVersion }) ||
    hashCanonical(execution.value.metadata) !== hashCanonical(lineage) || hashCanonical(authority.value.metadata) !== hashCanonical(expectedAuthority) ||
    hashCanonical(principal.value.metadata) !== hashCanonical({ principalId: grant.principalId }) ||
    derived.from !== semanticId || derived.to !== executionId || derived.relation !== SemanticRelation.DERIVED_FROM || hashCanonical(derived.metadata) !== hashCanonical({ workflowId: lineage.workflowId, actionHash: lineage.actionHash, preparedActionHash: lineage.preparedActionHash }) ||
    principalEdge.from !== principalId || principalEdge.to !== authorityId || principalEdge.relation !== SemanticRelation.INTRODUCED_BY || hashCanonical(principalEdge.metadata) !== hashCanonical({ grantId: grant.id, grantHash: hashCanonical(grant) }) ||
    authorizes.from !== authorityId || authorizes.to !== executionId || authorizes.relation !== SemanticRelation.AUTHORIZES || hashCanonical(authorizes.metadata) !== hashCanonical(expectedAuthority)) {
    return err(ErrorCode.PRIVILEGED_PATH_INCOMPLETE, "Durable execution provenance metadata mismatch");
  }
  const path = graph.assertPrivilegedPath(executionId);
  if (!path.ok) return path as Result<readonly ProvenanceNode[]>;
  const taint = graph.assertCanCreateAuthority(authorityId);
  if (!taint.ok) return taint as Result<readonly ProvenanceNode[]>;
  return ok(path.value.nodes);
}
