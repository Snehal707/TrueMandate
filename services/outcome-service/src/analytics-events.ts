import {
  createEnvelope,
  publishFailOpen,
  PubSubTopics,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";

/**
 * Wave 3.5: outcome analytics events for counterparty correlation.
 * Fail-open; never affects OutcomeService Results.
 * `merchant` is omitted when unknown (do not fabricate).
 */
export function publishOutcomeAnalyticsEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly type: string;
    readonly contractId: string;
    readonly intentId?: string;
    readonly merchant?: string;
    readonly state?: string;
    readonly observedAt: string;
    readonly dedupeKey: string;
    /** Wave 4.3: optional MonitoringContract link for escalation subscribers. */
    readonly monitoringContractId?: string;
  },
): void {
  const payload: Record<string, unknown> = {
    contractId: input.contractId,
    observedAt: input.observedAt,
  };
  if (input.merchant !== undefined && input.merchant.trim() !== "") {
    payload.merchant = input.merchant;
  }
  if (input.state !== undefined) payload.state = input.state;
  if (input.intentId !== undefined) payload.intentId = input.intentId;
  if (input.monitoringContractId !== undefined) {
    payload.monitoringContractId = input.monitoringContractId;
  }

  const envelope = createEnvelope({
    eventId: input.dedupeKey,
    type: input.type,
    aggregateId: input.contractId,
    aggregateVersion: 1,
    causationId: input.contractId,
    correlationId: input.intentId ?? input.contractId,
    actorService: "outcome-service",
    payloadHash: input.dedupeKey,
    idempotencyKey: input.dedupeKey,
    provenanceRefs: [],
    payload,
    occurredAt: input.observedAt,
  });
  publishFailOpen(publisher, PubSubTopics.OUTCOME, envelope);
}
