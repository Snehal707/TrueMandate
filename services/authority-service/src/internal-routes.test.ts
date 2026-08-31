import { describe, expect, it } from "vitest";
import { hashCanonical } from "@truemandate/crypto";
import { hashActionProposal } from "@truemandate/guardian-core";
import {
  AuthorityDecision,
  ErrorCode,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  PROTOCOL_VERSION,
  ok,
  type Result,
  type ActionProposal,
  type AuthorityDecision as AuthorityDecisionType,
  type GuardianVerdict,
} from "@truemandate/protocol";
import { createAuthorityInternalRoutes } from "./internal-routes.js";
import { proofObligationId, type SemanticArtifactReference } from "./semantic-artifact-resolver.js";

type Kind = SemanticArtifactReference["kind"];
type Predecessor = { id: string; kind: Kind; contentHash: string };
type Artifact = { id: string; kind: Kind; workflowId: string; payload: Record<string, unknown>; predecessors: Predecessor[]; contentHash: string };
type ScopeDecision = AuthorityDecisionType;
type Fixture = {
  workflowId: string;
  intentId: string;
  stateId: string;
  stateHash: string;
  version: number;
  records: Artifact[];
  effects: { evaluation: number };
  adaptiveSubjectId?: string;
  learning?: {
    getTrustSignal(
      subjectType: "AGENT" | "COUNTERPARTY",
      subjectId: string,
      domain: string,
    ): Promise<Result<unknown>>;
    getPreference(
      subjectId: string,
      domain: string,
      concept: string,
    ): Promise<Result<unknown>>;
    getWorkflowRule(
      subjectId: string,
      domain: string,
      concept: string,
    ): Promise<Result<unknown>>;
  };
  ownerFailure?: "unavailable" | "malformed" | "advanced" | "foreignIntent" | "hashMismatch";
  scopeDecision?: ScopeDecision;
  withTemporalAuthority?: boolean;
};

const obligations = [
  { constraintId: "food-grade", verificationStep: "certificate", requiredEvidence: "certificate", enforcingService: "guardian" },
  { constraintId: "approved-supplier", verificationStep: "supplier-approval", requiredEvidence: "approval-record", enforcingService: "guardian" }
] as const;
const hash = (payload: unknown) => String(hashCanonical(payload));
const ref = (record: Artifact): Predecessor => ({ id: record.id, kind: record.kind, contentHash: record.contentHash });
const kind = (fixture: Fixture, value: Kind) => {
  const result = fixture.records.find((record) => record.kind === value);
  if (!result) throw new Error(`missing ${value}`);
  return result;
};

const NOW = "2026-01-01T00:00:00.000Z";
const FUTURE = "2026-12-01T12:00:00.000Z";

function makeAction(fixture: {
  intentId: string;
  stateId: string;
  actionId: string;
}, overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: fixture.actionId as ActionProposal["id"],
    intentId: fixture.intentId as ActionProposal["intentId"],
    intentStateId: fixture.stateId as ActionProposal["intentStateId"],
    agentId: "agent" as ActionProposal["agentId"],
    capability: "execute_payment",
    merchant: "approved-supplier",
    product: "fg-container",
    quantity: 500,
    amount: 742000,
    currency: "INR",
    refundable: true,
    parameters: { sku: "FG-500" },
    consequenceLevel: "HIGH",
    createdAt: NOW,
    ...overrides,
  };
}

function makeVerdict(
  action: ActionProposal,
  stateHash: string,
  overrides: Partial<GuardianVerdict> = {},
): GuardianVerdict {
  const actionContentHash = hashActionProposal(action);
  return {
    id: `gv-${action.id}`,
    actionId: action.id,
    intentId: action.intentId,
    intentStateId: action.intentStateId,
    intentStateHash: stateHash as GuardianVerdict["intentStateHash"],
    actionContentHash,
    evidenceSnapshotHash: "ev-empty" as GuardianVerdict["evidenceSnapshotHash"],
    decision: AuthorityDecision.ALLOW,
    semanticStatus: GuardianSemanticStatus.CLEAR,
    overallFidelity: 1,
    constraintClaims: [],
    contradictions: [],
    uncertainty: 0,
    criticalFailure: false,
    judgeResults: [
      {
        judgeId: JudgeId.FIDELITY,
        status: JudgeInvocationStatus.OK,
        findings: [],
      },
    ],
    protocolVersion: PROTOCOL_VERSION,
    promptVersions: {},
    schemaVersions: {},
    stale: false,
    createdAt: NOW,
    verdictHash: actionContentHash,
    ...overrides,
  };
}

