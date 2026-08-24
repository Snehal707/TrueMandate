/** Canonical Pub/Sub topic names for domain event streams. */
export const PubSubTopics = {
  INTENT: "intent.events",
  SEMANTIC: "semantic.events",
  PLAN: "plan.events",
  GUARDIAN: "guardian.events",
  AUTHORITY: "authority.events",
  EXECUTION: "execution.events",
  EVIDENCE: "evidence.events",
  OUTCOME: "outcome.events",
  RESOLUTION: "resolution.events",
  SECURITY: "security.events",
  OBSERVABILITY: "observability.events",
} as const;

export type PubSubTopic = (typeof PubSubTopics)[keyof typeof PubSubTopics];
