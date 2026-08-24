import {
  createEnvelope,
  publishFailOpen,
  PubSubTopics,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";

/**
 * Wave 3.5/3.6: resolution analytics for remedy restoration rate.
 * Emits `restored` from the real RESOLVED("restored") path, and
 * `remedyType` from the deterministic taxonomy on the RemedyProposal
 * actually bound to this case's mandate — omitted (never fabricated) when
 * no such binding/value is known (e.g. variance-accepted closures).
 */
export function publishRemedyCompletedEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly caseId: string;
    readonly contractId: string;
    readonly restored: boolean;
    readonly remedyType?: string;
    readonly at: string;
  },
): void {
  const idempotencyKey = `remedy-completed:${input.caseId}:${input.restored}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "REMEDY_COMPLETED",
    aggregateId: input.caseId,
    aggregateVersion: 1,
    causationId: input.caseId,
    correlationId: input.contractId,
    actorService: "resolution-service",
    payloadHash: idempotencyKey,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      restored: input.restored,
      caseId: input.caseId,
      contractId: input.contractId,
      ...(input.remedyType ? { remedyType: input.remedyType } : {}),
    },
    occurredAt: input.at,
  });
  publishFailOpen(publisher, PubSubTopics.RESOLUTION, envelope);
}
