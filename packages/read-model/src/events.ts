/**
 * Client-facing event subscription — adapters may wrap in-process buses or future Pub/Sub.
 */
export type ObservabilityTopic =
  | "intent"
  | "authority"
  | "execution"
  | "outcome"
  | "resolution"
  | "*";

export interface ObservabilityEvent {
  readonly id: string;
  readonly topic: ObservabilityTopic;
  readonly type: string;
  readonly at: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dedupeKey?: string;
}

export type ObservabilityHandler = (event: ObservabilityEvent) => void;

export interface ObservabilityEventPort {
  subscribe(topic: ObservabilityTopic, handler: ObservabilityHandler): () => void;
  publish(event: ObservabilityEvent): void;
}

export class InProcessObservabilityBus implements ObservabilityEventPort {
  private readonly handlers = new Map<ObservabilityTopic, Set<ObservabilityHandler>>();
  private readonly seen = new Set<string>();

  subscribe(topic: ObservabilityTopic, handler: ObservabilityHandler): () => void {
    const set = this.handlers.get(topic) ?? new Set();
    set.add(handler);
    this.handlers.set(topic, set);
    return () => set.delete(handler);
  }

  publish(event: ObservabilityEvent): void {
    const key = event.dedupeKey ?? event.id;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    for (const topic of [event.topic, "*" as const]) {
      for (const h of this.handlers.get(topic) ?? []) {
        h(event);
      }
    }
  }
}
