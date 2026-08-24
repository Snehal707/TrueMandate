import {
  GooglePubSubPublisherPort,
  MemoryPubSubPublisherPort,
  NoopPubSubPublisherPort,
  type PubSubPublisherPort,
} from "./publisher-port.js";

export type GovernanceEventPublishMode = "disabled" | "memory" | "pubsub";

/**
 * Env-driven mode for outbound governance event publishing.
 * Default `disabled` preserves zero-behavior-change until explicitly enabled.
 */
export function governanceEventPublishModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceEventPublishMode {
  const raw = (env.TM_GOVERNANCE_EVENTS_MODE ?? "disabled").trim().toLowerCase();
  if (raw === "memory" || raw === "pubsub" || raw === "disabled") {
    return raw;
  }
  return "disabled";
}

export interface CreatePubSubPublisherPortOptions {
  readonly projectId?: string;
  readonly topicPrefix?: string;
}

/**
 * Factory for the outbound publisher. `pubsub` mode lazily constructs the
 * Google client; callers should await this at process start, not on hot path.
 *
 * Topic names in production are env-prefixed (e.g. `tm-dev-intent.events`).
 * Set `TM_PUBSUB_TOPIC_PREFIX=tm-dev-` (or pass `topicPrefix`) so publishes
 * target the Foundation domain topics.
 */
export async function createPubSubPublisherPort(
  mode: GovernanceEventPublishMode = governanceEventPublishModeFromEnv(),
  options: CreatePubSubPublisherPortOptions = {},
): Promise<PubSubPublisherPort> {
  if (mode === "memory") {
    return new MemoryPubSubPublisherPort();
  }
  if (mode === "pubsub") {
    const projectId =
      options.projectId ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GCP_PROJECT ??
      "";
    if (!projectId) {
      return new NoopPubSubPublisherPort();
    }
    const topicPrefix =
      options.topicPrefix ??
      process.env.TM_PUBSUB_TOPIC_PREFIX ??
      undefined;
    return GooglePubSubPublisherPort.create({
      projectId,
      topicPrefix,
    });
  }
  return new NoopPubSubPublisherPort();
}
