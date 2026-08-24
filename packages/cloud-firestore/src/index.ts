import type { DocumentStore } from "./document-store.js";
import { MemoryTransactionalStore } from "./document-store.js";
import { FirestoreGrantStore } from "./grant-store.js";
import { FirestoreCommitTokenStore } from "./commit-token-store.js";
import {
  FirestoreIdempotencyStore,
  FirestoreNonceStore,
} from "./crypto-stores.js";
import { FirestoreExposureLedger } from "./exposure-ledger.js";
import { FirestoreEconomicReservationStore } from "./economic-reservation-store.js";
import { FirestoreSideEffectLedger } from "./side-effect-ledger.js";
import { FirestorePreparedActionStore } from "./prepared-action-store.js";
import {
  FirestoreIntentRepository,
  FirestoreProvenanceRepository,
  createApprovalEventRepository,
  createApprovalRepository,
  createAuthorityEvaluationRepository,
  createEvidenceClaimRepository,
  createEvidenceEnvelopeRepository,
  createExecutionOutboxRepository,
  FirestoreSemanticArtifactRepository,
  createAnalyticsExportLedgerRepository,
  createLearnedContextRepository,
  createLearningProposalEventRepository,
  createLearningProposalRepository,
  createPreferenceRecordRepository,
  createPreferenceTipRepository,
  createDemoSessionRepository,
  createTrustSignalTipRepository,
  createWorkflowRuleRepository,
  createWorkflowRuleTipRepository,
  createPreferenceEvidenceIndexRepository,
  createOutcomeContractRepository,
  createOutcomeLifecycleRepository,
  createOutcomeEventRepository,
  createRemediationMandateRepository,
  createResolutionCaseRepository,
  createResolutionEventRepository,
  createResolutionTriggerDedupeRepository,
  createMandateClaimRepository,
} from "./repositories.js";
import {
  FirestoreModelTelemetryStore,
  FirestoreWorkflowStageStore,
} from "./telemetry-stores.js";
import { createMonitoringContractRepository } from "./monitoring-store.js";

export * from "./document-store.js";
export * from "./google-store.js";
export * from "./grant-store.js";
export * from "./commit-token-store.js";
export * from "./crypto-stores.js";
export * from "./exposure-ledger.js";
export * from "./economic-reservation-store.js";
export * from "./side-effect-ledger.js";
export * from "./prepared-action-store.js";
export * from "./repositories.js";
export * from "./telemetry-stores.js";
export * from "./monitoring-store.js";

export interface FirestorePersistenceBundle {
  readonly store: DocumentStore;
  readonly grants: FirestoreGrantStore;
  readonly commitTokens: FirestoreCommitTokenStore;
  readonly nonces: FirestoreNonceStore;
  readonly idempotency: FirestoreIdempotencyStore;
  readonly exposure: FirestoreExposureLedger;
  readonly economicReservations: FirestoreEconomicReservationStore;
  readonly sideEffects: FirestoreSideEffectLedger;
  readonly preparedActions: FirestorePreparedActionStore;
  readonly intents: FirestoreIntentRepository;
  readonly provenance: FirestoreProvenanceRepository;
  readonly outcomeContracts: ReturnType<typeof createOutcomeLifecycleRepository>;
  readonly outcomeContractDefinitions: ReturnType<typeof createOutcomeContractRepository>;
  readonly outcomeEvents: ReturnType<typeof createOutcomeEventRepository>;
  readonly resolutionCases: ReturnType<typeof createResolutionCaseRepository>;
  readonly resolutionTriggers: ReturnType<
    typeof createResolutionTriggerDedupeRepository
  >;
  readonly remediationMandates: ReturnType<
    typeof createRemediationMandateRepository
  >;
  readonly mandateClaims: ReturnType<typeof createMandateClaimRepository>;
  readonly approvals: ReturnType<typeof createApprovalRepository>;
  readonly approvalEvents: ReturnType<typeof createApprovalEventRepository>;
  readonly learningProposals: ReturnType<typeof createLearningProposalRepository>;
  readonly learningProposalEvents: ReturnType<
    typeof createLearningProposalEventRepository
  >;
  readonly learnedContext: ReturnType<typeof createLearnedContextRepository>;
  readonly preferenceRecords: ReturnType<typeof createPreferenceRecordRepository>;
  readonly preferenceTips: ReturnType<typeof createPreferenceTipRepository>;
  readonly demoSessions: ReturnType<typeof createDemoSessionRepository>;
  readonly trustSignalTips: ReturnType<typeof createTrustSignalTipRepository>;
  readonly workflowRules: ReturnType<typeof createWorkflowRuleRepository>;
  readonly workflowRuleTips: ReturnType<typeof createWorkflowRuleTipRepository>;
  readonly preferenceEvidenceIndexes: ReturnType<
    typeof createPreferenceEvidenceIndexRepository
  >;
  readonly analyticsExportLedger: ReturnType<
    typeof createAnalyticsExportLedgerRepository
  >;
  readonly resolutionEvents: ReturnType<typeof createResolutionEventRepository>;
  readonly evidenceEnvelopes: ReturnType<typeof createEvidenceEnvelopeRepository>;
  readonly evidenceClaims: ReturnType<typeof createEvidenceClaimRepository>;
  readonly executionOutbox: ReturnType<typeof createExecutionOutboxRepository>;
  readonly authorityEvaluations: ReturnType<typeof createAuthorityEvaluationRepository>;
  /** Wave 4.3: durable MonitoringContract persistence. */
  readonly monitoringContracts: ReturnType<typeof createMonitoringContractRepository>;
  readonly semanticArtifacts: FirestoreSemanticArtifactRepository;
  /** Wave 2 observability: durable model-call telemetry (success + failure). */
  readonly modelTelemetry: FirestoreModelTelemetryStore;
  /** Wave 2 observability: durable workflow stage-timing events. */
  readonly workflowStages: FirestoreWorkflowStageStore;
}

