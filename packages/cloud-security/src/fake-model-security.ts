import { ok, type Result } from "@truemandate/protocol";
import {
  ModelInspectionStatus,
  preserveTaintThroughInspection,
  type ModelSecurityAuditRecord,
  type ModelSecurityInspectInput,
  type ModelSecurityInspectResult,
  type ModelSecurityPort,
} from "./model-security-port.js";

export interface FakeModelArmorOptions {
  readonly defaultStatus?: ModelInspectionStatus;
  readonly handlers?: Readonly<
    Record<string, (input: ModelSecurityInspectInput) => ModelInspectionStatus>
  >;
  readonly unavailable?: boolean;
}

/**
 * In-memory Model Armor stand-in for tests and local development.
 */
export class InMemoryModelSecurityPort implements ModelSecurityPort {
  private readonly _requested: ModelSecurityAuditRecord[] = [];
  private readonly _results: ModelSecurityAuditRecord[] = [];
  private readonly _failures: ModelSecurityAuditRecord[] = [];

  constructor(private readonly options: FakeModelArmorOptions = {}) {}

  get inspectionRequested(): readonly ModelSecurityAuditRecord[] {
    return this._requested;
  }

  get inspectionResults(): readonly ModelSecurityAuditRecord[] {
    return this._results;
  }

  get inspectionFailures(): readonly ModelSecurityAuditRecord[] {
    return this._failures;
  }

  async inspect(
    input: ModelSecurityInspectInput,
  ): Promise<Result<ModelSecurityInspectResult>> {
    const at = new Date().toISOString();
    this._requested.push({ requestId: input.requestId, at });

    if (this.options.unavailable) {
      this._failures.push({
        requestId: input.requestId,
        at,
        detail: "unavailable",
      });
      return ok(
        preserveTaintThroughInspection(
          input,
          ModelInspectionStatus.UNAVAILABLE,
          ["model_armor_unavailable"],
        ),
      );
    }

    try {
      const handler = this.options.handlers?.[input.requestId];
      const status =
        handler?.(input) ??
        this.options.defaultStatus ??
        ModelInspectionStatus.CLEAN;
      const result = preserveTaintThroughInspection(input, status);
      this._results.push({ requestId: input.requestId, at, detail: status });
      return ok(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : "inspect failed";
      this._failures.push({ requestId: input.requestId, at, detail: message });
      return ok(
        preserveTaintThroughInspection(
          input,
          ModelInspectionStatus.ERROR,
          [message],
        ),
      );
    }
  }
}

/** Alias matching spec naming. */
export class FakeModelArmor extends InMemoryModelSecurityPort {}
