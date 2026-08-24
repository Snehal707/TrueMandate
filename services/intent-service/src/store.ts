import type { Intent, IntentId, IntentState, IntentStateId } from "@truemandate/protocol";

export interface IntentRepository {
  putIntent(intent: Intent): Promise<void>;
  getIntent(id: IntentId | string): Promise<Intent | undefined>;
  putState(state: IntentState): Promise<void>;
  getState(id: IntentStateId | string): Promise<IntentState | undefined>;
  getTip(intentId: IntentId | string): Promise<IntentState | undefined>;
  setTip(intentId: IntentId | string, stateId: IntentStateId): Promise<void>;
  /** Atomically installs a deterministic finalized state, returning an existing
   * state with the same id on replay. */
  finalizeState(state: IntentState): Promise<IntentState>;
}

/** Local/test-only. Not multi-instance safe. */
export class InMemoryIntentRepository implements IntentRepository {
  private readonly intents = new Map<string, Intent>();
  private readonly states = new Map<string, IntentState>();
  private readonly tips = new Map<string, IntentStateId>();

  async putIntent(intent: Intent): Promise<void> {
    this.intents.set(intent.id, intent);
  }

  async getIntent(id: IntentId | string): Promise<Intent | undefined> {
    return this.intents.get(String(id));
  }

  async putState(state: IntentState): Promise<void> {
    this.states.set(state.id, state);
  }

  async getState(id: IntentStateId | string): Promise<IntentState | undefined> {
    return this.states.get(String(id));
  }

  async getTip(intentId: IntentId | string): Promise<IntentState | undefined> {
    const tipId = this.tips.get(String(intentId));
    return tipId ? this.states.get(tipId) : undefined;
  }

  async setTip(intentId: IntentId | string, stateId: IntentStateId): Promise<void> {
    this.tips.set(String(intentId), stateId);
  }

  async finalizeState(state: IntentState): Promise<IntentState> {
    const existing = this.states.get(state.id);
    if (existing) return existing;
    this.states.set(state.id, state);
    this.tips.set(String(state.intentId), state.id);
    return state;
  }
}
