import type { CloudEventEnvelope } from "./envelope.js";
import type { PubSubPublisherPort } from "./publisher-port.js";
import type { PubSubTopic } from "./topics.js";

/**
 * Fail-open analytics publish. Never throws into or blocks privileged paths.
 * Soft Result failures and thrown client errors are both swallowed.
 *
 * Calls `publish` immediately so in-memory ports record synchronously before
 * the first await; only the Promise settlement is fire-and-forget.
 */
export function publishFailOpen(
  publisher: PubSubPublisherPort | undefined,
  topic: PubSubTopic,
  envelope: CloudEventEnvelope,
): void {
  if (!publisher) return;
  try {
    void publisher.publish(topic, envelope).catch(() => {
      // Fail-open: analytics must never affect privileged paths.
    });
  } catch {
    // Fail-open on synchronous throw from a hostile adapter.
  }
}
