import { AuthorityService, createAuthorityInternalRoutes, createApprovalRoutes } from "@truemandate/authority-service";
import { hashCanonical } from "@truemandate/crypto";
import { createGatewayInternalRoutes, TwoPhaseGateway } from "@truemandate/gateway-service";
import { compileAndVerify } from "@truemandate/intent-compiler";
import { IntentService } from "@truemandate/intent-service";
import { FakeModel } from "@truemandate/model";
import { OutcomeService } from "@truemandate/outcome-service";
import {
  ResolutionService,
  createOutcomeInternalRoutes,
  createResolutionReadRoutes,
  createRemedyRoutes,
  createRemedyExecutionPort,
} from "@truemandate/resolution-service";
import { EvidenceService, createEvidenceInternalRoutes } from "@truemandate/evidence-service";
import { cleanCompilerOutput } from "../../../agents/intent-compiler/src/test-fixtures.js";
import { cleanProcurementPlanOutput, acceptPlanVerifier } from "../../../agents/planner/src/test-fixtures.js";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  ErrorCode,
  MeaningClass,
  OutcomeContractState,
  ResolutionCaseState,
  SourceType,
  err,
  ok,
  type ApprovalEvent,
  type ApprovalRequest,
  type Intent,
  type IntentState,
  type Result,
} from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { authorityExecutionProvenance } from "@truemandate/provenance";
import { AuthoritativeIntentService } from "../../agent-runtime/src/authoritative-intent-service.js";
import { GenericWorkflowEngine } from "../../agent-runtime/src/generic-workflow-engine.js";
import { ProcurementDomainPack } from "../../agent-runtime/src/procurement-domain-pack.js";
import type { EvaluationStore, AuthorityEvaluationRecord } from "@truemandate/authority";
import { wave1AcceptanceFixture, wave1AuthorizationEvidence, wave1FullDeliveryEvidence, wave1ReplacementEvidence, wave1ShortDeliveryEvidence, wave1Workflow } from "./fixture.js";

export const WAVE1_CALLER = "wave1-verifier@test.iam.gserviceaccount.com";
export const WAVE1_COMMIT_CALLER = "resolution-service@test.iam.gserviceaccount.com";
export const NOW = "2026-06-01T12:00:00.000Z";
export const EXPIRY = "2026-12-31T17:00:00.000Z";

type Artifact = {
  readonly id: string;
  readonly intentId: string;
  readonly workflowId: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly predecessors: readonly { readonly id: string; readonly kind: string; readonly contentHash: string }[];
  readonly contentHash: string;
  readonly createdAt: string;
};

class MemoryEvaluations implements EvaluationStore {
  readonly rows = new Map<string, AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: AuthorityEvaluationRecord) {
    if (this.rows.has(id)) return ok(false);
    this.rows.set(id, value);
    return ok(true);
  }
}

/** Owner-shaped test double: it alone assigns immutable artifact hashes. */
class Owner {
  constructor(
    readonly intents: IntentService,
    readonly provenance: ProvenanceService,
    readonly artifacts: Map<string, Artifact> = new Map(),
    readonly capabilities?: Readonly<Record<string, AuthorityDecision>>,
  ) {}

  async getIntent(id: string) { return this.intents.getIntent(id); }
  async createIntent(raw: unknown) { return this.intents.createIntent(raw); }
  async getTip(id: string) { return this.intents.getCurrentIntentState(id); }
  async getIntentState(id: string) { return this.intents.getIntentState(id); }
  async recordNode(raw: unknown) { return this.provenance.recordNode(raw); }
  async recordEdge(raw: unknown) { return this.provenance.recordEdge(raw); }
  async getNode(id: string) { return this.provenance.getNode(id); }
  async getEdge(id: string) { return this.provenance.getEdge(id); }
  async createAuthorityBinding(raw: unknown): Promise<Result<unknown>> {
    const value = raw as { lineage?: import("@truemandate/provenance").AuthorityExecutionLineage; createdAt?: string };
    if (!value.lineage || !value.createdAt) return err(ErrorCode.SCHEMA_PARSE_FAILED, "Malformed authority provenance binding");
    const records = authorityExecutionProvenance(value.lineage, value.createdAt);
    for (const node of [records.principal, records.authority]) { const saved = await this.provenance.recordNode(node); if (!saved.ok) return saved; }
    for (const edge of [records.principalEdge, records.authorizes]) { const saved = await this.provenance.recordEdge(edge); if (!saved.ok) return saved; }
    return ok(records);
  }

