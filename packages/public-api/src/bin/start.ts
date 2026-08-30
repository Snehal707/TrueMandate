import { createLivePublicBffPorts } from "../adapters.js";
import { createDemoEvidenceProvisionPort } from "../demo-evidence-provisioning.js";
import { createPublicBffServer } from "../server.js";
import {
  AgentRuntimeS2SClient,
  AuthorityS2SClient,
  EvidenceS2SClient,
  GatewayS2SClient,
  IntentProvenanceS2SClient,
  OutcomeS2SClient,
  ResolutionS2SClient,
  adcIdentityTokenProvider,
  fetchS2SJson,
  initRuntimePersistence,
  loadRuntimeConfig,
  requireAgentRuntimeUrl,
  requireAuthorityUrl,
  requireEvidenceUrl,
  requireGatewayUrl,
  requireIntentProvenanceUrl,
  requireOutcomeResolutionUrl,
  s2sResultFromHttp,
  staticTokenProvider,
  type IdentityTokenProvider,
} from "@truemandate/cloud-runtime";
import { DemoRuntime } from "@truemandate/observability-service";

/**
 * Container entrypoint. Missing critical config must exit non-zero (fail closed).
 * Intent mutations are S2S to intent-provenance. Local Firestore is read-only /readyz.
 */
async function main(): Promise<void> {
  const requireConfig = process.env.TM_REQUIRE_CONFIG !== "false";
  const runtimeConfig = loadRuntimeConfig();
  requireIntentProvenanceUrl(runtimeConfig);
  requireAgentRuntimeUrl(runtimeConfig);
  requireAuthorityUrl(runtimeConfig);
  requireEvidenceUrl(runtimeConfig);
  requireGatewayUrl(runtimeConfig);
  requireOutcomeResolutionUrl(runtimeConfig);
  const persist = await initRuntimePersistence();
  const probed = await persist.probeReadiness();
  if (!probed.ready) {
    throw new Error(`public-bff persistence not ready: ${probed.reason ?? "probe_failed"}`);
  }

  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();
  const owner = new IntentProvenanceS2SClient(
    runtimeConfig.intentProvenanceUrl!,
    tokenProvider,
  );
  const workflows = new AgentRuntimeS2SClient(
    runtimeConfig.agentRuntimeUrl!,
    tokenProvider,
  );
  const gateway = new GatewayS2SClient(
    runtimeConfig.gatewayUrl!,
    tokenProvider,
  );
  const authority = new AuthorityS2SClient(
    runtimeConfig.authorityUrl!,
    tokenProvider,
  );
  const evidence = new EvidenceS2SClient(
    runtimeConfig.evidenceUrl!,
    tokenProvider,
  );
  const outcomes = new OutcomeS2SClient(
    runtimeConfig.outcomeResolutionUrl!,
    tokenProvider,
  );
  const resolutions = new ResolutionS2SClient(
    runtimeConfig.outcomeResolutionUrl!,
    tokenProvider,
  );

  const demoOrchestratorUrl = process.env.DEMO_ORCHESTRATOR_URL;
  const demoOrchestration = demoOrchestratorUrl
    ? {
        runScenario: async (scenarioId: string, variantId: string) => {
          const token = await (tokenProvider as IdentityTokenProvider).getIdentityToken(demoOrchestratorUrl);
          if (!token) throw new Error("S2S identity token missing for demo-evidence-orchestrator");
          return s2sResultFromHttp(
            await fetchS2SJson({
              baseUrl: demoOrchestratorUrl,
              path: `/internal/demo/scenarios/${encodeURIComponent(scenarioId)}/variants/${encodeURIComponent(variantId)}/run`,
              method: "POST",
              token,
            }),
          );
        },
      }
    : undefined;

  const demo = new DemoRuntime();
  const ports = createLivePublicBffPorts({
    intentCreate: { createIntent: (raw) => owner.createIntent(raw) },
    workspaceSource: {
      getIntent: (intentId) => owner.getIntent(intentId),
      getTip: (intentId) => owner.getTip(intentId),
      listWorkflowArtifacts: (workflowId) => owner.listWorkflowArtifacts(workflowId),
      getNode: (id) => owner.getNode(id),
      getEdge: (id) => owner.getEdge(id),
    },
    executionRead: {
      getPreparedAction: (id) => gateway.getPreparedAction(id),
    },
    demoRuntime: demo,
    evidence: {
      getEnvelope: (id) => evidence.getEnvelope(id),
      submitEvidence: (raw) => evidence.submitEvidence(raw),
    },
    approvalRead: {
      getApproval: (id) => authority.getApproval(id),
      getEvaluation: (id) => authority.getEvaluation(id),
    },
    approvalDecide: {
      decideApproval: (id, body) => authority.decideApproval(id, body),
    },
    workflow: {
      submitWorkflow: (raw) => workflows.submitWorkflow(raw),
      getWorkflow: (workflowId) => workflows.getWorkflow(workflowId),
      resumeWorkflow: (workflowId, body) =>
        workflows.resumeWorkflowApproval(workflowId, body),
      commitWorkflow: (workflowId) => workflows.commitWorkflow(workflowId),
    },
    outcomeRead: {
      getOutcomeContract: (id) => outcomes.getContract(id),
    },
    resolutionRead: {
      getCase: (id) => resolutions.getCase(id),
      getCaseByOutcomeContract: (contractId) =>
        outcomes.getResolutionCaseByContract(contractId),
      getRemedies: (caseId) => resolutions.listRemedies(caseId),
      getMandate: (id) => resolutions.getMandate(id),
    },
    // Read-only canonical projection for the judge demo (GET-only route).
    canonicalStore: persist.store,
    ...(demoOrchestration ? { demoOrchestration } : {}),
    // A-Prime: reuses the SAME already-constructed owner/evidence S2S
    // clients (public-bff's own identity) — no new client, no new URL.
    // The route itself only registers if TM_DEMO_EVIDENCE_PROVISION_CALLER_EMAILS
    // is configured (see router.ts).
    demoEvidenceProvision: createDemoEvidenceProvisionPort({
      getIntent: (intentId) => owner.getIntent(intentId),
      getTip: (intentId) => owner.getTip(intentId),
      submitEvidence: (raw) => evidence.submitEvidence(raw),
    }),
  });

  const { listen, bff } = createPublicBffServer(
    ports,
    { requireConfig },
    {
      ready: true,
      probe: () => persist.probeReadiness(),
    },
  );
  await listen();
  console.log(
    JSON.stringify({
      msg: "public-bff listening",
      host: bff.config.host,
      port: bff.config.port,
      persistence: persist.mode,
      service: runtimeConfig.serviceName,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
      intentOwner: "intent-provenance-s2s",
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
