import type { ModelCallTelemetryEvent } from "@truemandate/protocol";

/**
 * Best-effort sink for model-call telemetry (success and failure).
 *
 * Fail-open (non-negotiable): implementations, and callers of `record`,
 * must never let a telemetry write throw into, block, or alter the outcome
 * of a business/authorization code path. Use `failOpenModelTelemetry` to
 * wrap a real implementation so callers don't need their own try/catch.
 */
export interface ModelTelemetryPort {
  record(event: ModelCallTelemetryEvent): Promise<void>;
}

export class NoopModelTelemetry implements ModelTelemetryPort {
  async record(): Promise<void> {
    // Intentionally does nothing — default for environments/tests that
    // don't wire durable model telemetry.
  }
}

export const noopModelTelemetry: ModelTelemetryPort = new NoopModelTelemetry();

/**
 * Wraps a ModelTelemetryPort so that any failure to record is caught and
 * logged rather than propagated. Compose this at the injection point
 * (e.g. service bin/start.ts) so downstream callers (VertexGeminiModel)
 * can call `record` without their own error handling.
 */
export function failOpenModelTelemetry(
  port: ModelTelemetryPort,
  serviceName: string,
): ModelTelemetryPort {
  return {
    async record(event: ModelCallTelemetryEvent): Promise<void> {
      try {
        await port.record(event);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "model_telemetry_record_failed",
            service: serviceName,
            modelCallStatus: event.status,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  };
}

/**
 * Process-local, in-memory ModelTelemetryPort. Intended for services that
 * should observe model-call telemetry without polluting durable production
 * storage (e.g. the benchmark runner, whose scenario runs must not write
 * into the same `modelCalls` Firestore collection as production traffic).
 * Events are lost when the process exits — never use this where durability
 * is required.
 */
export class InMemoryModelTelemetryCollector implements ModelTelemetryPort {
  private readonly events: ModelCallTelemetryEvent[] = [];

  async record(event: ModelCallTelemetryEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(): readonly ModelCallTelemetryEvent[] {
    return this.events;
  }

  get count(): number {
    return this.events.length;
  }

  summary(): { total: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const event of this.events) {
      byStatus[event.status] = (byStatus[event.status] ?? 0) + 1;
    }
    return { total: this.events.length, byStatus };
  }
}
