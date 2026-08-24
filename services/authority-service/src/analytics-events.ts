import {
  createEnvelope,
  publishFailOpen,
  PubSubTopics,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";
import type { AuthorityDecision } from "@truemandate/protocol";

/**
 * Wave 3.5: emit AUTHORITY_DECISION for analytics field-contract compliance.
 * Fail-open; never affects the Authority decision Result.
 */
export function publishAuthorityDecisionEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly decision: AuthorityDecision | string;
    readonly intentId: string;
    readonly capability: string;
    readonly agentId: string;
    readonly reasons: readonly string[];
    readonly requestId: string;
  },
): void {
  const idempotencyKey = `authority-decision:${input.requestId}:${input.decision}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "AUTHORITY_DECISION",
    aggregateId: input.intentId,
    aggregateVersion: 1,
    causationId: input.requestId,
    correlationId: input.intentId,
    actorService: "authority-service",
    payloadHash: idempotencyKey,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      decision: input.decision,
      intentId: input.intentId,
      capability: input.capability,
      agentId: input.agentId,
      reasons: input.reasons,
    },
  });
  publishFailOpen(publisher, PubSubTopics.AUTHORITY, envelope);
}
