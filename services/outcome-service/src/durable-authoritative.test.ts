import { createFirestorePersistence, MemoryTransactionalStore } from "@truemandate/cloud-firestore";
import { IntentService } from "@truemandate/intent-service";
import { hashCanonical } from "@truemandate/crypto";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  OutcomeContractState,
  SourceType,
  asConstraintId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { OutcomeService } from "./service.js";

const NOW = "2030-01-08T00:00:00.000Z";
const H = (char: string) => char.repeat(64);

/** Two independent OutcomeService instances sharing one durable repository —
 * the exact v4 topology (instance A stale cache vs instance B durable write). */
async function twoInstances() {
  const persist = createFirestorePersistence(new MemoryTransactionalStore());
  const intents = new IntentService(persist.intents);
  const instanceA = new OutcomeService(undefined, {
    contracts: persist.outcomeContracts,
    events: persist.outcomeEvents,
  });
  const instanceB = new OutcomeService(undefined, {
    contracts: persist.outcomeContracts,
    events: persist.outcomeEvents,
  });
  const intent = await intents.createIntent({
    id: "phase-c-cache-intent",
    principalId: "principal-1",
    rawText: "Buy 500 food-grade containers",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error(intent.message);
  const state = await intents.createIntentState({
    id: "state-cache",
    intentId: intent.value.id,
    constraints: [{
      id: asConstraintId("c-quantity"),
      concept: "quantity",
      operator: ConstraintOperator.GTE,
      value: 500,
      kind: ConstraintKind.HARD,
      importance: 1,
      confidence: 1,
      sourceType: SourceType.HUMAN,
      mutability: ConstraintMutability.IMMUTABLE,
      meaningClass: MeaningClass.EXPLICIT,
    }],
    createdBy: "principal-1",
    createdAt: NOW,
  });
  if (!state.ok) throw new Error(state.message);
  const created = await instanceA.createPreExecutionProcurementContract({
    id: "outcome-cache-flagship",
    intentState: state.value,
    principalId: "principal-1",
    merchant: "phase-b-supplier",
    quantity: 500,
    budgetMax: 800000,
    product: "food-grade containers",
    actionProposalId: "action-cache",
    actionContentHash: hashCanonical({ action: "cache" }),
    createdAt: NOW,
    preExecutionBinding: {
      workflowId: "wf-cache",
      workflowHash: H("a") as never,
      actionId: "action-cache",
      actionHash: hashCanonical({ action: "cache" }) as never,
      evaluationId: "evaluation-cache",
      evaluationHash: H("b") as never,
      evaluatedIntentStateId: state.value.id,
      evaluatedIntentStateHash: state.value.stateHash,
      evaluatedIntentStateVersion: state.value.version,
    },
  });
  if (!created.ok) throw new Error(created.message);
  return { persist, instanceA, instanceB, intentState: state.value, contract: created.value };
}

describe("durable-authoritative OutcomeContract reads (v4 stale-cache repair)", () => {
  it("the exact v4 topology: A caches CREATED, B writes AWAITING_OUTCOME/SUCCESS, A's GET observes the durable state", async () => {
    const f = await twoInstances();
    // Instance A holds the stale CREATED copy (v4 shape).
    const staleA = await f.instanceA.getContract(f.contract.id);
    expect(staleA.ok && staleA.value.state).toBe(OutcomeContractState.CREATED);
    // Instance B handles the payment event and writes durable.
    const paid = await f.instanceB.onPaymentSuccess(f.contract.id, NOW);
    expect(paid.ok && paid.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(paid.ok && paid.value.paymentStatus).toBe("SUCCESS");
    // Instance A's GET must observe the durable state despite its cache.
    const refreshed = await f.instanceA.getContract(f.contract.id);
    expect(refreshed.ok && refreshed.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(refreshed.ok && refreshed.value.paymentStatus).toBe("SUCCESS");
  });

  it("evaluate-evidence from the stale instance loads the latest durable contract and transitions legally", async () => {
    const f = await twoInstances();
    await f.instanceB.onPaymentSuccess(f.contract.id, NOW);
    // Instance A's cache is still CREATED; applyObservations must load the
    // latest durable state before the transition.
    const applied = await f.instanceA.applyObservations(f.contract.id, {
      quantityReceived: 450,
      quantityOrdered: 500,
      paymentSettled: true,
    } as never, NOW, {});
    expect(applied.ok).toBe(true);
    expect(applied.ok && applied.value.contract.state).toBe(OutcomeContractState.PARTIAL);
    // The durable row holds PARTIAL; a third instance observes it.
    const third = new OutcomeService(undefined, {
      contracts: f.persist.outcomeContracts,
      events: f.persist.outcomeEvents,
    });
    const seen = await third.getContract(f.contract.id);
    expect(seen.ok && seen.value.state).toBe(OutcomeContractState.PARTIAL);
  });

  it("durable state beats divergent local cache (inverse adversarial)", async () => {
    const f = await twoInstances();
    await f.instanceB.onPaymentSuccess(f.contract.id, NOW);
    // Instance A's local cache still holds CREATED. Write a newer durable
    // value directly through the repository; the production read must return
    // the durable value, never the local one.
    await f.persist.outcomeContracts.put(f.contract.id, { ...f.contract, state: OutcomeContractState.BREACHED, paymentStatus: "SUCCESS" as never, updatedAt: NOW });
    const seen = await f.instanceA.getContract(f.contract.id);
    expect(seen.ok && seen.value.state).toBe(OutcomeContractState.BREACHED);
  });

  it("resolution lifecycle after PARTIAL emits the trigger exactly once", async () => {
    const f = await twoInstances();
    await f.instanceB.onPaymentSuccess(f.contract.id, NOW);
    const applied = await f.instanceA.applyObservations(f.contract.id, {
      quantityReceived: 450,
      quantityOrdered: 500,
      paymentSettled: true,
    } as never, NOW, {});
    expect(applied.ok).toBe(true);
    const events = f.instanceA.listEvents(f.contract.id);
    const partialTriggers = events.filter((event) => event.type === "OUTCOME_PARTIAL");
    expect(partialTriggers).toHaveLength(1);
    expect(partialTriggers[0]?.triggerIdentity).toBeDefined();
  });
});
