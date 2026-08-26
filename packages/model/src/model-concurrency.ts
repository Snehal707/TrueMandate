import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";

export interface ModelAttemptPermit {
  readonly leaseId: string;
  readonly slotId: string;
  readonly queueWaitMs: number;
  release(): Promise<void>;
}

export interface ModelAttemptPermitRequest {
  readonly requestId: string;
  readonly schemaId: string;
  readonly workflowId?: string;
  readonly intentId?: string;
  readonly deadlineAtMs: number;
}

export interface ModelConcurrencyLimiter {
  readonly limit: number;
  acquire(
    request: ModelAttemptPermitRequest,
  ): Promise<Result<ModelAttemptPermit>>;
}

export type ModelConcurrencyEvent = Readonly<{
  event: "tm.model.concurrency.state" | "tm.model.queue.wait" | "tm.model.permit.release";
  requestId: string;
  schemaId: string;
  workflowId?: string;
  intentId?: string;
  limit: number;
  active: number;
  queued: number;
  maxQueueDepth: number;
  stageActive: number;
  stageQueued: number;
  queueWaitMs?: number;
  outcome: "ENQUEUED" | "ACQUIRED" | "DEADLINE_EXCEEDED" | "STORE_UNAVAILABLE" | "RELEASED" | "RELEASE_UNCERTAIN";
}>;

export interface ModelConcurrencyObserver {
  record(event: ModelConcurrencyEvent): void;
}

export function modelConcurrencyLimitFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.TM_VERTEX_MODEL_CONCURRENCY ?? "12";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new Error("TM_VERTEX_MODEL_CONCURRENCY must be an integer from 1 to 64");
  }
  return value;
}

interface QueueEntry {
  readonly request: ModelAttemptPermitRequest;
  readonly resolve: (result: Result<ModelAttemptPermit>) => void;
}

/**
 * Process-local FIFO front-end for a distributed limiter. Acquisition remains
 * distributed, while admission ordering within one runtime instance is stable.
 */
export class FifoModelConcurrencyLimiter implements ModelConcurrencyLimiter {
  private readonly queue: QueueEntry[] = [];
  private active = 0;
  private draining = false;
  private maxQueueDepth = 0;
  private readonly activeByStage = new Map<string, number>();

  constructor(
    readonly limit: number,
    private readonly acquireDistributed: (
      request: ModelAttemptPermitRequest,
    ) => Promise<Result<ModelAttemptPermit>>,
    private readonly observer?: ModelConcurrencyObserver,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Model concurrency limit must be a positive integer");
    }
  }

  acquire(request: ModelAttemptPermitRequest): Promise<Result<ModelAttemptPermit>> {
    return new Promise((resolve) => {
      this.queue.push({ request, resolve });
      this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queue.length);
      this.emit(request, "ENQUEUED");
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift()!;
        if (Date.now() >= entry.request.deadlineAtMs) {
          this.emit(entry.request, "DEADLINE_EXCEEDED", 0);
          entry.resolve(err(ErrorCode.MODEL_UNAVAILABLE, "Model queue deadline exhausted", {
            retryable: false,
            reason: "MODEL_QUEUE_DEADLINE_EXCEEDED",
          }));
          continue;
        }

        let acquired: Result<ModelAttemptPermit>;
        try {
          acquired = await this.acquireDistributed(entry.request);
        } catch {
          acquired = err(ErrorCode.MODEL_UNAVAILABLE, "Model concurrency store unavailable", {
            retryable: true,
            reason: "MODEL_BACKPRESSURE_UNAVAILABLE",
          });
        }
        if (!acquired.ok) {
          const outcome = acquired.details?.reason === "MODEL_QUEUE_DEADLINE_EXCEEDED"
            ? "DEADLINE_EXCEEDED"
            : "STORE_UNAVAILABLE";
          this.emit(entry.request, outcome, 0);
          entry.resolve(acquired);
          continue;
        }

        this.active += 1;
        this.activeByStage.set(
          entry.request.schemaId,
          (this.activeByStage.get(entry.request.schemaId) ?? 0) + 1,
        );
        this.emit(entry.request, "ACQUIRED", acquired.value.queueWaitMs);
        const distributed = acquired.value;
        let released = false;
        entry.resolve(ok({
          ...distributed,
          release: async () => {
            if (released) return;
            released = true;
            let outcome: ModelConcurrencyEvent["outcome"] = "RELEASED";
            try {
              await distributed.release();
            } catch {
              outcome = "RELEASE_UNCERTAIN";
            } finally {
              this.active = Math.max(0, this.active - 1);
              const next = Math.max(
                0,
                (this.activeByStage.get(entry.request.schemaId) ?? 1) - 1,
              );
              if (next === 0) this.activeByStage.delete(entry.request.schemaId);
              else this.activeByStage.set(entry.request.schemaId, next);
              this.emit(entry.request, outcome, distributed.queueWaitMs);
            }
          },
        }));
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private emit(
    request: ModelAttemptPermitRequest,
    outcome: ModelConcurrencyEvent["outcome"],
    queueWaitMs?: number,
  ): void {
    if (!this.observer) return;
    const stageQueued = this.queue.filter(
      (entry) => entry.request.schemaId === request.schemaId,
    ).length;
    this.observer.record({
      event: outcome === "RELEASED" || outcome === "RELEASE_UNCERTAIN"
        ? "tm.model.permit.release"
        : queueWaitMs === undefined
          ? "tm.model.concurrency.state"
          : "tm.model.queue.wait",
      requestId: request.requestId,
      schemaId: request.schemaId,
      workflowId: request.workflowId,
      intentId: request.intentId,
      limit: this.limit,
      active: this.active,
      queued: this.queue.length,
      maxQueueDepth: this.maxQueueDepth,
      stageActive: this.activeByStage.get(request.schemaId) ?? 0,
      stageQueued,
      queueWaitMs,
      outcome,
    });
  }
}
