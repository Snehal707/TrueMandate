import { IntentService } from "@truemandate/intent-service";
import type { Intent, IntentState, Result, SemanticVerificationResult } from "@truemandate/protocol";
import {
  SemanticVerificationArtifactPayloadSchema,
  SemanticVerificationResultSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { ErrorCode, err } from "@truemandate/protocol";
import type { IntentProvenanceS2SClient } from "@truemandate/cloud-runtime";
import type { z } from "zod";

type SemanticVerificationArtifactPayload = z.infer<
  typeof SemanticVerificationArtifactPayloadSchema
>;

/** Read-only IntentService facade backed exclusively by intent-provenance. */
export class AuthoritativeIntentService extends IntentService {
  constructor(private readonly owner: IntentProvenanceS2SClient) { super(); }

  override async getIntent(intentId: string): Promise<Result<Intent>> {
    return this.owner.getIntent(intentId);
  }

  override async getIntentState(stateId: string): Promise<Result<IntentState>> {
    return this.owner.getIntentState(stateId);
  }

  override async getCurrentIntentState(intentId: string): Promise<Result<IntentState>> {
    return this.owner.getTip(intentId);
  }

  /** Resolves a state only when it belongs to the requested intent and is its live tip. */
  async getCurrentStateForIntent(intentId: string, stateId?: string): Promise<Result<IntentState>> {
    const tip = await this.owner.getTip(intentId);
    if (!tip.ok) {
      // Only an owner-declared absent tip is a replay-safe readiness condition.
      // Authentication, integrity, and every other owner failure remain fail-closed.
      if (tip.details?.status === 404) {
        return err(ErrorCode.INTENT_STATE_NOT_READY, "IntentState tip is not finalized", {
          status: 404,
          retryable: true,
        });
      }
      return tip;
    }
    if (tip.value.intentId !== intentId) {
      return err(ErrorCode.VALIDATION_FAILED, "Owner returned a tip for another intent");
    }
    if (stateId && tip.value.id !== stateId) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Requested IntentState is not the current tip", { requested: stateId, tip: tip.value.id });
    }
    return tip;
  }

  /** Verification is owner-issued alongside the immutable state; callers cannot supply it. */
  async getVerificationForState(state: IntentState): Promise<Result<SemanticVerificationResult>> {
    const stored = await this.getVerificationArtifactForState(state);
    if (!stored.ok) return stored as Result<SemanticVerificationResult>;
    return parseWithSchema(
      SemanticVerificationResultSchema,
      stored.value.payload.verification,
      "OwnerSemanticVerification",
    ) as Result<SemanticVerificationResult>;
  }

  async getVerificationArtifactForState(
    state: IntentState,
  ): Promise<
    Result<{
      readonly artifactId: string;
      readonly artifactHash: string;
      readonly payload: SemanticVerificationArtifactPayload;
    }>
  > {
    const stored = await this.owner.getSemanticArtifact(`semantic-verification-${state.id}`);
    if (!stored.ok || !stored.value || typeof stored.value !== "object") {
      return err(ErrorCode.VALIDATION_FAILED, "Missing owner semantic verification for IntentState");
    }
    const artifact = stored.value as Record<string, unknown>;
    const payload = parseWithSchema(
      SemanticVerificationArtifactPayloadSchema,
      artifact.payload,
      "OwnerSemanticVerificationArtifact",
    );
    if (
      !payload.ok ||
      artifact.kind !== "SEMANTIC_VERIFICATION" ||
      payload.value.intentStateId !== state.id ||
      payload.value.intentStateHash !== state.stateHash
    ) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Owner semantic verification binding mismatch");
    }
    return {
      ok: true,
      value: {
        artifactId: String(artifact.id ?? `semantic-verification-${state.id}`),
        artifactHash: String(artifact.contentHash ?? ""),
        payload: {
          ...payload.value,
          proofSummary: payload.value.proofSummary
            ? {
                ...payload.value.proofSummary,
                verifiedEvidenceRefs:
                  payload.value.proofSummary.verifiedEvidenceRefs ?? [],
              }
            : undefined,
          verifiedEvidenceRefs: payload.value.verifiedEvidenceRefs ?? [],
        },
      },
    };
  }
}
