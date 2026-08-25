import { ErrorCode, err, type Result } from "@truemandate/protocol";
import type {
  ModelPort,
  StructuredGenerateRequest,
  StructuredGenerateSuccess,
} from "./types.js";

export interface ModelStageBudget {
  readonly deadlineAtMs: number;
  readonly stageBudgetMs: number;
  readonly attemptTimeoutMs: number;
  readonly maxAttempts: number;
  readonly retryBackoffMs?: number;
  readonly now?: () => number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_CODES = new Set<string>([
  ErrorCode.MODEL_UNAVAILABLE,
  ErrorCode.MODEL_OUTPUT_INVALID,
  ErrorCode.SCHEMA_PARSE_FAILED,
]);

/**
 * Binds a model stage to the smaller of its stage budget and the enclosing
 * workflow deadline. Required model failures remain failures; this wrapper
 * only permits bounded retries of the same structured request.
 */
export function createBudgetedModelPort(
  model: ModelPort,
  budget: ModelStageBudget,
): ModelPort {
  const now = budget.now ?? Date.now;
  const stageDeadlineAtMs = Math.min(
    budget.deadlineAtMs,
    now() + budget.stageBudgetMs,
  );

  return {
    async generateStructured<T>(
      request: StructuredGenerateRequest<T>,
    ): Promise<Result<StructuredGenerateSuccess<T>>> {
      const attempts = Math.max(1, Math.floor(budget.maxAttempts));
      let last: Result<StructuredGenerateSuccess<T>> | undefined;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const remainingMs = stageDeadlineAtMs - now();
        if (remainingMs <= 0) {
          return err(ErrorCode.MODEL_UNAVAILABLE, "Model stage deadline exhausted", {
            retryable: true,
            reason: "MODEL_DEADLINE_EXCEEDED",
            attempt,
          });
        }
        console.info(JSON.stringify({
          event: "model_stage_budget_attempt",
          requestId: request.requestId,
          workflowId: request.workflowId,
          intentId: request.intentId,
          schemaId: request.schemaId,
          attempt,
          remainingMs,
        }));
        last = await model.generateStructured({
          ...request,
          deadlineAtMs: stageDeadlineAtMs,
          attemptTimeoutMs: Math.min(budget.attemptTimeoutMs, remainingMs),
          maxAttempts: 1,
        });
        if (last.ok || !RETRYABLE_CODES.has(last.code) || attempt === attempts) {
          return last;
        }
        const retryBackoffMs = budget.retryBackoffMs ?? 200;
        if (stageDeadlineAtMs - now() <= retryBackoffMs) {
          return err(ErrorCode.MODEL_UNAVAILABLE, "Model retry budget exhausted", {
            retryable: true,
            reason: "MODEL_DEADLINE_EXCEEDED",
            attempt,
          });
        }
        await sleep(retryBackoffMs);
      }
      return last ?? err(ErrorCode.MODEL_UNAVAILABLE, "Model stage did not execute");
    },
  };
}
