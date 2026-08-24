import { OutcomeContractSchema } from "@truemandate/schemas";
import { ErrorCode, err, ok, type OutcomeContract, type Result } from "@truemandate/protocol";
import { hashOutcomeContract } from "./hash.js";

/** Narrow immutable-definition persistence port. Lifecycle state transitions use
 * an explicit future CAS port and cannot overwrite this definition. */
export interface OutcomeContractStore {
  get(id: string): Promise<Result<OutcomeContract | undefined>>;
  putIfAbsent(id: string, value: OutcomeContract): Promise<Result<boolean>>;
}

function stripReadMetadata(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const row = value as Record<string, unknown>;
  if (!("workflowId" in row) && !("domain" in row)) {
    return value;
  }
  const { workflowId: _workflowId, domain: _domain, ...canonical } = row;
  return canonical;
}

export function parseOutcomeContract(value: unknown, label = "OutcomeContract"): Result<OutcomeContract> {
  const parsed = OutcomeContractSchema.safeParse(stripReadMetadata(value));
  if (!parsed.success) return err(ErrorCode.SCHEMA_PARSE_FAILED, `Invalid ${label}`);
  // Branded protocol ids are runtime strings; strict schema validation above
  // establishes the durable wire shape before this domain cast.
  const contract = parsed.data as unknown as OutcomeContract;
  const expected = hashOutcomeContract(contract);
  if (contract.definitionHash !== expected || contract.contractHash !== expected) {
    return err(ErrorCode.OUTCOME_CONTRACT_STALE, `${label} definition hash mismatch`);
  }
  return ok(contract);
}
