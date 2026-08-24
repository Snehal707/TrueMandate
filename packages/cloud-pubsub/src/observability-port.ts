import type {
  ObservabilityEvent,
  ObservabilityEventPort,
  ObservabilityHandler,
  ObservabilityTopic,
} from "@truemandate/read-model";
import { createEnvelope } from "./envelope.js";
import type { InMemoryPubSubBus } from "./in-memory-bus.js";
import { PubSubTopics, type PubSubTopic } from "./topics.js";

const TOPIC_MAP: Record<Exclude<ObservabilityTopic, "*">, PubSubTopic> = {
  intent: PubSubTopics.INTENT,
  authority: PubSubTopics.AUTHORITY,
  execution: PubSubTopics.EXECUTION,
  outcome: PubSubTopics.OUTCOME,
  resolution: PubSubTopics.RESOLUTION,
};

/**
 * Pub/Sub-backed ObservabilityEventPort for dashboard and audit projections.
 */
export class PubSubObservabilityEventPort implements ObservabilityEventPort {
  private readonly handlers = new Map<ObservabilityTopic, Set<ObservabilityHandler>>();
  private readonly seen = new Set<string>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly bus: InMemoryPubSubBus) {
    const unsub = bus.subscribe(PubSubTopics.OBSERVABILITY, (envelope) => {
      const event = envelopeToObservabilityEvent(envelope);
      const key = event.dedupeKey ?? event.id;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      for (const topic of [event.topic, "*" as const]) {
        for (const h of this.handlers.get(topic) ?? []) {
          h(event);
        }
      }
    });
    this.unsubscribers.push(unsub);
  }

  subscribe(topic: ObservabilityTopic, handler: ObservabilityHandler): () => void {
    const set = this.handlers.get(topic) ?? new Set();
    set.add(handler);
    this.handlers.set(topic, set);
    return () => set.delete(handler);
  }

  publish(event: ObservabilityEvent): void {
    const envelope = createEnvelope({
      eventId: event.id,
      type: event.type,
      aggregateId: event.topic,
      aggregateVersion: 1,
      causationId: event.id,
      correlationId: event.id,
      actorService: "observability-service",
      payloadHash: event.dedupeKey ?? event.id,
      idempotencyKey: event.dedupeKey ?? event.id,
      provenanceRefs: [],
      payload: {
        topic: event.topic,
        at: event.at,
        ...event.payload,
      },
      occurredAt: event.at,
    });

    void this.bus.publish(PubSubTopics.OBSERVABILITY, envelope);

    const domainTopic =
      event.topic === "*" ? undefined : TOPIC_MAP[event.topic];
    if (domainTopic) {
      void this.bus.publish(domainTopic, envelope);
    }
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
  }
}

function envelopeToObservabilityEvent(envelope: CloudEventEnvelopeLike): ObservabilityEvent {
  const payload = envelope.payload;
  const topic = (payload.topic as ObservabilityTopic | undefined) ?? "outcome";
  const { topic: _t, at, ...rest } = payload;
  return {
    id: envelope.eventId,
    topic,
    type: envelope.type,
    at: String(at ?? envelope.occurredAt),
    payload: rest,
    dedupeKey: envelope.idempotencyKey,
  };
}

interface CloudEventEnvelopeLike {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
