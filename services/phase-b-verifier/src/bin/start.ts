import { PubSub } from "@google-cloud/pubsub";
import { adcIdentityTokenProvider, fetchS2SJson, s2sResultFromHttp } from "@truemandate/cloud-runtime";
import { phaseBFixture } from "../fixture.js";
import { runPhaseBVerifier } from "../run.js";

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} required`); return value; }
async function call(tokens: Awaited<ReturnType<typeof adcIdentityTokenProvider>>, baseUrl: string, method: string, path: string, body?: unknown) {
  return s2sResultFromHttp(await fetchS2SJson({ baseUrl, method, path, body, token: await tokens.getIdentityToken(baseUrl) }));
}
async function main(): Promise<void> {
  const evidenceUrl = required("EVIDENCE_URL"); const agentUrl = required("AGENT_RUNTIME_URL");
  const tokens = await adcIdentityTokenProvider();
  const evidence = await call(tokens, evidenceUrl, "POST", "/internal/evidence/acceptance-fixtures", phaseBFixture());
  if (!evidence.ok) throw new Error(evidence.message);
  const result = await runPhaseBVerifier({
    publishRawIntent: async (event) => { await new PubSub().topic(required("INTENT_TOPIC")).publishMessage({ data: Buffer.from(JSON.stringify(event)) }); },
    submitWorkflow: (workflow) => call(tokens, agentUrl, "POST", "/internal/workflows/procurement", workflow),
    submitCommit: (body) => call(tokens, agentUrl, "POST", "/internal/execution/commit", body),
  });
  console.log(JSON.stringify(result));
}
main().catch((error: unknown) => { console.error(error); process.exit(1); });
