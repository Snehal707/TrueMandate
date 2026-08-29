import { hashCanonical } from "@truemandate/crypto";
import {
  ErrorCode,
  asIntentId,
  asConstraintId,
  asIntentStateId,
  err,
  ok,
  type Assumption,
  type Constraint,
  type CandidateInterpretation,
  type SemanticVerificationResult,
  type Intent,
  type IntentState,
  type Result,
} from "@truemandate/protocol";
import {
  AssumptionSchema,
  AuthorityDecisionSchema,
  ConstraintSchema,
  IntentSchema,
  IntentStateSchema,
  parseWithSchema,
} from "@truemandate/schemas";
import { z } from "zod";
import { detectWeakenedConstraints } from "@truemandate/authority";
import type { PubSubPublisherPort } from "@truemandate/cloud-pubsub";
import {
  InMemoryIntentRepository,
  type IntentRepository,
} from "./store.js";
import {
  publishConstraintWeakenedEvent,
  publishIntentRecordedEvent,
} from "./analytics-events.js";

const CreateIntentRequestSchema = z
  .object({
    principalId: z.string().min(1),
    rawText: z.string().min(1),
    id: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
    // Domain context for compilation, not a persisted Intent field — RAW
    // workflow submissions forward request.domain.packId (see
    // workflow-dispatcher.ts's toReferenceRequest); direct callers of this
    // route (e.g. the standalone POST /v1/intents path) legitimately have
    // none, and compilation stays free-form for them.
    packId: z.string().min(1).optional(),
  })
  .strict();

const CreateIntentStateRequestSchema = z
  .object({
    intentId: z.string().min(1),
    id: z.string().min(1).optional(),
    constraints: z.array(ConstraintSchema),
    assumptions: z.array(AssumptionSchema).optional(),
    /** Authoritative capability permissions (human/enterprise policy). */
    capabilities: z.record(AuthorityDecisionSchema).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1).optional(),
    previousStateId: z.string().min(1).optional(),
  })
  .strict();

/** Owner-side immutable semantic artifact persistence (structural port). */
export interface SemanticArtifactStore {
  putIfAbsent(record: {
    readonly id: string;
    readonly intentId: string;
    readonly workflowId: string;
    readonly kind: string;
    readonly payload: unknown;
    readonly predecessors: readonly { readonly id: string; readonly kind: string; readonly contentHash: string }[];
    readonly contentHash: string;
    readonly createdAt: string;
  }): Promise<boolean>;
  get(id: string): Promise<{
    readonly id?: string;
    readonly intentId?: string;
    readonly workflowId?: string;
    readonly kind: string;
    readonly payload?: unknown;
    readonly predecessors?: readonly {
      readonly id: string;
      readonly kind: string;
      readonly contentHash: string;
    }[];
    readonly contentHash: string;
    readonly createdAt?: string;
  } | undefined>;
}

/** Lineage required when the owner derives the finalized-state semantic verification. */
export interface FinalizeArtifactLineage {
  readonly compilationId: string;
  readonly verificationId: string;
  readonly verificationHash: string;
  readonly workflowId: string;
}

export class IntentService {
  constructor(
    private readonly repo: IntentRepository = new InMemoryIntentRepository(),
    private readonly artifacts?: SemanticArtifactStore,
    /** Wave 3.6: fail-open governance analytics publisher. */
    private readonly publisher?: PubSubPublisherPort,
  ) {}

  async createIntent(raw: unknown): Promise<Result<Intent>> {
    const parsed = parseWithSchema(CreateIntentRequestSchema, raw, "CreateIntentRequest");
    if (!parsed.ok) return parsed;

    const createdAt = parsed.value.createdAt ?? new Date().toISOString();
    const id = asIntentId(parsed.value.id ?? `intent-${hashCanonical(parsed.value.rawText).slice(0, 12)}`);
    const contentHash = hashCanonical({ rawText: parsed.value.rawText });
    const existing = await this.repo.getIntent(id);
    if (existing) {
      if (existing.contentHash === contentHash && existing.rawText === parsed.value.rawText) {
        const tip = await this.repo.getTip(id);
        if (!tip) {
          publishIntentRecordedEvent(this.publisher, existing, parsed.value.packId);
        }
        return ok(existing);
      }
      return err(ErrorCode.VALIDATION_FAILED, "Intent already exists", { id });
    }

    const intent: Intent = {
      id,
      principalId: parsed.value.principalId as Intent["principalId"],
      rawText: parsed.value.rawText,
      createdAt,
      contentHash,
    };

    const validated = parseWithSchema(IntentSchema, intent, "Intent");
    if (!validated.ok) return validated;

    await this.repo.putIntent(intent);
    publishIntentRecordedEvent(this.publisher, intent, parsed.value.packId);
    return ok(intent);
  }

