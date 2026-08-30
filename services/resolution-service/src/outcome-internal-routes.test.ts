import { createEvaluationRecord, type AuthorityEvaluationRecord, type EvaluationStore } from "@truemandate/authority";
import { ConstraintKind, ConstraintMutability, ConstraintOperator, MeaningClass, SourceType, err, ok, type IntentState } from "@truemandate/protocol";
import { OutcomeService } from "@truemandate/outcome-service";
import { IntentService } from "@truemandate/intent-service";
import { describe, expect, it } from "vitest";
import { createOutcomeInternalRoutes } from "./outcome-internal-routes.js";

const H = (char: string) => char.repeat(64);
const NOW = "2026-08-15T12:00:00.000Z";
const EXPIRY = "2026-12-31T00:00:00.000Z";

class MemoryEvaluations implements EvaluationStore {
  readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) { if (this.rows.has(id)) return ok(false); this.rows.set(id, value); return ok(true); }
}

async function fixture() {
  const intents = new IntentService();
  const i = await intents.createIntent({ id: "intent-outcome", principalId: "principal", rawText: "Buy 500 food-grade containers", createdAt: NOW });
  if (!i.ok) throw new Error("intent");
  const s = await intents.createIntentState({ id: "state-outcome", intentId: i.value.id, createdBy: "principal", createdAt: NOW, constraints: [{ id: "food", concept: "food_grade", operator: ConstraintOperator.REQUIRE, value: true, kind: ConstraintKind.SAFETY_CRITICAL, importance: 1, confidence: 1, sourceType: SourceType.HUMAN, mutability: ConstraintMutability.IMMUTABLE, meaningClass: MeaningClass.EXPLICIT }] });
  if (!s.ok) throw new Error("state");
  const state = s.value as IntentState;
  const workflow = { id: "workflow-outcome", kind: "WORKFLOW", workflowId: "workflow-outcome", contentHash: H("a"), payload: { packId: "procurement" } };
  const action = { id: "action-outcome", kind: "ACTION", workflowId: workflow.id, contentHash: H("b"), payload: { intentStateId: state.id, intentStateHash: state.stateHash, action: { createdAt: NOW, agentId: "agent", merchant: "approved-supplier", quantity: 500, amount: 742000, product: "food-grade containers", deliveryTerms: "before 2026-12-30", planId: "plan" } } };
  const evaluations = new MemoryEvaluations();
  const result = await createEvaluationRecord(evaluations, { schemaVersion: 1, id: "evaluation-outcome", workflowId: workflow.id, workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: action.contentHash }, guardian: { id: "guardian", hash: H("c") }, evaluatedIntentState: { id: state.id, hash: state.stateHash, version: state.version }, decision: "ALLOW", scope: { capabilities: { execute_payment: "ALLOW" }, maxAmount: 742000, currency: "INR", expiresAt: EXPIRY }, capability: "execute_payment", merchant: "approved-supplier", amount: 742000, currency: "INR", expiresAt: EXPIRY, materializationEligible: true, createdAt: NOW });
  if (!result.ok) throw new Error(result.message);
  const artifacts = new Map([[workflow.id, workflow], [action.id, action]]);
  const outcomes = new OutcomeService();
  const owners = { getEvaluation: async (id: string) => id === result.value.id ? ok(result.value) : err("VALIDATION_FAILED" as never, "missing"), getArtifact: async (id: string) => artifacts.has(id) ? ok(artifacts.get(id)) : err("VALIDATION_FAILED" as never, "missing"), getState: async (id: string) => id === state.id ? ok(state) : err("VALIDATION_FAILED" as never, "missing"), getTip: async (id: string) => id === state.intentId ? ok(state) : err("VALIDATION_FAILED" as never, "missing") };
  const route = createOutcomeInternalRoutes(outcomes, owners).find((candidate) => candidate.method === "POST")!;
  const body = { evaluation: { id: result.value.id, hash: result.value.recordHash }, workflow: { id: workflow.id, hash: workflow.contentHash }, action: { id: action.id, hash: action.contentHash }, idempotencyKey: "idem" };
  return { route, body, outcomes, action, workflow, state, evaluation: result.value, owners };
}