function makeFixture(
  prefix: string,
  options: {
    zero?: boolean;
    actionOverrides?: Partial<ActionProposal>;
    verdictOverrides?: Partial<GuardianVerdict>;
    scopeCapability?: ScopeDecision;
    scopeDecision?: ScopeDecision;
    adaptiveSubjectId?: string;
    withTemporalAuthority?: boolean;
  } = {},
): Fixture {
  const zero = options.zero ?? false;
  const workflowId = `workflow-${prefix}`, intentId = `intent-${prefix}`, stateId = `state-${prefix}`, stateHash = "a".repeat(64), version = 7;
  const actionId = `${prefix}-action`;
  const action = makeAction({ intentId, stateId, actionId }, options.actionOverrides);
  const verdict = makeVerdict(action, stateHash, options.verdictOverrides);
  const scopeCap = options.scopeCapability ?? AuthorityDecision.ALLOW;
  const payload = (body: Record<string, unknown>) => ({ intentStateId: stateId, intentStateHash: stateHash, ...body });
  const make = (id: string, artifactKind: Kind, body: Record<string, unknown>): Artifact => ({ id, kind: artifactKind, workflowId, payload: payload(body), predecessors: [], contentHash: "" });
  const proofObligations = zero ? [] : obligations;
  const plan = make(`${prefix}-plan`, "PLAN", { proofObligations });
  const verification = make(`${prefix}-verification`, "PLAN_VERIFICATION", {});
  const actionArtifact = make(actionId, "ACTION", {
    action,
    requiredProofObligationIds: proofObligations.map(proofObligationId),
    authorityRequest: {
      id: `request-${prefix}`, principalId: "principal", agentId: "agent", intentId, intentStateId: stateId,
      adaptiveSubjectId: options.adaptiveSubjectId,
      actionId, capability: action.capability, scope: { capabilities: { [action.capability]: scopeCap }, maxAmount: 800000, currency: "INR" },
      merchant: action.merchant ?? "approved-supplier", amount: action.amount ?? 742000, currency: action.currency ?? "INR", createdAt: NOW
    }
  });
  const proofs = proofObligations.map((proofObligation, index) => make(`${prefix}-proof-${index + 1}`, "PROOF", {
    schemaVersion: "1", proofId: `${prefix}-proof-${index + 1}`, obligationId: proofObligationId(proofObligation), actionArtifactId: actionArtifact.id,
    actionPayloadHash: "", status: "SATISFIED", evidenceRefs: [{ id: `evidence-${prefix}-${index + 1}`, hash: "b".repeat(64) }],
    evaluatedAt: NOW, method: "deterministic"
  }));
  const guardian = make(`${prefix}-guardian`, "GUARDIAN", {
    verdict,
    actionArtifactId: actionArtifact.id,
    actionArtifactHash: "",
    evaluatedProofs: [],
  });
  const workflow = make(`${prefix}-workflow`, "WORKFLOW", {});
  const fixture: Fixture = {
    workflowId,
    intentId,
    stateId,
    stateHash,
    version,
    records: [plan, verification, actionArtifact, ...proofs, guardian, workflow],
    effects: { evaluation: 0 },
    adaptiveSubjectId: options.adaptiveSubjectId,
    scopeDecision: options.scopeDecision ?? AuthorityDecision.ALLOW,
    withTemporalAuthority: options.withTemporalAuthority ?? false,
  };
  repair(fixture);
  return fixture;
}

