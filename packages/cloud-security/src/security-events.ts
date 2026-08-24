/**
 * First-class security event emissions for cloud observability.
 * Cloud Trace correlation IDs are NOT Intent Provenance Graph nodes.
 */

export const SecurityEventType = {
  MODEL_ARMOR_INSPECT_REQUESTED: "security.model_armor.inspect_requested",
  MODEL_ARMOR_INSPECT_RESULT: "security.model_armor.inspect_result",
  MODEL_ARMOR_UNAVAILABLE: "security.model_armor.unavailable",
  IDENTITY_VERIFICATION_FAILED: "security.identity.verification_failed",
  PRIVILEGED_PATH_DENIED: "security.privileged_path.denied",
  PUBSUB_DEDUPED: "security.pubsub.deduped",
  PUBSUB_OUT_OF_ORDER: "security.pubsub.out_of_order",
  PUBSUB_DLQ: "security.pubsub.dlq",
  BFF_FORBIDDEN_ROUTE: "security.bff.forbidden_route",
  CONFIG_FAIL_CLOSED: "security.config.fail_closed",
} as const;

export type SecurityEventType =
  (typeof SecurityEventType)[keyof typeof SecurityEventType];

export interface SecurityEvent {
  readonly id: string;
  readonly type: SecurityEventType;
  readonly at: string;
  readonly correlationId?: string;
  readonly actorService: string;
  readonly severity: "INFO" | "WARN" | "CRITICAL";
  readonly details: Readonly<Record<string, unknown>>;
}

export interface SecurityEventPort {
  emit(event: SecurityEvent): void;
  list(): readonly SecurityEvent[];
}

export class InMemorySecurityEventBus implements SecurityEventPort {
  private readonly events: SecurityEvent[] = [];

  emit(event: SecurityEvent): void {
    this.events.push(event);
  }

  list(): readonly SecurityEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function createSecurityEvent(
  partial: Omit<SecurityEvent, "id" | "at"> & {
    readonly id?: string;
    readonly at?: string;
  },
): SecurityEvent {
  return {
    id: partial.id ?? `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: partial.at ?? new Date().toISOString(),
    type: partial.type,
    correlationId: partial.correlationId,
    actorService: partial.actorService,
    severity: partial.severity,
    details: partial.details,
  };
}
