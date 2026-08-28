import {
  EvidenceS2SClient,
  IntentProvenanceS2SClient,
  adcIdentityTokenProvider,
  createCloudRunHttpServer,
  loadRuntimeConfig,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { ok, type Result } from "@truemandate/protocol";
import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import { createDemoInternalRoutes } from "../demo-internal-routes.js";
import type { DemoOrchestratorPorts } from "../demo-orchestrator.js";

/**
 * HTTP-serving entrypoint for the trusted demo-evidence orchestration.
 * Distinct from bin/start.ts (the existing, unrelated Phase C acceptance
 * JOB) — this runs as a Cloud Run SERVICE, under the SAME phase-c-verifier
 * identity, so it can call /internal/evidence/verifications without any new
 * grant. See runtime_services["demo-evidence-orchestrator"] in
 * infrastructure/terraform/modules/runtime/variables.tf.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

/**
 * Application-level, this hits a PUBLIC-BFF route: no elevated permission is
 * exercised by the transport itself — the payload shape and authorization
 * outcome are exactly what any caller (browser included) gets from that
 * route. But public-bff's own Cloud Run IAM policy requires an authenticated
 * invoker for every route without exception (confirmed live:
 * `gcloud run services get-iam-policy tm-dev-public-bff` grants
 * roles/run.invoker to tm-dev-web@ only) — a browser only ever reaches it
 * indirectly, through web-proxy.mjs attaching web's own identity token. This
 * identity has no such proxy, so it must attach its own token the same way,
 * or every call 403s before reaching public-bff's application code at all.
 */
async function postToPublicBff(
  tokenProvider: { getIdentityToken(audience: string): Promise<string> },
  webUrl: string,
  path: string,
  body: unknown,
): Promise<Result<Record<string, unknown>>> {
  const token = await tokenProvider.getIdentityToken(webUrl);
  if (!token) throw new Error(`S2S identity token missing for WORKFLOWS_API_URL (${path})`);
  const response = await fetch(`${webUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (response.ok) return ok(parsed as Record<string, unknown>);
  const error = (parsed as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
  return {
    ok: false,
    code: error?.code ?? "UNKNOWN_ERROR",
    message: error?.message ?? `HTTP ${response.status}`,
    details: error?.details,
  } as Result<never>;
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const webUrl = required("WORKFLOWS_API_URL");
  const evidenceUrl = required("EVIDENCE_URL");
  const intentProvenanceUrl = required("INTENT_PROVENANCE_URL");
  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();

  // Verification stays a direct S2S call to evidence-service, under this
  // service's own phase-c-verifier identity — unchanged by A-Prime.
  const evidence = new EvidenceS2SClient(evidenceUrl, tokenProvider);
  const intents = new IntentProvenanceS2SClient(intentProvenanceUrl, tokenProvider);

  const ports: DemoOrchestratorPorts = {
    submitWorkflow: (body: unknown) => postToPublicBff(tokenProvider, webUrl, "/v1/workflows", body),
    evidence: {
      // A-Prime: routed through public-bff's narrow, app-auth-gated
      // provisioning route — NOT a direct evidence-service call. `body` is
      // already exactly {scenarioId, runId, intentId, intentStateId}
      // (constructed in demo-orchestrator.ts); this only chooses where it
      // goes and how the call is authenticated. The resulting
      // /internal/evidence/submissions call is authenticated as
      // tm-dev-public-bff@..., never as this service's own identity.
      submitEvidence: (body) =>
        postToPublicBff(tokenProvider, webUrl, "/internal/demo/evidence-provisioning", body) as Promise<
          Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>
        >,
      verifyEvidence: (body) => evidence.verifyEvidence(body) as Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>,
    },
    intents: {
      getTip: (intentId) => intents.getTip(intentId) as Promise<Result<{ id: string; stateHash: string }>>,
    },
    newRunId: () => crypto.randomUUID(),
  };

  const callerEmails = (process.env.TM_DEMO_PROVISION_CALLER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const http = createCloudRunHttpServer({
    config,
    bus: new InMemoryPubSubBus(),
    acceptedTopics: [],
    enableEvents: false,
    health: { ready: true },
    internalRoutes: createDemoInternalRoutes(ports, callerEmails),
  });
  await http.listen();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