function repair(fixture: Fixture, options: { preserveProofActionHash?: boolean; preserveGuardianProofs?: boolean } = {}) {
  const plan = kind(fixture, "PLAN"), verification = kind(fixture, "PLAN_VERIFICATION"), action = kind(fixture, "ACTION"), guardian = kind(fixture, "GUARDIAN"), workflow = kind(fixture, "WORKFLOW");
  const proofs = fixture.records.filter((record) => record.kind === "PROOF");
  plan.contentHash = hash(plan.payload);
  verification.predecessors = [ref(plan)]; verification.contentHash = hash(verification.payload);
  action.predecessors = [ref(plan), ref(verification)]; action.contentHash = hash(action.payload);
  for (const proof of proofs) { proof.predecessors = [ref(action)]; if (!options.preserveProofActionHash) proof.payload.actionPayloadHash = action.contentHash; proof.contentHash = hash(proof.payload); }
  guardian.predecessors = [ref(plan), ref(verification), ref(action), ...proofs.map(ref)];
  guardian.payload.actionArtifactHash = action.contentHash;
  if (!options.preserveGuardianProofs) guardian.payload.evaluatedProofs = proofs.map((proof) => ({ id: proof.id, hash: proof.contentHash, obligationId: proof.payload.obligationId })).sort((a, b) => `${a.id}:${a.hash}`.localeCompare(`${b.id}:${b.hash}`));
  guardian.contentHash = hash(guardian.payload);
  workflow.predecessors = [ref(guardian)]; workflow.contentHash = hash(workflow.payload);
}

function request(fixture: Fixture): Record<string, unknown> {
  const lookup = (artifactKind: Kind) => kind(fixture, artifactKind);
  const compact = (record: Artifact) => ({ id: record.id, hash: record.contentHash });
  return {
    workflowId: fixture.workflowId, intentStateId: fixture.stateId, intentStateHash: fixture.stateHash,
    workflow: compact(lookup("WORKFLOW")), plan: compact(lookup("PLAN")), planVerification: compact(lookup("PLAN_VERIFICATION")),
    action: compact(lookup("ACTION")), guardian: compact(lookup("GUARDIAN")), proofs: fixture.records.filter((record) => record.kind === "PROOF").map(compact), idempotencyKey: `idem-${fixture.workflowId}`
  };
}

function expectNoPrivilegedSideEffects(body: unknown) {
  const record = body as Record<string, unknown>;
  expect(record).not.toHaveProperty("grant");
  expect(record).not.toHaveProperty("commitToken");
  expect(record).not.toHaveProperty("approvalArtifact");
  expect(record).not.toHaveProperty("preparedAction");
  expect(record).not.toHaveProperty("commitTokenId");
  expect(record).not.toHaveProperty("grantId");
}

