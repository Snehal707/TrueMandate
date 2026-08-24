import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  asPreparedActionId,
  err,
  ok,
  type ActionId,
  type AgentId,
  type HashDigest,
  type IntentId,
  type IntentStateId,
  type MaterialExternalSnapshot,
  type PreparedAction,
  type PreparedActionParameters,
  type Result,
} from "@truemandate/protocol";

export const PREPARED_ACTION_HASH_VERSION = 1 as const;

const DEFAULT_MATERIAL_KEYS = [
  "merchant",
  "product",
  "quantity",
  "amount",
  "currency",
  "refundability",
  "deliveryTerms",
  "certificationRef",
  "counterparty",
  "sku",
] as const satisfies readonly (keyof MaterialExternalSnapshot)[];

export type MaterialKey = (typeof DEFAULT_MATERIAL_KEYS)[number];

/** INV_017: parameters only. */
export function computePreparedActionHash(
  parameters: PreparedActionParameters,
): ReturnType<typeof hashCanonical> {
  return hashCanonical(parameters);
}

export interface PreparedActionHashPayload {
  readonly hashVersion: typeof PREPARED_ACTION_HASH_VERSION;
  readonly id: string;
  readonly actionId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly agentId: string;
  readonly capability: string;
  readonly authorityScope: PreparedAction["authorityScope"] | null;
  readonly parameters: PreparedActionParameters;
  readonly parameterHash: string;
  readonly principalId: string | null;
  readonly toolId: string | null;
  readonly idempotencyKey: string | null;
  readonly expiresAt: string | null;
  readonly intentStateHash: string | null;
  readonly planId: string | null;
  readonly planVersion: number | null;
  readonly actionProposalId: string | null;
  readonly actionContentHash: string | null;
  readonly guardianVerdictId: string | null;
  readonly guardianVerdictHash: string | null;
  readonly externalStateSnapshot: MaterialExternalSnapshot | null;
  readonly externalStateHash: string | null;
  readonly outcomeContractId: string | null;
  readonly outcomeContractHash: string | null;
  readonly evaluationRecordId: string | null;
  readonly evaluationRecordHash: string | null;
  readonly workflowId: string | null;
  readonly workflowHash: string | null;
  readonly evaluatedIntentStateVersion: number | null;
  readonly bundleId: string | null;
  readonly dependsOnPreparedActionIds: readonly string[];
}

export function preparedActionHashPayload(
  prepared: Omit<PreparedAction, "preparedActionHash">,
): PreparedActionHashPayload {
  return {
    hashVersion: PREPARED_ACTION_HASH_VERSION,
    id: prepared.id,
    actionId: prepared.actionId,
    intentId: prepared.intentId,
    intentStateId: prepared.intentStateId,
    agentId: prepared.agentId,
    capability: prepared.capability,
    authorityScope: prepared.authorityScope ?? null,
    parameters: prepared.parameters,
    parameterHash: prepared.parameterHash,
    principalId: prepared.principalId ?? null,
    toolId: prepared.toolId ?? null,
    idempotencyKey: prepared.idempotencyKey ? String(prepared.idempotencyKey) : null,
    expiresAt: prepared.expiresAt ?? null,
    intentStateHash: prepared.intentStateHash ?? null,
    planId: prepared.planId ?? null,
    planVersion: prepared.planVersion ?? null,
    actionProposalId: prepared.actionProposalId ?? null,
    actionContentHash: prepared.actionContentHash ?? null,
    guardianVerdictId: prepared.guardianVerdictId ?? null,
    guardianVerdictHash: prepared.guardianVerdictHash ?? null,
    externalStateSnapshot: prepared.externalStateSnapshot ?? null,
    externalStateHash: prepared.externalStateHash ?? null,
    outcomeContractId: prepared.outcomeContractId
      ? String(prepared.outcomeContractId)
      : null,
    outcomeContractHash: prepared.outcomeContractHash ?? null,
    evaluationRecordId: prepared.evaluationRecordId ?? null,
    evaluationRecordHash: prepared.evaluationRecordHash ?? null,
    workflowId: prepared.workflowId ?? null,
    workflowHash: prepared.workflowHash ?? null,
    evaluatedIntentStateVersion: prepared.evaluatedIntentStateVersion ?? null,
    bundleId: prepared.bundleId ?? null,
    dependsOnPreparedActionIds: prepared.dependsOnPreparedActionIds ?? [],
  };
}

export function computeFullPreparedActionHash(
  prepared: Omit<PreparedAction, "preparedActionHash">,
): HashDigest {
  return hashCanonical(preparedActionHashPayload(prepared));
}

