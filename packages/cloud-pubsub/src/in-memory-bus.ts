import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { extractContext, withSpan } from "@truemandate/observability/propagation";
import type { CloudEventEnvelope } from "./envelope.js";
import type { PubSubTopic } from "./topics.js";

export type PubSubHandler = (
  envelope: CloudEventEnvelope,
) => void | Result<unknown> | Promise<void | Result<unknown>>;

export interface SubscribeOptions {
  /** Failed handlers on security-critical subscriptions route to DLQ. */
  readonly securityCritical?: boolean;
}

interface Subscription {
  readonly handler: PubSubHandler;
  readonly securityCritical: boolean;
}

export interface PublishRejection {
  readonly reason: "OUT_OF_ORDER" | "DUPLICATE";
  readonly envelope: CloudEventEnvelope;
}

function isResult(value: unknown): value is Result<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
}

/**
 * In-process Pub/Sub bus for CI and local Cloud wiring.
 * Production adapters may wrap @google-cloud/pubsub with the same semantics.
 *
 * Idempotency keys are recorded only after all handlers complete successfully.
 * A duplicate of a completed key ACKs without re-running handlers. Transient
 * failure must remain retryable (key not consumed).
 */
export class InMemoryPubSubBus {
  private readonly handlers = new Map<PubSubTopic, Set<Subscription>>();
  private readonly seenIdempotency = new Set<string>();
  private readonly aggregateVersions = new Map<string, number>();
  private readonly deadLetterQueue: CloudEventEnvelope[] = [];
  private readonly rejections: PublishRejection[] = [];

  get dlq(): readonly CloudEventEnvelope[] {
    return this.deadLetterQueue;
  }

  get publishRejections(): readonly PublishRejection[] {
    return this.rejections;
  }

  subscribe(
    topic: PubSubTopic,
    handler: PubSubHandler,
    options: SubscribeOptions = {},
  ): () => void {
    const sub: Subscription = {
      handler,
      securityCritical: options.securityCritical ?? false,
    };
    const set = this.handlers.get(topic) ?? new Set();
    set.add(sub);
    this.handlers.set(topic, set);
    return () => set.delete(sub);
  }

  async publish(
    topic: PubSubTopic,
    envelope: CloudEventEnvelope,
  ): Promise<Result<void>> {
    const lastSeen = this.aggregateVersions.get(envelope.aggregateId) ?? 0;
    if (envelope.aggregateVersion < lastSeen) {
      this.rejections.push({ reason: "OUT_OF_ORDER", envelope });
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Out-of-order aggregate version rejected",
        {
          aggregateId: envelope.aggregateId,
          aggregateVersion: envelope.aggregateVersion,
          lastSeen,
        },
      );
    }

    if (this.seenIdempotency.has(envelope.idempotencyKey)) {
      this.rejections.push({ reason: "DUPLICATE", envelope });
      return ok();
    }

    const subs = this.handlers.get(topic);
    if (!subs || subs.size === 0) {
      this.recordSuccess(envelope, lastSeen);
      return ok();
    }

    // Wave 2 observability: link the consumer handler span to the
    // publisher's trace (envelope.traceContext) across the async Pub/Sub
    // boundary. Fail-open: extractContext/withSpan never throw for tracing
    // reasons; a thrown error here is a real handler failure, unchanged
    // from prior behavior.
    const handlerContext = extractContext(
      envelope.traceContext ? { traceparent: envelope.traceContext } : {},
    );

    for (const sub of subs) {
      try {
        const outcome = await withSpan(
          `PubSub consume ${topic}`,
          {
            "messaging.system": "gcp_pubsub",
            "messaging.destination.name": topic,
            "messaging.message.id": envelope.eventId,
          },
          () => sub.handler(envelope),
          handlerContext,
        );
        if (isResult(outcome) && !outcome.ok) {
          this.deadLetterQueue.push(envelope);
          if (sub.securityCritical) {
            continue;
          }
          return outcome;
        }
      } catch (e) {
        this.deadLetterQueue.push(envelope);
        if (sub.securityCritical) {
          continue;
        }
        const message = e instanceof Error ? e.message : "Handler failed";
        return err(ErrorCode.VALIDATION_FAILED, message, {
          topic,
          eventId: envelope.eventId,
          dlq: true,
          unexpected: true,
        });
      }
    }

    this.recordSuccess(envelope, lastSeen);
    return ok();
  }

  private recordSuccess(envelope: CloudEventEnvelope, lastSeen: number): void {
    this.seenIdempotency.add(envelope.idempotencyKey);
    if (envelope.aggregateVersion > lastSeen) {
      this.aggregateVersions.set(envelope.aggregateId, envelope.aggregateVersion);
    }
  }
}
