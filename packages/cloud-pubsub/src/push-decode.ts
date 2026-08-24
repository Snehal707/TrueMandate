import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import type { CloudEventEnvelope } from "./envelope.js";
import { PubSubTopics, type PubSubTopic } from "./topics.js";

const TOPIC_VALUES = new Set<string>(Object.values(PubSubTopics));

export function isPubSubTopic(value: string): value is PubSubTopic {
  return TOPIC_VALUES.has(value);
}

/** Parse `…/subscriptions/{prefix}-{consumer}--{topic}-push`. */
export function topicFromSubscription(subscription: string): PubSubTopic | undefined {
  const name = subscription.split("/").pop() ?? subscription;
  const match = name.match(/--(.+)-push$/);
  const topic = match?.[1];
  return topic && isPubSubTopic(topic) ? topic : undefined;
}

const ENVELOPE_STRING_FIELDS = [
  "eventId",
  "type",
  "aggregateId",
  "causationId",
  "correlationId",
  "actorService",
  "payloadHash",
  "idempotencyKey",
] as const;

export function parseCloudEventEnvelope(
  value: unknown,
): Result<CloudEventEnvelope> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return err(ErrorCode.VALIDATION_FAILED, "Envelope must be an object", {});
  }
  const rec = value as Record<string, unknown>;
  for (const field of ENVELOPE_STRING_FIELDS) {
    if (typeof rec[field] !== "string" || rec[field].trim() === "") {
      return err(ErrorCode.VALIDATION_FAILED, `Envelope missing ${field}`, {
        field,
      });
    }
  }
  if (typeof rec.aggregateVersion !== "number" || !Number.isFinite(rec.aggregateVersion)) {
    return err(ErrorCode.VALIDATION_FAILED, "Envelope missing aggregateVersion", {});
  }
  if (rec.payload === null || typeof rec.payload !== "object" || Array.isArray(rec.payload)) {
    return err(ErrorCode.VALIDATION_FAILED, "Envelope payload must be an object", {});
  }
  const provenanceRefs = rec.provenanceRefs;
  if (
    provenanceRefs !== undefined &&
    (!Array.isArray(provenanceRefs) ||
      provenanceRefs.some((r) => typeof r !== "string"))
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Envelope provenanceRefs invalid", {});
  }

  return ok({
    eventId: rec.eventId as string,
    type: rec.type as string,
    aggregateId: rec.aggregateId as string,
    aggregateVersion: rec.aggregateVersion,
    causationId: rec.causationId as string,
    correlationId: rec.correlationId as string,
    actorService: rec.actorService as string,
    protocolVersion:
      typeof rec.protocolVersion === "string" ? rec.protocolVersion : "unspecified",
    schemaVersion: typeof rec.schemaVersion === "string" ? rec.schemaVersion : "1",
    payloadHash: rec.payloadHash as string,
    idempotencyKey: rec.idempotencyKey as string,
    provenanceRefs: (provenanceRefs as readonly string[] | undefined) ?? [],
    payload: rec.payload as Readonly<Record<string, unknown>>,
    occurredAt:
      typeof rec.occurredAt === "string"
        ? rec.occurredAt
        : new Date().toISOString(),
    traceContext: typeof rec.traceContext === "string" ? rec.traceContext : undefined,
  });
}

export interface PubSubPushMessage {
  readonly topic: PubSubTopic;
  readonly envelope: CloudEventEnvelope;
  readonly messageId?: string;
}

/**
 * Decode a Google Pub/Sub push HTTP body.
 * `message.data` is base64-encoded JSON CloudEventEnvelope.
 */
export function decodePubSubPush(body: unknown): Result<PubSubPushMessage> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return err(ErrorCode.VALIDATION_FAILED, "Push body must be an object", {});
  }
  const rec = body as Record<string, unknown>;
  const message = rec.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return err(ErrorCode.VALIDATION_FAILED, "Push body missing message", {});
  }
  const msg = message as Record<string, unknown>;
  if (typeof msg.data !== "string" || msg.data.trim() === "") {
    return err(ErrorCode.VALIDATION_FAILED, "Push message missing data", {});
  }

  let decoded: string;
  try {
    decoded = Buffer.from(msg.data, "base64").toString("utf8");
  } catch {
    return err(ErrorCode.VALIDATION_FAILED, "Push message data is not base64", {});
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decoded);
  } catch {
    return err(ErrorCode.VALIDATION_FAILED, "Push message data is not JSON", {});
  }

  const envelope = parseCloudEventEnvelope(parsedJson);
  if (!envelope.ok) return envelope;

  const attrs = msg.attributes;
  const attrTopic =
    attrs !== null && typeof attrs === "object" && !Array.isArray(attrs)
      ? (attrs as Record<string, unknown>).topic
      : undefined;
  const fromAttr = typeof attrTopic === "string" && isPubSubTopic(attrTopic)
    ? attrTopic
    : undefined;
  const fromSub =
    typeof rec.subscription === "string"
      ? topicFromSubscription(rec.subscription)
      : undefined;
  const topic = fromAttr ?? fromSub;
  if (!topic) {
    return err(
      ErrorCode.VALIDATION_FAILED,
      "Cannot resolve Pub/Sub topic from push body",
      {},
    );
  }

  return ok({
    topic,
    envelope: envelope.value,
    messageId: typeof msg.messageId === "string" ? msg.messageId : undefined,
  });
}
