import {
  consumeGrant,
  issueCommitToken,
} from "@truemandate/authority";
import { InMemoryPubSubBus } from "@truemandate/cloud-pubsub";
import {
  createCloudRunHttpServer,
  loadRuntimeConfig,
} from "@truemandate/cloud-runtime";
import {
  ErrorCode,
  LearningStatus,
  PreferenceRecordStatus,
  WorkflowRuleStatus,
  type LearnedContextRecord,
  type LearningProposal,
  type LearningProposalEvent,
  type PreferenceRecord,
  type WorkflowRule,
} from "@truemandate/protocol";
import { principalSubjectId } from "@truemandate/preference-core";
import { describe, expect, it } from "vitest";
import {
  createLearningRoutes,
  type DemoSessionDoc,
  type PreferenceEvidenceIndexDoc,
  type PreferenceTipDoc,
  type TrustSignalTipDoc,
  type WorkflowRuleTipDoc,
} from "./learning-routes.js";

const NOW = "2026-06-04T12:00:00.000Z";
const LATER = "2026-06-04T13:00:00.000Z";
const CALLER = { email: "human-learner@example.com" };
const CALLER_A = { email: "judge-a@example.com" };
const CALLER_B = { email: "judge-b@example.com" };
const AUTHORITY_CALLER = "authority@test.iam.gserviceaccount.com";
const OUTSIDER_CALLER = "outsider@test.iam.gserviceaccount.com";
const LEARNING_AUDIENCE = "https://learning-service.example.run.app";

const AGENT_RELIABILITY_CONTENT = {
  trustSignal: {
    subjectType: "AGENT",
    subjectId: "agent-1",
    domain: "procurement",
    value: 0.9,
    sampleSize: 10,
    basis: ["workflows_observed:10"],
    computedAt: NOW,
  },
};

class MemoryLearningStore {
  readonly proposals = new Map<string, LearningProposal>();
  readonly events = new Map<string, LearningProposalEvent>();
  readonly contexts = new Map<string, LearnedContextRecord>();
  readonly preferences = new Map<string, PreferenceRecord>();
  readonly tips = new Map<string, PreferenceTipDoc>();
  readonly demos = new Map<string, DemoSessionDoc>();
  readonly trustSignalTips = new Map<string, TrustSignalTipDoc>();
  readonly workflowRules = new Map<string, WorkflowRule>();
  readonly workflowRuleTips = new Map<string, WorkflowRuleTipDoc>();
  readonly evidenceIndexes = new Map<string, PreferenceEvidenceIndexDoc>();

  async getProposal(id: string): Promise<LearningProposal | undefined> {
    return this.proposals.get(id);
  }
  async putIfAbsentProposal(id: string, value: LearningProposal): Promise<boolean> {
    if (this.proposals.has(id)) return false;
    this.proposals.set(id, value);
    return true;
  }
  async putProposal(id: string, value: LearningProposal): Promise<void> {
    this.proposals.set(id, value);
  }
  async putEvent(id: string, value: LearningProposalEvent): Promise<boolean> {
    if (this.events.has(id)) return false;
    this.events.set(id, value);
    return true;
  }
  async getContext(id: string): Promise<LearnedContextRecord | undefined> {
    return this.contexts.get(id);
  }
  async putIfAbsentContext(id: string, value: LearnedContextRecord): Promise<boolean> {
    if (this.contexts.has(id)) return false;
    this.contexts.set(id, value);
    return true;
  }
}

