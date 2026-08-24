import { describe, expect, it } from "vitest";
import {
  OutcomeContractState,
  OutcomeRequirementCriticality,
  OutcomeRequirementState,
  OutcomeRequirementType,
  PaymentStatus,
  type OutcomeContract,
} from "@truemandate/protocol";
import { hashOutcomeContract } from "./hash.js";
import { parseOutcomeContract } from "./contract-store.js";

const H = (char: string) => char.repeat(64);

function contract(): OutcomeContract {
  const base = {
    id: "outcome-1",
    intentId: "intent-1",
    intentStateId: "state-1",
    intentStateHash: H("a"),
    principalId: "principal-1",
    actionProposalId: "action-1",
    actionContentHash: H("b"),
    requirements: [
      {
        id: "req-1",
        concept: "booking_confirmed",
        operator: "EQ",
        value: true,
        criticality: OutcomeRequirementCriticality.HARD,
        state: OutcomeRequirementState.PENDING,
        type: OutcomeRequirementType.BOOLEAN,
        predicate: "booking_confirmed",
        evaluationMethod: "DETERMINISTIC",
      },
    ],
    state: OutcomeContractState.CREATED,
    paymentStatus: PaymentStatus.PENDING,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    preExecutionBinding: {
      workflowId: "wf-1",
      workflowHash: H("c"),
      actionId: "action-1",
      actionHash: H("b"),
      evaluationId: "evaluation-1",
      evaluationHash: H("d"),
      evaluatedIntentStateId: "state-1",
      evaluatedIntentStateHash: H("a"),
      evaluatedIntentStateVersion: 1,
    },
  } as OutcomeContract;
  const definitionHash = hashOutcomeContract(base);
  return {
    ...base,
    definitionHash,
    contractHash: definitionHash,
  };
}

describe("parseOutcomeContract", () => {
  it("accepts canonical contracts unchanged", () => {
    const parsed = parseOutcomeContract(contract(), "OutcomeContract");
    expect(parsed.ok).toBe(true);
  });

  it("accepts internal read contracts enriched with safe workflow metadata", () => {
    const parsed = parseOutcomeContract(
      {
        ...contract(),
        workflowId: "wf-1",
        domain: "travel",
      },
      "OutcomeContract",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.preExecutionBinding?.workflowId).toBe("wf-1");
  });
});
