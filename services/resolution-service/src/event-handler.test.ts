import { createEnvelope, InMemoryPubSubBus, PubSubTopics } from "@truemandate/cloud-pubsub";
import { createCloudRunHttpServer, loadRuntimeConfig } from "@truemandate/cloud-runtime";
import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { deriveObservations } from "@truemandate/outcome-core";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  OutcomeContractState,
  OutcomeRequirementState,
  PaymentStatus,
  SourceType,
  asConstraintId,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  handleEvidenceEvent,
  handleExecutionEvent,
  type OutcomeResolutionPorts,
} from "./event-handler.js";
import { ResolutionService } from "./service.js";

const NOW = "2026-06-04T12:00:00.000Z";

class MemoryKv<T> implements DurableKeyValue<T> {
  readonly store = new Map<string, T>();
  failPuts = false;

  async put(id: string, value: T): Promise<void> {
    if (this.failPuts) throw new Error("firestore unavailable");
    this.store.set(id, value);
  }

  async get(id: string): Promise<T | undefined> {
    if (this.failPuts) throw new Error("firestore unavailable");
    return this.store.get(id);
  }

  async putIfAbsent(id: string, value: T): Promise<boolean> {
    if (this.failPuts) throw new Error("firestore unavailable");
    if (this.store.has(id)) return false;
    this.store.set(id, value);
    return true;
  }
}

function pushBody(envelope: unknown, subscription: string): string {
  return JSON.stringify({
    message: {
      data: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
      messageId: "m-1",
    },
    subscription,
  });
}

async function seedProcurement(id: string) {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: `intent-${id}`,
    principalId: "principal-1",
    rawText: "Buy 500 food-grade containers under INR 800000",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: `state-${id}`,
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("c-food"),
        concept: "food_grade",
        operator: ConstraintOperator.REQUIRE,
        value: true,
        kind: ConstraintKind.SAFETY_CRITICAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!state.ok) throw new Error("state");

  const contracts = new MemoryKv<unknown>();
  const events = new MemoryKv<unknown>();
  const cases = new MemoryKv<unknown>();
  const triggers = new MemoryKv<{ seenAt: string; caseId?: string }>();
  const outcomes = new OutcomeService(undefined, { contracts, events });
  const resolution = new ResolutionService(outcomes, undefined, {
    cases,
    triggers,
  });
  const created = await outcomes.createContractFromIntent({
    id: `oc-${id}`,
    intentState: state.value,
    principalId: "principal-1",
    merchant: "ApprovedFoodChem",
    quantity: 500,
    budgetMax: 800000,
    createdAt: NOW,
  });
  if (!created.ok) throw new Error("contract");

  const ports: OutcomeResolutionPorts = {
    outcomes,
    resolution,
    getIntentState: async (stateId) =>
      stateId === state.value.id ? state.value : undefined,
  };

  return {
    state: state.value,
    contract: created.value,
    outcomes,
    resolution,
    ports,
    contracts,
    events,
    cases,
    triggers,
  };
}

