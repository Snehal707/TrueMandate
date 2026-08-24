import { PROTOCOL_VERSION } from "@truemandate/protocol";
import { currentTraceParent } from "@truemandate/observability/propagation";

/** Canonical CloudEvent-style envelope for Pub/Sub transport. */
export interface CloudEventEnvelope<TPayload = Readonly<Record<string, unknown>>> {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly causationId: string;
  readonly correlationId: string;
  readonly actorService: string;
  readonly protocolVersion: string;
  readonly schemaVersion: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly provenanceRefs: readonly string[];
  readonly payload: TPayload;
  readonly occurredAt: string;
  /**
   * Wave 2 observability: W3C `traceparent` of the span active when this
   * envelope was created, captured best-effort so the consumer's handler
   * span can link back to the publisher's trace across the async Pub/Sub
   * boundary. Never used for authorization or correlation of privileged
   * state — see packages/cloud-security for the distinct, non-provenance
   * Cloud Trace correlation-id note.
   */
  readonly traceContext?: string;
}

export function createEnvelope<TPayload extends Readonly<Record<string, unknown>>>(
  partial: Omit<
    CloudEventEnvelope<TPayload>,
    "protocolVersion" | "schemaVersion" | "occurredAt" | "traceContext"
  > & {
    protocolVersion?: string;
    schemaVersion?: string;
    occurredAt?: string;
    traceContext?: string;
  },
): CloudEventEnvelope<TPayload> {
  return {
    protocolVersion: partial.protocolVersion ?? PROTOCOL_VERSION,
    schemaVersion: partial.schemaVersion ?? "1",
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
    eventId: partial.eventId,
    type: partial.type,
    aggregateId: partial.aggregateId,
    aggregateVersion: partial.aggregateVersion,
    causationId: partial.causationId,
    correlationId: partial.correlationId,
    actorService: partial.actorService,
    payloadHash: partial.payloadHash,
    idempotencyKey: partial.idempotencyKey,
    provenanceRefs: partial.provenanceRefs,
    payload: partial.payload,
    traceContext: partial.traceContext ?? currentTraceParent(),
  };
}
