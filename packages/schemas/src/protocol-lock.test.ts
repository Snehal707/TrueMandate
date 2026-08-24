import { SemanticRelation } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ProtocolSchemas, SemanticRelationSchema } from "./index.js";

describe("protocol/schema parity lock", () => {
  it("includes SUMMARIZES and DELEGATES_TO in SemanticRelationSchema", () => {
    expect(SemanticRelationSchema.options).toContain("SUMMARIZES");
    expect(SemanticRelationSchema.options).toContain("DELEGATES_TO");
    expect(SemanticRelation.SUMMARIZES).toBe("SUMMARIZES");
    expect(SemanticRelation.DELEGATES_TO).toBe("DELEGATES_TO");
  });

  it("registers PlanGraph and PlanStep schemas", () => {
    expect(ProtocolSchemas.PlanGraph).toBeDefined();
    expect(ProtocolSchemas.PlanStep).toBeDefined();
  });

  it("registers Phase 4 semantic schemas", () => {
    expect(ProtocolSchemas.CandidateInterpretation).toBeDefined();
    expect(ProtocolSchemas.SemanticVerificationResult).toBeDefined();
  });
});
