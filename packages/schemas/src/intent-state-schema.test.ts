import { describe, expect, it } from "vitest";
import { IntentStateSchema } from "./objects.js";

const state = {
  id: "state-1",
  intentId: "intent-1",
  rawIntentHash: "raw-hash",
  version: 1,
  constraints: [],
  assumptions: [],
  createdAt: "2026-08-16T00:00:00.000Z",
  createdBy: "principal-1",
  stateHash: "state-hash",
};

describe("IntentStateSchema temporalAuthority", () => {
  it("accepts canonical owner-derived temporal authority", () => {
    expect(IntentStateSchema.safeParse({
      ...state,
      temporalAuthority: {
        executionNotBefore: "2026-08-16T00:00:00.000Z",
        executionNotAfter: "2026-08-17T00:00:00.000Z",
        source: "EXPLICIT_HUMAN",
        sourceRef: "constraint-deadline",
        provenanceNodeId: "provenance-1",
      },
    }).success).toBe(true);
  });

  it("rejects invalid, inverted, and non-strict temporal authority", () => {
    for (const temporalAuthority of [
      { executionNotAfter: "not-a-timestamp", source: "EXPLICIT_HUMAN", sourceRef: "constraint-deadline" },
      { executionNotBefore: "2026-08-18T00:00:00.000Z", executionNotAfter: "2026-08-17T00:00:00.000Z", source: "EXPLICIT_HUMAN", sourceRef: "constraint-deadline" },
      { executionNotAfter: "2026-08-17T00:00:00.000Z", source: "EXPLICIT_HUMAN", sourceRef: "constraint-deadline", unexpected: true },
    ]) {
      expect(IntentStateSchema.safeParse({ ...state, temporalAuthority }).success).toBe(false);
    }
  });
});