function fixture() {
  const store = new MemoryLearningStore();
  const routes = createLearningRoutes({
    proposals: {
      get: (id) => store.getProposal(id),
      putIfAbsent: (id, value) => store.putIfAbsentProposal(id, value),
      put: (id, value) => store.putProposal(id, value),
    },
    events: { putIfAbsent: (id, value) => store.putEvent(id, value) },
    learnedContext: {
      get: (id) => store.getContext(id),
      putIfAbsent: (id, value) => store.putIfAbsentContext(id, value),
    },
    preferenceRecords: {
      get: async (id) => store.preferences.get(id),
      put: async (id, value) => {
        store.preferences.set(id, value);
      },
    },
    preferenceTips: {
      get: async (tipKey) => store.tips.get(tipKey),
      put: async (tipKey, value) => {
        store.tips.set(tipKey, value);
      },
    },
    demoSessions: {
      get: async (id) => store.demos.get(id),
      putIfAbsent: async (id, value) => {
        if (store.demos.has(id)) return false;
        store.demos.set(id, value);
        return true;
      },
    },
    trustSignalTips: {
      get: async (tipKey) => store.trustSignalTips.get(tipKey),
      put: async (tipKey, value) => {
        store.trustSignalTips.set(tipKey, value);
      },
    },
    workflowRules: {
      get: async (id) => store.workflowRules.get(id),
      put: async (id, value) => {
        store.workflowRules.set(id, value);
      },
    },
    workflowRuleTips: {
      get: async (tipKey) => store.workflowRuleTips.get(tipKey),
      put: async (tipKey, value) => {
        store.workflowRuleTips.set(tipKey, value);
      },
    },
    preferenceEvidenceIndexes: {
      get: async (tipKey) => store.evidenceIndexes.get(tipKey),
      put: async (tipKey, value) => {
        store.evidenceIndexes.set(tipKey, value);
      },
    },
    now: () => LATER,
  });
  const createRoute = routes.find((r) => r.pattern === "/internal/learning-proposals")!;
  const confirmRoute = routes.find(
    (r) => r.pattern === "/internal/learning-proposals/:id/confirm",
  )!;
  const rejectRoute = routes.find(
    (r) => r.pattern === "/internal/learning-proposals/:id/reject",
  )!;
  const getRoute = routes.find(
    (r) => r.pattern === "/internal/learning-proposals/:id",
  )!;
  const getContextRoute = routes.find(
    (r) => r.pattern === "/internal/learned-context/:id",
  )!;
  const demoRoute = routes.find((r) => r.pattern === "/internal/demo-sessions")!;
  const prefRoute = routes.find(
    (r) => r.pattern === "/internal/preferences/:subjectId/:domain/:concept",
  )!;
  const trustRoute = routes.find(
    (r) => r.pattern === "/internal/trust-signals/:subjectType/:subjectId/:domain",
  )!;
  const ruleRoute = routes.find(
    (r) => r.pattern === "/internal/workflow-rules/:subjectId/:domain/:concept",
  )!;
  const evidenceRoute = routes.find(
    (r) => r.pattern === "/internal/workflow-rules/evidence",
  )!;
  return {
    store,
    createRoute,
    confirmRoute,
    rejectRoute,
    getRoute,
    getContextRoute,
    demoRoute,
    prefRoute,
    trustRoute,
    ruleRoute,
    evidenceRoute,
  };
}

