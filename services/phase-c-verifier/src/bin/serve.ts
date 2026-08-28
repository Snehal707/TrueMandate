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

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const webUrl = required("WEB_URL");
  const evidenceUrl = required("EVIDENCE_URL");
  const intentProvenanceUrl = required("INTENT_PROVENANCE_URL");
  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();

  const evidence = new EvidenceS2SClient(evidenceUrl, tokenProvider);
  const intents = new IntentProvenanceS2SClient(intentProvenanceUrl, tokenProvider);

  const ports: DemoOrchestratorPorts = {
    // The PUBLIC route — no special auth. Reused exactly as any other
    // caller (browser included) would use it; this identity's only special
    // authority is the verification call below.
    submitWorkflow: async (body: unknown): Promise<Result<Record<string, unknown>>> => {
      const response = await fetch(`${webUrl.replace(/\/$/, "")}/v1/workflows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
    },
    evidence: {
      submitEvidence: (body) => evidence.submitEvidence(body) as Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>,
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