async function invoke(fixture: Fixture, body: unknown) {
  const rows = new Map(fixture.records.map((record) => [record.id, record]));
  const artifacts = {
    getSemanticArtifact: async (id: string) => {
      const record = rows.get(id);
      return record ? { ok: true as const, value: record } : { ok: false as const, code: ErrorCode.VALIDATION_FAILED, message: "missing" };
    },
    getIntentState: async (_id: string) => {
      if (fixture.ownerFailure === "unavailable") return { ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" };
      if (fixture.ownerFailure === "malformed") return { ok: true as const, value: {} as never };
      return {
        ok: true as const,
        value: {
          id: fixture.stateId,
          intentId: fixture.ownerFailure === "foreignIntent" ? "foreign-intent" : fixture.intentId,
          stateHash: fixture.ownerFailure === "hashMismatch" ? "c".repeat(64) : fixture.stateHash,
          version: fixture.version,
          constraints: fixture.withTemporalAuthority
            ? [{
                id: "human-deadline",
                concept: "completion_deadline",
                operator: "LTE",
                value: FUTURE,
                kind: "TEMPORAL",
                importance: 1,
                confidence: 1,
                sourceType: "HUMAN",
                mutability: "IMMUTABLE",
                meaningClass: "EXPLICIT",
              }]
            : [],
          ...(fixture.withTemporalAuthority
            ? {
                temporalAuthority: {
                  executionNotAfter: FUTURE,
                  source: "EXPLICIT_HUMAN",
                  sourceRef: "human-deadline",
                },
              }
            : {}),
        },
      };
    },
    getTip: async (_intentId: string) => {
      if (fixture.ownerFailure === "unavailable") return { ok: false as const, code: ErrorCode.MODEL_UNAVAILABLE, message: "owner unavailable" };
      if (fixture.ownerFailure === "malformed") return { ok: true as const, value: {} as never };
      return { ok: true as const, value: { id: fixture.ownerFailure === "advanced" ? "advanced-state" : fixture.stateId, intentId: fixture.intentId, stateHash: fixture.stateHash, version: fixture.version } };
    }
  };
  const authority = {
    evaluateAuthorityRequest: async () => {
      fixture.effects.evaluation += 1;
      return {
        ok: true as const,
        value: {
          decision: fixture.scopeDecision ?? AuthorityDecision.ALLOW,
          reasons: ["test scope evaluation"],
        },
      };
    },
    getIntentService: () => ({
      getCurrentIntentState: async () => ({
        ok: true as const,
        value: {
          id: fixture.stateId,
          intentId: fixture.intentId,
          stateHash: fixture.stateHash,
          version: fixture.version,
        },
      }),
    }),
  };
  const route = createAuthorityInternalRoutes({ authority: authority as never, artifacts, learning: fixture.learning }).find((item) => item.pattern === "/internal/authority/procurement");
  if (!route) throw new Error("procurement route not configured");
  return route.handler({ body, params: {}, headers: {} });
}

function expectNoPrivilegedEffects(fixture: Fixture) {
  expect(fixture.effects.evaluation).toBe(0);
}

describe("POST /internal/authority/procurement", () => {
  it("does not register the legacy raw grant-minting route", () => {
    const routes = createAuthorityInternalRoutes({ authority: { evaluateAuthorityRequest: async () => ({ ok: true as const, value: { decision: AuthorityDecision.ALLOW, reasons: [] } }) } as never });
    expect(routes.some((route) => route.pattern === "/internal/authority/grants")).toBe(false);
  });

  it("limits lifecycle services to durable evaluation reads", () => {
    const routes = createAuthorityInternalRoutes({
      authority: { evaluateAuthorityRequest: async () => ({ ok: true as const, value: { decision: AuthorityDecision.ALLOW, reasons: [] } }) } as never,
      evaluationReadCallers: ["public-bff@example.com", "outcome-resolution@example.com", "gateway@example.com"],
    });
    const evaluationRead = routes.find((route) => route.pattern === "/internal/authority/evaluations/:id");
    const evaluationWrite = routes.find((route) => route.pattern === "/internal/authority/evaluate");

    expect(evaluationRead?.allowedCallers).toEqual(["public-bff@example.com", "outcome-resolution@example.com", "gateway@example.com"]);
    expect(evaluationWrite?.allowedCallers).toBeUndefined();
  });

  it.each([false, true])("evaluates a valid current %s-obligation chain and returns the fresh state binding", async (zero) => {
    const fixture = makeFixture(zero ? "zero" : "valid", { zero });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ decision: AuthorityDecision.ALLOW, evaluatedIntentState: { id: fixture.stateId, stateHash: fixture.stateHash, version: fixture.version } });
    expect(fixture.effects.evaluation).toBe(1);
    expectNoPrivilegedSideEffects(response.body);
  });

  it("accepts [A,B] and [B,A] Guardian proof sets as the same semantic set", async () => {
    const ordered = makeFixture("ordered");
    const reordered = makeFixture("reordered");
    const guardian = kind(reordered, "GUARDIAN");
    guardian.payload.evaluatedProofs = [...(guardian.payload.evaluatedProofs as unknown[])].reverse();
    guardian.contentHash = hash(guardian.payload); kind(reordered, "WORKFLOW").predecessors = [ref(guardian)]; kind(reordered, "WORKFLOW").contentHash = hash(kind(reordered, "WORKFLOW").payload);
    expect((await invoke(ordered, request(ordered))).status).toBe(200);
    expect((await invoke(reordered, request(reordered))).status).toBe(200);
    expect(ordered.effects.evaluation).toBe(1); expect(reordered.effects.evaluation).toBe(1);
  });

  it.each([
    ["foreign intent state ownership", (f: Fixture) => { f.ownerFailure = "foreignIntent"; }, 400],
    ["referenced state hash mismatch", (f: Fixture) => { f.ownerFailure = "hashMismatch"; }, 400],
    ["advanced current tip", (f: Fixture) => { f.ownerFailure = "advanced"; }, 400],
    ["malformed freshness owner response", (f: Fixture) => { f.ownerFailure = "malformed"; }, 400],
    ["unavailable freshness owner", (f: Fixture) => { f.ownerFailure = "unavailable"; }, 503],
    ["wrong verification predecessor", (f: Fixture) => { kind(f, "PLAN_VERIFICATION").predecessors[0]!.id = "foreign-plan"; }, 400],
    ["wrong Action predecessor", (f: Fixture) => { kind(f, "ACTION").predecessors[0]!.id = "foreign-plan"; }, 400],
    ["wrong proof Action binding", (f: Fixture) => { kind(f, "PROOF").payload.actionArtifactId = "foreign-action"; repair(f); }, 400],
    ["wrong proof Action hash", (f: Fixture) => { kind(f, "PROOF").payload.actionPayloadHash = "d".repeat(64); repair(f, { preserveProofActionHash: true }); }, 400],
    ["unknown proof obligation", (f: Fixture) => { kind(f, "PROOF").payload.obligationId = "unknown"; repair(f); }, 400],
    ["UNKNOWN proof", (f: Fixture) => { kind(f, "PROOF").payload.status = "UNKNOWN"; repair(f); }, 400],
    ["UNSATISFIED proof", (f: Fixture) => { kind(f, "PROOF").payload.status = "UNSATISFIED"; repair(f); }, 400],
    ["Guardian proof-set mismatch", (f: Fixture) => { kind(f, "GUARDIAN").payload.evaluatedProofs = []; repair(f, { preserveGuardianProofs: true }); }, 400],
    ["WORKFLOW wrong Guardian binding", (f: Fixture) => { kind(f, "WORKFLOW").predecessors[0]!.id = "foreign-guardian"; }, 400],
    ["wrong artifact IntentState binding", (f: Fixture) => { kind(f, "PLAN").payload.intentStateId = "foreign-state"; kind(f, "PLAN").contentHash = hash(kind(f, "PLAN").payload); }, 400],
    ["missing required proof", (f: Fixture) => { f.records = f.records.filter((record) => record.kind !== "PROOF"); }, 400],
    ["malformed persisted artifact", (f: Fixture) => { delete (kind(f, "ACTION") as Partial<Artifact>).predecessors; }, 400]
  ])("fails closed for %s", async (_name, mutate, status) => {
    const fixture = makeFixture(`failure-${_name.replaceAll(" ", "-")}`); mutate(fixture);
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(status); expect(response.body).toHaveProperty("error"); expectNoPrivilegedEffects(fixture);
  });

  it("rejects genuine cross-workflow artifact recombination", async () => {
    const left = makeFixture("left"), right = makeFixture("right");
    left.records.push(...right.records);
    const body = request(left); body.guardian = { id: kind(right, "GUARDIAN").id, hash: kind(right, "GUARDIAN").contentHash };
    const response = await invoke(left, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(left);
  });

  it("rejects a genuine artifact paired with a different genuine reference hash", async () => {
    const fixture = makeFixture("genuine-wrong-hash");
    const other = makeFixture("genuine-wrong-hash-other");
    const body = request(fixture);
    (body.plan as { hash: string }).hash = kind(other, "PLAN").contentHash;
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it.each(["PLAN", "PLAN_VERIFICATION", "ACTION", "GUARDIAN", "WORKFLOW"] as const)("rejects a missing referenced %s artifact", async (artifactKind) => {
    const fixture = makeFixture(`missing-${artifactKind}`); const body = request(fixture);
    fixture.records = fixture.records.filter((record) => record.kind !== artifactKind);
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it("rejects conflicting durable proofs for one required obligation", async () => {
    const fixture = makeFixture("conflicting-proofs"); const proof = kind(fixture, "PROOF"); const second = structuredClone(proof);
    second.id = "conflicting-proof-second"; second.payload.proofId = second.id;
    fixture.records.splice(fixture.records.indexOf(proof) + 1, 0, second); repair(fixture);
    const response = await invoke(fixture, request(fixture)); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it("rejects a Guardian proof set containing a genuine substituted proof", async () => {
    const fixture = makeFixture("guardian-genuine-substitute"); const other = makeFixture("guardian-genuine-substitute-other"); const foreignProof = kind(other, "PROOF");
    fixture.records.push(...other.records);
    const guardian = kind(fixture, "GUARDIAN"); guardian.payload.evaluatedProofs = [{ id: foreignProof.id, hash: foreignProof.contentHash, obligationId: foreignProof.payload.obligationId }];
    guardian.contentHash = hash(guardian.payload); kind(fixture, "WORKFLOW").predecessors = [ref(guardian)]; kind(fixture, "WORKFLOW").contentHash = hash(kind(fixture, "WORKFLOW").payload);
    const body = request(fixture); body.proofs = [body.proofs instanceof Array ? body.proofs[0]! : {}, { id: foreignProof.id, hash: foreignProof.contentHash }];
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it.each(["guardianVerdict", "authorityDecision", "proofsSatisfied", "allow", "action", "planGraph", "rawProofs", "grant", "approvalArtifact", "preparedAction", "commitToken"])("rejects authority-bearing DTO smuggling field %s", async (field) => {
    const fixture = makeFixture(`smuggle-${field}`); const body = { ...request(fixture), [field]: { forged: true } };
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it.each([
    ["action", { id: "raw-action", capability: "execute_payment", amount: 742000 }],
    ["plan", { proofObligations: obligations }],
    ["proofs", [{ obligationId: proofObligationId(obligations[0]), status: "SATISFIED" }]],
    ["guardian", { decision: "ALLOW", evaluatedProofs: [] }]
  ])("rejects a raw semantic object supplied in the %s reference field", async (field, raw) => {
    const fixture = makeFixture(`raw-reference-${field}`); const body = request(fixture); body[field] = raw;
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });

  it.each([
    ["malformed artifact hash", (body: Record<string, unknown>) => { (body.plan as { hash: string }).hash = "bad"; }],
    ["missing idempotency key", (body: Record<string, unknown>) => { delete body.idempotencyKey; }],
    ["empty correlation metadata", (body: Record<string, unknown>) => { body.correlationId = ""; }],
    ["duplicate proof references", (body: Record<string, unknown>) => { const proof = (body.proofs as object[])[0]!; body.proofs = [proof, proof]; }]
  ])("rejects %s at the HTTP boundary", async (_name, mutate) => {
    const fixture = makeFixture(`dto-${_name.replaceAll(" ", "-")}`); const body = request(fixture); mutate(body);
    const response = await invoke(fixture, body); expect(response.status).toBe(400); expectNoPrivilegedEffects(fixture);
  });
});

describe("Wave 4.1 Guardian + scope fusion on /internal/authority/procurement", () => {
  it("Guardian BLOCK dominates a permissive scope ALLOW", async () => {
    const fixture = makeFixture("guardian-block", {
      withTemporalAuthority: true,
      verdictOverrides: {
        decision: AuthorityDecision.BLOCK,
        semanticStatus: GuardianSemanticStatus.CRITICAL_FAILURE,
        criticalFailure: true,
      },
      scopeDecision: AuthorityDecision.ALLOW,
    });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.BLOCK,
      evaluation: {
        materializationEligible: false,
        materializationReason: "AUTHORITY_BLOCKED",
      },
    });
    expect(fixture.effects.evaluation).toBe(1);
    expectNoPrivilegedSideEffects(response.body);
  });

  it("Guardian REQUIRE_APPROVAL propagates over scope ALLOW (UNCERTAIN + high-consequence)", async () => {
    const fixture = makeFixture("guardian-require-approval", {
      withTemporalAuthority: true,
      verdictOverrides: {
        decision: AuthorityDecision.REQUIRE_APPROVAL,
        semanticStatus: GuardianSemanticStatus.UNCERTAIN,
        uncertainty: 0.7,
      },
      scopeDecision: AuthorityDecision.ALLOW,
    });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.REQUIRE_APPROVAL,
      evaluation: {
        materializationEligible: false,
        materializationReason: "PENDING_APPROVAL",
      },
    });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("Guardian ALLOW_WITH_MONITORING propagates over scope ALLOW (UNCERTAIN + low-consequence)", async () => {
    const fixture = makeFixture("guardian-monitoring", {
      withTemporalAuthority: true,
      actionOverrides: {
        capability: "search",
        consequenceLevel: "LOW",
        amount: 0,
      },
      verdictOverrides: {
        decision: AuthorityDecision.ALLOW_WITH_MONITORING,
        semanticStatus: GuardianSemanticStatus.UNCERTAIN,
        uncertainty: 0.4,
      },
      scopeDecision: AuthorityDecision.ALLOW,
    });
    // Re-bind verdict hash after low-consequence action override (already done in makeFixture).
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.ALLOW_WITH_MONITORING,
      evaluation: {
        materializationEligible: true,
        materializationReason: "PENDING_MONITORING",
      },
    });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("capability/scope BLOCK still dominates a CLEAR Guardian", async () => {
    const fixture = makeFixture("scope-block-dominates", {
      withTemporalAuthority: true,
      scopeDecision: AuthorityDecision.BLOCK,
    });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.BLOCK,
      evaluation: {
        materializationEligible: false,
        materializationReason: "AUTHORITY_BLOCKED",
      },
    });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("scope ALLOW_WITH_MONITORING is preserved when Guardian is CLEAR", async () => {
    const fixture = makeFixture("scope-monitoring-preserved", {
      withTemporalAuthority: true,
      scopeDecision: AuthorityDecision.ALLOW_WITH_MONITORING,
    });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.ALLOW_WITH_MONITORING,
      evaluation: {
        materializationEligible: true,
        materializationReason: "PENDING_MONITORING",
      },
    });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("rejects a GuardianVerdict with mismatched actionContentHash fail-closed", async () => {
    const fixture = makeFixture("stale-action-hash");
    const guardian = kind(fixture, "GUARDIAN");
    const verdict = guardian.payload.verdict as GuardianVerdict;
    guardian.payload.verdict = {
      ...verdict,
      actionContentHash: "f".repeat(64) as GuardianVerdict["actionContentHash"],
    };
    repair(fixture);
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: ErrorCode.ACTION_PROPOSAL_MISMATCH });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("rejects a GuardianVerdict with mismatched intentStateHash fail-closed", async () => {
    const fixture = makeFixture("stale-intent-hash");
    const guardian = kind(fixture, "GUARDIAN");
    const verdict = guardian.payload.verdict as GuardianVerdict;
    guardian.payload.verdict = {
      ...verdict,
      intentStateHash: "e".repeat(64) as GuardianVerdict["intentStateHash"],
    };
    repair(fixture);
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: ErrorCode.GUARDIAN_VERDICT_STALE });
    expectNoPrivilegedSideEffects(response.body);
  });

  it("never exposes grant/CommitToken/Gateway fields from the evaluation-only route", async () => {
    const fixture = makeFixture("no-bypass-surface", { withTemporalAuthority: true });
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ decision: AuthorityDecision.ALLOW });
    expectNoPrivilegedSideEffects(response.body);
    const routes = createAuthorityInternalRoutes({
      authority: {
        evaluateAuthorityRequest: async () => ({ ok: true as const, value: { decision: AuthorityDecision.ALLOW, reasons: [] } }),
        getIntentService: () => ({ getCurrentIntentState: async () => ({ ok: true as const, value: {} }) }),
      } as never,
    });
    expect(routes.some((route) => route.pattern === "/internal/authority/grants")).toBe(false);
    expect(routes.some((route) => route.pattern.includes("commit"))).toBe(false);
  });
});

describe("Wave 4.4 adaptive authority signal consumption", () => {
  it("tightens baseline ALLOW to ALLOW_WITH_MONITORING for weak confirmed counterparty trust", async () => {
    const fixture = makeFixture("adaptive-weak-counterparty", {
      withTemporalAuthority: true,
      adaptiveSubjectId: "principal:owner@example.com",
    });
    fixture.learning = {
      getTrustSignal: async (subjectType, subjectId, domain) =>
        ok(
          subjectType === "COUNTERPARTY" && subjectId === "approved-supplier" && domain === "procurement"
            ? {
                learnedContext: {
                  id: "ctx-counterparty",
                  learningProposalId: "lp-counterparty",
                  principalId: "principal",
                  domain: "procurement",
                  proposalType: "COUNTERPARTY_TRUST",
                  content: {},
                  confirmedAt: NOW,
                  confirmedBy: "principal",
                  contentHash: "a".repeat(64),
                },
                trustSignal: {
                  subjectType: "COUNTERPARTY",
                  subjectId: "approved-supplier",
                  domain: "procurement",
                  value: 0.2,
                  sampleSize: 10,
                  basis: ["observed"],
                  computedAt: NOW,
                },
              }
            : { learnedContext: null, trustSignal: null },
        ),
      getPreference: async () => ok({ preference: null }),
      getWorkflowRule: async () => ok({ workflowRule: null }),
    };
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.ALLOW_WITH_MONITORING,
      evaluation: {
        materializationEligible: true,
        materializationReason: "PENDING_MONITORING",
      },
    });
  });

  it("tightens baseline ALLOW to REQUIRE_APPROVAL for workflow-rule mismatch on delivery_terms", async () => {
    const fixture = makeFixture("adaptive-rule-mismatch", {
      withTemporalAuthority: true,
      adaptiveSubjectId: "principal:owner@example.com",
      actionOverrides: { deliveryTerms: "standard" },
    });
    fixture.learning = {
      getTrustSignal: async () => ok({ learnedContext: null, trustSignal: null }),
      getPreference: async () => ok({ preference: null }),
      getWorkflowRule: async (subjectId, domain, concept) =>
        ok(
          subjectId === "principal:owner@example.com" &&
            domain === "procurement" &&
            concept === "delivery_terms"
            ? {
                workflowRule: {
                  id: "rule-delivery",
                  subjectId,
                  domain,
                  concept,
                  action: { value: "overnight" },
                  version: 1,
                  status: "ACTIVE",
                  evidenceRefs: ["e1", "e2", "e3"],
                  basis: ["b1", "b2", "b3"],
                  sourceLearningProposalId: "lp-rule-delivery",
                  createdAt: NOW,
                  confirmedAt: NOW,
                  confirmedBy: "principal",
                  contentHash: "b".repeat(64),
                },
              }
            : { workflowRule: null },
        ),
    };
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.REQUIRE_APPROVAL,
      evaluation: {
        materializationEligible: false,
        materializationReason: "PENDING_APPROVAL",
      },
    });
  });

  it("ignores malformed or mismatched adaptive signals fail-safe", async () => {
    const fixture = makeFixture("adaptive-ignore-invalid", {
      withTemporalAuthority: true,
      adaptiveSubjectId: "principal:owner@example.com",
    });
    fixture.learning = {
      getTrustSignal: async () =>
        ok({
          learnedContext: {
            id: "ctx-agent",
            learningProposalId: "lp-agent",
            principalId: "principal",
            domain: "travel",
            proposalType: "AGENT_RELIABILITY",
            content: {},
            confirmedAt: NOW,
            confirmedBy: "principal",
            contentHash: "c".repeat(64),
          },
          trustSignal: {
            subjectType: "AGENT",
            subjectId: "wrong-agent",
            domain: "travel",
            value: 0.1,
            sampleSize: 10,
            basis: ["observed"],
            computedAt: NOW,
          },
        }),
      getPreference: async () => ok({ preference: { malformed: true } }),
      getWorkflowRule: async () => ok({ workflowRule: { malformed: true } }),
    };
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: AuthorityDecision.ALLOW,
      evaluation: {
        materializationEligible: true,
      },
    });
  });

  it("never guesses preference/workflow-rule subject from principalId when adaptiveSubjectId is absent", async () => {
    const fixture = makeFixture("adaptive-no-guess", {
      withTemporalAuthority: true,
    });
    const calls = { preference: 0, workflowRule: 0 };
    fixture.learning = {
      getTrustSignal: async () => ok({ learnedContext: null, trustSignal: null }),
      getPreference: async () => {
        calls.preference += 1;
        return ok({ preference: null });
      },
      getWorkflowRule: async () => {
        calls.workflowRule += 1;
        return ok({ workflowRule: null });
      },
    };
    const response = await invoke(fixture, request(fixture));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ decision: AuthorityDecision.ALLOW });
    expect(calls).toEqual({ preference: 0, workflowRule: 0 });
  });
});