  async putSemanticArtifact(raw: unknown): Promise<Result<unknown>> {
    if (!raw || typeof raw !== "object") return err(ErrorCode.SCHEMA_PARSE_FAILED, "Malformed semantic artifact");
    const input = raw as Record<string, unknown>;
    if (typeof input.id !== "string" || typeof input.intentId !== "string" || typeof input.workflowId !== "string" || typeof input.kind !== "string" || !input.payload || typeof input.payload !== "object" || typeof input.createdAt !== "string") {
      return err(ErrorCode.SCHEMA_PARSE_FAILED, "Malformed semantic artifact");
    }
    if (input.contentHash !== undefined) return err(ErrorCode.VALIDATION_FAILED, "Caller cannot set semantic artifact hash");
    const predecessors = Array.isArray(input.predecessors) ? input.predecessors as Artifact["predecessors"] : [];
    for (const predecessor of predecessors) {
      const persisted = this.artifacts.get(predecessor.id);
      if (!persisted || persisted.contentHash !== predecessor.contentHash || persisted.kind !== predecessor.kind || persisted.workflowId !== input.workflowId) {
        return err(ErrorCode.VALIDATION_FAILED, "Invalid semantic predecessor");
      }
    }
    if (this.artifacts.has(input.id)) return err(ErrorCode.VALIDATION_FAILED, "Semantic artifact immutable");
    const payload = input.payload as Record<string, unknown>;
    const normalized = input.kind === "GUARDIAN" && Array.isArray(payload.evaluatedProofs)
      ? { ...payload, evaluatedProofs: [...payload.evaluatedProofs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
      : payload;
    const artifact: Artifact = {
      id: input.id, intentId: input.intentId, workflowId: input.workflowId, kind: input.kind,
      payload: normalized, predecessors, contentHash: hashCanonical(normalized), createdAt: input.createdAt,
    };
    this.artifacts.set(artifact.id, artifact);
    return ok(artifact);
  }
  async getSemanticArtifact(id: string): Promise<Result<unknown>> {
    const value = this.artifacts.get(id);
    return value ? ok(value) : err(ErrorCode.VALIDATION_FAILED, "Unknown semantic artifact");
  }
  async listWorkflowArtifacts(workflowId: string): Promise<Result<readonly unknown[]>> {
    return ok([...this.artifacts.values()].filter((artifact) => artifact.workflowId === workflowId));
  }
  async createCompilation(raw: unknown) { return this.putSemanticArtifact(raw); }
  async createCompilationVerification(raw: unknown) { return this.putSemanticArtifact(raw); }
  async finalizeCompilation(raw: unknown): Promise<Result<IntentState>> {
    const refs = raw as { compilationId: string; compilationHash: string; verificationId: string; verificationHash: string };
    const compilation = this.artifacts.get(refs.compilationId);
    const verification = this.artifacts.get(refs.verificationId);
    if (!compilation || !verification || compilation.contentHash !== refs.compilationHash || verification.contentHash !== refs.verificationHash) return err(ErrorCode.VALIDATION_FAILED, "Compilation lineage mismatch");
    const candidate = compilation.payload.candidate as import("@truemandate/protocol").CandidateInterpretation;
    const result = verification.payload.verification as import("@truemandate/protocol").SemanticVerificationResult;
    const temporal = candidate.constraints.find((constraint) => constraint.kind === ConstraintKind.TEMPORAL && constraint.sourceType === SourceType.HUMAN && constraint.meaningClass === MeaningClass.EXPLICIT)?.temporalResolution;
    return this.intents.finalizeVerifiedCompilation({
      intentId: compilation.intentId,
      candidate,
      verification: result,
      compilationHash: compilation.contentHash,
      temporalAuthority: temporal ? { executionNotAfter: temporal.resolvedValue, source: "EXPLICIT_HUMAN", sourceRef: candidate.constraints.find((constraint) => constraint.temporalResolution === temporal)!.id } : undefined,
      capabilities: this.capabilities,
      artifactLineage: { compilationId: refs.compilationId, verificationId: refs.verificationId, verificationHash: refs.verificationHash, workflowId: compilation.workflowId },
    });
  }
}

function resultFromRoute(response: { status: number; body: unknown }): Result<unknown> {
  if (response.status >= 200 && response.status < 300) return ok(response.body);
  const body = response.body as { error?: ErrorCode; message?: string };
  return err(body.error ?? ErrorCode.VALIDATION_FAILED, body.message ?? "Internal owner route rejected");
}

function model(plannerTransform?: (output: unknown) => unknown) {
  return new FakeModel({
    defaultHandler: async (request) => {
      if (request.schemaId === "planner.plan.v1") {
        const payload = request.userPayload as { constraints: readonly import("@truemandate/protocol").Constraint[]; requiredProofObligations?: readonly import("@truemandate/protocol").ProofObligation[] };
        const output = cleanProcurementPlanOutput(payload.constraints, { requiredProofObligations: payload.requiredProofObligations });
        return plannerTransform ? plannerTransform(output) : output;
      }
      if (request.schemaId === "plan-verifier.result.v1") return acceptPlanVerifier();
      return { findings: [], constraintClassifications: ((request.userPayload as { constraints?: readonly { id: string }[] }).constraints ?? []).map((constraint) => ({ constraintId: constraint.id, classification: "SUPPORTED", confidence: 1 })) };
    },
  });
}

export interface Wave1Runtime {
  readonly coordinator: GenericWorkflowEngine<import("../../agent-runtime/src/procurement-domain-pack.js").ProcurementInput>;
  readonly owner: Owner;
  readonly gateway: TwoPhaseGateway;
  readonly authority: AuthorityService;
  readonly outcomes: OutcomeService;
  readonly resolution: ResolutionService;
  readonly intentState: IntentState;
  readonly intent: Intent;
  readonly evaluations: MemoryEvaluations;
  readonly commitRoute: { handler(input: { body: unknown; headers: Record<string, unknown>; params: Record<string, string> }): Promise<{ status: number; body: unknown }> };
  readonly evaluateEvidenceRoute: { handler(input: { body: unknown; headers: Record<string, unknown>; params: Record<string, string> }): Promise<{ status: number; body: unknown }> };
  readonly closeContractRoute: { handler(input: { body: unknown; headers: Record<string, unknown>; params: Record<string, string> }): Promise<{ status: number; body: unknown }> };
  readonly submitFixture: (fixture: unknown) => Promise<Result<unknown>>;
  readonly getCaseByContract: (contractId: string) => Promise<Result<unknown>>;
  readonly listRemedies: (caseId: string) => Promise<{ status: number; body: unknown }>;
  readonly issueMandate: (caseId: string, remedyId: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  readonly executeRemedy: (caseId: string, remedyId: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  readonly verifyRemedy: (caseId: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  readonly getContract: (id: string) => Promise<Result<import("@truemandate/protocol").OutcomeContract>>;
}

export async function wave1Runtime(
  rawText: string,
  intentId: string,
  options: {
    readonly compilerTransform?: (output: unknown) => unknown;
    readonly plannerTransform?: (output: unknown) => unknown;
    readonly capabilities?: Readonly<Record<string, AuthorityDecision>>;
  } = {},
): Promise<Wave1Runtime> {
  const provenance = new ProvenanceService();
  const artifactRows = new Map<string, Artifact>();
  const intentOwner = new IntentService(undefined, {
    putIfAbsent: async (record) => {
      if (artifactRows.has(record.id)) return false;
      artifactRows.set(record.id, record as Artifact);
      return true;
    },
    get: async (id) => artifactRows.get(id),
  });
  const owner = new Owner(intentOwner, provenance, artifactRows, options.capabilities);
  const compiler = new FakeModel({ handlers: {
    "compiler.candidate.v1": async () => {
      const base = cleanCompilerOutput(rawText);
      const output = { ...base, ambiguities: [], readiness: "EXECUTABLE", constraints: [...base.constraints, {
        id: "c-deadline", concept: "execution_deadline", operator: ConstraintOperator.LTE, value: EXPIRY,
        kind: ConstraintKind.TEMPORAL, importance: 1, confidence: 1, sourceType: SourceType.HUMAN,
        mutability: ConstraintMutability.IMMUTABLE, meaningClass: MeaningClass.EXPLICIT,
        grounding: { sourceText: "before 2026-12-31T17:00:00.000Z", sourceSpan: { start: rawText.indexOf("before"), end: rawText.length }, quoteExact: true },
        temporalResolution: { originalExpression: "before 2026-12-31T17:00:00.000Z", resolvedValue: EXPIRY, resolutionTimestamp: NOW, timezone: "UTC" },
      }] };
      return options.compilerTransform ? options.compilerTransform(output) : output;
    },
  } });
  const verifier = new FakeModel({ handlers: { "verifier.result.v1": async () => ({ findings: [], transformations: [], criticalFailure: false, readiness: "EXECUTABLE", ambiguityClass: "A0" }) } });
  const compiled = await compileAndVerify({ principalId: "wave1-human-principal", rawText, intentId, createdAt: NOW }, { intents: owner as never, provenance, compilerModel: compiler, verifierModel: verifier });
  if (!compiled.ok || !compiled.value.intentState) throw new Error(compiled.ok ? "owner finalization did not return state" : compiled.message);
  const state = compiled.value.intentState;

  const authoritative = new AuthoritativeIntentService(owner as never);
  const authority = new AuthorityService(authoritative);
  const evaluations = new MemoryEvaluations();
  const outcomes = new OutcomeService();
  const evidenceService = new EvidenceService();
  const approvalStore = new Map<string, ApprovalRequest>();
  const approvalEvents = new Map<string, ApprovalEvent>();
  const resolution = new ResolutionService(outcomes, undefined, undefined, {
    getIntentState: async (id) => (await owner.getIntentState(id)).ok ? (await owner.getIntentState(id)).value : undefined,
  });
  const gateway = new TwoPhaseGateway({
    intents: authoritative,
    authority,
    provenance,
    provenanceOwner: { getNode: async (id) => provenance.getNode(id), getEdge: async (id) => provenance.getEdge(id) },
    outcomeBinding: outcomes,
  });

  const artifacts = { getSemanticArtifact: (id: string) => owner.getSemanticArtifact(id), getTip: (id: string) => owner.getTip(id), getIntentState: (id: string) => owner.getIntentState(id) };
  const approvalRoutes = createApprovalRoutes({
    approvals: {
      get: (id) => Promise.resolve(approvalStore.get(id)),
      putIfAbsent: async (id, value) => { if (approvalStore.has(id)) return false; approvalStore.set(id, value); return true; },
      put: async (id, value) => { approvalStore.set(id, value); },
    },
    approvalEvents: { putIfAbsent: async (id, value) => { if (approvalEvents.has(id)) return false; approvalEvents.set(id, value); return true; } },
    evaluations,
    tip: {
      getCurrentIntentState: async (iid) => {
        const tip = await owner.getTip(iid);
        if (!tip.ok) return tip;
        return { ok: true as const, value: { id: tip.value.id, stateHash: tip.value.stateHash } };
      },
    },
  });
  const approvalCreateRoute = approvalRoutes.find((route) => route.pattern === "/internal/approvals")!;
  const approvalGetRoute = approvalRoutes.find((route) => route.pattern === "/internal/approvals/:id")!;

  const authorityRoutes = createAuthorityInternalRoutes({
    authority,
    artifacts,
    evaluations,
    preparedActions: { get: async (id) => gateway.getPreparedActionStore().get(id) },
    outcomeContracts: { get: async (id) => outcomes.getContract(id) },
    provenance: owner,
    approvals: { get: (id) => approvalStore.get(id) },
    resolution: {
      getMandate: async (id) => resolution.getMandate(id),
      getCase: async (id) => resolution.getCase(id),
      getRemedy: async (caseId, remedyId) => resolution.getRemedy(caseId, remedyId),
    },
  });
  const evaluationRoute = authorityRoutes.find((route) => route.pattern === "/internal/authority/procurement")!;
  const mintRoute = authorityRoutes.find((route) => route.pattern === "/internal/authority/bind-and-mint")!;
  const remedyEvaluationRoute = authorityRoutes.find((route) => route.pattern === "/internal/authority/remedy-evaluations")!;

  const gatewayRoutes = createGatewayInternalRoutes({
    gateway,
    owners: { getEvaluation: async (id) => evaluations.get(id), getOutcomeContract: (id) => outcomes.getContract(id), getArtifact: (id) => owner.getSemanticArtifact(id), getState: (id) => owner.getIntentState(id), getTip: (id) => owner.getTip(id) },
    commitCallers: [WAVE1_COMMIT_CALLER],
    approvalReadPort: { get: (id) => approvalStore.get(id) },
  });
  const prepareRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/prepare-references")!;
  const authorizeRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/authorize")!;
  const commitRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/commit")!;

  const fixtureRows = new Map<string, unknown>();
  const evidenceOwner = {
    getEnvelope: async (id: string) => {
      const result = await evidenceService.getEnvelope(id);
      return result.ok ? result.value : undefined;
    },
    getClaim: async (id: string) => {
      const result = await evidenceService.getClaim(id);
      return result.ok ? result.value : undefined;
    },
    persistFixture: async (fixture: unknown): Promise<Result<unknown>> => {
      const value = fixture as { envelopes: unknown[]; claims: unknown[] };
      for (const envelope of value.envelopes) {
        const saved = await evidenceService.persistEnvelope(envelope, { get: async (id) => fixtureRows.get(id), putIfAbsent: async (id, row) => { if (fixtureRows.has(id)) return false; fixtureRows.set(id, row); return true; } });
        if (!saved.ok) return saved;
      }
      for (const claim of value.claims) {
        const saved = await evidenceService.persistClaim(claim, { get: async (id) => fixtureRows.get(id), putIfAbsent: async (id, row) => { if (fixtureRows.has(id)) return false; fixtureRows.set(id, row); return true; } });
        if (!saved.ok) return saved;
      }
      return ok({ envelopeIds: value.envelopes.map((x) => (x as { id: string }).id), claimIds: value.claims.map((x) => (x as { id: string }).id) });
    },
  };
  const evidenceRoutes = createEvidenceInternalRoutes(
    evidenceOwner,
    [{ email: WAVE1_CALLER, idPrefix: "wave1-" }],
    [WAVE1_CALLER, WAVE1_COMMIT_CALLER],
  );
  const evidenceFixtureRoute = evidenceRoutes.find((route) => route.pattern === "/internal/evidence/acceptance-fixtures")!;

  const outcomeRoutes = createOutcomeInternalRoutes(outcomes, {
    getEvaluation: async (id) => evaluations.get(id),
    getArtifact: (id) => owner.getSemanticArtifact(id),
    getState: (id) => owner.getIntentState(id),
    getTip: (id) => owner.getTip(id),
  }, {
    globalCallers: [WAVE1_CALLER],
    authorityCallerEmail: "authority@test.iam.gserviceaccount.com",
    evaluationCallerEmail: WAVE1_CALLER,
    evidenceReadPort: {
      getClaim: async (id) => { const r = await evidenceService.getClaim(id); return r.ok ? ok(r.value) : err(ErrorCode.VALIDATION_FAILED, "Unknown claim"); },
      getEnvelope: async (id) => { const r = await evidenceService.getEnvelope(id); return r.ok ? ok(r.value) : err(ErrorCode.VALIDATION_FAILED, "Unknown envelope"); },
    },
    approvalReadPort: { get: (id) => approvalStore.get(id) },
    resolutionRead: { getCaseByContract: (contractId) => resolution.getCaseByContract(contractId) },
  });
  const outcomeRoute = outcomeRoutes.find((route) => route.method === "POST" && route.pattern === "/internal/outcomes/procurement-contract")!;
  const evaluateEvidenceRoute = outcomeRoutes.find((route) => route.pattern === "/internal/outcomes/:outcomeContractId/evaluate-evidence")!;
  const closeContractRoute = outcomeRoutes.find((route) => route.pattern === "/internal/outcomes/contracts/:id/close")!;

  const remedyPort = createRemedyExecutionPort({
    owner,
    authority: {
      evaluateRemedyProcurement: async (body) => resultFromRoute(await remedyEvaluationRoute.handler({ body, headers: {}, params: {} })),
      bindAndMint: async (body) => resultFromRoute(await mintRoute.handler({ body, headers: {}, params: {} })),
    },
    gateway: {
      prepareFromReferences: async (body) => resultFromRoute(await prepareRoute.handler({ body, headers: {}, params: {} })) as Result<import("@truemandate/protocol").PreparedAction>,
      authorize: async (body) => resultFromRoute(await authorizeRoute.handler({ body, headers: {}, params: {} })),
      commit: async (body) => resultFromRoute(await commitRoute.handler({ body, headers: {}, params: {} })),
    },
    outcomes,
    resolution,
  });

  const readRoutes = createResolutionReadRoutes(resolution, [WAVE1_CALLER, WAVE1_COMMIT_CALLER, "authority@test.iam.gserviceaccount.com"]);
  const caseByContractRoute = readRoutes.find((route) => route.pattern === "/internal/resolutions/cases/by-contract/:outcomeContractId")!;
  const remedyRoutes = createRemedyRoutes({
    resolution,
    outcomes,
    gateway: remedyPort,
    getIntentState: async (id) => (await owner.getIntentState(id)).ok ? (await owner.getIntentState(id)).value : undefined,
    remedyCallers: [WAVE1_CALLER, WAVE1_COMMIT_CALLER],
  });
  const remediesListRoute = remedyRoutes.find((route) => route.pattern === "/internal/resolutions/cases/:id/remedies")!;
  const mandateRoute = remedyRoutes.find((route) => route.pattern === "/internal/resolutions/cases/:id/remedies/:remedyId/mandates")!;
  const executeRoute = remedyRoutes.find((route) => route.pattern === "/internal/resolutions/cases/:id/remedies/:remedyId/execute")!;
  const verifyRoute = remedyRoutes.find((route) => route.pattern === "/internal/resolutions/cases/:id/remedy-verification")!;

  const coordinator = new GenericWorkflowEngine({
    pack: ProcurementDomainPack,
    intents: authoritative, owner: owner as never,
    evidence: { getEnvelope: async (id) => { const r = await evidenceService.getEnvelope(id); return r.ok ? ok({ id, contentHash: r.value.contentHash } as never) : err(ErrorCode.VALIDATION_FAILED, "unknown"); }, getClaim: async () => err(ErrorCode.VALIDATION_FAILED, "not used") },
    authority: {
      evaluateWorkflow: async (body) => resultFromRoute(await evaluationRoute.handler({ body, headers: {}, params: {} })),
      bindAndMint: async (body) => resultFromRoute(await mintRoute.handler({ body, headers: {}, params: {} })),
      createApproval: async (body) => resultFromRoute(await approvalCreateRoute.handler({ body, headers: {}, params: {} })),
      getApproval: async (id) => resultFromRoute(await approvalGetRoute.handler({ body: undefined, headers: {}, params: { id } })),
    },
    outcomes: { createContract: async (body) => resultFromRoute(await outcomeRoute.handler({ body, headers: {}, params: {} })) },
    gateway: {
      prepareFromReferences: async (body) => resultFromRoute(await prepareRoute.handler({ body, headers: {}, params: {} })) as Result<import("@truemandate/protocol").PreparedAction>,
      authorize: async (body) => resultFromRoute(await authorizeRoute.handler({ body, headers: {}, params: {} })),
      commit: async (body) => resultFromRoute(await commitRoute.handler({ body, headers: {}, params: {} })),
    },
    model: model(options.plannerTransform), provenance, now: () => NOW,
  });

  return {
    coordinator, owner, gateway, authority, outcomes, resolution,
    evaluations,
    intentState: state,
    intent: compiled.value.intent,
    commitRoute,
    evaluateEvidenceRoute,
    closeContractRoute,
    submitFixture: async (fixture) => {
      const response = await evidenceFixtureRoute.handler({ body: fixture, headers: {}, params: {}, caller: { email: WAVE1_CALLER } });
      return resultFromRoute(response);
    },
    getCaseByContract: async (contractId) => resultFromRoute(await caseByContractRoute.handler({ body: undefined, headers: {}, params: { outcomeContractId: contractId }, caller: { email: WAVE1_CALLER } })),
    listRemedies: async (caseId) => remediesListRoute.handler({ body: undefined, headers: {}, params: { id: caseId }, caller: { email: WAVE1_CALLER } }),
    issueMandate: async (caseId, remedyId, body) => mandateRoute.handler({ body, headers: {}, params: { id: caseId, remedyId }, caller: { email: WAVE1_CALLER } }),
    executeRemedy: async (caseId, remedyId, body) => executeRoute.handler({ body, headers: {}, params: { id: caseId, remedyId }, caller: { email: WAVE1_CALLER } }),
    verifyRemedy: async (caseId, body) => verifyRoute.handler({ body, headers: {}, params: { id: caseId }, caller: { email: WAVE1_CALLER } }),
    getContract: (id) => outcomes.getContract(id),
  };
}

/** Wave 1 acceptance A: unsafe supplier → BLOCK with zero purchase.
 *
 * The workflow terminates at the Guardian/semantic gate: the supplier-approval
 * obligation is UNSATISFIED, so the Action never becomes eligible and NO
 * AuthorityRequest is ever created. "Authority Denied" is represented as the
 * absence of authority (the Guardian made the action ineligible) — never as a
 * fabricated Authority record.
 */
export async function runWave1BlockAcceptance(rt: Wave1Runtime, intentId: string): Promise<{
  state: string;
  sideEffects: number;
  evaluations: number;
  guardianDecision: string;
  unsatisfiedProofs: number;
}> {
  const fixture = wave1AcceptanceFixture(intentId, wave1AuthorizationEvidence(intentId, "unsafe-supplier"));
  const submitted = await rt.submitFixture(fixture);
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  const workflow = wave1Workflow(intentId, { id: "unsafe-supplier", approved: false });
  const result = await rt.coordinator.run({ ...(workflow as object), expectedIntentStateId: rt.intentState.id });
  if (!result.ok) throw new Error(JSON.stringify({ stage: "workflow", code: result.code, message: result.message }));
  const state = (result.value as { state: string }).state;
  if (state !== "BLOCKED") throw new Error(JSON.stringify({ outcome: "WAVE1_A_NOT_BLOCKED", state }));
  const ledger = await rt.gateway.getSideEffectLedger().listAll();
  if (ledger.length !== 0) throw new Error(JSON.stringify({ outcome: "WAVE1_A_PURCHASE_HAPPENED", sideEffects: ledger.length }));
  // Zero authority: no evaluation record was ever created (the semantic gate
  // terminated the flow before the Authority owner was consulted).
  if (rt.evaluations.rows.size !== 0) throw new Error(JSON.stringify({ outcome: "WAVE1_A_EVALUATION_CREATED", evaluations: rt.evaluations.rows.size }));
  // The durable Guardian + PROOF records document the semantic failure
  // (unsatisfied supplier-approval obligation) — the fail-closed evidence
  // trail that keeps the action ineligible for authority.
  const guardianArtifact = [...rt.owner.artifacts.values()].find((artifact) => artifact.kind === "GUARDIAN");
  if (!guardianArtifact) throw new Error(JSON.stringify({ outcome: "WAVE1_A_GUARDIAN_MISSING" }));
  const verdict = (guardianArtifact.payload as { verdict?: { decision?: string } }).verdict;
  const unsatisfiedProofs = [...rt.owner.artifacts.values()].filter(
    (artifact) => artifact.kind === "PROOF" && (artifact.payload as { status?: string }).status === "UNSATISFIED",
  ).length;
  if (unsatisfiedProofs === 0) throw new Error(JSON.stringify({ outcome: "WAVE1_A_NO_UNSATISFIED_PROOF" }));
  return {
    state,
    sideEffects: ledger.length,
    evaluations: rt.evaluations.rows.size,
    guardianDecision: String(verdict?.decision ?? "UNKNOWN"),
    unsatisfiedProofs,
  };
}

/** Wave 1 acceptance B: valid supplier, full delivery → SATISFIED → CLOSED.
 * Full acceptance evidence: exactly one controlled purchase side effect,
 * payment SUCCESS, quantity 500, valid food-grade evidence, approved
 * supplier, amount within budget, SATISFIED → CLOSED, no ResolutionCase,
 * CommitToken consumed exactly once, replay adds zero side effects. */
export async function runWave1FullDeliveryAcceptance(rt: Wave1Runtime, intentId: string): Promise<{
  contractId: string;
  state: string;
  sideEffects: number;
  paymentStatus: string;
  quantityReceived: number;
  foodGradeSatisfied: boolean;
  supplierSatisfied: boolean;
  amount: number;
  withinBudget: boolean;
  tokenConsumed: boolean;
  replaySideEffects: number;
}> {
  const fixture = wave1AcceptanceFixture(intentId, [
    ...wave1AuthorizationEvidence(intentId, "wave1-supplier"),
    ...wave1FullDeliveryEvidence(intentId),
  ]);
  const submitted = await rt.submitFixture(fixture);
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  const workflow = wave1Workflow(intentId, { id: "wave1-supplier", approved: true });
  const result = await rt.coordinator.run({ ...(workflow as object), expectedIntentStateId: rt.intentState.id });
  if (!result.ok) throw new Error(JSON.stringify({ stage: "workflow", code: result.code, message: result.message }));
  const value = result.value as { state: string; authorization?: { commitToken?: { id?: string }; grant?: { id?: string; amount?: number; currency?: string; outcomeContractId?: string } } };
  const tokenId = value.authorization?.commitToken?.id;
  if (value.state !== "AUTHORIZED" || !tokenId) {
    throw new Error(JSON.stringify({ outcome: "WAVE1_B_AUTHORIZATION_INCOMPLETE", state: value.state }));
  }
  const commit = await rt.commitRoute.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
  if (commit.status !== 200 || ((commit.body as { status?: string }).status ?? "UNKNOWN") !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "WAVE1_B_COMMIT_FAILED", status: commit.status, body: commit.body }));
  }
  const grant = value.authorization?.grant;
  const contractId = grant?.outcomeContractId;
  if (!contractId) throw new Error(JSON.stringify({ outcome: "WAVE1_B_CONTRACT_MISSING" }));
  const claims = wave1FullDeliveryEvidence(intentId).map((item) => `${item.artifactId}-claim`);
  const evaluated = await rt.evaluateEvidenceRoute.handler({ body: { claimIds: claims }, headers: {}, params: { outcomeContractId: contractId }, caller: { email: WAVE1_CALLER } });
  if (evaluated.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_B_EVALUATION_FAILED", status: evaluated.status, body: evaluated.body }));
  const contractState = (evaluated.body as { contract: { state: string } }).contract.state;
  if (contractState !== OutcomeContractState.SATISFIED) throw new Error(JSON.stringify({ outcome: "WAVE1_B_NOT_SATISFIED", state: contractState }));

  const contract = (evaluated.body as { contract: import("@truemandate/protocol").OutcomeContract }).contract;
  const requirements = contract.requirements;
  const qtyReq = requirements.find((req) => req.concept === "quantity_received");
  const foodReq = requirements.find((req) => req.concept === "food_grade");
  const supplierReq = requirements.find((req) => req.concept === "supplier_approved");

  // Full acceptance evidence.
  const ledger = await rt.gateway.getSideEffectLedger().listAll();
  if (ledger.length !== 1 || ledger[0]!.resultState !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "WAVE1_B_SIDE_EFFECT_NOT_EXACTLY_ONE", sideEffects: ledger.length, state: ledger[0]?.resultState }));
  }
  if (contract.paymentStatus !== "SUCCESS") throw new Error(JSON.stringify({ outcome: "WAVE1_B_PAYMENT_NOT_SUCCESS", paymentStatus: contract.paymentStatus }));
  if (qtyReq?.state !== "SATISFIED" || qtyReq.value !== 500) throw new Error(JSON.stringify({ outcome: "WAVE1_B_QUANTITY_MISMATCH", qtyReq }));
  if (foodReq?.state !== "SATISFIED") throw new Error(JSON.stringify({ outcome: "WAVE1_B_FOOD_GRADE_UNSATISFIED", foodReq }));
  if (supplierReq?.state !== "SATISFIED") throw new Error(JSON.stringify({ outcome: "WAVE1_B_SUPPLIER_UNSATISFIED", supplierReq }));
  const amount = grant?.amount ?? 0;
  if (amount !== 742000 || amount > 800000) throw new Error(JSON.stringify({ outcome: "WAVE1_B_AMOUNT_OUT_OF_BOUNDS", amount }));
  const token = await rt.gateway.getCommitTokenStore().get(tokenId);
  if (!token.ok || !token.value?.consumed) throw new Error(JSON.stringify({ outcome: "WAVE1_B_TOKEN_NOT_CONSUMED" }));

