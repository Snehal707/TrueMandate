import type { OutcomeEvent } from "@truemandate/protocol";

export type OutcomeEventHandler = (event: OutcomeEvent) => void;

/** In-process port — swap for Pub/Sub later. */
export class OutcomeEventBus {
  private readonly handlers = new Map<string, Set<OutcomeEventHandler>>();
  private readonly all = new Set<OutcomeEventHandler>();

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

  publish(event: OutcomeEvent): void {
    for (const h of this.all) h(event);
    const set = this.handlers.get(event.type);
    if (set) for (const h of set) h(event);
  }
}
