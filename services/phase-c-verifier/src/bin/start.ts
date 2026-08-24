import { PubSub } from "@google-cloud/pubsub";
import {
  EvidenceS2SClient,
  OutcomeS2SClient,
  adcIdentityTokenProvider,
  fetchS2SJson,
  s2sResultFromHttp,
} from "@truemandate/cloud-runtime";
import { phaseCAcceptanceFixture, phaseCRawEvent, phaseCWorkflow } from "../fixture.js";
import { runPhaseCVerifier } from "../run.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

async function main(): Promise<void> {
  const evidenceUrl = required("EVIDENCE_URL");
  const agentUrl = required("AGENT_RUNTIME_URL");
  const outcomeUrl = required("OUTCOME_RESOLUTION_URL");
  const tokens = await adcIdentityTokenProvider();
  const evidence = new EvidenceS2SClient(evidenceUrl, tokens);
  const outcomes = new OutcomeS2SClient(outcomeUrl, tokens);

  const callAgent = async (method: string, path: string, body?: unknown) => {
    const token = await tokens.getIdentityToken(agentUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: agentUrl, path, method, token, body }));
  };

  const result = await runPhaseCVerifier({
    submitEvidenceFixture: (fixture) => evidence.submitAcceptanceFixture(fixture),
    getContract: (contractId) => outcomes.getContract(contractId) as never,
    publishRawIntent: async (event) => {
      await new PubSub().topic(required("INTENT_TOPIC")).publishMessage({
        data: Buffer.from(JSON.stringify(event)),
      });
    },
    submitWorkflow: (workflow) => callAgent("POST", "/internal/workflows/procurement", workflow),
    submitCommit: (body) => callAgent("POST", "/internal/execution/commit", body),
    evaluateEvidence: (contractId, body) => outcomes.evaluateEvidence(contractId, body) as never,
    getResolutionCaseByContract: (contractId) => outcomes.getResolutionCaseByContract(contractId) as never,
  }, {
    fixture: phaseCAcceptanceFixture() as never,
    rawEvent: phaseCRawEvent(),
    workflow: phaseCWorkflow(),
  });
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  console.log(JSON.stringify(result.value));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
