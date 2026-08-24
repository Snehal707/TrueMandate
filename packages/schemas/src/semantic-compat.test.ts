import { describe, expect, it } from "vitest";
import { SemanticVerificationResultSchema } from "./semantic.js";

const base = {
  id: "verdict-1",
  intentId: "intent-1",
  candidateId: "cand-1",
  candidateHash: "a".repeat(64),
  lifecycle: "VERIFIED",
  findings: [],
  transformations: [],
  criticalFailure: false,
  readiness: "ACTIONABLE",
  ambiguityClass: "A0",
  modelMeta: {
    modelId: "fake", modelVersion: "1", promptVersion: "v1", schemaId: "v", schemaVersion: "1",
    protocolVersion: "0.1", requestId: "r", timestamp: "2026-01-01T00:00:00.000Z",
  },
  verifiedAt: "2026-01-01T00:00:00.000Z",
};

describe("SemanticVerificationResult schema compatibility generations", () => {
  it("accepts an old-generation record without the advisory fields", () => {
    expect(SemanticVerificationResultSchema.safeParse(base).success).toBe(true);
  });

  it("accepts the new-generation record with both advisory fields", () => {
    const next = { ...base, modelProposedReadiness: "PLANNABLE", modelProposedAmbiguityClass: "A1" };
    expect(SemanticVerificationResultSchema.safeParse(next).success).toBe(true);
  });

  it("still rejects unknown unsupported fields (strict parsing preserved)", () => {
    const hostile = { ...base, inventedPrivilege: "EXECUTABLE" };
    expect(SemanticVerificationResultSchema.safeParse(hostile).success).toBe(false);
  });
});
