import { createHash, randomUUID } from "node:crypto";
import {
  FifoModelConcurrencyLimiter,
  type ModelAttemptPermit,
  type ModelAttemptPermitRequest,
  type ModelConcurrencyObserver,
} from "@truemandate/model";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { COLLECTIONS, docPath, type DocumentStore } from "./document-store.js";

interface ModelConcurrencyLease {
  readonly slotId: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly requestId: string;
  readonly schemaId: string;
  readonly workflowId?: string;
  readonly intentId?: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
}

export interface FirestoreModelConcurrencyLimiterOptions {
  readonly limit: number;
  readonly ownerId: string;
  readonly leaseMs?: number;
  readonly pollMs?: number;
  readonly observer?: ModelConcurrencyObserver;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function stableOffset(value: string, modulo: number): number {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) % modulo;
}

function boundedJitter(requestId: string, attempt: number): number {
  return stableOffset(`${requestId}:${attempt}`, 37);
}

/**
 * Fixed-slot distributed semaphore. A crashed owner cannot oversubscribe the
 * provider: its slot remains unavailable until the bounded lease expires.
 */
export class FirestoreModelConcurrencyLimiter extends FifoModelConcurrencyLimiter {
  constructor(
    private readonly store: DocumentStore,
    private readonly options: FirestoreModelConcurrencyLimiterOptions,
  ) {
    super(
      options.limit,
      (request) => FirestoreModelConcurrencyLimiter.acquireLease(store, options, request),
      options.observer,
    );
  }

  private static async acquireLease(
    store: DocumentStore,
    options: FirestoreModelConcurrencyLimiterOptions,
    request: ModelAttemptPermitRequest,
  ): Promise<Result<ModelAttemptPermit>> {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const leaseMs = options.leaseMs ?? 90_000;
    const pollMs = options.pollMs ?? 200;
    const startedAtMs = now();
    let attempt = 0;

    while (now() < request.deadlineAtMs) {
      attempt += 1;
      const leaseId = randomUUID();
      const acquiredAtMs = now();
      const offset = stableOffset(request.requestId, options.limit);
      const claimed = await store.runTransaction(async (tx) => {
        for (let index = 0; index < options.limit; index += 1) {
          const slotNumber = (offset + index) % options.limit;
          const slotId = `slot-${String(slotNumber).padStart(2, "0")}`;
          const path = docPath(COLLECTIONS.modelConcurrencySlots, slotId);
          const current = await tx.get<ModelConcurrencyLease>(path);
          if (current && current.expiresAtMs > acquiredAtMs) continue;
          const lease: ModelConcurrencyLease = {
            slotId,
            leaseId,
            ownerId: options.ownerId,
            requestId: request.requestId,
            schemaId: request.schemaId,
            workflowId: request.workflowId,
            intentId: request.intentId,
            acquiredAtMs,
            expiresAtMs: acquiredAtMs + leaseMs,
          };
          await tx.set(path, lease);
          return lease;
        }
        return undefined;
      });

      if (claimed) {
        return ok({
          leaseId: claimed.leaseId,
          slotId: claimed.slotId,
          queueWaitMs: Math.max(0, now() - startedAtMs),
          release: async () => {
            const path = docPath(COLLECTIONS.modelConcurrencySlots, claimed.slotId);
            await store.runTransaction(async (tx) => {
              const current = await tx.get<ModelConcurrencyLease>(path);
              if (!current) return;
              if (current.leaseId !== claimed.leaseId || current.ownerId !== options.ownerId) {
                return;
              }
              await tx.delete(path);
            });
          },
        });
      }

      const remaining = request.deadlineAtMs - now();
      if (remaining <= 0) break;
      await sleep(Math.min(remaining, pollMs + boundedJitter(request.requestId, attempt)));
    }

    return err(ErrorCode.MODEL_UNAVAILABLE, "Model queue deadline exhausted", {
      retryable: false,
      reason: "MODEL_QUEUE_DEADLINE_EXCEEDED",
      queueWaitMs: Math.max(0, now() - startedAtMs),
    });
  }
}