async function travelFixture() {
  const intents = new IntentService();
  const i = await intents.createIntent({
    id: "intent-travel-outcome",
    principalId: "principal",
    rawText: "Book two refundable stays at Seaside Lodge with Meridian Travel Partners",
    createdAt: NOW,
  });
  if (!i.ok) throw new Error("intent");
  const s = await intents.createIntentState({
    id: "state-travel-outcome",
    intentId: i.value.id,
    createdBy: "principal",
    createdAt: NOW,
    constraints: [
      {
        id: "booking-provider",
        concept: "booking_provider",
        operator: ConstraintOperator.EQ,
        value: "Meridian Travel Partners",
        kind: ConstraintKind.HARD,
        importance: 1,
        confidence: 1,
        sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE,
        meaningClass: MeaningClass.EXPLICIT,
      },
    ],
  });
  if (!s.ok) throw new Error("state");
  const state = s.value as IntentState;
  const workflow = {
    id: "workflow-travel-outcome",
    kind: "WORKFLOW",
    workflowId: "workflow-travel-outcome",
    contentHash: H("d"),
    payload: { packId: "travel" },
  };
  const action = {
    id: "action-travel-outcome",
    kind: "ACTION",
    workflowId: workflow.id,
    contentHash: H("e"),
    payload: {
      intentStateId: state.id,
      intentStateHash: state.stateHash,
      action: {
        createdAt: NOW,
        agentId: "agent",
        merchant: "travel-provider",
        quantity: 2,
        amount: 3200,
        product: "Seaside Lodge",
        parameters: {
          providerName: "Meridian Travel Partners",
          travelerCount: 2,
          checkInDate: "2026-12-20T00:00:00.000Z",
        },
      },
    },
  };
  const evaluations = new MemoryEvaluations();
  const result = await createEvaluationRecord(evaluations, {
    schemaVersion: 1,
    id: "evaluation-travel-outcome",
    workflowId: workflow.id,
    workflow: { id: workflow.id, hash: workflow.contentHash },
    action: { id: action.id, hash: action.contentHash },
    guardian: { id: "guardian", hash: H("f") },
    evaluatedIntentState: {
      id: state.id,
      hash: state.stateHash,
      version: state.version,
    },
    decision: "ALLOW",
    scope: {
      capabilities: { book_travel: "ALLOW" },
      maxAmount: 3200,
      currency: "USD",
      allowedMerchants: ["travel-provider"],
      expiresAt: EXPIRY,
    },
    capability: "book_travel",
    merchant: "travel-provider",
    amount: 3200,
    currency: "USD",
    expiresAt: EXPIRY,
    materializationEligible: true,
    createdAt: NOW,
  });
  if (!result.ok) throw new Error(result.message);
  const artifacts = new Map([
    [workflow.id, workflow],
    [action.id, action],
  ]);
  const outcomes = new OutcomeService();
  const owners = {
    getEvaluation: async (id: string) =>
      id === result.value.id
        ? ok(result.value)
        : err("VALIDATION_FAILED" as never, "missing"),
    getArtifact: async (id: string) =>
      artifacts.has(id)
        ? ok(artifacts.get(id))
        : err("VALIDATION_FAILED" as never, "missing"),
    getState: async (id: string) =>
      id === state.id
        ? ok(state)
        : err("VALIDATION_FAILED" as never, "missing"),
    getTip: async (id: string) =>
      id === state.intentId
        ? ok(state)
        : err("VALIDATION_FAILED" as never, "missing"),
  };
  const route = createOutcomeInternalRoutes(outcomes, owners).find(
    (candidate) => candidate.method === "POST",
  )!;
  const body = {
    evaluation: { id: result.value.id, hash: result.value.recordHash },
    workflow: { id: workflow.id, hash: workflow.contentHash },
    action: { id: action.id, hash: action.contentHash },
    idempotencyKey: "travel-idem",
  };
  return { route, body, outcomes };
}

