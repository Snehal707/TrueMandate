import { ok, asOutcomeContractId, type OutcomeEvent, type Result } from "@truemandate/protocol";
import { createEnvelope, type CloudEventEnvelope } from "./envelope.js";
import type { InMemoryPubSubBus } from "./in-memory-bus.js";
import { PubSubTopics } from "./topics.js";

export type OutcomeEventHandler = (event: OutcomeEvent) => void;

/**
 * Pub/Sub-backed outcome event port — API-compatible with evidence-service OutcomeEventBus.
 */
export class PubSubOutcomeEventBus {
  private readonly handlers = new Map<string, Set<OutcomeEventHandler>>();
  private readonly all = new Set<OutcomeEventHandler>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly bus: InMemoryPubSubBus) {
    const unsub = bus.subscribe(PubSubTopics.OUTCOME, (envelope) => {
      const event = envelopeToOutcomeEvent(envelope);
      for (const h of this.all) h(event);
      const set = this.handlers.get(event.type);
      if (set) for (const h of set) h(event);
    });
    this.unsubscribers.push(unsub);
  }

  subscribe(type: string | "*", handler: OutcomeEventHandler): () => void {
    if (type === "*") {
      this.all.add(handler);
      return () => this.all.delete(handler);
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  async publish(event: OutcomeEvent): Promise<Result<void>> {
    const envelope = createEnvelope({
      eventId: event.id ?? crypto.randomUUID(),
      type: event.type,
      aggregateId: event.contractId,
      aggregateVersion: 1,
      causationId: event.id ?? event.contractId,
      correlationId: event.contractId,
      actorService: "outcome-service",
      payloadHash: event.dedupeKey ?? event.id ?? event.contractId,
      idempotencyKey: event.dedupeKey ?? event.id ?? `${event.contractId}:${event.type}:${event.observedAt}`,
      provenanceRefs: event.causalRefs ?? [],
      payload: {
        contractId: event.contractId,
        observedAt: event.observedAt,
        ...event.payload,
        evidenceIds: event.evidenceIds,
        triggerIdentity: event.triggerIdentity,
        conditionKey: event.conditionKey,
      },
    });
    return this.bus.publish(PubSubTopics.OUTCOME, envelope);
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
  }
}

function envelopeToOutcomeEvent(envelope: CloudEventEnvelope): OutcomeEvent {
  const payload = envelope.payload as Record<string, unknown>;
  const { contractId, observedAt, evidenceIds, triggerIdentity, conditionKey, ...rest } =
    payload;
  return {
    id: envelope.eventId,
    contractId: asOutcomeContractId(String(contractId ?? envelope.aggregateId)),
    type: envelope.type,
    observedAt: String(observedAt ?? envelope.occurredAt),
    payload: rest,
    evidenceIds: Array.isArray(evidenceIds)
      ? (evidenceIds as OutcomeEvent["evidenceIds"])
      : undefined,
    dedupeKey: envelope.idempotencyKey,
    causalRefs: envelope.provenanceRefs,
    triggerIdentity:
      typeof triggerIdentity === "string" ? triggerIdentity : undefined,
    conditionKey: typeof conditionKey === "string" ? conditionKey : undefined,
  };
}

/** Synchronous publish helper for in-process callers that ignore async transport. */
export function publishOutcomeEventSync(
  bus: PubSubOutcomeEventBus,
  event: OutcomeEvent,
): Result<void> {
  void bus.publish(event);
  return ok();
}
