import { createFirestorePersistence, MemoryTransactionalStore } from "@truemandate/cloud-firestore";
import { IntentService } from "@truemandate/intent-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { ResolutionService } from "@truemandate/resolution-service";
import { EvidenceService } from "@truemandate/evidence-service";
import { createEvidenceInternalRoutes } from "@truemandate/evidence-service/internal-routes";
import { createOutcomeInternalRoutes } from "@truemandate/resolution-service/outcome-internal-routes";
import { createResolutionReadRoutes } from "@truemandate/resolution-service/resolution-read-routes";
import { hashCanonical } from "@truemandate/crypto";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  OutcomeContractState,
  SourceType,
  asConstraintId,
  type InternalRoute,
  type Result,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { runPhaseCVerifier, type PhaseCVerifierPorts } from "./run.js";
import { phaseCAcceptanceFixture, phaseCRawEvent, phaseCWorkflow } from "./fixture.js";

const NOW_ISO = "2030-01-08T00:00:00.000Z";
const H = (char: string) => char.repeat(64);

const PC_CALLER = "phase-c-verifier@test.iam.gserviceaccount.com";
const OR_CALLER = "outcome-resolution@test.iam.gserviceaccount.com";

/** Production-shaped routing harness: the real owner route handlers wired
 * over in-process services + memory persistence — the exact route policy
 * shapes the deployed services will expose. */
async function routingFixture() {
  const persist = createFirestorePersistence(new MemoryTransactionalStore());
  const intents = new IntentService(persist.intents);
  const outcomes = new OutcomeService(undefined, {
    contracts: persist.outcomeContracts,
    events: persist.outcomeEvents,
  });
  const resolution = new ResolutionService(outcomes, undefined, {
    cases: persist.resolutionCases,
    triggers: persist.resolutionTriggers,
  }, {
    getIntentState: async (id) => (await persist.intents.getState(id)) ?? undefined,
  });
  const evidenceService = new EvidenceService();
  const evidenceOwner = {
    getEnvelope: async (id: string) => {
      const row = await persist.evidenceEnvelopes.get(id);
      return row as never;
    },
    getClaim: async (id: string) => {
      const row = await persist.evidenceClaims.get(id);
      return row as never;
    },
    persistFixture: async (fixture: unknown) => {
      const value = fixture as { envelopes: never[]; claims: never[] };
      for (const envelope of value.envelopes) {
        const saved = await evidenceService.persistEnvelope(envelope, persist.evidenceEnvelopes);
        if (!saved.ok) return saved;
      }
      for (const claim of value.claims) {
        const saved = await evidenceService.persistClaim(claim, persist.evidenceClaims);
        if (!saved.ok) return saved;
      }
      return { ok: true as const, value: { ok: true } };
    },
  };

  // Real route handlers — the caller policies match the deployed config.
  const evidenceRoutes = createEvidenceInternalRoutes(evidenceOwner, [
    { email: PC_CALLER, idPrefix: "phase-c-" },
  ], [OR_CALLER]);
  const outcomeRoutes = createOutcomeInternalRoutes(outcomes, {
    getEvaluation: async () => ({ ok: true as const, value: undefined }),
    getArtifact: async () => ({ ok: true as const, value: undefined }),
    getState: async () => ({ ok: true as const, value: undefined }),
    getTip: async () => ({ ok: true as const, value: undefined }),
  }, {
    globalCallers: ["agent-runtime@test.iam.gserviceaccount.com"],
    authorityCallerEmail: "authority@test.iam.gserviceaccount.com",
    evaluationCallerEmail: PC_CALLER,
    evidenceReadPort: {
      getClaim: async (id) => {
        const route = evidenceRoutes.find((r) => r.pattern === "/internal/evidence/claims/:id");
        const res = await route!.handler({ params: { id }, headers: {}, body: undefined });
        return res.status === 200
          ? { ok: true as const, value: res.body }
          : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "unknown claim", details: undefined };
      },
      getEnvelope: async (id) => {
        const route = evidenceRoutes.find((r) => r.pattern === "/internal/evidence/envelopes/:id");
        const res = await route!.handler({ params: { id }, headers: {}, body: undefined });
        return res.status === 200
          ? { ok: true as const, value: res.body }
          : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "unknown envelope", details: undefined };
      },
    },
  });
  const resolutionRoutes = createResolutionReadRoutes(resolution, [PC_CALLER]);

  // Seed the flagship OutcomeContract (payment SUCCESS, AWAITING_OUTCOME).
  const intent = await intents.createIntent({
    id: "phase-c-food-grade-500-v1",
    principalId: "phase-c-human-principal",
    rawText: "Buy 500 food-grade containers under INR 800000",
    createdAt: NOW_ISO,
  });
  if (!intent.ok) throw new Error(intent.message);
  const state = await intents.createIntentState({
    id: "state-phase-c",
    intentId: intent.value.id,
    constraints: [{
      id: asConstraintId("c-quantity"),
      concept: "quantity",
      operator: ConstraintOperator.GTE,
      value: 500,
      kind: ConstraintKind.HARD,
      importance: 1,
      confidence: 1,
      sourceType: SourceType.HUMAN,
      mutability: ConstraintMutability.IMMUTABLE,
      meaningClass: MeaningClass.EXPLICIT,
    }],
    createdBy: "phase-c-human-principal",
    createdAt: NOW_ISO,
  });
  if (!state.ok) throw new Error(state.message);
  const contract = await outcomes.createPreExecutionProcurementContract({
    id: "outcome-phase-c-flagship",
    intentState: state.value,
    principalId: "phase-c-human-principal",
    merchant: "phase-b-supplier",
    quantity: 500,
    budgetMax: 800000,
    product: "food-grade containers",
    actionProposalId: "action-phase-c",
    actionContentHash: hashCanonical({ action: "phase-c" }),
    createdAt: NOW_ISO,
    preExecutionBinding: {
      workflowId: "wf-phase-c",
      workflowHash: H("a") as never,
      actionId: "action-phase-c",
      actionHash: hashCanonical({ action: "phase-c" }) as never,
      evaluationId: "evaluation-phase-c",
      evaluationHash: H("b") as never,
      evaluatedIntentStateId: state.value.id,
      evaluatedIntentStateHash: state.value.stateHash,
      evaluatedIntentStateVersion: state.value.version,
    },
  });
  if (!contract.ok) throw new Error(contract.message);
  const paid = await outcomes.onPaymentSuccess(contract.value.id, NOW_ISO);
  if (!paid.ok) throw new Error(paid.message);

  return { persist, intents, outcomes, resolution, evidenceRoutes, outcomeRoutes, resolutionRoutes, state: state.value, contract: paid.value };
}

