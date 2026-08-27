import {
  IntentProvenanceS2SClient,
  OutcomeS2SClient,
  adcIdentityTokenProvider,
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
  requireIntentProvenanceUrl,
  requireInternalAllowedCallers,
  requireOutcomeResolutionUrl,
  staticTokenProvider,
} from "@truemandate/cloud-runtime";
import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import { initTracing } from "@truemandate/observability";
import { ok, type EvidenceClaim, type EvidenceEnvelope, type Result } from "@truemandate/protocol";
import {
  composeEvidenceReaderEmails,
  composeEvidenceSubmitCallerEmails,
  createEvidenceInternalRoutes,
  type AcceptanceFixtureWriter,
} from "../internal-routes.js";
import { EvidenceService } from "../service.js";
import {
  normalizeEvidenceSubmission,
  validateEvidenceSubmissionLineage,
} from "../submissions.js";
import type { PublicEvidenceSubmission } from "@truemandate/schemas";
import { verifyEvidenceSubmission } from "../verifications.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  requireInternalAllowedCallers(config);
  requireIntentProvenanceUrl(config);
  requireOutcomeResolutionUrl(config);
  const persist = await initRuntimePersistence();
  const tokenProvider = process.env.TM_S2S_BEARER
    ? staticTokenProvider(process.env.TM_S2S_BEARER)
    : await adcIdentityTokenProvider();
  const intents = new IntentProvenanceS2SClient(
    config.intentProvenanceUrl!,
    tokenProvider,
  );
  const outcomes = new OutcomeS2SClient(
    config.outcomeResolutionUrl!,
    tokenProvider,
  );
  // The Evidence owner durably owns Envelope/Claim rows: reads go through the
  // service read-through (mirror → durable → schema-validated).
  const service = new EvidenceService({
    envelopes: { get: (id) => persist.bundle.evidenceEnvelopes.get(id) },
    claims: { get: (id) => persist.bundle.evidenceClaims.get(id) },
  });
  const owner = {
    getEnvelope: async (id: string) => {
      const result = await service.getEnvelope(id);
      return result.ok ? result.value : undefined;
    },
    getClaim: async (id: string) => {
      const result = await service.getClaim(id);
      return result.ok ? result.value : undefined;
    },
    // Read-through by envelope. Confers no trust: the caller must already hold
    // the envelope id, and could read each claim individually anyway.
    listClaimsForEnvelope: async (envelopeId: string): Promise<readonly EvidenceClaim[]> => {
      const rows = await persist.bundle.evidenceClaims.list();
      const claims: EvidenceClaim[] = [];
      for (const row of rows) {
        const claim = row as EvidenceClaim | undefined;
        if (!claim || claim.evidenceId !== envelopeId || claim.invalidatedAt) continue;
        const validated = await service.getClaim(String(claim.id));
        if (validated.ok) claims.push(validated.value);
      }
      return claims;
    },
    // The route layer has already validated the fixture against the
    // caller-bound namespace schema; this owner only persists.
    persistFixture: async (fixture: unknown): Promise<Result<unknown>> => {
      const value = fixture as { envelopes: EvidenceEnvelope[]; claims: EvidenceClaim[] };
      for (const envelope of value.envelopes) {
        const saved = await service.persistEnvelope(envelope, persist.bundle.evidenceEnvelopes);
        if (!saved.ok) return saved;
      }
      for (const claim of value.claims) {
        const saved = await service.persistClaim(claim, persist.bundle.evidenceClaims);
        if (!saved.ok) return saved;
      }
      return ok({ envelopeIds: value.envelopes.map((x) => x.id), claimIds: value.claims.map((x) => x.id) });
    },
    persistSubmission: async (
      submission: PublicEvidenceSubmission,
      callerEmail: string,
    ): Promise<Result<unknown>> => {
      const lineage = await validateEvidenceSubmissionLineage(submission, {
        getIntent: (intentId) => intents.getIntent(intentId),
        getIntentState: (intentStateId) => intents.getIntentState(intentStateId),
        listWorkflowArtifacts: (workflowId) =>
          intents.listWorkflowArtifacts(workflowId),
        getOutcomeContract: (outcomeContractId) =>
          outcomes.getContract(outcomeContractId),
      });
      if (!lineage.ok) return lineage;
      const normalized = normalizeEvidenceSubmission(
        submission,
        callerEmail,
        lineage.value,
      );
      for (const envelope of normalized.envelopes) {
        const saved = await service.persistEnvelope(
          envelope,
          persist.bundle.evidenceEnvelopes,
        );
        if (!saved.ok) return saved;
      }
      for (const claim of normalized.claims) {
        const saved = await service.persistClaim(
          claim,
          persist.bundle.evidenceClaims,
        );
        if (!saved.ok) return saved;
      }
      return ok({
        envelopeIds: normalized.envelopes.map((x) => x.id),
        claimIds: normalized.claims.map((x) => x.id),
      });
    },
    persistVerification: async (
      verification: unknown,
      callerEmail: string,
    ): Promise<Result<unknown>> => {
      const verified = await verifyEvidenceSubmission(verification, callerEmail, {
        getIntent: (intentId) => intents.getIntent(intentId),
        getIntentState: (intentStateId) => intents.getIntentState(intentStateId),
        listWorkflowArtifacts: (workflowId) =>
          intents.listWorkflowArtifacts(workflowId),
        getOutcomeContract: (outcomeContractId) =>
          outcomes.getContract(outcomeContractId),
        getEnvelope: (id) => owner.getEnvelope(id),
        getClaim: (id) => owner.getClaim(id),
      });
      if (!verified.ok) return verified;
      const savedEnvelope = await service.persistEnvelope(
        verified.value.envelope,
        persist.bundle.evidenceEnvelopes,
      );
      if (!savedEnvelope.ok) return savedEnvelope;
      for (const claim of verified.value.claims) {
        const saved = await service.persistClaim(
          claim,
          persist.bundle.evidenceClaims,
        );
        if (!saved.ok) return saved;
      }
      return ok({
        envelopeIds: [verified.value.envelope.id],
        claimIds: verified.value.claims.map((item) => item.id),
        lineage: verified.value.lineage,
        verificationId: verified.value.verificationId,
      });
    },
  };
  // Caller-bound fixture namespaces: the verified service identity decides
  // which id prefix it may create. Namespace prefixes are server-side
  // constants — never derived from fixture payloads.
  const fixtureWriters: AcceptanceFixtureWriter[] = [
    ...(process.env.TM_ACCEPTANCE_FIXTURE_CALLER_EMAIL ? [{ email: process.env.TM_ACCEPTANCE_FIXTURE_CALLER_EMAIL, idPrefix: "phase-a-" }] : []),
    ...(process.env.TM_PHASE_B_FIXTURE_CALLER_EMAIL ? [{ email: process.env.TM_PHASE_B_FIXTURE_CALLER_EMAIL, idPrefix: "phase-b-" }] : []),
    ...(process.env.TM_PHASE_C_FIXTURE_CALLER_EMAIL ? [{ email: process.env.TM_PHASE_C_FIXTURE_CALLER_EMAIL, idPrefix: "phase-c-" }] : []),
    ...(process.env.TM_WAVE1_FIXTURE_CALLER_EMAIL ? [{ email: process.env.TM_WAVE1_FIXTURE_CALLER_EMAIL, idPrefix: "wave1-" }] : []),
  ];
  // Route-specific reader identities (e.g., the Outcome owner verifying
  // accepted evidence). Readers ADD to the existing global caller policy —
  // the coordinator's chain-era envelope reads must never be displaced.
  const evidenceReaderEmails = composeEvidenceReaderEmails(
    config.internalAllowedCallers,
    process.env.TM_EVIDENCE_READER_CALLER_EMAILS,
  );
  const evidenceSubmitCallerEmails = composeEvidenceSubmitCallerEmails(
    process.env.TM_EVIDENCE_SUBMIT_CALLER_EMAILS,
  );
  const evidenceVerifyCallerEmails = composeEvidenceSubmitCallerEmails(
    process.env.TM_EVIDENCE_VERIFY_CALLER_EMAILS,
  );
  const http = createCloudRunHttpServer({
    config, bus: new InMemoryPubSubBus(), acceptedTopics: [], enableEvents: false,
    health: { ready: true }, readinessProbe: () => persist.probeReadiness(),
    extraHealth: { evidenceOwner: true, firestoreClient: persist.firestoreClient ? "initialized" : "none" },
    internalRoutes: createEvidenceInternalRoutes(
      owner,
      fixtureWriters,
      evidenceReaderEmails,
      evidenceSubmitCallerEmails,
      evidenceVerifyCallerEmails,
    ),
  });
  await http.listen();
}
main().catch((error: unknown) => { console.error(error); process.exit(1); });
