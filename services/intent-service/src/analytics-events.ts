import {
  createEnvelope,
  publishFailOpen,
  PubSubTopics,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";
import type { Intent } from "@truemandate/protocol";
import type { WeakenedConstraint } from "@truemandate/authority";

/**
 * Emits the durable compile trigger for a recorded raw Intent.
 * Publishing is idempotent and fail-open so an identical replay can
 * safely retrigger the compile/finalize path without mutating the Intent.
 */
export function publishIntentRecordedEvent(
  publisher: PubSubPublisherPort | undefined,
  intent: Intent,
): void {
  const idempotencyKey = `intent-recorded:${intent.id}:${intent.contentHash}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "INTENT_RECORDED",
    aggregateId: intent.id,
    aggregateVersion: 1,
    causationId: intent.id,
    correlationId: intent.id,
    actorService: "intent-service",
    payloadHash: intent.contentHash,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      intentId: intent.id,
      principalId: intent.principalId,
      rawText: intent.rawText,
      createdAt: intent.createdAt,
      contentHash: intent.contentHash,
    },
    occurredAt: intent.createdAt,
  });
  publishFailOpen(publisher, PubSubTopics.INTENT, envelope);
}

/**
 * Wave 3.6: emit CONSTRAINT_WEAKENED for each constraint the real
 * detectWeakenedConstraints() comparison found weaker in the new
 * IntentState version than in the previous one. Fail-open; never affects
 * the createIntentState() Result.
 */
export function publishConstraintWeakenedEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly intentId: string;
    readonly intentStateId: string;
    readonly previousStateId: string;
    readonly drift: WeakenedConstraint;
    readonly at: string;
  },
): void {
  const idempotencyKey = `constraint-weakened:${input.intentStateId}:${input.drift.constraintId}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "CONSTRAINT_WEAKENED",
    aggregateId: input.intentId,
    aggregateVersion: 1,
    causationId: input.previousStateId,
    correlationId: input.intentId,
    actorService: "intent-service",
    payloadHash: idempotencyKey,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      concept: input.drift.concept,
      constraintId: input.drift.constraintId,
      reason: input.drift.reason,
      intentId: input.intentId,
      intentStateId: input.intentStateId,
      previousStateId: input.previousStateId,
    },
    occurredAt: input.at,
  });
  publishFailOpen(publisher, PubSubTopics.INTENT, envelope);
}