async function seedTravel(id: string) {
  const intents = new IntentService();
  const intent = await intents.createIntent({
    id: `intent-travel-${id}`,
    principalId: "principal-1",
    rawText:
      "Book 2 refundable stays with an approved provider at Seaside Lodge for under USD 5000 before December 31, 2026.",
    createdAt: NOW,
  });
  if (!intent.ok) throw new Error("intent");
  const state = await intents.createIntentState({
    id: `state-travel-${id}`,
    intentId: intent.value.id,
    createdBy: "principal-1",
    createdAt: NOW,
    constraints: [
      {
        id: asConstraintId("travel-provider"),
        concept: "approved_provider",
        operator: ConstraintOperator.EQ,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-property"),
        concept: "property_name",
        operator: ConstraintOperator.EQ,
        value: "Seaside Lodge",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-refundable"),
        concept: "refundable",
        operator: ConstraintOperator.EQ,
        value: true,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-budget"),
        concept: "total_budget",
        operator: ConstraintOperator.LTE,
        value: 5000,
        kind: ConstraintKind.FINANCIAL,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-count"),
        concept: "hotel_stay_count",
        operator: ConstraintOperator.EQ,
        value: 2,
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-date"),
        concept: "stay_start_date",
        operator: ConstraintOperator.EQ,
        value: "2026-12-20T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
      {
        id: asConstraintId("travel-deadline"),
        concept: "completion_deadline",
        operator: ConstraintOperator.LTE,
        value: "2026-12-31T00:00:00.000Z",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!state.ok) throw new Error("state");

  const contracts = new MemoryKv<unknown>();
  const events = new MemoryKv<unknown>();
  const cases = new MemoryKv<unknown>();
  const triggers = new MemoryKv<{ seenAt: string; caseId?: string }>();
  const outcomes = new OutcomeService(undefined, { contracts, events });
  const resolution = new ResolutionService(outcomes, undefined, {
    cases,
    triggers,
  });
  const created = await outcomes.createContractFromIntent({
    id: `oc-travel-${id}`,
    intentState: state.value,
    principalId: "principal-1",
    merchant: "Approved Travel Co",
    quantity: 2,
    budgetMax: 5000,
    product: "Seaside Lodge",
    createdAt: NOW,
    domain: "travel",
    parameters: {
      travelDate: "2026-12-20T00:00:00.000Z",
      travelerCount: 2,
      refundableRequired: true,
      lodgingName: "Seaside Lodge",
    },
  });
  if (!created.ok) throw new Error("contract");

  const ports: OutcomeResolutionPorts = {
    outcomes,
    resolution,
    getIntentState: async (stateId) =>
      stateId === state.value.id ? state.value : undefined,
  };

  return {
    state: state.value,
    contract: created.value,
    outcomes,
    resolution,
    ports,
  };
}

function executionEnvelope(
  contractId: string,
  status: "SUCCESS" | "FAILED" | "UNKNOWN",
  idempotencyKey: string,
  extra: Record<string, unknown> = {},
) {
  return createEnvelope({
    eventId: `evt-${idempotencyKey}`,
    type: "execution.completed",
    aggregateId: contractId,
    aggregateVersion: 1,
    causationId: "c",
    correlationId: "corr",
    actorService: "gateway",
    payloadHash: "h",
    idempotencyKey,
    provenanceRefs: [],
    payload: { contractId, status, now: NOW, ...extra },
    occurredAt: NOW,
  });
}

function evidenceEnvelope(
  contractId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  return createEnvelope({
    eventId: `evt-${idempotencyKey}`,
    type: "evidence.observed",
    aggregateId: contractId,
    aggregateVersion: 2,
    causationId: "c",
    correlationId: "corr",
    actorService: "observability",
    payloadHash: "h",
    idempotencyKey,
    provenanceRefs: [],
    payload: { contractId, now: NOW, ...payload },
    occurredAt: NOW,
  });
}

const PARTIAL_FACTS = {
  facts: {
    quantityReceived: 450,
    quantityOrdered: 500,
    pricePaid: 700000,
    budgetMax: 800000,
    merchantObserved: "ApprovedFoodChem",
    merchantExpected: "ApprovedFoodChem",
    certificateValid: true,
    productObserved: "fg",
    productExpected: "fg",
  },
};

describe("outcome-resolution event handlers", () => {
  it("execution SUCCESS updates the bound OutcomeContract but does not satisfy it", async () => {
    const ctx = await seedProcurement("pay");
    const result = await handleExecutionEvent(
      executionEnvelope(ctx.contract.id, "SUCCESS", "exec-success"),
      ctx.ports,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(loaded.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(loaded.value.state).not.toBe(OutcomeContractState.SATISFIED);
  });

  it("evidence updates requirement verification and can open PARTIAL resolution", async () => {
    const ctx = await seedProcurement("partial");
    await handleExecutionEvent(
      executionEnvelope(ctx.contract.id, "SUCCESS", "exec-partial"),
      ctx.ports,
    );
    const result = await handleEvidenceEvent(
      evidenceEnvelope(ctx.contract.id, PARTIAL_FACTS, "ev-partial"),
      ctx.ports,
    );
    expect(result.ok).toBe(true);
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(loaded.value.state).toBe(OutcomeContractState.PARTIAL);
    const qty = loaded.value.requirements.find((r) => r.concept === "quantity_received");
    expect(qty?.state).toBe(OutcomeRequirementState.PARTIAL);
    expect(ctx.resolution.listCasesForContract(ctx.contract.id)).toHaveLength(1);
  });

  it("duplicate completed delivery does not duplicate transitions or Resolution Cases", async () => {
    const ctx = await seedProcurement("dup");
    const exec = executionEnvelope(ctx.contract.id, "SUCCESS", "exec-dup");
    expect((await handleExecutionEvent(exec, ctx.ports)).ok).toBe(true);
    expect((await handleExecutionEvent(exec, ctx.ports)).ok).toBe(true);
    expect(
      ctx.outcomes.listTransitions(ctx.contract.id).filter((t) => t.reason === "payment_success"),
    ).toHaveLength(1);
    expect(
      ctx.outcomes.listEvents(ctx.contract.id).filter((e) => e.type === "payment_settled"),
    ).toHaveLength(1);

    const evidence = evidenceEnvelope(ctx.contract.id, PARTIAL_FACTS, "ev-dup");
    expect((await handleEvidenceEvent(evidence, ctx.ports)).ok).toBe(true);
    expect((await handleEvidenceEvent(evidence, ctx.ports)).ok).toBe(true);
    expect(
      ctx.outcomes.listTransitions(ctx.contract.id).filter((t) => t.reason === "observation_aggregate"),
    ).toHaveLength(1);
    expect(ctx.resolution.listCasesForContract(ctx.contract.id)).toHaveLength(1);
  });

  it("keeps payment SUCCESS distinct from a PARTIAL outcome", async () => {
    const ctx = await seedProcurement("distinct");
    await handleExecutionEvent(
      executionEnvelope(ctx.contract.id, "SUCCESS", "exec-distinct"),
      ctx.ports,
    );
    await handleEvidenceEvent(
      evidenceEnvelope(ctx.contract.id, PARTIAL_FACTS, "ev-distinct"),
      ctx.ports,
    );
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(loaded.value.state).toBe(OutcomeContractState.PARTIAL);
    expect(loaded.value.state).not.toBe(OutcomeContractState.SATISFIED);
  });

  it("travel BREACHED uses the same ResolutionCase path without a domain-specific outcome coordinator", async () => {
    const ctx = await seedTravel("partial");
    await handleExecutionEvent(
      executionEnvelope(ctx.contract.id, "SUCCESS", "exec-travel-partial"),
      ctx.ports,
    );
    const derived = deriveObservations(ctx.contract, [
      {
        id: "travel-provider",
        concept: "provider",
        value: "Approved Travel Co",
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-approved",
        concept: "approved_provider",
        value: true,
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-booking",
        concept: "booking_confirmed",
        value: true,
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-count",
        concept: "traveler_count",
        value: 1,
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-amount",
        concept: "total_amount",
        value: 3200,
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-refundable",
        concept: "refundable",
        value: true,
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-property",
        concept: "property_name",
        value: "Seaside Lodge",
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-date",
        concept: "stay_start_date",
        value: "2026-12-20T00:00:00.000Z",
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
      {
        id: "travel-deadline",
        concept: "completion_deadline",
        value: "2026-12-30T00:00:00.000Z",
        source: "verifier",
        trustClass: "ELEVATED_EXTERNAL",
        capturedAt: NOW,
      },
    ]);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const result = await handleEvidenceEvent(
      evidenceEnvelope(
        ctx.contract.id,
        { facts: derived.value.facts, conflictedConcepts: derived.value.conflictedConcepts },
        "ev-travel-partial",
      ),
      ctx.ports,
    );
    expect(result.ok).toBe(true);
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok && loaded.value.state).toBe(OutcomeContractState.BREACHED);
    expect(ctx.resolution.listCasesForContract(ctx.contract.id)).toHaveLength(1);
  });

  it("evidence conflict and breach paths update verification and open a case", async () => {
    const conflictCtx = await seedProcurement("conflict");
    await handleExecutionEvent(
      executionEnvelope(conflictCtx.contract.id, "SUCCESS", "exec-conflict"),
      conflictCtx.ports,
    );
    const conflicted = await handleEvidenceEvent(
      evidenceEnvelope(
        conflictCtx.contract.id,
        { ...PARTIAL_FACTS, conflictedConcepts: ["quantity_received"] },
        "ev-conflict",
      ),
      conflictCtx.ports,
    );
    expect(conflicted.ok).toBe(true);
    const conflictContract = await conflictCtx.outcomes.getContract(conflictCtx.contract.id);
    expect(conflictContract.ok && conflictContract.value.state).toBe(
      OutcomeContractState.CONFLICTED,
    );
    expect(conflictCtx.resolution.listCasesForContract(conflictCtx.contract.id)).toHaveLength(1);

    const breachCtx = await seedProcurement("breach");
    await handleExecutionEvent(
      executionEnvelope(breachCtx.contract.id, "SUCCESS", "exec-breach"),
      breachCtx.ports,
    );
    const breached = await handleEvidenceEvent(
      evidenceEnvelope(
        breachCtx.contract.id,
        {
          facts: {
            quantityReceived: 0,
            quantityOrdered: 500,
            pricePaid: 700000,
            budgetMax: 800000,
            merchantObserved: "ApprovedFoodChem",
            merchantExpected: "ApprovedFoodChem",
            certificateValid: false,
            productObserved: "industrial",
            productExpected: "fg",
          },
        },
        "ev-breach",
      ),
      breachCtx.ports,
    );
    expect(breached.ok).toBe(true);
    const breachContract = await breachCtx.outcomes.getContract(breachCtx.contract.id);
    expect(breachContract.ok && breachContract.value.state).toBe(
      OutcomeContractState.BREACHED,
    );
    expect(breachCtx.resolution.listCasesForContract(breachCtx.contract.id)).toHaveLength(1);
  });

  it("malformed and unsupported payloads are 4xx validation failures", async () => {
    const ctx = await seedProcurement("bad");
    const missingStatus = await handleExecutionEvent(
      createEnvelope({
        eventId: "evt-bad",
        type: "execution.completed",
        aggregateId: ctx.contract.id,
        aggregateVersion: 1,
        causationId: "c",
        correlationId: "corr",
        actorService: "gateway",
        payloadHash: "h",
        idempotencyKey: "bad-status",
        provenanceRefs: [],
        payload: { contractId: ctx.contract.id },
        occurredAt: NOW,
      }),
      ctx.ports,
    );
    expect(missingStatus.ok).toBe(false);
    if (missingStatus.ok) return;
    expect(missingStatus.code).toBe(ErrorCode.VALIDATION_FAILED);

    const extraField = await handleExecutionEvent(
      executionEnvelope(ctx.contract.id, "SUCCESS", "bad-extra", { unexpected: true }),
      ctx.ports,
    );
    expect(extraField.ok).toBe(false);
    if (extraField.ok) return;
    expect(extraField.code).toBe(ErrorCode.SCHEMA_PARSE_FAILED);
  });

  it("retryable persistence failure does not consume bus idempotency", async () => {
    const ctx = await seedProcurement("persist");
    ctx.contracts.failPuts = true;
    const envelope = executionEnvelope(ctx.contract.id, "SUCCESS", "exec-persist");
    const bus = new InMemoryPubSubBus();
    bus.subscribe(PubSubTopics.EXECUTION, (e) => handleExecutionEvent(e, ctx.ports));

    const first = await bus.publish(PubSubTopics.EXECUTION, envelope);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.details?.unexpected).toBe(true);

    ctx.contracts.failPuts = false;
    const retry = await bus.publish(PubSubTopics.EXECUTION, envelope);
    expect(retry.ok).toBe(true);
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok && loaded.value.paymentStatus).toBe(PaymentStatus.SUCCESS);
  });

  it("HTTP /internal/events maps persistence failure to 5xx and success/duplicate to 2xx", async () => {
    const ctx = await seedProcurement("http");
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "outcome-resolution",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_PERSISTENCE: "memory",
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const bus = new InMemoryPubSubBus();
    bus.subscribe(PubSubTopics.EXECUTION, (e) => handleExecutionEvent(e, ctx.ports));
    bus.subscribe(PubSubTopics.EVIDENCE, (e) => handleEvidenceEvent(e, ctx.ports));
    const http = createCloudRunHttpServer({
      config,
      bus,
      acceptedTopics: [PubSubTopics.EXECUTION, PubSubTopics.EVIDENCE],
      health: { ready: true },
      enableEvents: true,
    });
    await http.listen();
    const addr = http.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const execSub = "projects/p/subscriptions/tm-dev-outcome-resolution--execution.events-push";
    const evSub = "projects/p/subscriptions/tm-dev-outcome-resolution--evidence.events-push";

    ctx.contracts.failPuts = true;
    const failRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(
        executionEnvelope(ctx.contract.id, "SUCCESS", "http-persist"),
        execSub,
      ),
    });
    expect(failRes.status).toBe(500);

    ctx.contracts.failPuts = false;
    const okRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(
        executionEnvelope(ctx.contract.id, "SUCCESS", "http-persist"),
        execSub,
      ),
    });
    expect(okRes.status).toBe(200);

    const dupRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(
        executionEnvelope(ctx.contract.id, "SUCCESS", "http-persist"),
        execSub,
      ),
    });
    expect(dupRes.status).toBe(200);

    const evidenceRes = await fetch(`http://127.0.0.1:${port}/internal/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: pushBody(
        evidenceEnvelope(ctx.contract.id, PARTIAL_FACTS, "http-partial"),
        evSub,
      ),
    });
    expect(evidenceRes.status).toBe(200);
    const loaded = await ctx.outcomes.getContract(ctx.contract.id);
    expect(loaded.ok && loaded.value.state).toBe(OutcomeContractState.PARTIAL);
    expect(loaded.ok && loaded.value.paymentStatus).toBe(PaymentStatus.SUCCESS);

    await http.close();
  });
});
