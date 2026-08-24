import {
  CompilerModelOutputSchema,
  VerifierModelOutputSchema,
} from "@truemandate/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  sanitizeForVertexResponseSchema,
  vertexObjectPropertyNames,
  vertexObjectRequiredFields,
  zodToVertexResponseSchema,
} from "./vertex-response-schema.js";

describe("zodToVertexResponseSchema", () => {
  it("derives compiler schema with all canonical required fields", () => {
    const { responseSchema } = zodToVertexResponseSchema(
      CompilerModelOutputSchema,
      "compiler.candidate.v1",
    );
    expect(responseSchema.type).toBe("object");
    const required = vertexObjectRequiredFields(responseSchema);
    for (const field of [
      "goal",
      "constraints",
      "preferences",
      "assumptions",
      "ambiguities",
      "readiness",
    ]) {
      expect(required).toContain(field);
      expect(vertexObjectPropertyNames(responseSchema)).toContain(field);
    }
  });

  it("derives verifier schema with canonical required fields", () => {
    const { responseSchema } = zodToVertexResponseSchema(
      VerifierModelOutputSchema,
      "verifier.result.v1",
    );
    expect(responseSchema.type).toBe("object");
    const required = vertexObjectRequiredFields(responseSchema);
    for (const field of [
      "findings",
      "transformations",
      "criticalFailure",
      "readiness",
      "ambiguityClass",
    ]) {
      expect(required).toContain(field);
    }
  });

  it("keeps nested enums and optionality aligned with Zod", () => {
    const { responseSchema } = zodToVertexResponseSchema(
      CompilerModelOutputSchema,
      "compiler.candidate.v1",
    );
    const props = responseSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.readiness?.enum).toEqual([
      "SEARCHABLE",
      "PLANNABLE",
      "ACTIONABLE",
      "EXECUTABLE",
    ]);
    const constraintItems = (props.constraints as { items?: Record<string, unknown> })
      ?.items;
    expect(constraintItems?.type).toBe("object");
    const constraintRequired = Array.isArray(constraintItems?.required)
      ? (constraintItems!.required as string[])
      : [];
    expect(constraintRequired).toContain("concept");
    expect(constraintRequired).toContain("grounding");
    // temporalResolution is optional — not in required
    expect(constraintRequired).not.toContain("temporalResolution");
  });

  it("valid compiler JSON still passes Zod after conversion parity", () => {
    const sample = {
      goal: "Procure food-grade containers",
      constraints: [
        {
          id: "c1",
          concept: "quantity",
          operator: "EQ",
          value: 500,
          kind: "HARD",
          importance: 1,
          confidence: 1,
          sourceType: "HUMAN",
          mutability: "IMMUTABLE",
          meaningClass: "EXPLICIT",
          grounding: { sourceText: "500", quoteExact: true },
        },
      ],
      preferences: [],
      assumptions: [],
      ambiguities: [],
      readiness: "PLANNABLE",
    };
    expect(CompilerModelOutputSchema.safeParse(sample).success).toBe(true);
    const { responseSchema } = zodToVertexResponseSchema(
      CompilerModelOutputSchema,
      "compiler.candidate.v1",
    );
    expect(vertexObjectRequiredFields(responseSchema)).toEqual(
      expect.arrayContaining(Object.keys(sample)),
    );
  });

  it("strips additionalProperties and fails closed on $ref", () => {
    const stripped: string[] = [];
    const sanitized = sanitizeForVertexResponseSchema(
      {
        type: "object",
        additionalProperties: false,
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      stripped,
    );
    expect(sanitized.additionalProperties).toBeUndefined();
    expect(stripped).toContain("additionalProperties");
    expect(() =>
      sanitizeForVertexResponseSchema({ $ref: "#/definitions/X" }),
    ).toThrow(/\$ref/);
  });

  it("maps empty schemas to JSON value anyOf", () => {
    const sanitized = sanitizeForVertexResponseSchema({});
    expect(Array.isArray(sanitized.anyOf)).toBe(true);
  });

  it("converts a tiny zod schema without unresolved refs", () => {
    const schema = z
      .object({
        answer: z.string().min(1),
        optionalNote: z.string().optional(),
      })
      .strict();
    const { responseSchema, strippedKeywords } = zodToVertexResponseSchema(
      schema,
      "tiny",
    );
    expect(responseSchema.type).toBe("object");
    expect(vertexObjectRequiredFields(responseSchema)).toContain("answer");
    expect(vertexObjectRequiredFields(responseSchema)).not.toContain(
      "optionalNote",
    );
    expect(strippedKeywords).toContain("additionalProperties");
  });
});
