import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  asIntentStateId,
  err,
  ok,
  type Assumption,
  type Constraint,
  type HashDigest,
  type Intent,
  type IntentState,
  type IntentStateId,
  type PrincipalId,
  type Result,
  type AgentId,
} from "@truemandate/protocol";

export interface CreateIntentStateInput {
  readonly id: IntentStateId | string;
  readonly intent: Intent;
  readonly version: number;
  readonly constraints: readonly Constraint[];
  readonly assumptions?: readonly Assumption[];
  readonly createdAt: string;
  readonly createdBy: PrincipalId | AgentId;
  readonly previousStateId?: IntentStateId;
}

/**
 * INV_001: There is no API to mutate Intent.rawText or Intent.contentHash.
 * New human changes must create a new IntentState (and possibly a new Intent).
 */
export function createIntentState(input: CreateIntentStateInput): Result<IntentState> {
  if (input.version < 1) {
    return err(ErrorCode.VALIDATION_FAILED, "IntentState version must be >= 1");
  }
  if (input.previousStateId === undefined && input.version !== 1) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "First IntentState must be version 1 without previousStateId",
    );
  }
  if (input.previousStateId !== undefined && input.version < 2) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Transitioned IntentState must increment version",
    );
  }

  const stateWithoutHash = {
    id: asIntentStateId(String(input.id)),
    intentId: input.intent.id,
    rawIntentHash: input.intent.contentHash,
    version: input.version,
    constraints: input.constraints,
    assumptions: input.assumptions ?? [],
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    previousStateId: input.previousStateId,
  };

  const stateHash = hashCanonical({
    id: stateWithoutHash.id,
    intentId: stateWithoutHash.intentId,
    rawIntentHash: stateWithoutHash.rawIntentHash,
    version: stateWithoutHash.version,
    constraints: stateWithoutHash.constraints,
    assumptions: stateWithoutHash.assumptions,
    previousStateId: stateWithoutHash.previousStateId ?? null,
  });

  return ok({
    ...stateWithoutHash,
    stateHash,
  });
}

/**
 * Transition to a new IntentState. Never mutates the prior state or raw intent.
 */
export function transitionIntentState(
  previous: IntentState,
  intent: Intent,
  next: Omit<CreateIntentStateInput, "intent" | "previousStateId" | "version"> & {
    readonly version?: number;
  },
): Result<IntentState> {
  if (intent.id !== previous.intentId) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Cannot transition IntentState across different Intent IDs",
    );
  }
  if (intent.contentHash !== previous.rawIntentHash) {
    // Same Intent id must keep immutable raw content; a changed raw text requires a new Intent.
    return err(
      ErrorCode.RAW_INTENT_IMMUTABLE,
      "Raw human intent is immutable; create a new Intent for changed raw text",
      {
        previousHash: previous.rawIntentHash,
        nextHash: intent.contentHash,
      },
    );
  }

  return createIntentState({
    id: next.id,
    intent,
    version: next.version ?? previous.version + 1,
    constraints: next.constraints,
    assumptions: next.assumptions,
    createdAt: next.createdAt,
    createdBy: next.createdBy,
    previousStateId: previous.id,
  });
}

/**
 * Fail-closed guard: reject any attempt to "update" raw intent in place.
 */
export function rejectRawIntentMutation(
  _intent: Intent,
  _newRawText: string,
): Result<never> {
  return err(
    ErrorCode.RAW_INTENT_IMMUTABLE,
    "Raw human intent is immutable; there is no API to edit rawIntent",
  );
}

export function assertIntentStateHash(
  state: IntentState,
  expectedHash: HashDigest,
): Result<void> {
  if (state.stateHash !== expectedHash) {
    return err(
      ErrorCode.GRANT_INTENT_STATE_MISMATCH,
      "IntentState hash mismatch",
      { expectedHash, actualHash: state.stateHash },
    );
  }
  return ok();
}