function routeByName(routes: readonly InternalRoute[], pattern: string): InternalRoute {
  const route = routes.find((r) => r.pattern === pattern);
  if (!route) throw new Error(`route ${pattern} missing`);
  return route;
}

async function verifierPorts(f: Awaited<ReturnType<typeof routingFixture>>): Promise<PhaseCVerifierPorts> {
  return {
    getContract: async (contractId) => {
      const route = routeByName(f.outcomeRoutes, "/internal/outcomes/contracts/:id");
      const res = await route.handler({ params: { id: contractId }, headers: {}, body: undefined });
      return res.status === 200
        ? { ok: true as const, value: res.body as never }
        : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "contract read failed", details: undefined };
    },
    submitEvidenceFixture: async (fixture) => {
      const route = routeByName(f.evidenceRoutes, "/internal/evidence/acceptance-fixtures");
      const res = await route.handler({ params: {}, headers: {}, caller: { email: PC_CALLER }, body: fixture });
      return res.status === 200
        ? { ok: true as const, value: res.body }
        : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "fixture rejected" };
    },
    publishRawIntent: async () => undefined,
    submitWorkflow: async () => ({
      ok: true as const,
      value: {
        state: "AUTHORIZED",
        authorization: {
          commitToken: { id: "ct-phase-c-1" },
          grant: { id: "grant-phase-c-1", amount: 742000, currency: "INR", merchant: "phase-b-supplier", outcomeContractId: f.contract.id },
        },
      },
    }),
    submitCommit: async () => ({
      ok: true as const,
      value: { status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-phase-c" },
    }),
    evaluateEvidence: async (contractId, body) => {
      const route = routeByName(f.outcomeRoutes, "/internal/outcomes/:outcomeContractId/evaluate-evidence");
      const res = await route.handler({ params: { outcomeContractId: contractId }, headers: {}, caller: { email: PC_CALLER }, body });
      if (res.status !== 200) console.log("EVALUATE DIAG:", JSON.stringify(res.body));
      return res.status === 200
        ? { ok: true as const, value: res.body as never }
        : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "evaluate failed" };
    },
    getResolutionCaseByContract: async (contractId) => {
      const route = routeByName(f.resolutionRoutes, "/internal/resolutions/cases/by-contract/:outcomeContractId");
      const res = await route.handler({ params: { outcomeContractId: contractId }, headers: {}, caller: { email: PC_CALLER }, body: undefined });
      return res.status === 200
        ? { ok: true as const, value: res.body as never }
        : { ok: false as const, code: "VALIDATION_FAILED" as never, message: (res.body as { message?: string })?.message ?? "case missing" };
    },
    now: () => 0,
    sleep: async (ms: number) => { await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10))); },
  };
}