  const closed = await rt.closeContractRoute.handler({ body: undefined, headers: {}, params: { id: contractId }, caller: { email: WAVE1_CALLER } });
  if (closed.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_B_CLOSE_FAILED", status: closed.status, body: closed.body }));
  const finalState = (closed.body as { state: string }).state;
  if (finalState !== OutcomeContractState.CLOSED) throw new Error(JSON.stringify({ outcome: "WAVE1_B_NOT_CLOSED", state: finalState }));
  const caseRead = await rt.getCaseByContract(contractId);
  if (caseRead.ok) throw new Error(JSON.stringify({ outcome: "WAVE1_B_UNEXPECTED_RESOLUTION_CASE" }));

  // Replay: the consumed token adds zero additional side effects.
  const replay = await rt.commitRoute.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
  if (replay.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_B_REPLAY_NOT_IDEMPOTENT", status: replay.status, body: replay.body }));
  const ledgerAfterReplay = await rt.gateway.getSideEffectLedger().listAll();
  if (ledgerAfterReplay.length !== 1) throw new Error(JSON.stringify({ outcome: "WAVE1_B_REPLAY_ADDED_SIDE_EFFECT", sideEffects: ledgerAfterReplay.length }));

  return {
    contractId,
    state: finalState,
    sideEffects: ledger.length,
    paymentStatus: contract.paymentStatus,
    quantityReceived: 500,
    foodGradeSatisfied: foodReq?.state === "SATISFIED",
    supplierSatisfied: supplierReq?.state === "SATISFIED",
    amount,
    withinBudget: amount <= 800000,
    tokenConsumed: Boolean(token.value?.consumed),
    replaySideEffects: ledgerAfterReplay.length,
  };
}

/** Wave 1 acceptance C: short delivery → PARTIAL → remedy → combined 500 → RESOLVED. */
export async function runWave1RemedyAcceptance(rt: Wave1Runtime, intentId: string): Promise<{
  originalContractId: string;
  originalState: string;
  remedyContractId: string;
  remedyState: string;
  caseState: string;
  combinedReceived: number;
}> {
  const fixture = wave1AcceptanceFixture(intentId, [
    ...wave1AuthorizationEvidence(intentId, "wave1-supplier"),
    ...wave1ShortDeliveryEvidence(intentId),
    ...wave1ReplacementEvidence(intentId),
  ]);
  const submitted = await rt.submitFixture(fixture);
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  const workflow = wave1Workflow(intentId, { id: "wave1-supplier", approved: true });
  const result = await rt.coordinator.run({ ...(workflow as object), expectedIntentStateId: rt.intentState.id });
  if (!result.ok) throw new Error(JSON.stringify({ stage: "workflow", code: result.code, message: result.message }));
  const value = result.value as { state: string; authorization?: { commitToken?: { id?: string }; grant?: { id?: string; outcomeContractId?: string } } };
  const tokenId = value.authorization?.commitToken?.id;
  const originalGrantId = value.authorization?.grant?.id;
  const contractId = value.authorization?.grant?.outcomeContractId;
  if (value.state !== "AUTHORIZED" || !tokenId || !originalGrantId || !contractId) {
    throw new Error(JSON.stringify({ outcome: "WAVE1_C_AUTHORIZATION_INCOMPLETE", state: value.state }));
  }
  const commit = await rt.commitRoute.handler({ body: { commitTokenId: tokenId }, headers: {}, params: {} });
  if (commit.status !== 200 || ((commit.body as { status?: string }).status ?? "UNKNOWN") !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "WAVE1_C_COMMIT_FAILED", status: commit.status }));
  }
  const deliveryClaims = wave1ShortDeliveryEvidence(intentId).map((item) => `${item.artifactId}-claim`);
  const evaluated = await rt.evaluateEvidenceRoute.handler({ body: { claimIds: deliveryClaims }, headers: {}, params: { outcomeContractId: contractId }, caller: { email: WAVE1_CALLER } });
  if (evaluated.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_EVALUATION_FAILED", status: evaluated.status, body: evaluated.body }));
  const partial = (evaluated.body as { contract: { state: string }; divergence: { shortfall: number } | null }).contract.state;
  const shortfall = (evaluated.body as { divergence: { shortfall: number } | null }).divergence?.shortfall;
  if (partial !== OutcomeContractState.PARTIAL || shortfall !== 50) {
    throw new Error(JSON.stringify({ outcome: "WAVE1_C_NOT_PARTIAL", state: partial, shortfall }));
  }

  // The owner's trigger lifecycle opens the durable ResolutionCase.
  let caseBody: { case: { id: string; state: string; responsibilityState: string } } | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await rt.getCaseByContract(contractId);
    if (found.ok) { caseBody = found.value as { case: { id: string; state: string; responsibilityState: string } }; break; }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (!caseBody) throw new Error(JSON.stringify({ outcome: "WAVE1_C_CASE_NOT_OPENED" }));
  const caseId = caseBody.case.id;
  if (caseBody.case.responsibilityState !== "UNKNOWN") {
    throw new Error(JSON.stringify({ outcome: "WAVE1_C_RESPONSIBILITY_NOT_UNKNOWN", responsibility: caseBody.case.responsibilityState }));
  }

  const remediesResponse = await rt.listRemedies(caseId);
  if (remediesResponse.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_REMEDIES_FAILED", body: remediesResponse.body }));
  const remedies = (remediesResponse.body as { remedies: { id: string; requiresFinancialAction: boolean }[] }).remedies;
  const replacement = remedies.find((remedy) => remedy.requiresFinancialAction);
  if (!replacement) throw new Error(JSON.stringify({ outcome: "WAVE1_C_NO_FINANCIAL_REMEDY" }));

  const mandateResponse = await rt.issueMandate(caseId, replacement.id, { expiresAt: EXPIRY });
  if (mandateResponse.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_MANDATE_FAILED", body: mandateResponse.body }));
  const mandate = (mandateResponse.body as { mandate: { id: string } }).mandate;

  const executed = await rt.executeRemedy(caseId, replacement.id, { mandateId: mandate.id, originalPaymentGrantId: originalGrantId });
  if (executed.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_EXECUTE_FAILED", status: executed.status, body: executed.body }));
  const execution = executed.body as { executionStatus: string; remedyOutcomeContractId: string; case: { state: string } };
  if (execution.executionStatus !== "SUCCESS") throw new Error(JSON.stringify({ outcome: "WAVE1_C_EXECUTION_NOT_SUCCESS", executionStatus: execution.executionStatus }));
  if (execution.case.state !== ResolutionCaseState.VERIFYING_REMEDY) throw new Error(JSON.stringify({ outcome: "WAVE1_C_NOT_VERIFYING", state: execution.case.state }));
  const remedyContractId = execution.remedyOutcomeContractId;

  // Remedy outcome evidence: the replacement delivery proves the remedy contract.
  const remedyClaims = wave1ReplacementEvidence(intentId).map((item) => `${item.artifactId}-claim`);
  const remedyEvaluated = await rt.evaluateEvidenceRoute.handler({ body: { claimIds: remedyClaims }, headers: {}, params: { outcomeContractId: remedyContractId }, caller: { email: WAVE1_CALLER } });
  if (remedyEvaluated.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_REMEDY_EVALUATION_FAILED", status: remedyEvaluated.status, body: remedyEvaluated.body }));
  const remedyState = (remedyEvaluated.body as { contract: { state: string } }).contract.state;
  if (remedyState !== OutcomeContractState.SATISFIED) throw new Error(JSON.stringify({ outcome: "WAVE1_C_REMEDY_NOT_SATISFIED", state: remedyState }));

  const verified = await rt.verifyRemedy(caseId, { remedyOutcomeContractId: remedyContractId });
  if (verified.status !== 200) throw new Error(JSON.stringify({ outcome: "WAVE1_C_VERIFY_FAILED", status: verified.status, body: verified.body }));
  const caseState = (verified.body as { state: string }).state;
  if (caseState !== ResolutionCaseState.RESOLVED) throw new Error(JSON.stringify({ outcome: "WAVE1_C_NOT_RESOLVED", state: caseState }));

  // History preserved: the original contract stays PARTIAL; the combined
  // received quantity (450 + 50) restores the full 500.
  const original = await rt.getContract(contractId);
  if (!original.ok || original.value.state !== OutcomeContractState.PARTIAL) {
    throw new Error(JSON.stringify({ outcome: "WAVE1_C_ORIGINAL_HISTORY_LOST", state: original.ok ? original.value.state : original.code }));
  }
  return {
    originalContractId: contractId,
    originalState: original.value.state,
    remedyContractId,
    remedyState,
    caseState,
    combinedReceived: 450 + 50,
  };
}