export function authorizationHash(prepared: PreparedAction): HashDigest {
  return prepared.preparedActionHash;
}

export function createPreparedAction(input: {
  readonly id: string;
  readonly actionId: ActionId;
  readonly intentId: IntentId;
  readonly intentStateId: IntentStateId;
  readonly agentId: AgentId;
  readonly capability: string;
  readonly authorityScope?: PreparedAction["authorityScope"];
  readonly parameters: PreparedActionParameters;
  readonly createdAt: string;
  readonly bundleId?: string;
  readonly dependsOnPreparedActionIds?: readonly string[];
  readonly intentStateHash?: PreparedAction["intentStateHash"];
  readonly planId?: PreparedAction["planId"];
  readonly planVersion?: number;
  readonly actionProposalId?: ActionId;
  readonly actionContentHash?: PreparedAction["actionContentHash"];
  readonly guardianVerdictId?: string;
  readonly guardianVerdictHash?: PreparedAction["guardianVerdictHash"];
  readonly principalId?: PreparedAction["principalId"];
  readonly toolId?: string;
  readonly idempotencyKey?: string;
  readonly expiresAt?: string;
  readonly externalStateSnapshot?: PreparedAction["externalStateSnapshot"];
  readonly outcomeContractId?: PreparedAction["outcomeContractId"];
  readonly outcomeContractHash?: PreparedAction["outcomeContractHash"];
  readonly evaluationRecordId?: string;
  readonly evaluationRecordHash?: PreparedAction["evaluationRecordHash"];
  readonly workflowId?: string;
  readonly workflowHash?: PreparedAction["workflowHash"];
  readonly evaluatedIntentStateVersion?: number;
}): Result<PreparedAction> {
  const parameterHash = computePreparedActionHash(input.parameters);
  const externalStateHash = input.externalStateSnapshot
    ? hashCanonical(input.externalStateSnapshot)
    : undefined;
  const unsigned: Omit<PreparedAction, "preparedActionHash"> = {
    id: asPreparedActionId(input.id),
    actionId: input.actionId,
    intentId: input.intentId,
    intentStateId: input.intentStateId,
    agentId: input.agentId,
    capability: input.capability,
    authorityScope: input.authorityScope,
    parameters: Object.freeze({
      ...input.parameters,
      toolParameters: { ...input.parameters.toolParameters },
    }),
    parameterHash,
    createdAt: input.createdAt,
    bundleId: input.bundleId,
    dependsOnPreparedActionIds:
      input.dependsOnPreparedActionIds?.map(asPreparedActionId),
    intentStateHash: input.intentStateHash,
    planId: input.planId,
    planVersion: input.planVersion,
    actionProposalId: input.actionProposalId,
    actionContentHash: input.actionContentHash,
    guardianVerdictId: input.guardianVerdictId,
    guardianVerdictHash: input.guardianVerdictHash,
    principalId: input.principalId,
    toolId: input.toolId,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt,
    externalStateSnapshot: input.externalStateSnapshot
      ? Object.freeze({ ...input.externalStateSnapshot })
      : undefined,
    externalStateHash,
    outcomeContractId: input.outcomeContractId,
    outcomeContractHash: input.outcomeContractHash,
    evaluationRecordId: input.evaluationRecordId,
    evaluationRecordHash: input.evaluationRecordHash,
    workflowId: input.workflowId,
    workflowHash: input.workflowHash,
    evaluatedIntentStateVersion: input.evaluatedIntentStateVersion,
  };
  return ok({
    ...unsigned,
    preparedActionHash: computeFullPreparedActionHash(unsigned),
  });
}

/**
 * INV_017: Prepared action parameters are immutable.
 */
export function assertPreparedActionUnmodified(
  prepared: PreparedAction,
  candidateParameters: PreparedActionParameters,
): Result<void> {
  const candidateHash = computePreparedActionHash(candidateParameters);
  if (candidateHash !== prepared.parameterHash) {
    return err(
      ErrorCode.PREPARED_ACTION_IMMUTABLE,
      "Prepared action parameters are immutable",
      {
        expectedHash: prepared.parameterHash,
        actualHash: candidateHash,
      },
    );
  }
  return ok();
}

/** INV_018: recompute the full authorization hash from stored fields. */
export function assertPreparedActionIntegrity(
  prepared: PreparedAction,
): Result<void> {
  const { preparedActionHash: _ignored, ...unsigned } = prepared;
  void _ignored;
  const expected = computeFullPreparedActionHash(unsigned);
  if (expected !== prepared.preparedActionHash) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "PreparedAction hash does not match authorization-relevant fields",
      {
        expectedHash: expected,
        actualHash: prepared.preparedActionHash,
      },
    );
  }
  const parameterCheck = assertPreparedActionUnmodified(
    prepared,
    prepared.parameters,
  );
  if (!parameterCheck.ok) return parameterCheck;
  return ok();
}

