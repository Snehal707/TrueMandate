import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import type { CloudEventEnvelope } from "./envelope.js";
import type { PubSubTopic } from "./topics.js";

/**
 * Outbound governance-event publisher. Fail-open by design: callers must
 * never let a publish failure affect Authority, Gateway, or commit paths.
 */
export interface PubSubPublisherPort {
  publish(
    topic: PubSubTopic,
    envelope: CloudEventEnvelope,
  ): Promise<Result<void>>;
}

/** Default when unconfigured — zero behavior change, nothing leaves process. */
export class NoopPubSubPublisherPort implements PubSubPublisherPort {
  async publish(
    _topic: PubSubTopic,
    _envelope: CloudEventEnvelope,
  ): Promise<Result<void>> {
    return ok();
  }
}

export interface PublishedRecord {
  readonly topic: PubSubTopic;
  readonly envelope: CloudEventEnvelope;
}

/**
 * In-memory sink for tests. Captures published envelopes; never talks to GCP.
 */
export class MemoryPubSubPublisherPort implements PubSubPublisherPort {
  readonly published: PublishedRecord[] = [];
  private failPublishes = false;
  private throwOnPublish = false;

  setFailPublishes(value: boolean): void {
    this.failPublishes = value;
  }

  setThrowOnPublish(value: boolean): void {
    this.throwOnPublish = value;
  }

  async publish(
    topic: PubSubTopic,
    envelope: CloudEventEnvelope,
  ): Promise<Result<void>> {
    if (this.throwOnPublish) {
      throw new Error("PUBSUB_UNAVAILABLE");
    }
    if (this.failPublishes) {
      return err(ErrorCode.VALIDATION_FAILED, "Pub/Sub publish failed", {
        topic,
      });
    }
    this.published.push({ topic, envelope });
    return ok();
  }

  clear(): void {
    this.published.length = 0;
  }
}

export interface GooglePubSubPublisherPortOptions {
  readonly projectId: string;
  /** Optional topic name prefix (e.g. env-qualified). Defaults to bare topic. */
  readonly topicPrefix?: string;
}

type GoogleTopic = {
  publishMessage(input: {
    data: Buffer;
    attributes?: Record<string, string>;
  }): Promise<string>;
};

type GooglePubSubClient = {
  topic(name: string): GoogleTopic;
};

/**
 * Production adapter. Lazily imports `@google-cloud/pubsub` only when
 * constructed — privileged packages never need this dependency installed.
 */
export class GooglePubSubPublisherPort implements PubSubPublisherPort {
  constructor(
    private readonly options: GooglePubSubPublisherPortOptions,
    private readonly client: GooglePubSubClient,
  ) {}

  static async create(
    options: GooglePubSubPublisherPortOptions,
  ): Promise<GooglePubSubPublisherPort> {
    // Avoid a static module dependency so privileged package graphs and CI
    // builds never require @google-cloud/pubsub. Resolved only when
    // TM_GOVERNANCE_EVENTS_MODE=pubsub at runtime.
    const load = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<{
      PubSub: new (opts: { projectId: string }) => GooglePubSubClient;
    }>;
    const mod = await load("@google-cloud/pubsub");
    const client = new mod.PubSub({ projectId: options.projectId });
    return new GooglePubSubPublisherPort(options, client);
  }

  async publish(
    topic: PubSubTopic,
    envelope: CloudEventEnvelope,
  ): Promise<Result<void>> {
    try {
      const name = this.options.topicPrefix
        ? `${this.options.topicPrefix}${topic}`
        : topic;
      const data = Buffer.from(JSON.stringify(envelope), "utf8");
      await this.client.topic(name).publishMessage({
        data,
        attributes: { topic },
      });
      return ok();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(
        ErrorCode.VALIDATION_FAILED,
        `Pub/Sub publish failed: ${message}`,
        { topic },
      );
    }
  }
}
