/**
 * Wave 4.3 — MonitoringContract deterministic core.
 *
 * Pure state machine for ALLOW_WITH_MONITORING. This module NEVER mints
 * grants, issues CommitTokens, or calls Gateway. Escalation only narrows
 * or freezes future privileged materialization; it never widens authority.
 */
import {
  ErrorCode,
  MonitoringContractState,
  MonitoringRiskState,
  MonitoringSignalSeverity,
  err,
  ok,
  type MonitoringContract,
  type MonitoringRiskSignal,
  type Result,
} from "@truemandate/protocol";
import { MonitoringContractSchema, parseWithSchema } from "@truemandate/schemas";

/** Legal MonitoringContract state transitions (fail closed). */
const ALLOWED: Readonly<
  Record<MonitoringContractState, readonly MonitoringContractState[]>
> = {
  [MonitoringContractState.ACTIVE]: [
    MonitoringContractState.ESCALATED,
    MonitoringContractState.FROZEN,
    MonitoringContractState.RESOLUTION_OPENED,
    MonitoringContractState.CLOSED,
  ],
  [MonitoringContractState.ESCALATED]: [
    MonitoringContractState.FROZEN,
    MonitoringContractState.RESOLUTION_OPENED,
    MonitoringContractState.CLOSED,
  ],
  [MonitoringContractState.FROZEN]: [
    MonitoringContractState.RESOLUTION_OPENED,
    MonitoringContractState.CLOSED,
  ],
  [MonitoringContractState.RESOLUTION_OPENED]: [MonitoringContractState.CLOSED],
  [MonitoringContractState.CLOSED]: [],
};

export function assertMonitoringTransitionAllowed(
  from: MonitoringContractState,
  to: MonitoringContractState,
): Result<void> {
  if (from === to) return ok();
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    return err(
      ErrorCode.MONITORING_TRANSITION_INVALID,
      `Illegal MonitoringContract transition ${from} → ${to}`,
      { from, to },
    );
  }
  return ok();
}

export function parseMonitoringContract(
  value: unknown,
  label = "MonitoringContract",
): Result<MonitoringContract> {
  return parseWithSchema(MonitoringContractSchema, value, label) as Result<MonitoringContract>;
}

export interface CreateMonitoringContractInput {
  readonly id: string;
  readonly workflowId: string;
  readonly intentId: string;
  readonly intentStateId: string;
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly capability: string;
  readonly merchant?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly grantId?: string;
  readonly outcomeContractId?: string;
  readonly createdAt: string;
}

/** Open an ACTIVE / HEALTHY MonitoringContract for an ALLOW_WITH_MONITORING evaluation. */
export function createMonitoringContract(
  input: CreateMonitoringContractInput,
): Result<MonitoringContract> {
  const contract: MonitoringContract = {
    id: input.id,
    workflowId: input.workflowId,
    intentId: input.intentId as MonitoringContract["intentId"],
    intentStateId: input.intentStateId as MonitoringContract["intentStateId"],
    evaluationId: input.evaluationId,
    evaluationHash: input.evaluationHash as MonitoringContract["evaluationHash"],
    capability: input.capability,
    ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.grantId !== undefined
      ? { grantId: input.grantId as MonitoringContract["grantId"] }
      : {}),
    ...(input.outcomeContractId !== undefined
      ? {
          outcomeContractId:
            input.outcomeContractId as MonitoringContract["outcomeContractId"],
        }
      : {}),
    state: MonitoringContractState.ACTIVE,
    riskState: MonitoringRiskState.HEALTHY,
    signals: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return parseMonitoringContract(contract);
}

/**
 * Deterministic severity → risk/state mapping.
 * Escalation is monotonic: once ESCALATED/FROZEN, LOW signals cannot de-escalate.
 */
function severityTarget(
  severity: MonitoringSignalSeverity,
): { readonly riskState: MonitoringRiskState; readonly state: MonitoringContractState } {
  if (severity === MonitoringSignalSeverity.HIGH) {
    return {
      riskState: MonitoringRiskState.UNACCEPTABLE,
      state: MonitoringContractState.FROZEN,
    };
  }
  if (severity === MonitoringSignalSeverity.MEDIUM) {
    return {
      riskState: MonitoringRiskState.ELEVATED,
      state: MonitoringContractState.ESCALATED,
    };
  }
  return {
    riskState: MonitoringRiskState.HEALTHY,
    state: MonitoringContractState.ACTIVE,
  };
}

const RISK_RANK: Readonly<Record<MonitoringRiskState, number>> = {
  [MonitoringRiskState.HEALTHY]: 0,
  [MonitoringRiskState.ELEVATED]: 1,
  [MonitoringRiskState.UNACCEPTABLE]: 2,
};

const STATE_RANK: Readonly<Record<MonitoringContractState, number>> = {
  [MonitoringContractState.ACTIVE]: 0,
  [MonitoringContractState.ESCALATED]: 1,
  [MonitoringContractState.FROZEN]: 2,
  [MonitoringContractState.RESOLUTION_OPENED]: 3,
  [MonitoringContractState.CLOSED]: 4,
};