  async getIntent(intentId: string): Promise<Result<Intent>> {
    const intent = await this.repo.getIntent(intentId);
    if (!intent) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown intent", { intentId });
    }
    return ok(intent);
  }

  async createIntentState(raw: unknown): Promise<Result<IntentState>> {
    const parsed = parseWithSchema(
      CreateIntentStateRequestSchema,
      raw,
      "CreateIntentStateRequest",
    );
    if (!parsed.ok) return parsed;

    const intent = await this.repo.getIntent(parsed.value.intentId);
    if (!intent) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown intent", {
        intentId: parsed.value.intentId,
      });
    }

    const tip = await this.repo.getTip(intent.id);
    let version = 1;
    let previousStateId = parsed.value.previousStateId
      ? asIntentStateId(parsed.value.previousStateId)
      : undefined;

    if (tip) {
      version = tip.version + 1;
      previousStateId = previousStateId ?? tip.id;
    } else if (previousStateId) {
      return err(
        ErrorCode.VALIDATION_FAILED,
        "previousStateId provided but no tip exists",
      );
    }

    const createdAt = parsed.value.createdAt ?? new Date().toISOString();
    const id = asIntentStateId(
      parsed.value.id ?? `state-${intent.id}-v${version}`,
    );

    const constraints = parsed.value.constraints as Constraint[];
    const assumptions = (parsed.value.assumptions ?? []) as Assumption[];
    // Policy ingress may change capabilities only. Temporal authority is
    // inherited from the verified tip — callers cannot strip or invent it.
    const temporalAuthority = tip?.temporalAuthority;

    const stateWithoutHash = {
      id,
      intentId: intent.id,
      rawIntentHash: intent.contentHash,
      version,
      constraints,
      assumptions,
      ...(parsed.value.capabilities ? { capabilities: parsed.value.capabilities } : {}),
      ...(temporalAuthority ? { temporalAuthority } : {}),
      createdAt,
      createdBy: parsed.value.createdBy as IntentState["createdBy"],
      previousStateId,
    };

    const state: IntentState = {
      ...stateWithoutHash,
      stateHash: hashCanonical({
        id: stateWithoutHash.id,
        intentId: stateWithoutHash.intentId,
        rawIntentHash: stateWithoutHash.rawIntentHash,
        version: stateWithoutHash.version,
        constraints: stateWithoutHash.constraints,
        assumptions: stateWithoutHash.assumptions,
        capabilities: stateWithoutHash.capabilities,
        previousStateId: stateWithoutHash.previousStateId ?? null,
        temporalAuthority: stateWithoutHash.temporalAuthority ?? null,
      }),
    };

    const validated = parseWithSchema(IntentStateSchema, state, "IntentState");
    if (!validated.ok) return validated;

    await this.repo.putState(state);
    await this.repo.setTip(intent.id, state.id);

    // Wave 3.6: real, deterministic drift detection against the previous
    // tip's constraints (analytics-only; never blocks or alters the write).
    if (tip) {
      const drifts = detectWeakenedConstraints(tip.constraints, constraints);
      for (const drift of drifts) {
        publishConstraintWeakenedEvent(this.publisher, {
          intentId: String(intent.id),
          intentStateId: String(state.id),
          previousStateId: String(tip.id),
          drift,
          at: createdAt,
        });
      }
    }

    return ok(state);
  }

  /** Owner-only path. Callers supply references to durable records; the route
   * resolves and validates them before this method receives their contents.
   *
   * When the owner's semantic artifact store is wired, successful finalization
   * also derives the immutable `SEMANTIC_VERIFICATION` artifact
   * (`semantic-verification-<intentStateId>`) from the validated lineage.
   * Replay of the identical lineage is idempotent; divergent replay for the
   * same canonical IntentState fails closed. */
  async finalizeVerifiedCompilation(input: {
    readonly intentId: string;
    readonly candidate: CandidateInterpretation;
    readonly verification: SemanticVerificationResult;
    readonly compilationHash: string;
    readonly temporalAuthority?: IntentState["temporalAuthority"];
    /** Authoritative capability permissions carried onto the finalized state. */
    readonly capabilities?: IntentState["capabilities"];
    readonly artifactLineage?: FinalizeArtifactLineage;
  }): Promise<Result<IntentState>> {
    const intent = await this.repo.getIntent(input.intentId);
    if (!intent || intent.contentHash !== input.candidate.rawIntentHash ||
      input.candidate.intentId !== intent.id || input.verification.intentId !== intent.id ||
      input.verification.candidateId !== input.candidate.id ||
      input.verification.candidateHash !== input.candidate.candidateHash ||
      (input.verification.lifecycle !== "VERIFIED" && input.verification.lifecycle !== "AMBIGUOUS") || input.verification.criticalFailure) {
      return err(ErrorCode.VALIDATION_FAILED, "Compilation finalization lineage invalid");
    }
    const id = asIntentStateId(`state-${intent.id}-compiled-${input.compilationHash.slice(0, 16)}`);
    const existing = await this.repo.getState(id);
    const build = async (): Promise<Result<IntentState>> => {
      const tip = await this.repo.getTip(intent.id);
      const constraints: Constraint[] = input.candidate.constraints.map((c) => ({
        id: asConstraintId(c.id), concept: c.concept, operator: c.operator, value: c.value,
        kind: c.kind, importance: c.importance, confidence: c.confidence, sourceType: c.sourceType,
        sourceText: c.grounding.sourceText, sourceSpan: c.grounding.sourceSpan,
        mutability: c.mutability, meaningClass: c.meaningClass, proofObligation: c.proofObligation,
      }));
      const stateWithoutHash = {
        id, intentId: intent.id, rawIntentHash: intent.contentHash, version: (tip?.version ?? 0) + 1,
        constraints, assumptions: input.candidate.assumptions, createdAt: input.verification.verifiedAt,
        createdBy: intent.principalId, previousStateId: tip?.id, temporalAuthority: input.temporalAuthority,
        ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      };
      const built: IntentState = {
        ...stateWithoutHash,
        stateHash: hashCanonical({ id: stateWithoutHash.id, intentId: stateWithoutHash.intentId,
          rawIntentHash: stateWithoutHash.rawIntentHash, version: stateWithoutHash.version,
          constraints, assumptions: stateWithoutHash.assumptions,
          capabilities: stateWithoutHash.capabilities,
          previousStateId: stateWithoutHash.previousStateId ?? null,
          temporalAuthority: stateWithoutHash.temporalAuthority ?? null }),
      };
      const validated = parseWithSchema(IntentStateSchema, built, "FinalizedIntentState");
      if (!validated.ok) return validated;
      return ok(built);
    };
    const stateResult = existing ? ok(existing) : await build();
    if (!stateResult.ok) return stateResult;
    const state = stateResult.value;

    if (this.artifacts) {
      const lineage = input.artifactLineage;
      if (!lineage) {
        return err(ErrorCode.VALIDATION_FAILED, "Semantic verification lineage required for owner artifact");
      }
      const artifactId = `semantic-verification-${state.id}`;
      const payload = {
        schemaVersion: 1,
        intentStateId: state.id,
        intentStateHash: state.stateHash,
        intentStateVersion: state.version,
        compilationId: lineage.compilationId,
        compilationHash: input.compilationHash,
        verificationId: lineage.verificationId,
        verificationHash: lineage.verificationHash,
        lifecycle: input.verification.lifecycle,
        verification: input.verification,
        evaluatedAt: input.verification.verifiedAt,
        createdAt: state.createdAt,
      };
      const record = {
        id: artifactId,
        intentId: intent.id,
        workflowId: lineage.workflowId,
        kind: "SEMANTIC_VERIFICATION" as const,
        payload,
        predecessors: [{ id: lineage.verificationId, kind: "COMPILATION_VERIFICATION", contentHash: lineage.verificationHash }],
        contentHash: hashCanonical(payload),
        createdAt: state.createdAt,
      };
      const inserted = await this.artifacts.putIfAbsent(record);
      if (!inserted) {
        const durable = await this.artifacts.get(artifactId);
        if (!durable || durable.kind !== record.kind || durable.contentHash !== record.contentHash) {
          return err(ErrorCode.VALIDATION_FAILED, "Semantic verification artifact replay conflict", { id: artifactId });
        }
      }
    }

    // Publish the current tip only after its required semantic verification is
    // durable. This prevents readers from observing a finalized state whose
    // owner verification is still in flight.
    return ok(existing ?? await this.repo.finalizeState(state));
  }

  async getIntentState(stateId: string): Promise<Result<IntentState>> {
    const state = await this.repo.getState(stateId);
    if (!state) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown IntentState", { stateId });
    }
    return ok(state);
  }

  async getCurrentIntentState(intentId: string): Promise<Result<IntentState>> {
    const tip = await this.repo.getTip(intentId);
    if (!tip) {
      return err(ErrorCode.VALIDATION_FAILED, "No IntentState tip for intent", {
        intentId,
      });
    }
    return ok(tip);
  }
}
