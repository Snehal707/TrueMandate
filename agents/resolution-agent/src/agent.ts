import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  err,
  ok,
  type Result,
  type RootCauseCode,
} from "@truemandate/protocol";
import { z } from "zod";

const HypothesisOutSchema = z
  .object({
    hypotheses: z.array(
      z
        .object({
          assertedCause: z.string(),
          involvedActor: z.string().optional(),
          confidence: z.number().min(0).max(1),
          rationale: z.string().optional(),
          inventedEventIds: z.array(z.string()).optional(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * Isolated adjudication context — findings only.
 * Cannot mutate OutcomeContract, create grants, or call Gateway.
 */
export class ResolutionAgent {
  constructor(private readonly model: ModelPort) {}

  async proposeCausalHypotheses(input: {
    readonly knownEventIds: readonly string[];
    readonly structuredHistory: Readonly<Record<string, unknown>>;
  }): Promise<
    Result<{
      readonly hypotheses: readonly {
        readonly assertedCause: RootCauseCode | string;
        readonly involvedActor?: string;
        readonly confidence: number;
        readonly rationale?: string;
      }[];
    }>
  > {
    const result = await this.model.generateStructured({
      modelId: "resolution-agent",
      promptVersion: "resolution-agent-v1",
      schemaId: "ResolutionHypotheses",
      schemaVersion: "1",
      schema: HypothesisOutSchema,
      systemInstruction:
        "Propose responsibility hypotheses from structured history only. Never invent events not in history. Never assign ESTABLISHED liability from plausibility alone.",
      userPayload: input.structuredHistory,
      requestId: `res-agent-${Date.now()}`,
    });
    if (!result.ok) return result;
    const parsed = HypothesisOutSchema.safeParse(result.value.value);
    if (!parsed.success) {
      return err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid resolution agent output", {
        issues: parsed.error.issues,
      });
    }
    const known = new Set(input.knownEventIds);
    for (const h of parsed.data.hypotheses) {
      for (const invented of h.inventedEventIds ?? []) {
        if (!known.has(invented)) {
          return err(
            ErrorCode.VALIDATION_FAILED,
            "Model invented causal event not in history",
            { invented },
          );
        }
      }
    }
    return ok({
      hypotheses: parsed.data.hypotheses.map((h) => ({
        assertedCause: h.assertedCause,
        involvedActor: h.involvedActor,
        confidence: h.confidence,
        rationale: h.rationale,
      })),
    });
  }
}
