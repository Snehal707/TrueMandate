import {
  createEnvelope,
  publishFailOpen,
  PubSubTopics,
  type PubSubPublisherPort,
} from "@truemandate/cloud-pubsub";

/**
 * Wave 3.5: plan + guardian analytics events for field-contract compliance.
 * Fail-open; never affects workflow Results.
 */
export function publishPlanCreatedEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly workflowId: string;
    readonly intentId: string;
    readonly planId: string;
    readonly ambiguityClass: string;
  },
): void {
  const idempotencyKey = `plan-created:${input.workflowId}:${input.planId}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "PLAN_CREATED",
    aggregateId: input.workflowId,
    aggregateVersion: 1,
    causationId: input.planId,
    correlationId: input.intentId,
    actorService: "agent-runtime",
    payloadHash: idempotencyKey,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      ambiguityClass: input.ambiguityClass,
      workflowId: input.workflowId,
      intentId: input.intentId,
      planId: input.planId,
    },
  });
  publishFailOpen(publisher, PubSubTopics.PLAN, envelope);
}

export function publishGuardianVerdictEvent(
  publisher: PubSubPublisherPort | undefined,
  input: {
    readonly workflowId: string;
    readonly intentId: string;
    readonly agentId: string;
    readonly decision: string;
    readonly criticalFailure?: boolean;
    readonly semanticStatus?: string;
  },
): void {
  const idempotencyKey = `guardian-verdict:${input.workflowId}:${input.decision}`;
  const envelope = createEnvelope({
    eventId: idempotencyKey,
    type: "GUARDIAN_VERDICT",
    aggregateId: input.workflowId,
    aggregateVersion: 1,
    causationId: input.workflowId,
    correlationId: input.intentId,
    actorService: "agent-runtime",
    payloadHash: idempotencyKey,
    idempotencyKey,
    provenanceRefs: [],
    payload: {
      decision: input.decision,
      agentId: input.agentId,
      workflowId: input.workflowId,
      intentId: input.intentId,
      ...(input.criticalFailure !== undefined
        ? { criticalFailure: input.criticalFailure }
        : {}),
      ...(input.semanticStatus !== undefined
        ? { semanticStatus: input.semanticStatus }
        : {}),
    },
  });
  publishFailOpen(publisher, PubSubTopics.GUARDIAN, envelope);
}
