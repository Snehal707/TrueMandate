import { describe, expect, it } from "vitest";
import {
  ExecutionAuthorizationArtifactPayloadSchema,
  SemanticArtifactKindSchema,
} from "./semantic-artifacts.js";

const hash = "a".repeat(64);
const payload = {
  intentStateId: "state-1",
  intentStateHash: hash,
  workflowId: "wf-1",
  packId: "travel",
  commitTokenId: "ct-internal",
  preparedActionId: "prep-1",
  preparedActionHash: hash,
  grantId: "grant-1",
  outcomeContractId: "outcome-1",
  outcomeContractHash: hash,
};

describe("semantic artifact schemas", () => {
  it("admits every historical kind and EXECUTION_AUTHORIZATION", () => {
    for (const kind of [
      "COMPILATION",
      "COMPILATION_VERIFICATION",
      "SEMANTIC_VERIFICATION",
      "PLAN",
      "PLAN_VERIFICATION",
      "PROOF",
      "ACTION",
      "GUARDIAN",
      "WORKFLOW",
      "EXECUTION_AUTHORIZATION",
    ]) {
      expect(SemanticArtifactKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("accepts only the minimal internal execution authorization payload", () => {
    expect(ExecutionAuthorizationArtifactPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      ExecutionAuthorizationArtifactPayloadSchema.safeParse({
        ...payload,
        rawGatewayResponse: { commitToken: payload.commitTokenId },
      }).success,
    ).toBe(false);
  });

  it.each([
    "intentStateId",
    "intentStateHash",
    "workflowId",
    "packId",
    "commitTokenId",
    "preparedActionId",
    "preparedActionHash",
    "grantId",
    "outcomeContractId",
    "outcomeContractHash",
  ])("rejects a payload missing %s", (field) => {
    const malformed = { ...payload } as Record<string, unknown>;
    delete malformed[field];
    expect(ExecutionAuthorizationArtifactPayloadSchema.safeParse(malformed).success).toBe(false);
  });
});
