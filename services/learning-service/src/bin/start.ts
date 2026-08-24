import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  initRuntimePersistence,
  loadRuntimeConfig,
} from "@truemandate/cloud-runtime";
import { initTracing } from "@truemandate/observability";
import type {
  LearnedContextRecord,
  LearningProposal,
  LearningProposalEvent,
  PreferenceRecord,
  WorkflowRule,
} from "@truemandate/protocol";
import {
  createLearningRoutes,
    type DemoSessionDoc,
    type PreferenceEvidenceIndexDoc,
    type PreferenceTipDoc,
    type TrustSignalTipDoc,
    type WorkflowRuleTipDoc,
} from "../learning-routes.js";
import { LearningService } from "../service.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  initTracing({ serviceName: config.serviceName });
  const persist = await initRuntimePersistence();

  const proposals = {
    get: async (id: string) =>
      (await persist.bundle.learningProposals.get(id)) as
        | LearningProposal
        | undefined,
    putIfAbsent: async (id: string, value: LearningProposal) =>
      persist.bundle.learningProposals.putIfAbsent(id, value),
    put: async (id: string, value: LearningProposal) =>
      persist.bundle.learningProposals.put(id, value),
  };
  const events = {
    putIfAbsent: async (id: string, value: LearningProposalEvent) =>
      persist.bundle.learningProposalEvents.putIfAbsent(id, value),
  };
  const learnedContext = {
    get: async (id: string) =>
      (await persist.bundle.learnedContext.get(id)) as
        | LearnedContextRecord
        | undefined,
    putIfAbsent: async (id: string, value: LearnedContextRecord) =>
      persist.bundle.learnedContext.putIfAbsent(id, value),
  };
  const preferenceRecords = {
    get: async (id: string) =>
      (await persist.bundle.preferenceRecords.get(id)) as
        | PreferenceRecord
        | undefined,
    put: async (id: string, value: PreferenceRecord) =>
      persist.bundle.preferenceRecords.put(id, value),
  };
  const preferenceTips = {
    get: async (tipKey: string) =>
      (await persist.bundle.preferenceTips.get(tipKey)) as
        | PreferenceTipDoc
        | undefined,
    put: async (tipKey: string, value: PreferenceTipDoc) =>
      persist.bundle.preferenceTips.put(tipKey, value),
  };
  const demoSessions = {
    get: async (id: string) =>
      (await persist.bundle.demoSessions.get(id)) as DemoSessionDoc | undefined,
    putIfAbsent: async (id: string, value: DemoSessionDoc) =>
      persist.bundle.demoSessions.putIfAbsent(id, value),
  };
  const trustSignalTips = {
    get: async (tipKey: string) =>
      (await persist.bundle.trustSignalTips.get(tipKey)) as
        | TrustSignalTipDoc
        | undefined,
    put: async (tipKey: string, value: TrustSignalTipDoc) =>
      persist.bundle.trustSignalTips.put(tipKey, value),
  };
  const workflowRules = {
    get: async (id: string) =>
      (await persist.bundle.workflowRules.get(id)) as WorkflowRule | undefined,
    put: async (id: string, value: WorkflowRule) =>
      persist.bundle.workflowRules.put(id, value),
  };
  const workflowRuleTips = {
    get: async (tipKey: string) =>
      (await persist.bundle.workflowRuleTips.get(tipKey)) as
        | WorkflowRuleTipDoc
        | undefined,
    put: async (tipKey: string, value: WorkflowRuleTipDoc) =>
      persist.bundle.workflowRuleTips.put(tipKey, value),
  };
  const preferenceEvidenceIndexes = {
    get: async (tipKey: string) =>
      (await persist.bundle.preferenceEvidenceIndexes.get(tipKey)) as
        | PreferenceEvidenceIndexDoc
        | undefined,
    put: async (tipKey: string, value: PreferenceEvidenceIndexDoc) =>
      persist.bundle.preferenceEvidenceIndexes.put(tipKey, value),
  };

  const learning = new LearningService({
    proposals,
    learnedContext: { get: learnedContext.get },
    intents: {
      getIntent: (id) => persist.bundle.intents.getIntent(id),
      getTip: (id) => persist.bundle.intents.getTip(id),
    },
  });

  const bus = new InMemoryPubSubBus();
  const http = createCloudRunHttpServer({
    config,
    bus,
    acceptedTopics: [],
    health: { ready: true },
    readinessProbe: () => persist.probeReadiness(),
    extraHealth: {
      persistence: persist.mode,
      firestoreClient: persist.firestoreClient ? "initialized" : "none",
      storeKind: persist.store.kind,
    },
    enableEvents: false,
    internalRoutes: [
      ...createLearningRoutes({
        proposals,
        events,
        learnedContext,
        preferenceRecords,
        preferenceTips,
        demoSessions,
        trustSignalTips,
        workflowRules,
        workflowRuleTips,
        preferenceEvidenceIndexes,
        resolveHistorical: (targetIntentId) =>
          learning.resolveHistorical(targetIntentId),
      }),
    ],
  });
  await http.listen();
  console.log(
    JSON.stringify({
      msg: "learning-service listening",
      service: config.serviceName,
      port: config.port,
    }),
  );
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