describe("pre-execution OutcomeContract owner route", () => {
  it("derives and replays the immutable flagship definition from references", async () => {
    const f = await fixture();
    const first = await f.route.handler({ params: {}, headers: {}, body: f.body });
    const second = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const contract = first.body as { requirements: Array<{ concept: string; value: unknown }>; preExecutionBinding: { evaluationId: string }; state: string; paymentStatus: string };
    expect(contract.state).toBe("CREATED"); expect(contract.paymentStatus).toBe("PENDING");
    expect(contract.preExecutionBinding.evaluationId).toBe(f.evaluation.id);
    expect(contract.requirements.find((r) => r.concept === "quantity_received")?.value).toBe(500);
    expect(contract.requirements.some((r) => r.concept === "food_grade")).toBe(true);
  });

  it("projects workflowId and canonical domain from exact durable workflow lineage", async () => {
    const f = await fixture();
    const created = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(created.status).toBe(200);
    const contractId = String((created.body as { id: string }).id);
    const read = createOutcomeInternalRoutes(f.outcomes, f.owners).find(
      (candidate) =>
        candidate.method === "GET" &&
        candidate.pattern === "/internal/outcomes/contracts/:id",
    );
    const result = await read?.handler({
      params: { id: contractId },
      headers: {},
      body: undefined,
    });

    expect(result).toMatchObject({
      status: 200,
      body: {
        id: contractId,
        workflowId: f.workflow.id,
        domain: "procurement",
      },
    });
  });

  it("fails closed when bound workflow lineage is malformed or hash-mismatched", async () => {
    const f = await fixture();
    const created = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(created.status).toBe(200);
    const contractId = String((created.body as { id: string }).id);
    f.owners.getArtifact = async (id: string) =>
      id === f.workflow.id
        ? ok({ ...f.workflow, contentHash: H("f") })
        : err("VALIDATION_FAILED" as never, "missing");
    const read = createOutcomeInternalRoutes(f.outcomes, f.owners).find(
      (candidate) => candidate.method === "GET",
    );
    const result = await read?.handler({
      params: { id: contractId },
      headers: {},
      body: undefined,
    });

    expect(result).toMatchObject({
      status: 400,
      body: { error: "OUTCOME_CONTRACT_STALE" },
    });
  });

  it("uses the domain identity field for travel outcome merchant reconstruction", async () => {
    const f = await travelFixture();
    const created = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(created.status).toBe(200);
    const contract = created.body as {
      merchant: string;
      requirements: Array<{ concept: string; value: unknown }>;
    };
    expect(contract.merchant).toBe("Meridian Travel Partners");
    expect(
      contract.requirements.find((requirement) => requirement.concept === "travel_provider_match")?.value,
    ).toBe("Meridian Travel Partners");
    expect(
      contract.requirements.find((requirement) => requirement.concept === "booking_provider")?.value,
    ).toBe("Meridian Travel Partners");
  });

  it.each(["quantity", "supplier", "amount", "product", "requirements", "state", "paymentStatus", "deliveryCondition", "evidenceRequirements"])('rejects caller-supplied %s', async (field) => {
    const f = await fixture();
    const result = await f.route.handler({ params: {}, headers: {}, body: { ...f.body, [field]: "smuggled" } });
    expect(result.status).toBe(400);
    expect(await f.outcomes.getContract(`outcome-${f.evaluation.id}`)).toMatchObject({ ok: false });
  });

  it("fails closed on a genuine cross-workflow action substitution", async () => {
    const f = await fixture();
    const result = await f.route.handler({ params: {}, headers: {}, body: { ...f.body, action: { id: "other-action", hash: H("d") } } });
    expect(result.status).toBe(400);
  });

  it("rejects an evaluation when the authoritative IntentState tip advances before contract creation", async () => {
    const f = await fixture();
    f.owners.getTip = async () => ok({ ...f.state, id: "state-advanced" as never, stateHash: H("f") as never, version: f.state.version + 1 });
    const result = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(result.status).toBe(400);
  });

describe("outcome-resolution least-privilege caller isolation", () => {
  const GATEWAY = "tm-dev-gateway@elite-crossbar-505104-t9.iam.gserviceaccount.com";
  const AGENT = "tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com";
  const AUTHORITY = "tm-dev-authority@elite-crossbar-505104-t9.iam.gserviceaccount.com";
  const PUBLIC_BFF = "tm-dev-public-bff@elite-crossbar-505104-t9.iam.gserviceaccount.com";
  it("grants Authority exactly the contract read; keeps the owner CREATE exclusive", () => {
    const routes = createOutcomeInternalRoutes(new OutcomeService(), {
      getEvaluation: async () => ({ ok: true, value: {} }),
      getArtifact: async () => ({ ok: true, value: {} }),
      getState: async () => ({ ok: true, value: {} }),
      getTip: async () => ({ ok: true, value: {} }),
    } as never, { globalCallers: [GATEWAY, AGENT], authorityCallerEmail: AUTHORITY });
    const get = routes.find((r) => r.pattern === "/internal/outcomes/contracts/:id");
    const post = routes.find((r) => r.pattern === "/internal/outcomes/procurement-contract");
    expect(get?.allowedCallers?.slice().sort()).toEqual([GATEWAY, AGENT, AUTHORITY].sort());
    expect(post?.allowedCallers?.slice().sort()).toEqual([GATEWAY, AGENT].sort());
    expect(post?.allowedCallers).not.toContain(AUTHORITY);
  });

  it("grants Public BFF only the contract read seam", () => {
    const routes = createOutcomeInternalRoutes(new OutcomeService(), {
      getEvaluation: async () => ({ ok: true, value: {} }),
      getArtifact: async () => ({ ok: true, value: {} }),
      getState: async () => ({ ok: true, value: {} }),
      getTip: async () => ({ ok: true, value: {} }),
    } as never, {
      globalCallers: [GATEWAY, AGENT],
      readerCallerEmails: [PUBLIC_BFF],
      authorityCallerEmail: AUTHORITY,
      evaluationCallerEmail: "phase-c-verifier@test",
      evidenceReadPort: {
        getClaim: async () => ({ ok: true, value: {} }),
        getEnvelope: async () => ({ ok: true, value: {} }),
      },
    });

    const read = routes.find((route) => route.method === "GET" && route.pattern === "/internal/outcomes/contracts/:id");
    const create = routes.find((route) => route.method === "POST" && route.pattern === "/internal/outcomes/contracts");
    const close = routes.find((route) => route.pattern === "/internal/outcomes/contracts/:id/close");
    const evaluate = routes.find((route) => route.pattern === "/internal/outcomes/:outcomeContractId/evaluate-evidence");

    expect(read?.allowedCallers).toContain(PUBLIC_BFF);
    expect(create?.allowedCallers).not.toContain(PUBLIC_BFF);
    expect(close?.allowedCallers).not.toContain(PUBLIC_BFF);
    expect(evaluate?.allowedCallers).not.toContain(PUBLIC_BFF);
    expect(read?.allowedCallers).not.toContain("unauthorized@test");
  });
});

describe("gateway payment-status owner route", () => {
  it("accepts only the configured gateway caller and advances the durable contract", async () => {
    const f = await fixture();
    const created = await f.route.handler({ params: {}, headers: {}, body: f.body });
    expect(created.status).toBe(200);
    const contractId = String((created.body as { id: string }).id);
    const route = createOutcomeInternalRoutes(f.outcomes, f.owners, {
      gatewayCallerEmail: "gateway@example.test",
    }).find((candidate) => candidate.pattern === "/internal/outcomes/contracts/:id/payment-status");

    expect(route?.allowedCallers).toEqual(["gateway@example.test"]);
    const updated = await route?.handler({
      params: { id: contractId },
      headers: {},
      body: { status: "SUCCESS", occurredAt: NOW },
    });

    expect(updated).toMatchObject({ status: 200, body: { paymentStatus: "SUCCESS" } });
    const stored = await f.outcomes.getContract(contractId);
    expect(stored.ok && stored.value.paymentStatus).toBe("SUCCESS");
  });
});
});