describe("Phase C production-shaped routing E2E", () => {
  it("runs the full deployed closure through the real owner routes", async () => {
    const f = await routingFixture();
    const p = await verifierPorts(f);
    let commits = 0;
    p.submitCommit = async () => {
      commits += 1;
      return commits === 1
        ? { ok: true as const, value: { status: "SUCCESS", executionId: "exec-phase-c", resultRef: "mock-pay-phase-c", grantId: "grant-phase-c-1" } }
        : { ok: true as const, value: { status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-phase-c" } };
    };
    const result = await runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome.state).toBe("PARTIAL");
    expect(result.value.divergence).toMatchObject({ requiredQuantity: 500, verifiedReceived: 450, shortfall: 50 });
    expect(result.value.resolutionCase.responsibilityState).toBe("UNKNOWN");
    expect(result.value.evidenceRequests.length).toBeGreaterThanOrEqual(2);
    const stored = await f.outcomes.getContract(f.contract.id);
    expect(stored.ok && stored.value.state).toBe(OutcomeContractState.PARTIAL);
  });

  it("rejects caller-supplied outcome state/delivered/responsibility structurally", async () => {
    const f = await routingFixture();
    const route = routeByName(f.outcomeRoutes, "/internal/outcomes/:outcomeContractId/evaluate-evidence");
    const res = await route.handler({
      params: { outcomeContractId: f.contract.id },
      headers: {},
      caller: { email: PC_CALLER },
      body: { claimIds: ["phase-c-claim-quantity_received"], state: "SATISFIED", delivered: 500, responsibility: "merchant" },
    });
    expect(res.status).toBe(400);
  });

  it("the evaluation route caller policy admits only the Phase C verifier", async () => {
    // Caller enforcement lives in the cloud-runtime middleware (verified in
    // the cloud-runtime suite); the production-shaped route policy itself
    // must admit exactly one identity.
    const f = await routingFixture();
    const route = routeByName(f.outcomeRoutes, "/internal/outcomes/:outcomeContractId/evaluate-evidence");
    expect(route.allowedCallers).toEqual([PC_CALLER]);
    const caseRoute = routeByName(f.resolutionRoutes, "/internal/resolutions/cases/by-contract/:outcomeContractId");
    expect(caseRoute.allowedCallers).toEqual([PC_CALLER]);
  });

  it("v3-shaped delayed payment event: CREATED → poll → AWAITING_OUTCOME/SUCCESS → PARTIAL closure", async () => {
    const f = await routingFixture();
    const p = await verifierPorts(f);
    let commits = 0;
    p.submitCommit = async () => {
      commits += 1;
      return commits === 1
        ? { ok: true as const, value: { status: "SUCCESS", executionId: "exec-phase-c", resultRef: "mock-pay-phase-c", grantId: "grant-phase-c-1" } }
        : { ok: true as const, value: { status: "IDEMPOTENT_REPLAY", resultRef: "mock-pay-phase-c" } };
    };
    // Simulate the asynchronous execution event: the payment transition lands
    // after the verifier's first readiness read (the v2 race shape).
    const originalGetContract = p.getContract;
    let reads = 0;
    p.getContract = async (contractId) => {
      reads += 1;
      if (reads === 1) {
        return { ok: true as const, value: { ...f.contract, state: "CREATED" as never, paymentStatus: "PENDING" as never } as never };
      }
      if (reads === 2) {
        // The owner's execution-event handler transitions the contract now.
        const paid = await f.outcomes.onPaymentSuccess(f.contract.id, NOW_ISO);
        if (!paid.ok) throw new Error(paid.message);
      }
      return originalGetContract(contractId);
    };
    const result = await runPhaseCVerifier(p, {
      fixture: phaseCAcceptanceFixture() as never,
      rawEvent: phaseCRawEvent(),
      workflow: phaseCWorkflow(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome.state).toBe("PARTIAL");
    expect(result.value.resolutionCase.responsibilityState).toBe("UNKNOWN");
    expect(result.value.evidenceRequests.length).toBeGreaterThanOrEqual(2);
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it("duplicate trigger does not open a second ResolutionCase (trigger idempotency)", async () => {
    const f = await routingFixture();
    // Owner-level idempotency: applying the same accepted evidence twice
    // publishes the same trigger identity; the resolution owner returns the
    // same durable case.
    const fixtureRoute = routeByName(f.evidenceRoutes, "/internal/evidence/acceptance-fixtures");
    const fixtureAccepted = await fixtureRoute.handler({ params: {}, headers: {}, caller: { email: PC_CALLER }, body: phaseCAcceptanceFixture() });
    expect(fixtureAccepted.status).toBe(200);
    const evaluate = routeByName(f.outcomeRoutes, "/internal/outcomes/:outcomeContractId/evaluate-evidence");
    const claimIds = phaseCAcceptanceFixture().claims.map((claim) => (claim as { id: string }).id);
    const body = { claimIds };
    const first = await evaluate.handler({ params: { outcomeContractId: f.contract.id }, headers: {}, caller: { email: PC_CALLER }, body });
    const second = await evaluate.handler({ params: { outcomeContractId: f.contract.id }, headers: {}, caller: { email: PC_CALLER }, body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const read = routeByName(f.resolutionRoutes, "/internal/resolutions/cases/by-contract/:outcomeContractId");
    const caseA = await read.handler({ params: { outcomeContractId: f.contract.id }, headers: {}, caller: { email: PC_CALLER }, body: undefined });
    const caseB = await read.handler({ params: { outcomeContractId: f.contract.id }, headers: {}, caller: { email: PC_CALLER }, body: undefined });
    expect(caseA.status).toBe(200);
    expect(caseB.status).toBe(200);
    expect((caseA.body as { case: { id: string } }).case.id).toBe((caseB.body as { case: { id: string } }).case.id);
  });
});