async function createAndConfirmPreference(
  f: ReturnType<typeof fixture>,
  input: {
    readonly id: string;
    readonly caller: { email: string };
    readonly domain: string;
    readonly concept: string;
    readonly value: unknown;
    readonly origin: "EXPLICIT_USER_INPUT" | "CONFIRMED_LEARNING";
  },
) {
  const subjectId = principalSubjectId(input.caller.email);
  const created = await f.createRoute.handler({
    body: {
      id: input.id,
      principalId: input.caller.email,
      domain: input.domain,
      proposalType: "USER_PREFERENCE",
      content: {
        subjectId,
        concept: input.concept,
        value: input.value,
        origin: input.origin,
      },
      createdAt: NOW,
    },
    headers: {},
    params: {},
    caller: input.caller,
  });
  expect(created.status).toBe(200);
  const confirmed = await f.confirmRoute.handler({
    body: { reason: "ok" },
    headers: {},
    params: { id: input.id },
    caller: input.caller,
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body as {
    proposal: LearningProposal;
    learnedContext: LearnedContextRecord;
    preferenceRecord: PreferenceRecord;
  };
}

describe("learning-service routes", () => {
  it("allows the authority caller to read adaptive signals and blocks other callers", async () => {
    const f = fixture();
    const created = await f.createRoute.handler({
      body: {
        id: "learn-route-auth-1",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    expect(created.status).toBe(200);
    const confirmed = await f.confirmRoute.handler({
      body: { reason: "confirmed" },
      headers: {},
      params: { id: "learn-route-auth-1" },
      caller: CALLER,
    });
    expect(confirmed.status).toBe(200);

    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "true",
      TM_SERVICE_NAME: "learning-service",
      GOOGLE_CLOUD_PROJECT: "test-proj",
      TM_REQUIRE_INTERNAL_AUTH: "true",
      TM_INTERNAL_AUTH_VERIFY: "true",
      TM_INTERNAL_AUTH_AUDIENCE: LEARNING_AUDIENCE,
      TM_INTERNAL_ALLOWED_CALLERS: AUTHORITY_CALLER,
      PORT: "0",
      HOST: "127.0.0.1",
    });
    const routes = createLearningRoutes({
      proposals: {
        get: (id) => f.store.getProposal(id),
        putIfAbsent: (id, value) => f.store.putIfAbsentProposal(id, value),
        put: (id, value) => f.store.putProposal(id, value),
      },
      events: { putIfAbsent: (id, value) => f.store.putEvent(id, value) },
      learnedContext: {
        get: (id) => f.store.getContext(id),
        putIfAbsent: (id, value) => f.store.putIfAbsentContext(id, value),
      },
      preferenceRecords: {
        get: async (id) => f.store.preferences.get(id),
        put: async (id, value) => {
          f.store.preferences.set(id, value);
        },
      },
      preferenceTips: {
        get: async (tipKey) => f.store.tips.get(tipKey),
        put: async (tipKey, value) => {
          f.store.tips.set(tipKey, value);
        },
      },
      demoSessions: {
        get: async (id) => f.store.demos.get(id),
        putIfAbsent: async (id, value) => {
          if (f.store.demos.has(id)) return false;
          f.store.demos.set(id, value);
          return true;
        },
      },
      trustSignalTips: {
        get: async (tipKey) => f.store.trustSignalTips.get(tipKey),
        put: async (tipKey, value) => {
          f.store.trustSignalTips.set(tipKey, value);
        },
      },
      workflowRules: {
        get: async (id) => f.store.workflowRules.get(id),
        put: async (id, value) => {
          f.store.workflowRules.set(id, value);
        },
      },
      workflowRuleTips: {
        get: async (tipKey) => f.store.workflowRuleTips.get(tipKey),
        put: async (tipKey, value) => {
          f.store.workflowRuleTips.set(tipKey, value);
        },
      },
      preferenceEvidenceIndexes: {
        get: async (tipKey) => f.store.evidenceIndexes.get(tipKey),
        put: async (tipKey, value) => {
          f.store.evidenceIndexes.set(tipKey, value);
        },
      },
      now: () => LATER,
    });
    const makeServer = (email: string) =>
      createCloudRunHttpServer({
        config,
        bus: new InMemoryPubSubBus(),
        acceptedTopics: [],
        health: { ready: true },
        enableEvents: false,
        identityVerifier: { verify: async () => ({ email }) },
        internalRoutes: [...routes],
      });

    const allowedServer = makeServer(AUTHORITY_CALLER);
    await allowedServer.listen();
    const allowedAddr = allowedServer.server.address();
    const allowedPort = typeof allowedAddr === "object" && allowedAddr ? allowedAddr.port : 0;
    const allowed = await fetch(
      `http://127.0.0.1:${allowedPort}/internal/trust-signals/AGENT/agent-1/procurement`,
      { method: "GET", headers: { Authorization: "Bearer header.payload.signature" } },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      trustSignal: {
        subjectType: "AGENT",
        subjectId: "agent-1",
        domain: "procurement",
      },
    });
    await allowedServer.close();

    const deniedServer = makeServer(OUTSIDER_CALLER);
    await deniedServer.listen();
    const deniedAddr = deniedServer.server.address();
    const deniedPort = typeof deniedAddr === "object" && deniedAddr ? deniedAddr.port : 0;
    const denied = await fetch(
      `http://127.0.0.1:${deniedPort}/internal/trust-signals/AGENT/agent-1/procurement`,
      { method: "GET", headers: { Authorization: "Bearer header.payload.signature" } },
    );
    expect(denied.status).toBe(403);
    await deniedServer.close();
  });

  it("creates, confirms, and stores durable learned context", async () => {
    const f = fixture();
    const created = await f.createRoute.handler({
      body: {
        id: "learn-route-1",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      id: "learn-route-1",
      status: LearningStatus.PROPOSED,
      requiresConfirmation: true,
    });
    expect(f.store.events.has("learning-event-learn-route-1-proposed")).toBe(true);

    const confirmed = await f.confirmRoute.handler({
      body: { reason: "human ok" },
      headers: {},
      params: { id: "learn-route-1" },
      caller: CALLER,
    });
    expect(confirmed.status).toBe(200);
    const body = confirmed.body as {
      proposal: LearningProposal;
      learnedContext: LearnedContextRecord;
    };
    expect(body.proposal.status).toBe(LearningStatus.CONFIRMED);
    expect(body.proposal.decidedBy).toBe(CALLER.email);
    expect(body.learnedContext.learningProposalId).toBe("learn-route-1");

    const getContext = await f.getContextRoute.handler({
      body: undefined,
      headers: {},
      params: { id: body.learnedContext.id },
    });
    expect(getContext.status).toBe(200);
  });

  it("writes and reads the latest confirmed trust tip for AGENT_RELIABILITY", async () => {
    const f = fixture();
    const created = await f.createRoute.handler({
      body: {
        id: "learn-trust-tip",
        principalId: CALLER.email,
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER,
    });
    expect(created.status).toBe(200);
    const confirmed = await f.confirmRoute.handler({
      body: { reason: "ok" },
      headers: {},
      params: { id: "learn-trust-tip" },
      caller: CALLER,
    });
    expect(confirmed.status).toBe(200);

    const read = await f.trustRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectType: "AGENT",
        subjectId: "agent-1",
        domain: "procurement",
      },
    });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      learnedContext: { learningProposalId: "learn-trust-tip" },
      trustSignal: {
        subjectType: "AGENT",
        subjectId: "agent-1",
        domain: "procurement",
      },
    });
  });

  it("trust tip lookup returns null on subject/domain mismatch", async () => {
    const f = fixture();
    const created = await f.createRoute.handler({
      body: {
        id: "learn-trust-mismatch",
        principalId: CALLER.email,
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER,
    });
    expect(created.status).toBe(200);
    const confirmed = await f.confirmRoute.handler({
      body: { reason: "ok" },
      headers: {},
      params: { id: "learn-trust-mismatch" },
      caller: CALLER,
    });
    expect(confirmed.status).toBe(200);

    const wrongDomain = await f.trustRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectType: "AGENT",
        subjectId: "agent-1",
        domain: "travel",
      },
    });
    expect(wrongDomain.status).toBe(200);
    expect(wrongDomain.body).toEqual({ learnedContext: null, trustSignal: null });
  });

  it("rejects without writing learned context", async () => {
    const f = fixture();
    await f.createRoute.handler({
      body: {
        id: "learn-route-reject",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    const rejected = await f.rejectRoute.handler({
      body: { reason: "no" },
      headers: {},
      params: { id: "learn-route-reject" },
      caller: CALLER,
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ status: LearningStatus.REJECTED });
    expect(f.store.contexts.size).toBe(0);
  });

  it("requires verified caller identity for confirm", async () => {
    const f = fixture();
    await f.createRoute.handler({
      body: {
        id: "learn-route-auth",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    const confirmed = await f.confirmRoute.handler({
      body: {},
      headers: {},
      params: { id: "learn-route-auth" },
    });
    expect(confirmed.status).toBe(400);
    expect(confirmed.body).toMatchObject({ error: ErrorCode.VALIDATION_FAILED });
  });

  it("blocks expanding proposedScope on create (INV_015)", async () => {
    const f = fixture();
    const response = await f.createRoute.handler({
      body: {
        id: "learn-expand",
        principalId: CALLER.email,
        domain: "procurement",
        proposalType: "WORKFLOW_RULE",
        content: {
          subjectId: principalSubjectId(CALLER.email),
          concept: "refundable",
          action: { prefer: true },
          evidenceRefs: ["lp-1", "lp-2", "lp-3"],
          basis: ["a", "b", "c"],
          currentScope: {
            capabilities: { execute_payment: "ALLOW" },
            maxAmount: 1000,
            currency: "INR",
          },
          proposedScope: {
            capabilities: { execute_payment: "ALLOW" },
            maxAmount: 999999,
            currency: "INR",
          },
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ErrorCode.CRITICAL_FAILURE_CANNOT_EXPAND_AUTHORITY,
    });
  });

  it("LearnedContextRecord cannot feed privilege helpers (no learning surface)", () => {
    expect(issueCommitToken.toString()).not.toMatch(/LearningProposal|LearnedContext/);
    expect(consumeGrant.toString()).not.toMatch(/LearningProposal|LearnedContext/);
  });

  it("get returns durable proposal", async () => {
    const f = fixture();
    await f.createRoute.handler({
      body: {
        id: "learn-get",
        principalId: "principal-1",
        domain: "procurement",
        proposalType: "AGENT_RELIABILITY",
        content: AGENT_RELIABILITY_CONTENT,
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    const got = await f.getRoute.handler({
      body: undefined,
      headers: {},
      params: { id: "learn-get" },
    });
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ id: "learn-get", status: LearningStatus.PROPOSED });
  });
});

describe("Wave 3.8 preference memory routes", () => {
  it("rejects USER_PREFERENCE with mismatched subjectId", async () => {
    const f = fixture();
    const response = await f.createRoute.handler({
      body: {
        id: "pref-mismatch",
        principalId: CALLER_A.email,
        domain: "TRAVEL",
        proposalType: "USER_PREFERENCE",
        content: {
          subjectId: principalSubjectId(CALLER_B.email),
          concept: "refundable",
          value: true,
          origin: "EXPLICIT_USER_INPUT",
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER_A,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
    });
  });

  it("isolates preferences by subject and domain", async () => {
    const f = fixture();
    await createAndConfirmPreference(f, {
      id: "pref-a-travel",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: true,
      origin: "EXPLICIT_USER_INPUT",
    });
    await createAndConfirmPreference(f, {
      id: "pref-b-travel",
      caller: CALLER_B,
      domain: "TRAVEL",
      concept: "refundable",
      value: false,
      origin: "EXPLICIT_USER_INPUT",
    });
    await createAndConfirmPreference(f, {
      id: "pref-a-proc",
      caller: CALLER_A,
      domain: "PROCUREMENT",
      concept: "refundable",
      value: "n/a",
      origin: "EXPLICIT_USER_INPUT",
    });

    const aTravel = await f.prefRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    const bTravel = await f.prefRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_B.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    const aProc = await f.prefRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "PROCUREMENT",
        concept: "refundable",
      },
    });

    expect((aTravel.body as { preference: PreferenceRecord }).preference.value).toBe(
      true,
    );
    expect((bTravel.body as { preference: PreferenceRecord }).preference.value).toBe(
      false,
    );
    expect((aProc.body as { preference: PreferenceRecord }).preference.value).toBe(
      "n/a",
    );
  });

  it("explicit correction supersedes older preference", async () => {
    const f = fixture();
    await createAndConfirmPreference(f, {
      id: "pref-old",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: true,
      origin: "EXPLICIT_USER_INPUT",
    });
    const newer = await createAndConfirmPreference(f, {
      id: "pref-new",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: false,
      origin: "EXPLICIT_USER_INPUT",
    });
    expect(newer.preferenceRecord.status).toBe(PreferenceRecordStatus.ACTIVE);
    expect(newer.preferenceRecord.value).toBe(false);
    expect(newer.preferenceRecord.supersedesId).toBe("pref-pref-old");

    const tip = await f.prefRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    expect((tip.body as { preference: PreferenceRecord }).preference.id).toBe(
      "pref-pref-new",
    );
  });

  it("learned cannot silently supersede active explicit preference", async () => {
    const f = fixture();
    await createAndConfirmPreference(f, {
      id: "pref-explicit",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "window_seat",
      value: true,
      origin: "EXPLICIT_USER_INPUT",
    });
    const learned = await createAndConfirmPreference(f, {
      id: "pref-learned",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "window_seat",
      value: false,
      origin: "CONFIRMED_LEARNING",
    });
    expect(learned.preferenceRecord.status).toBe(PreferenceRecordStatus.SUPERSEDED);
    expect(learned.preferenceRecord.supersededById).toBe("pref-pref-explicit");

    const tip = await f.prefRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "window_seat",
      },
    });
    const pref = (tip.body as { preference: PreferenceRecord }).preference;
    expect(pref.id).toBe("pref-pref-explicit");
    expect(pref.value).toBe(true);
  });

  it("demo session isolation binds subjectId to allocated session", async () => {
    const f = fixture();
    const demo = await f.demoRoute.handler({
      body: {},
      headers: {},
      params: {},
    });
    expect(demo.status).toBe(200);
    const demoBody = demo.body as {
      demoSessionId: string;
      subjectId: string;
    };

    const created = await f.createRoute.handler({
      body: {
        id: "pref-demo",
        principalId: "anonymous",
        domain: "TRAVEL",
        proposalType: "USER_PREFERENCE",
        demoSessionId: demoBody.demoSessionId,
        content: {
          subjectId: demoBody.subjectId,
          concept: "refundable",
          value: true,
          origin: "EXPLICIT_USER_INPUT",
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    expect(created.status).toBe(200);

    const mismatched = await f.createRoute.handler({
      body: {
        id: "pref-demo-bad",
        principalId: "anonymous",
        domain: "TRAVEL",
        proposalType: "USER_PREFERENCE",
        demoSessionId: demoBody.demoSessionId,
        content: {
          subjectId: "demo:other-session",
          concept: "refundable",
          value: true,
          origin: "EXPLICIT_USER_INPUT",
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body).toMatchObject({
      error: ErrorCode.PREFERENCE_SUBJECT_MISMATCH,
    });
  });
});

async function createAndConfirmWorkflowRule(
  f: ReturnType<typeof fixture>,
  input: {
    readonly id: string;
    readonly caller: { email: string };
    readonly domain: string;
    readonly concept: string;
    readonly action: unknown;
    readonly evidenceRefs: readonly string[];
    readonly basis: readonly string[];
  },
) {
  const subjectId = principalSubjectId(input.caller.email);
  const created = await f.createRoute.handler({
    body: {
      id: input.id,
      principalId: input.caller.email,
      domain: input.domain,
      proposalType: "WORKFLOW_RULE",
      content: {
        subjectId,
        concept: input.concept,
        action: input.action,
        evidenceRefs: [...input.evidenceRefs],
        basis: [...input.basis],
      },
      createdAt: NOW,
    },
    headers: {},
    params: {},
    caller: input.caller,
  });
  expect(created.status).toBe(200);
  const confirmed = await f.confirmRoute.handler({
    body: { reason: "ok" },
    headers: {},
    params: { id: input.id },
    caller: input.caller,
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body as {
    proposal: LearningProposal;
    learnedContext: LearnedContextRecord;
    workflowRule: WorkflowRule;
  };
}

describe("Wave 3.9 workflow-rule learning routes", () => {
  it("rejects WORKFLOW_RULE with mismatched subjectId", async () => {
    const f = fixture();
    const response = await f.createRoute.handler({
      body: {
        id: "wr-mismatch",
        principalId: CALLER_A.email,
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: {
          subjectId: principalSubjectId(CALLER_B.email),
          concept: "refundable",
          action: { prefer: true },
          evidenceRefs: ["lp-1", "lp-2", "lp-3"],
          basis: ["a", "b", "c"],
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER_A,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ErrorCode.WORKFLOW_RULE_SUBJECT_MISMATCH,
    });
  });

  it("rejects WORKFLOW_RULE with insufficient evidence", async () => {
    const f = fixture();
    const response = await f.createRoute.handler({
      body: {
        id: "wr-thin",
        principalId: CALLER_A.email,
        domain: "TRAVEL",
        proposalType: "WORKFLOW_RULE",
        content: {
          subjectId: principalSubjectId(CALLER_A.email),
          concept: "refundable",
          action: { prefer: true },
          evidenceRefs: ["lp-1", "lp-2"],
          basis: ["a", "b"],
        },
        createdAt: NOW,
      },
      headers: {},
      params: {},
      caller: CALLER_A,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ErrorCode.WORKFLOW_RULE_INSUFFICIENT_EVIDENCE,
    });
  });

  it("confirm persists WorkflowRule v1 and tip; second confirm supersedes to v2", async () => {
    const f = fixture();
    const first = await createAndConfirmWorkflowRule(f, {
      id: "wr-v1",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      action: { prefer: true },
      evidenceRefs: ["lp-1", "lp-2", "lp-3"],
      basis: ["a", "b", "c"],
    });
    expect(first.workflowRule.version).toBe(1);
    expect(first.workflowRule.status).toBe(WorkflowRuleStatus.ACTIVE);

    const second = await createAndConfirmWorkflowRule(f, {
      id: "wr-v2",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      action: { prefer: false },
      evidenceRefs: ["lp-4", "lp-5", "lp-6"],
      basis: ["d", "e", "f"],
    });
    expect(second.workflowRule.version).toBe(2);
    expect(second.workflowRule.supersedesId).toBe("wr-wr-v1");
    expect(f.store.workflowRules.get("wr-wr-v1")?.status).toBe(
      WorkflowRuleStatus.SUPERSEDED,
    );

    const tip = await f.ruleRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    expect((tip.body as { workflowRule: WorkflowRule }).workflowRule.id).toBe(
      "wr-wr-v2",
    );
  });

  it("isolates workflow rules by subject and domain", async () => {
    const f = fixture();
    await createAndConfirmWorkflowRule(f, {
      id: "wr-a",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      action: { prefer: true },
      evidenceRefs: ["lp-1", "lp-2", "lp-3"],
      basis: ["a", "b", "c"],
    });
    await createAndConfirmWorkflowRule(f, {
      id: "wr-b",
      caller: CALLER_B,
      domain: "TRAVEL",
      concept: "refundable",
      action: { prefer: false },
      evidenceRefs: ["lp-1", "lp-2", "lp-3"],
      basis: ["a", "b", "c"],
    });

    const a = await f.ruleRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    const b = await f.ruleRoute.handler({
      body: undefined,
      headers: {},
      params: {
        subjectId: principalSubjectId(CALLER_B.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
    });
    expect((a.body as { workflowRule: WorkflowRule }).workflowRule.action).toEqual({
      prefer: true,
    });
    expect((b.body as { workflowRule: WorkflowRule }).workflowRule.action).toEqual({
      prefer: false,
    });
  });

  it("evidence derivation route returns refs/basis from preference history", async () => {
    const f = fixture();
    await createAndConfirmPreference(f, {
      id: "ev-1",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: true,
      origin: "EXPLICIT_USER_INPUT",
    });
    await createAndConfirmPreference(f, {
      id: "ev-2",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: true,
      origin: "CONFIRMED_LEARNING",
    });
    await createAndConfirmPreference(f, {
      id: "ev-3",
      caller: CALLER_A,
      domain: "TRAVEL",
      concept: "refundable",
      value: false,
      origin: "EXPLICIT_USER_INPUT",
    });

    const derived = await f.evidenceRoute.handler({
      body: {
        subjectId: principalSubjectId(CALLER_A.email),
        domain: "TRAVEL",
        concept: "refundable",
      },
      headers: {},
      params: {},
    });
    expect(derived.status).toBe(200);
    const body = derived.body as {
      evidenceRefs: string[];
      basis: string[];
      sufficient: boolean;
    };
    expect(body.evidenceRefs).toEqual(["ev-1", "ev-2", "ev-3"]);
    expect(body.basis).toHaveLength(3);
    expect(body.sufficient).toBe(true);
  });
});