describe("Phase C contract-read caller composition", () => {
  it("adds the Phase C evaluation caller to the contract READ route without displacing existing readers", () => {
    const routes = createOutcomeInternalRoutes(new OutcomeService(), {
      getEvaluation: async () => ({ ok: true as const, value: undefined }),
      getArtifact: async () => ({ ok: true as const, value: undefined }),
      getState: async () => ({ ok: true as const, value: undefined }),
      getTip: async () => ({ ok: true as const, value: undefined }),
    }, {
      globalCallers: ["agent-runtime@test", "gateway@test"],
      authorityCallerEmail: "authority@test",
      evaluationCallerEmail: "phase-c-verifier@test",
      evidenceReadPort: {
        getClaim: async () => ({ ok: true as const, value: undefined }),
        getEnvelope: async () => ({ ok: true as const, value: undefined }),
      },
    });
    const read = routes.find((route) => route.pattern === "/internal/outcomes/contracts/:id");
    expect(read?.allowedCallers).toEqual(["agent-runtime@test", "gateway@test", "authority@test", "phase-c-verifier@test"]);
    // The evaluate route stays Phase C only; the create route stays global.
    const evaluate = routes.find((route) => route.pattern === "/internal/outcomes/:outcomeContractId/evaluate-evidence");
    expect(evaluate?.allowedCallers).toEqual(["phase-c-verifier@test"]);
    const create = routes.find((route) => route.pattern === "/internal/outcomes/procurement-contract");
    expect(create?.allowedCallers).toEqual(["agent-runtime@test", "gateway@test"]);
  });
});
