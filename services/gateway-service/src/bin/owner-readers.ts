import {
  type AuthorityS2SClient,
  type IntentProvenanceS2SClient,
  type OutcomeS2SClient,
} from "@truemandate/cloud-runtime";

/** Gateway reads authoritative lineage exclusively through owner S2S APIs. */
export function createGatewayOwnerReaders(input: {
  readonly authority: Pick<AuthorityS2SClient, "getEvaluation">;
  readonly intents: Pick<IntentProvenanceS2SClient, "getIntentState" | "getSemanticArtifact" | "getTip">;
  readonly outcomes: Pick<OutcomeS2SClient, "getContract">;
}) {
  return {
    getEvaluation: (id: string) => input.authority.getEvaluation(id),
    getOutcomeContract: (id: string) => input.outcomes.getContract(id),
    getArtifact: (id: string) => input.intents.getSemanticArtifact(id),
    getState: (id: string) => input.intents.getIntentState(id),
    getTip: (intentId: string) => input.intents.getTip(intentId),
  };
}
