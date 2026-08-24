import {
  ErrorCode,
  err,
  ok,
  type Intent,
  type IntentState,
  type LearnedContextRecord,
  type LearningProposal,
  type Result,
} from "@truemandate/protocol";
import { parseLearningProposal } from "@truemandate/authority";

export interface LearningStorePorts {
  readonly proposals: {
    get(id: string): Promise<LearningProposal | undefined>;
    putIfAbsent(id: string, value: LearningProposal): Promise<boolean>;
    put(id: string, value: LearningProposal): Promise<void>;
  };
  readonly learnedContext: {
    get(id: string): Promise<LearnedContextRecord | undefined>;
  };
  readonly intents?: {
    getIntent(id: string): Promise<Intent | undefined>;
    getTip(intentId: string): Promise<IntentState | undefined>;
  };
}

/**
 * Thin owner for LearningProposal / LearnedContextRecord durability.
 * Learning never mints grants, CommitTokens, or Gateway authority.
 */
export class LearningService {
  constructor(private readonly ports: LearningStorePorts) {}

  async getProposal(id: string): Promise<Result<LearningProposal | undefined>> {
    const loaded = await this.ports.proposals.get(id);
    if (!loaded) return ok(undefined);
    return parseLearningProposal(loaded);
  }

  async getLearnedContext(
    id: string,
  ): Promise<Result<LearnedContextRecord | undefined>> {
    const loaded = await this.ports.learnedContext.get(id);
    if (!loaded) return ok(undefined);
    return ok(loaded);
  }

  async resolveHistorical(
    targetIntentId: string,
  ): Promise<Result<{ intent: Intent; state: IntentState }>> {
    if (!this.ports.intents) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "Intent lookup port required when targetIntentId is set",
      );
    }
    const intent = await this.ports.intents.getIntent(targetIntentId);
    if (!intent) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown targetIntentId", {
        targetIntentId,
      });
    }
    const state = await this.ports.intents.getTip(targetIntentId);
    if (!state) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown IntentState tip for targetIntentId", {
        targetIntentId,
      });
    }
    return ok({ intent, state });
  }
}