export function recordRiskSignal(
  contract: MonitoringContract,
  signal: MonitoringRiskSignal,
  now: string,
): Result<{ readonly updated: MonitoringContract; readonly escalated: boolean }> {
  if (
    contract.state === MonitoringContractState.CLOSED ||
    contract.state === MonitoringContractState.RESOLUTION_OPENED
  ) {
    return err(
      ErrorCode.MONITORING_TRANSITION_INVALID,
      "Cannot record risk signals on a terminal MonitoringContract",
      { state: contract.state },
    );
  }

  const target = severityTarget(signal.severity);
  // Monotonic: never de-escalate risk or state via a weaker signal.
  const nextRisk =
    RISK_RANK[target.riskState] > RISK_RANK[contract.riskState]
      ? target.riskState
      : contract.riskState;
  let nextState: MonitoringContractState = contract.state;
  if (STATE_RANK[target.state] > STATE_RANK[contract.state]) {
    const transition = assertMonitoringTransitionAllowed(contract.state, target.state);
    if (!transition.ok) return transition;
    nextState = target.state;
  }

  const updated: MonitoringContract = {
    ...contract,
    riskState: nextRisk,
    state: nextState,
    signals: [...contract.signals, signal],
    updatedAt: now,
  };
  const parsed = parseMonitoringContract(updated);
  if (!parsed.ok) return parsed;
  return ok({
    updated: parsed.value,
    escalated: nextState !== contract.state,
  });
}

/** Verified outcome failure always escalates to RESOLUTION_OPENED. */
export function markVerifiedOutcomeFailure(
  contract: MonitoringContract,
  now: string,
  resolutionCaseHint?: string,
): Result<MonitoringContract> {
  if (contract.state === MonitoringContractState.CLOSED) {
    return err(
      ErrorCode.MONITORING_TRANSITION_INVALID,
      "Cannot mark outcome failure on a CLOSED MonitoringContract",
    );
  }
  if (contract.state === MonitoringContractState.RESOLUTION_OPENED) {
    return ok(contract);
  }
  const transition = assertMonitoringTransitionAllowed(
    contract.state,
    MonitoringContractState.RESOLUTION_OPENED,
  );
  if (!transition.ok) return transition;
  const updated: MonitoringContract = {
    ...contract,
    state: MonitoringContractState.RESOLUTION_OPENED,
    riskState:
      RISK_RANK[contract.riskState] >= RISK_RANK[MonitoringRiskState.UNACCEPTABLE]
        ? contract.riskState
        : MonitoringRiskState.UNACCEPTABLE,
    ...(resolutionCaseHint !== undefined ? { resolutionCaseHint } : {}),
    updatedAt: now,
  };
  return parseMonitoringContract(updated);
}

/**
 * Forward-looking choke-point gate for future privileged minting.
 * Never widens: only returns requiresApproval or fail-closed FROZEN.
 * No contract / ACTIVE → allowed without approval.
 */
export function assertPrivilegedActionAllowed(
  contract: MonitoringContract | undefined,
): Result<{ readonly requiresApproval: boolean }> {
  if (!contract || contract.state === MonitoringContractState.ACTIVE) {
    return ok({ requiresApproval: false });
  }
  if (contract.state === MonitoringContractState.ESCALATED) {
    return ok({ requiresApproval: true });
  }
  return err(
    ErrorCode.MONITORING_CONTRACT_FROZEN,
    `MonitoringContract state ${contract.state} blocks further privileged action`,
    { state: contract.state, workflowId: contract.workflowId },
  );
}

export interface MonitoringContractStore {
  get(id: string): Promise<Result<MonitoringContract | undefined>>;
  getByWorkflowId(workflowId: string): Promise<Result<MonitoringContract | undefined>>;
  putIfAbsent(id: string, value: MonitoringContract): Promise<Result<boolean>>;
  put(id: string, value: MonitoringContract): Promise<Result<void>>;
}

export class InMemoryMonitoringContractStore implements MonitoringContractStore {
  private readonly byId = new Map<string, MonitoringContract>();
  private readonly byWorkflow = new Map<string, string>();

  async get(id: string): Promise<Result<MonitoringContract | undefined>> {
    return ok(this.byId.get(id));
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<Result<MonitoringContract | undefined>> {
    const id = this.byWorkflow.get(workflowId);
    return ok(id ? this.byId.get(id) : undefined);
  }

  async putIfAbsent(
    id: string,
    value: MonitoringContract,
  ): Promise<Result<boolean>> {
    const parsed = parseMonitoringContract(value);
    if (!parsed.ok) return parsed as Result<boolean>;
    if (this.byId.has(id)) return ok(false);
    this.byId.set(id, parsed.value);
    this.byWorkflow.set(parsed.value.workflowId, id);
    return ok(true);
  }

  async put(id: string, value: MonitoringContract): Promise<Result<void>> {
    const parsed = parseMonitoringContract(value);
    if (!parsed.ok) return parsed as Result<void>;
    this.byId.set(id, parsed.value);
    this.byWorkflow.set(parsed.value.workflowId, id);
    return ok();
  }
}