/**
 * INV_016: No T2/T3 tool executes without a PreparedAction.
 */
export function requirePreparedAction(
  prepared: PreparedAction | null | undefined,
): Result<PreparedAction> {
  if (!prepared) {
    return err(
      ErrorCode.PREPARED_ACTION_REQUIRED,
      "Privileged tool execution requires a PreparedAction",
    );
  }
  return ok(prepared);
}

export interface CriticalExternalState {
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly refundability?: boolean;
  readonly product?: string;
  readonly quantity?: number;
  readonly deliveryTerms?: string;
  readonly certificationRef?: string;
  readonly counterparty?: string;
  readonly sku?: string;
  /** Non-material; ignored for TOCTOU (e.g. page view count). */
  readonly pageViewCount?: number;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function snapshotFromPrepared(prepared: PreparedAction): MaterialExternalSnapshot {
  const p = prepared.parameters;
  const snap = prepared.externalStateSnapshot;
  const tool = p.toolParameters ?? {};
  const preparedCert =
    snap?.certificationRef ??
    (typeof tool.certificationRef === "string"
      ? tool.certificationRef
      : typeof tool.foodGradeEvidenceRef === "string"
        ? tool.foodGradeEvidenceRef
        : undefined);
  const preparedSku =
    snap?.sku ?? (typeof tool.sku === "string" ? tool.sku : undefined);
  return {
    merchant: snap?.merchant ?? p.merchant,
    product: snap?.product ?? p.product,
    quantity: snap?.quantity ?? p.quantity,
    amount: snap?.amount ?? p.amount,
    currency: snap?.currency ?? p.currency,
    refundability: snap?.refundability ?? p.refundability,
    deliveryTerms: snap?.deliveryTerms ?? p.deliveryTerms,
    certificationRef: preparedCert,
    counterparty: snap?.counterparty ?? p.merchant,
    sku: preparedSku,
  };
}

function pickMaterial(
  source: CriticalExternalState | MaterialExternalSnapshot,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = (source as Record<string, unknown>)[key];
  }
  return out;
}

/**
 * INV_020: Critical external state is revalidated before commit.
 * Material keys must be present as own properties (omit-to-bypass is forbidden).
 * Non-material fields (pageViewCount) are ignored.
 */
export function revalidateExternalState(
  prepared: PreparedAction,
  commitTimeState: CriticalExternalState,
  materialKeys?: readonly string[],
): Result<void> {
  const keys = materialKeys ?? DEFAULT_MATERIAL_KEYS;
  const missing = keys.filter((key) => !hasOwn(commitTimeState, key));
  if (missing.length > 0) {
    return err(
      ErrorCode.PREPARED_ACTION_STALE,
      "Incomplete critical external state at commit",
      { missing },
    );
  }

  const preparedSnap = snapshotFromPrepared(prepared);
  const mismatches: string[] = [];
  for (const key of keys) {
    const expected = (preparedSnap as Record<string, unknown>)[key];
    const actual = (commitTimeState as Record<string, unknown>)[key];
    if (expected !== actual) {
      mismatches.push(key);
    }
  }

  const freshHash = hashCanonical(pickMaterial(commitTimeState, keys));
  const preparedMaterialHash = hashCanonical(
    pickMaterial(preparedSnap, keys),
  );
  if (freshHash !== preparedMaterialHash) {
    mismatches.push("externalStateHash");
  }
  if (
    prepared.externalStateHash &&
    prepared.externalStateSnapshot &&
    hashCanonical(prepared.externalStateSnapshot) !== prepared.externalStateHash
  ) {
    return err(
      ErrorCode.PREPARED_ACTION_HASH_MISMATCH,
      "Stored external state snapshot does not match externalStateHash",
    );
  }

  if (mismatches.length > 0) {
    return err(
      ErrorCode.PREPARED_ACTION_STALE,
      "Critical external state changed between prepare and commit",
      { mismatches },
    );
  }
  return ok();
}

export function assertPreparedActionNotExpired(
  prepared: PreparedAction,
  now: string,
): Result<void> {
  if (prepared.expiresAt && Date.parse(now) > Date.parse(prepared.expiresAt)) {
    return err(ErrorCode.PREPARED_ACTION_STALE, "PreparedAction expired", {
      expiresAt: prepared.expiresAt,
      now,
    });
  }
  return ok();
}

export { DEFAULT_MATERIAL_KEYS };
