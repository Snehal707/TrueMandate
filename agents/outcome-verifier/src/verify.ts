import type { ModelPort } from "@truemandate/model";
import {
  ErrorCode,
  err,
  ok,
  type OutcomeRequirement,
  type Result,
} from "@truemandate/protocol";
import { z } from "zod";

const FindingSchema = z
  .object({
    requirementId: z.string().min(1),
    concept: z.string().min(1),
    match: z.union([z.boolean(), z.literal("UNKNOWN")]),
    confidence: z.number().min(0).max(1),
    rationale: z.string().optional(),
  })
  .strict();

const OutputSchema = z
  .object({
    findings: z.array(FindingSchema),
  })
  .strict();

export type OutcomeSemanticFinding = z.infer<typeof FindingSchema>;

/**
 * Semantic outcome verifier — findings only.
 * Never mutates OutcomeContract state or requirement criticality.
 */
export class OutcomeVerifier {
  constructor(private readonly model: ModelPort) {}

  async evaluate(input: {
    readonly requirements: readonly OutcomeRequirement[];
    readonly observations: Readonly<Record<string, unknown>>;
  }): Promise<Result<{ readonly findings: readonly OutcomeSemanticFinding[] }>> {
    const semantic = input.requirements.filter(
      (r) =>
        r.evaluationMethod === "SEMANTIC" ||
        r.evaluationMethod === "HYBRID" ||
        r.type === "SEMANTIC",
    );
    if (semantic.length === 0) {
      return ok({ findings: [] });
    }

    const result = await this.model.generateStructured({
      modelId: "outcome-verifier",
      promptVersion: "outcome-verifier-v1",
      schemaId: "OutcomeVerifierFindings",
      schemaVersion: "1",
      schema: OutputSchema,
      systemInstruction:
        "You judge semantic outcome fidelity. Return findings only. Never change criticality.",
      userPayload: {
        requirements: semantic.map((r) => ({
          id: r.id,
          concept: r.concept,
          value: r.value,
          criticality: r.criticality,
        })),
        observations: input.observations,
      },
      requestId: `outcome-verify-${Date.now()}`,
    });

    if (!result.ok) return result;

    const parsed = OutputSchema.safeParse(result.value.value);
    if (!parsed.success) {
      return err(
        ErrorCode.SCHEMA_PARSE_FAILED,
        "Outcome verifier schema parse failed",
        { issues: parsed.error.issues },
      );
    }
    return ok({ findings: parsed.data.findings });
  }
}
