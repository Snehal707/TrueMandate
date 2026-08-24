import { ok } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { createGatewayOwnerReaders } from "./owner-readers.js";

describe("Gateway production owner readers", () => {
  it("registers reference-only preparation against Authority, Outcome, and Intent owners", async () => {
    const readers = createGatewayOwnerReaders({
      authority: { getEvaluation: async (id) => ok({ id, owner: "authority" }) },
      outcomes: { getContract: async (id) => ok({ id, owner: "outcome" }) },
      intents: {
        getSemanticArtifact: async (id) => ok({ id, owner: "intent" }),
        getIntentState: async (id) => ok({ id, owner: "intent" }),
        getTip: async (id) => ok({ id, owner: "intent" }),
      },
    });
    await expect(readers.getEvaluation("evaluation-1")).resolves.toEqual(ok({ id: "evaluation-1", owner: "authority" }));
    await expect(readers.getOutcomeContract("outcome-1")).resolves.toEqual(ok({ id: "outcome-1", owner: "outcome" }));
    await expect(readers.getArtifact("action-1")).resolves.toEqual(ok({ id: "action-1", owner: "intent" }));
    await expect(readers.getState("state-1")).resolves.toEqual(ok({ id: "state-1", owner: "intent" }));
    await expect(readers.getTip("intent-1")).resolves.toEqual(ok({ id: "intent-1", owner: "intent" }));
  });
});