/**
 * Wire persistence. Default CI uses MemoryTransactionalStore (emulator-equivalent TX).
 * Production: pass a DocumentStore backed by @google-cloud/firestore when TM_PERSISTENCE=firestore.
 */
export function createFirestorePersistence(
  store: DocumentStore = new MemoryTransactionalStore(),
): FirestorePersistenceBundle {
  return {
    store,
    grants: new FirestoreGrantStore(store),
    commitTokens: new FirestoreCommitTokenStore(store),
    nonces: new FirestoreNonceStore(store),
    idempotency: new FirestoreIdempotencyStore(store),
    exposure: new FirestoreExposureLedger(store),
    economicReservations: new FirestoreEconomicReservationStore(store),
    sideEffects: new FirestoreSideEffectLedger(store),
    preparedActions: new FirestorePreparedActionStore(store),
    intents: new FirestoreIntentRepository(store),
    provenance: new FirestoreProvenanceRepository(store),
    outcomeContracts: createOutcomeLifecycleRepository(store),
    outcomeContractDefinitions: createOutcomeContractRepository(store),
    outcomeEvents: createOutcomeEventRepository(store),
    resolutionCases: createResolutionCaseRepository(store),
    resolutionTriggers: createResolutionTriggerDedupeRepository(store),
    remediationMandates: createRemediationMandateRepository(store),
    mandateClaims: createMandateClaimRepository(store),
    approvals: createApprovalRepository(store),
    approvalEvents: createApprovalEventRepository(store),
    learningProposals: createLearningProposalRepository(store),
    learningProposalEvents: createLearningProposalEventRepository(store),
    learnedContext: createLearnedContextRepository(store),
    preferenceRecords: createPreferenceRecordRepository(store),
    preferenceTips: createPreferenceTipRepository(store),
    demoSessions: createDemoSessionRepository(store),
    trustSignalTips: createTrustSignalTipRepository(store),
    workflowRules: createWorkflowRuleRepository(store),
    workflowRuleTips: createWorkflowRuleTipRepository(store),
    preferenceEvidenceIndexes: createPreferenceEvidenceIndexRepository(store),
    analyticsExportLedger: createAnalyticsExportLedgerRepository(store),
    resolutionEvents: createResolutionEventRepository(store),
    evidenceEnvelopes: createEvidenceEnvelopeRepository(store),
    evidenceClaims: createEvidenceClaimRepository(store),
    executionOutbox: createExecutionOutboxRepository(store),
    authorityEvaluations: createAuthorityEvaluationRepository(store),
    monitoringContracts: createMonitoringContractRepository(store),
    semanticArtifacts: new FirestoreSemanticArtifactRepository(store),
    modelTelemetry: new FirestoreModelTelemetryStore(store),
    workflowStages: new FirestoreWorkflowStageStore(store),
  };
}

export function persistenceModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): "memory" | "firestore" {
  return env.TM_PERSISTENCE === "firestore" ? "firestore" : "memory";
}
