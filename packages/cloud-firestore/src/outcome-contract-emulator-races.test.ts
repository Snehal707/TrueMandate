import { Firestore } from "@google-cloud/firestore";
import { hashOutcomeContract } from "@truemandate/outcome-core";
import { OutcomeContractState, OutcomeRequirementCriticality, OutcomeRequirementState, OutcomeRequirementType, PaymentStatus, type OutcomeContract } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, docPath } from "./document-store.js";
import { GoogleFirestoreDocumentStore } from "./google-store.js";
import { createOutcomeContractRepository } from "./repositories.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const H = (char: string) => char.repeat(64);
function contract(id: string, changes: Partial<OutcomeContract> = {}): OutcomeContract {
  const base = { id, intentId: "intent", intentStateId: "state", intentStateHash: H("a"), principalId: "principal", actionProposalId: "action", actionContentHash: H("b"), requirements: [{ id: "qty", concept: "quantity_received", operator: "GTE", value: 500, criticality: OutcomeRequirementCriticality.HARD, state: OutcomeRequirementState.PENDING, type: OutcomeRequirementType.NUMERIC, predicate: "quantity_received", evaluationMethod: "DETERMINISTIC" }], state: OutcomeContractState.CREATED, paymentStatus: PaymentStatus.PENDING, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, preExecutionBinding: { workflowId: "workflow", workflowHash: H("c"), actionId: "action", actionHash: H("b"), evaluationId: "evaluation", evaluationHash: H("d"), evaluatedIntentStateId: "state", evaluatedIntentStateHash: H("a"), evaluatedIntentStateVersion: 1 }, ...changes } as unknown as OutcomeContract;
  const definitionHash = hashOutcomeContract(base);
  return { ...base, definitionHash, contractHash: definitionHash };
}
function repo() { const store = new GoogleFirestoreDocumentStore(new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator" })); return { store, repository: createOutcomeContractRepository(store) }; }

describe.skipIf(!enabled)("OutcomeContract Firestore immutable definition races", () => {
  it("concurrent identical creation persists one canonical definition", async () => {
    const id = `outcome-identical-${Date.now()}`; const row = contract(id);
    const [a, b] = await Promise.all([repo().repository.putIfAbsent(id, row), repo().repository.putIfAbsent(id, row)]);
    expect([a, b].filter((r) => r.ok && r.value)).toHaveLength(1);
    const read = await repo().repository.get(id);
    expect(read.ok && read.value?.definitionHash).toBe(row.definitionHash);
  }, 20_000);
  it.each([
    ["binding", { preExecutionBinding: { ...contract("x").preExecutionBinding!, actionHash: H("e") } }],
    ["requirements", { requirements: [{ ...contract("x").requirements[0]!, value: 450 }] }],
  ])("same-id divergent %s fails closed", async (_name, changes) => {
    const id = `outcome-divergent-${_name}-${Date.now()}`;
    const first = await repo().repository.putIfAbsent(id, contract(id));
    const second = await repo().repository.putIfAbsent(id, contract(id, changes));
    expect(first.ok && first.value).toBe(true); expect(second.ok && second.value).toBe(false);
  });
  it("reconstructs after restart and rejects tampered durable rows", async () => {
    const id = `outcome-restart-${Date.now()}`, row = contract(id); const first = repo();
    expect((await first.repository.putIfAbsent(id, row)).ok).toBe(true);
    const replay = await repo().repository.get(id); expect(replay.ok && replay.value?.contractHash).toBe(row.contractHash);
    const broken = `outcome-broken-${Date.now()}`; await first.store.set(docPath(COLLECTIONS.outcomeContracts, broken), { ...contract(broken), definitionHash: H("0") });
    expect((await repo().repository.get(broken)).ok).toBe(false);
  });
});
