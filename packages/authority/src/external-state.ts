import {
  ErrorCode,
  err,
  ok,
  type PreparedAction,
  type Result,
} from "@truemandate/protocol";
import {
  type CriticalExternalState,
  DEFAULT_MATERIAL_KEYS,
} from "./prepared-action.js";

export interface CriticalExternalStateProvider {
  refresh(input: {
    readonly preparedAction: PreparedAction;
    readonly materialKeys: readonly string[];
  }): Promise<Result<CriticalExternalState>>;
}

/**
 * Mock / test provider. Returns the persisted snapshot unless a test override
 * is registered. Does not fetch live merchant state.
 */
export class SnapshotExternalStateProvider implements CriticalExternalStateProvider {
  private readonly overrides = new Map<string, CriticalExternalState>();
  private unavailable = new Set<string>();

  setOverride(preparedActionId: string, state: CriticalExternalState): void {
    this.overrides.set(preparedActionId, state);
  }

  markUnavailable(preparedActionId: string): void {
    this.unavailable.add(preparedActionId);
  }

  async refresh(input: {
    readonly preparedAction: PreparedAction;
    readonly materialKeys: readonly string[];
  }): Promise<Result<CriticalExternalState>> {
    const id = String(input.preparedAction.id);
    if (this.unavailable.has(id)) {
      return err(
        ErrorCode.PREPARED_ACTION_STALE,
        "Trusted external state refresh unavailable",
        { preparedActionId: id },
      );
    }
    const keys = [
      ...new Set([...DEFAULT_MATERIAL_KEYS, ...input.materialKeys]),
    ];
    const source =
      this.overrides.get(id) ??
      input.preparedAction.externalStateSnapshot ??
      input.preparedAction.parameters;
    const complete: Record<string, unknown> = {};
    for (const key of keys) {
      complete[key] = (source as Record<string, unknown>)[key];
    }
    return ok(complete as CriticalExternalState);
  }
}
