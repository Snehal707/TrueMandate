import { AuthorityService, type EvaluationStore } from "@truemandate/authority-service";
import { createEnvelope, MemoryPubSubPublisherPort } from "@truemandate/cloud-pubsub";
import { FakeModelArmor, ModelInspectionStatus } from "@truemandate/cloud-security";
import { hashCanonical, proofObligationId } from "@truemandate/crypto";
import { createGatewayInternalRoutes, TwoPhaseGateway } from "@truemandate/gateway-service";
import { compileAndVerify } from "@truemandate/intent-compiler";
import { IntentService } from "@truemandate/intent-service";
import { supersedeSemanticVerification } from "../../intent-service/src/semantic-supersession.js";
import { PreExecutionReadinessService } from "./pre-execution-readiness.js";
import { FakeModel } from "@truemandate/model";
import { OutcomeService } from "@truemandate/outcome-service";
import { deriveObservations, type AcceptedEvidenceClaim } from "@truemandate/outcome-core";
import { cleanCompilerOutput } from "../../../agents/intent-compiler/src/test-fixtures.js";
import { cleanProcurementPlanOutput, cleanTravelPlanOutput, acceptPlanVerifier } from "../../../agents/planner/src/test-fixtures.js";
import { AuthorityDecision, ConstraintKind, ConstraintMutability, ConstraintOperator, ErrorCode, MeaningClass, OutcomeContractState, SourceType, err, ok, type Intent, type IntentState, type Result } from "@truemandate/protocol";
import { ProvenanceService } from "@truemandate/provenance-service";
import { authorityExecutionProvenance } from "@truemandate/provenance";
import { handleEvidenceEvent, handleExecutionEvent } from "../../resolution-service/src/event-handler.js";
import { createOutcomeInternalRoutes } from "../../resolution-service/src/outcome-internal-routes.js";
import { ResolutionService } from "../../resolution-service/src/service.js";
import { describe, expect, it, vi } from "vitest";
import { AuthoritativeIntentService } from "./authoritative-intent-service.js";
import { createAuthorityInternalRoutes } from "../../authority-service/src/internal-routes.js";
import { createApprovalRoutes } from "../../authority-service/src/approval-routes.js";
import { GenericWorkflowEngine } from "./generic-workflow-engine.js";
import { InvoiceVendorPaymentDomainPack } from "./invoice-vendor-payment-domain-pack.js";
import { handleIntentCompileEvent } from "./intent-event-handler.js";
import { LogisticsFulfillmentDomainPack } from "./logistics-fulfillment-domain-pack.js";
import { ProcurementDomainPack } from "./procurement-domain-pack.js";
import { SaasItSpendDomainPack } from "./saas-it-spend-domain-pack.js";
import { TravelDomainPack } from "./travel-domain-pack.js";
import { GenericWorkflowDispatcher } from "./workflow-dispatcher.js";
import {
  classifyRequiredProofCoverage,
  deriveRequiredProofObligations,
} from "@truemandate/semantic-readiness";

const NOW = "2026-06-01T12:00:00.000Z";
const EXPIRY = "2026-12-31T17:00:00.000Z";
const H = (char: string) => char.repeat(64);

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
  readonly rows = new Map<string, import("@truemandate/authority").AuthorityEvaluationRecord>();
  async get(id: string) { return ok(this.rows.get(id)); }
  async putIfAbsent(id: string, value: import("@truemandate/authority").AuthorityEvaluationRecord) {
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
  async getTip(id: string) {
    const tip = await this.intents.getCurrentIntentState(id);
    if (
      !tip.ok &&
      tip.code === ErrorCode.VALIDATION_FAILED &&
      tip.message === "No IntentState tip for intent"
    ) {
      return err(ErrorCode.VALIDATION_FAILED, tip.message, {
        ...(tip.details ?? {}),
        status: 404,
      });
    }
    return tip;
  }
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

function withExecutionCapability(output: unknown, capability: string) {
  if (capability === "execute_payment") return output;
  const plan = output as {
    steps: Array<{ requestedCapabilities: string[]; requiredFutureCapabilities: string[] }>;
  };
  return {
    ...plan,
    steps: plan.steps.map((step) => ({
      ...step,
      requestedCapabilities: step.requestedCapabilities.map((value) =>
        value === "execute_payment" ? capability : value,
      ),
      requiredFutureCapabilities: step.requiredFutureCapabilities.map((value) =>
        value === "execute_payment" ? capability : value,
      ),
    })),
  };
}

function model(plannerTransform?: (output: unknown) => unknown) {
  return new FakeModel({
    defaultHandler: async (request) => {
      if (request.schemaId === "planner.plan.v1") {
        const payload = request.userPayload as {
          constraints: readonly import("@truemandate/protocol").Constraint[];
          requiredProofObligations?: readonly import("@truemandate/protocol").ProofObligation[];
          planningContext?: { domainId?: string; executionCapability?: string };
        };
        const output = payload.planningContext?.domainId === "travel" || payload.planningContext?.executionCapability === "book_travel"
          ? cleanTravelPlanOutput(payload.constraints, { requiredProofObligations: payload.requiredProofObligations })
          : withExecutionCapability(
              cleanProcurementPlanOutput(payload.constraints, { requiredProofObligations: payload.requiredProofObligations }),
              payload.planningContext?.executionCapability ?? "execute_payment",
            );
        return plannerTransform ? plannerTransform(output) : output;
      }
      if (request.schemaId === "plan-verifier.result.v1") return acceptPlanVerifier();
      return { findings: [], constraintClassifications: ((request.userPayload as { constraints?: readonly { id: string }[] }).constraints ?? []).map((constraint) => ({ constraintId: constraint.id, classification: "SUPPORTED", confidence: 1 })) };
    },
  });
}

export async function runtime(options: {
  plannerTransform?: (output: unknown) => unknown;
  compilerTransform?: (output: unknown) => unknown;
  verificationReadiness?: "SEARCHABLE" | "PLANNABLE" | "ACTIONABLE" | "EXECUTABLE";
  rawText?: string;
  capabilities?: Readonly<Record<string, AuthorityDecision>>;
  stageRecorder?: import("@truemandate/observability").WorkflowStageRecorder;
  monitoringCreate?: (body: unknown) => Promise<Result<unknown>>;
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
  /**
   * Suppresses the harness's synthesized proofSummary so a test can exercise the
   * production path, where the summary only exists if evidence-backed readiness
   * actually produced one.
   */
  omitProofSummary?: boolean;
  /**
   * Deterministic trusted demo evidence. Supplying it wires the REAL
   * PreExecutionReadinessService, so the proof summary is produced by the genuine
   * evidence-backed readiness path rather than seeded by the harness.
   */
  demoEvidence?: readonly {
    readonly envelope: Record<string, unknown>;
    readonly claims: readonly Record<string, unknown>[];
  }[];
  /** The evidence-backed readiness handoff the lifecycle now calls in-process. */
  preExecutionReadiness?: { evaluate(raw: unknown): Promise<Result<unknown>> };
  evidence?: {
    getEnvelope(id: string): Promise<Result<unknown>>;
    getClaim(id: string): Promise<Result<unknown>>;
    listClaimsForEnvelope?(id: string): Promise<Result<unknown>>;
  };
  proofSummaryMutator?: (input: {
    readonly packId: string;
    readonly state: IntentState;
    readonly summary: Record<string, unknown>;
  }) => Record<string, unknown>;
} = {}) {
  const provenance = new ProvenanceService();
  const intentPublisher = new MemoryPubSubPublisherPort();
  // The owner's immutable semantic artifact rows back the IntentService's
  // owner-side SEMANTIC_VERIFICATION derivation during authoritative finalization.
  const artifactRows = new Map<string, Artifact>();
  const intentOwner = new IntentService(
    undefined,
    {
      putIfAbsent: async (record) => {
        if (artifactRows.has(record.id)) return false;
        artifactRows.set(record.id, record as Artifact);
        return true;
      },
      get: async (id) => artifactRows.get(id),
    },
    intentPublisher,
  );
  const owner = new Owner(intentOwner, provenance, artifactRows, options.capabilities);
  const rawText =
    options.rawText ??
    "Buy 500 food-grade containers from an approved supplier for under INR 800000 before 2026-12-31T17:00:00.000Z";
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
  const compiled = await compileAndVerify({ principalId: "principal-e2e", rawText, intentId: "intent-e2e", createdAt: NOW }, { intents: owner as never, provenance, compilerModel: compiler, verifierModel: verifier });
  if (!compiled.ok || !compiled.value.intentState) throw new Error(compiled.ok ? "owner finalization did not return state" : compiled.message);
  const state = compiled.value.intentState;
  // Production owner finalization must have derived the immutable
  // SEMANTIC_VERIFICATION artifact; no test-side seeding.
  const ownerVerification = artifactRows.get(`semantic-verification-${state.id}`);
  if (!ownerVerification || ownerVerification.kind !== "SEMANTIC_VERIFICATION") {
    throw new Error("owner finalization did not create the SEMANTIC_VERIFICATION artifact");
  }
  if (options.verificationReadiness) {
    const verificationPayload = ownerVerification.payload as {
      verification?: Record<string, unknown>;
    };
    if (verificationPayload.verification) {
      verificationPayload.verification = {
        ...verificationPayload.verification,
        readiness: options.verificationReadiness,
      };
    }
    ownerVerification.contentHash = hashCanonical(ownerVerification.payload);
  }
  intentPublisher.clear();

  const authoritative = new AuthoritativeIntentService(owner as never);

  /**
   * Deterministic demo evidence, seeded the way a trusted acceptance-fixture
   * writer would: the rows are already ELEVATED_EXTERNAL because a trusted
   * identity attested them out of band. The workflow requester never verifies
   * its own evidence — it only references ids it did not create.
   *
   * With this present the harness wires the REAL PreExecutionReadinessService,
   * so the proof summary can only exist if the genuine readiness operation
   * produced it. No `semanticPayload.proofSummary = summary` shortcut.
   */
  const demoEnvelopes = new Map<string, Record<string, unknown>>();
  const demoClaims = new Map<string, Record<string, unknown>>();
  for (const row of options.demoEvidence ?? []) {
    demoEnvelopes.set(String(row.envelope.id), row.envelope);
    for (const claim of row.claims) demoClaims.set(String(claim.id), claim);
  }
  const demoEvidencePort = {
    getEnvelope: async (id: string) =>
      demoEnvelopes.has(id)
        ? ok(demoEnvelopes.get(id) as never)
        : err(ErrorCode.VALIDATION_FAILED, "Unknown evidence envelope"),
    getClaim: async (id: string) =>
      demoClaims.has(id)
        ? ok(demoClaims.get(id) as never)
        : err(ErrorCode.VALIDATION_FAILED, "Unknown evidence claim"),
    listClaimsForEnvelope: async (id: string) =>
      ok({
        envelopeId: id,
        claims: [...demoClaims.values()].filter((claim) => claim.evidenceId === id),
      } as never),
  };
  const realPreExecutionReadiness = options.demoEvidence
    ? new PreExecutionReadinessService({
        intents: authoritative,
        owner: {
          getSemanticArtifact: (id: string) => owner.getSemanticArtifact(id),
          supersedeSemanticVerification: (stateId: string, raw: unknown) =>
            supersedeSemanticVerification(
              intentOwner,
              {
                putIfAbsent: async (record) => {
                  if (artifactRows.has(record.id)) return false;
                  artifactRows.set(record.id, record as Artifact);
                  return true;
                },
                get: async (id) => artifactRows.get(id),
              },
              stateId,
              raw,
            ),
        } as never,
        evidence: demoEvidencePort as never,
        now: () => NOW,
      })
    : undefined;
  const authority = new AuthorityService(authoritative);
  const evaluations = new MemoryEvaluations();
  const outcomes = new OutcomeService();
  const resolution = new ResolutionService(outcomes, undefined, undefined, {
    getIntentState: async (id) => {
      const loaded = await owner.getIntentState(id);
      return loaded.ok ? loaded.value : undefined;
    },
  });
  const gateway = new TwoPhaseGateway({
    intents: authoritative,
    authority,
    provenance,
    provenanceOwner: { getNode: async (id) => provenance.getNode(id), getEdge: async (id) => provenance.getEdge(id) },
    outcomeBinding: outcomes,
  });
  const artifacts = { getSemanticArtifact: (id: string) => owner.getSemanticArtifact(id), getTip: (id: string) => owner.getTip(id), getIntentState: (id: string) => owner.getIntentState(id) };
  // Durable approval store + owner routes (shared by coordinator and outcome owner).
  const approvalStore = new Map<string, import("@truemandate/protocol").ApprovalRequest>();
  const approvalEvents = new Map<string, import("@truemandate/protocol").ApprovalEvent>();
  const approvalRoutes = createApprovalRoutes({
    approvals: {
      get: (id) => Promise.resolve(approvalStore.get(id)),
      putIfAbsent: async (id, value) => { if (approvalStore.has(id)) return false; approvalStore.set(id, value); return true; },
      put: async (id, value) => { approvalStore.set(id, value); },
    },
    approvalEvents: { putIfAbsent: async (id, value) => { if (approvalEvents.has(id)) return false; approvalEvents.set(id, value); return true; } },
    evaluations,
    tip: {
      getCurrentIntentState: async (intentId) => {
        const tip = await owner.getTip(intentId);
        if (!tip.ok) return tip;
        return { ok: true as const, value: { id: tip.value.id, stateHash: tip.value.stateHash } };
      },
    },
  });
  const approvalCreateRoute = approvalRoutes.find((route) => route.pattern === "/internal/approvals")!;
  const approvalDecideRoute = approvalRoutes.find((route) => route.pattern === "/internal/approvals/:id/decide")!;
  const approvalGetRoute = approvalRoutes.find((route) => route.pattern === "/internal/approvals/:id")!;
  const authorityRoutes = createAuthorityInternalRoutes({ authority, artifacts, evaluations, preparedActions: { get: async (id) => gateway.getPreparedActionStore().get(id) }, outcomeContracts: { get: async (id) => outcomes.getContract(id) }, provenance: owner, approvals: { get: (id) => approvalStore.get(id) }, learning: options.learning });
  const evaluationRoute = authorityRoutes.find((route) => route.pattern === "/internal/authority/procurement")!;
  const mintRoute = authorityRoutes.find((route) => route.pattern === "/internal/authority/bind-and-mint")!;
  const outcomeRoute = createOutcomeInternalRoutes(outcomes, { getEvaluation: async (id) => evaluations.get(id), getArtifact: (id) => owner.getSemanticArtifact(id), getState: (id) => owner.getIntentState(id), getTip: (id) => owner.getTip(id) }, { approvalReadPort: { get: (id) => approvalStore.get(id) } }).find((route) => route.method === "POST")!;
  const gatewayRoutes = createGatewayInternalRoutes({ gateway, owners: { getEvaluation: async (id) => evaluations.get(id), getOutcomeContract: (id) => outcomes.getContract(id), getArtifact: (id) => owner.getSemanticArtifact(id), getState: (id) => owner.getIntentState(id), getTip: (id) => owner.getTip(id) }, commitCallers: ["tm-dev-agent-runtime@elite-crossbar-505104-t9.iam.gserviceaccount.com"], approvalReadPort: { get: (id) => approvalStore.get(id) } });
  const prepareRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/prepare-references")!;
  const authorizeRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/authorize")!;
  const commitRoute = gatewayRoutes.find((route) => route.pattern === "/internal/gateway/commit")!;
  const calls: {
    evaluation: number;
    outcome: number;
    prepare: number;
    mint: number;
    authorize: number;
    commit: number;
    paymentAdapter: number;
    outbox: number;
    evaluationBody?: unknown;
    outcomeBodies: unknown[];
    monitoringBodies: unknown[];
    sequence: string[];
  } = {
    evaluation: 0,
    outcome: 0,
    prepare: 0,
    mint: 0,
    authorize: 0,
    commit: 0,
    paymentAdapter: 0,
    outbox: 0,
    outcomeBodies: [],
    monitoringBodies: [],
    sequence: [],
  };
  const sharedDeps = {
    intents: authoritative, owner: owner as never,
    evidence: options.demoEvidence
      ? (demoEvidencePort as never)
      : options.evidence ?? { getEnvelope: async (id) => ok({ id, contentHash: H("e") } as never), getClaim: async () => err(ErrorCode.VALIDATION_FAILED, "not used") },
    ...(options.preExecutionReadiness
      ? { preExecutionReadiness: options.preExecutionReadiness }
      : realPreExecutionReadiness
        ? { preExecutionReadiness: realPreExecutionReadiness }
        : {}),
    authority: {
      evaluateWorkflow: async (body) => { calls.evaluation += 1; calls.evaluationBody = body as never; return resultFromRoute(await evaluationRoute.handler({ body, headers: {}, params: {} })); },
      bindAndMint: async (body) => { calls.mint += 1; return resultFromRoute(await mintRoute.handler({ body, headers: {}, params: {} })); },
      createApproval: async (body) => resultFromRoute(await approvalCreateRoute.handler({ body, headers: {}, params: {} })),
      getApproval: async (id) => resultFromRoute(await approvalGetRoute.handler({ body: undefined, headers: {}, params: { id } })),
    },
    outcomes: {
      createContract: async (body) => {
        calls.outcome += 1;
        calls.outcomeBodies.push(body);
        calls.sequence.push("outcome");
        return resultFromRoute(await outcomeRoute.handler({ body, headers: {}, params: {} }));
      },
    },
    monitoring: {
      createContract: async (body) => {
        calls.monitoringBodies.push(body);
        calls.sequence.push("monitoring");
        if (options.monitoringCreate) return options.monitoringCreate(body);
        const request = body as { id?: string; workflowId?: string; intentId?: string; intentStateId?: string; evaluationId?: string; createdAt?: string };
        return ok({
          id: request.id ?? `monitoring-${request.workflowId ?? "workflow"}`,
          workflowId: request.workflowId,
          intentId: request.intentId,
          intentStateId: request.intentStateId,
          evaluationId: request.evaluationId,
          createdAt: request.createdAt,
        });
      },
    },
    gateway: {
      prepareFromReferences: async (body) => { calls.prepare += 1; return resultFromRoute(await prepareRoute.handler({ body, headers: {}, params: {} })) as Result<import("@truemandate/protocol").PreparedAction>; },
      authorize: async (body) => { calls.authorize += 1; return resultFromRoute(await authorizeRoute.handler({ body, headers: {}, params: {} })); },
      commit: async (body) => { calls.commit += 1; return resultFromRoute(await commitRoute.handler({ body, headers: {}, params: {} })); },
    },
    model: model(options.plannerTransform), provenance, now: () => NOW,
    stageRecorder: options.stageRecorder,
  } as const;
  const coordinator = new GenericWorkflowEngine({
    pack: ProcurementDomainPack,
    ...sharedDeps,
  });
  const travelCoordinator = new GenericWorkflowEngine({
    pack: TravelDomainPack,
    ...sharedDeps,
  });
  const saasCoordinator = new GenericWorkflowEngine({
    pack: SaasItSpendDomainPack,
    ...sharedDeps,
  });
  const invoiceCoordinator = new GenericWorkflowEngine({
    pack: InvoiceVendorPaymentDomainPack,
    ...sharedDeps,
  });
  const logisticsCoordinator = new GenericWorkflowEngine({
    pack: LogisticsFulfillmentDomainPack,
    ...sharedDeps,
  });
  const dispatcher = new GenericWorkflowDispatcher(owner as never, {
    procurement: coordinator as GenericWorkflowEngine<import("./domain-pack.js").WorkflowRequestBase>,
    travel: travelCoordinator as GenericWorkflowEngine<import("./domain-pack.js").WorkflowRequestBase>,
    saas_it_spend: saasCoordinator as GenericWorkflowEngine<import("./domain-pack.js").WorkflowRequestBase>,
    invoice_vendor_payment: invoiceCoordinator as GenericWorkflowEngine<import("./domain-pack.js").WorkflowRequestBase>,
    logistics_fulfillment: logisticsCoordinator as GenericWorkflowEngine<import("./domain-pack.js").WorkflowRequestBase>,
  });
  const packs = {
    procurement: ProcurementDomainPack,
    travel: TravelDomainPack,
    saas_it_spend: SaasItSpendDomainPack,
    invoice_vendor_payment: InvoiceVendorPaymentDomainPack,
    logistics_fulfillment: LogisticsFulfillmentDomainPack,
  } as const;

  function evidenceIdsFromPayload(payload: Record<string, unknown>): string[] {
    return Array.isArray(payload.evidenceIds)
      ? payload.evidenceIds.filter((value): value is string => typeof value === "string")
      : [];
  }

  function exactEvidence(ids: readonly string[], wanted: string): string | undefined {
    return ids.includes(wanted) ? wanted : undefined;
  }

  function firstEvidence(ids: readonly string[]): string | undefined {
    return ids[0];
  }

  function evidenceForConstraint(
    packId: keyof typeof packs,
    constraint: { readonly concept: string },
    payload: Record<string, unknown>,
  ): string | undefined {
    const ids = evidenceIdsFromPayload(payload);
    const providerApprovalEvidenceId =
      typeof (payload.provider as { approvalEvidenceId?: unknown } | undefined)?.approvalEvidenceId === "string"
        ? (payload.provider as { approvalEvidenceId: string }).approvalEvidenceId
        : typeof (payload.supplier as { approvalEvidenceId?: unknown } | undefined)?.approvalEvidenceId === "string"
          ? (payload.supplier as { approvalEvidenceId: string }).approvalEvidenceId
          : typeof (payload.vendor as { approvalEvidenceId?: unknown } | undefined)?.approvalEvidenceId === "string"
            ? (payload.vendor as { approvalEvidenceId: string }).approvalEvidenceId
            : typeof (payload.payee as { approvalEvidenceId?: unknown } | undefined)?.approvalEvidenceId === "string"
              ? (payload.payee as { approvalEvidenceId: string }).approvalEvidenceId
              : undefined;
    switch (packId) {
      case "procurement":
        if (constraint.concept === "approved_supplier") return providerApprovalEvidenceId ?? firstEvidence(ids);
        if (constraint.concept === "food_grade") return typeof payload.foodGradeEvidenceId === "string" ? payload.foodGradeEvidenceId : firstEvidence(ids);
        if (constraint.concept === "quantity") return exactEvidence(ids, "quantity-evidence") ?? firstEvidence(ids);
        if (constraint.concept === "execution_deadline") return exactEvidence(ids, "quote-evidence") ?? firstEvidence(ids);
        if (constraint.concept === "budget_max") return exactEvidence(ids, "quote-evidence") ?? firstEvidence(ids);
        return firstEvidence(ids);
      case "travel": {
        const bookingEvidence =
          exactEvidence(ids, "hotel-offer-evidence") ??
          exactEvidence(ids, "approval-evidence") ??
          firstEvidence(ids);
        if (constraint.concept === "approved_provider") return providerApprovalEvidenceId ?? bookingEvidence;
        if (constraint.concept === "traveler_count" || constraint.concept === "hotel_stay_count") {
          return exactEvidence(ids, "traveler-count-evidence") ?? bookingEvidence;
        }
        if (constraint.concept === "refundable") return exactEvidence(ids, "refund-evidence") ?? bookingEvidence;
        if (
          constraint.concept === "property_name" ||
          constraint.concept === "travel_budget" ||
          constraint.concept === "total_budget" ||
          constraint.concept === "travel_date" ||
          constraint.concept === "stay_date" ||
          constraint.concept === "completion_deadline" ||
          constraint.concept === "stay_start_date" ||
          constraint.concept === "stay_end_date"
        ) {
          return bookingEvidence;
        }
        return bookingEvidence;
      }
      case "saas_it_spend":
        if (constraint.concept === "approved_vendor") return providerApprovalEvidenceId ?? firstEvidence(ids);
        if (constraint.concept === "seat_count") return exactEvidence(ids, "seat-count-evidence") ?? firstEvidence(ids);
        if (
          constraint.concept === "term_months" ||
          constraint.concept === "renewal_setting" ||
          constraint.concept === "saas_budget" ||
          constraint.concept === "subscription_deadline"
        ) {
          return exactEvidence(ids, "term-renewal-evidence") ?? firstEvidence(ids);
        }
        return firstEvidence(ids);
      case "invoice_vendor_payment":
        if (constraint.concept === "approved_payee") return providerApprovalEvidenceId ?? firstEvidence(ids);
        return exactEvidence(ids, "invoice-evidence") ?? firstEvidence(ids);
      case "logistics_fulfillment":
        if (constraint.concept === "approved_carrier") return providerApprovalEvidenceId ?? firstEvidence(ids);
        if (constraint.concept === "fulfill_count") return exactEvidence(ids, "fulfill-count-evidence") ?? firstEvidence(ids);
        return exactEvidence(ids, "shipment-evidence") ?? firstEvidence(ids);
      default:
        return firstEvidence(ids);
    }
  }

  function writeAuthoritativeProofSummary(
    packId: keyof typeof packs,
    intentId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!intentId || !packId || !payload) return;
    const pack = packs[packId];
    if (!pack) return;
    const semanticArtifact = artifactRows.get(`semantic-verification-${state.id}`);
    if (!semanticArtifact) return;
    const obligations = deriveRequiredProofObligations(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: pack.planning,
    });
    const coverageRows = classifyRequiredProofCoverage(state.constraints, {
      temporalAuthority: state.temporalAuthority,
      conceptContract: pack.planning,
    });
    const proofRows = obligations.map((obligation) => {
      const constraint = state.constraints.find((row) => row.id === obligation.constraintId);
      const evidenceId = constraint
        ? evidenceForConstraint(packId, constraint, payload)
        : undefined;
      return {
        obligationId: proofObligationId(obligation),
        constraintId: obligation.constraintId,
        concept: constraint?.concept,
        evidenceId,
        status: evidenceId ? "SATISFIED" : "UNKNOWN",
        reason: evidenceId
          ? "runtime-test-authoritative-proof-snapshot"
          : "runtime-test-authoritative-proof-missing-evidence",
        proofMechanism: "EVIDENCE_OBLIGATION",
      };
    });
    const evaluatedConstraintIds = proofRows
      .filter((row) => row.constraintId && row.status !== "UNKNOWN")
      .map((row) => row.constraintId as string)
      .sort();
    const missingEvaluationConstraintIds = coverageRows
      .map((row) => row.constraintId)
      .filter((constraintId) => !evaluatedConstraintIds.includes(constraintId));
    const evidenceRefs = [...new Set(proofRows.map((row) => row.evidenceId).filter((value): value is string => Boolean(value)))]
      .sort()
      .map((id) => ({
        id,
        hash: H("e"),
        trustClass: "ELEVATED_EXTERNAL" as const,
      }));
    const summaryBase: Record<string, unknown> = {
      version: 1,
      intentId,
      intentStateId: state.id,
      intentStateHash: state.stateHash,
      packId,
      generatedAt: NOW,
      requiredProofObligationIds: obligations.map(proofObligationId).sort(),
      proofRows,
      coverage: {
        requiredConstraintIds: coverageRows.map((row) => row.constraintId).sort(),
        derivedObligationConstraintIds: proofRows.map((row) => row.constraintId).filter((value): value is string => typeof value === "string").sort(),
        evaluatedConstraintIds,
        missingObligationConstraintIds: [],
        missingEvaluationConstraintIds,
        incompleteDeterministicRuleIds: [],
        allRequiredCovered: missingEvaluationConstraintIds.length === 0,
      },
      verifiedEvidenceRefs: evidenceRefs,
    };
    // The production path has no synthesized summary: it exists only if the
    // evidence-backed readiness handoff produced one.
    if (options.omitProofSummary) return;
    const summary = options.proofSummaryMutator
      ? options.proofSummaryMutator({ packId, state, summary: summaryBase })
      : summaryBase;
    const semanticPayload = semanticArtifact.payload as {
      proofSummary?: Record<string, unknown>;
      verifiedEvidenceRefs?: unknown;
    };
    semanticPayload.proofSummary = summary;
    semanticPayload.verifiedEvidenceRefs =
      Array.isArray(summary.verifiedEvidenceRefs) ? summary.verifiedEvidenceRefs : [];
    semanticArtifact.contentHash = hashCanonical(semanticArtifact.payload);
  }

  function seedAuthoritativeProofSummary(body: unknown): void {
    if (!body || typeof body !== "object") return;
    const requestBody = body as {
      intent?: { intentId?: string };
      domain?: { packId?: keyof typeof packs; payload?: Record<string, unknown> };
    };
    const intentId = requestBody.intent?.intentId;
    const packId = requestBody.domain?.packId;
    const payload = requestBody.domain?.payload;
    if (!intentId || !packId || !payload) return;
    writeAuthoritativeProofSummary(packId, intentId, payload);
  }

  function seedPackProofSummary(
    packId: keyof typeof packs,
    body: unknown,
  ): void {
    if (!body || typeof body !== "object") return;
    const requestBody = body as Record<string, unknown>;
    const intentId =
      typeof requestBody.intentId === "string" ? requestBody.intentId : state.intentId;
    writeAuthoritativeProofSummary(packId, intentId, requestBody);
  }

  const guardedCoordinator = {
    ...coordinator,
    run: async (body: unknown) => {
      seedPackProofSummary("procurement", body);
      return coordinator.run(body as never);
    },
    resumeWithApproval: (body: unknown) => coordinator.resumeWithApproval(body as never),
    commitAuthorizedExecution: (body: unknown) =>
      coordinator.commitAuthorizedExecution(body as never),
  };

  const guardedDispatcher = {
    run: async (body: unknown) => {
      seedPackProofSummary("procurement", body);
      return dispatcher.run(body as never);
    },
    submitWorkflow: async (body: unknown) => {
      seedAuthoritativeProofSummary(body);
      return dispatcher.submitWorkflow(body as never);
    },
    commitWorkflow: (workflowId: string) => dispatcher.commitWorkflow(workflowId),
    readWorkflow: (workflowId: string) => dispatcher.readWorkflow(workflowId),
    readApproval: (approvalId: string) => dispatcher.readApproval(approvalId),
    decideApproval: (approvalId: string, body: unknown) => dispatcher.decideApproval(approvalId, body as never),
    readEvidence: (evidenceId: string) => dispatcher.readEvidence(evidenceId),
    readOutcome: (outcomeContractId: string) => dispatcher.readOutcome(outcomeContractId),
    readResolutionCase: (resolutionCaseId: string) => dispatcher.readResolutionCase(resolutionCaseId),
    readResolutionByOutcome: (outcomeContractId: string) => dispatcher.readResolutionByOutcome(outcomeContractId),
  };
  return {
    coordinator: guardedCoordinator, dispatcher: guardedDispatcher, owner, gateway, authority, evaluations, outcomes, resolution, calls, state, commitRoute,
    approvalStore, approvalEvents,
    compiler,
    verifier,
    provenance,
    intentPublisher,
    // Exposed (undefined unless `demoEvidence` was supplied) so a test can call
    // `.evaluate()` directly and inspect its full per-constraint `proofRows`/
    // `coverage` return value — the only place that differentiated detail is
    // observable. When supersession isn't eligible, resolveEvidenceBackedState
    // only reads the boolean `superseded` field and discards the rest, so the
    // durable PROOF artifacts collapse to a uniform
    // authoritative-proof-handoff-absent/UNKNOWN for every constraint.
    preExecutionReadiness: realPreExecutionReadiness,
    decideApproval: async (id: string, body: unknown) =>
      approvalDecideRoute.handler({ body, headers: {}, params: { id }, caller: { email: "human-approver@example.com" } }),
  };
}

export function request(specification = "food-grade containers") {
  return { intentId: "intent-e2e", expectedIntentStateId: "", idempotencyKey: `e2e-${specification.replace(/\W/g, "-")}`, supplier: { id: "approved-supplier", name: "Approved Supplier", approved: true, approvalEvidenceId: "approval-evidence" }, item: { specification }, quantity: 500, totalAmount: 742000, currency: "INR", foodGradeEvidenceId: "food-evidence", evidenceIds: ["food-evidence", "quote-evidence", "approval-evidence", "quantity-evidence"], delivery: { terms: "deliver before 2026-12-30", deadline: "2026-12-30T23:59:59.000Z" } };
}

function genericRequest(overrides: Record<string, unknown> = {}) {
  return {
    intent: {
      kind: "REFERENCE",
      intentId: "intent-e2e",
      expectedIntentStateId: "",
    },
    action: {
      capability: "execute_payment",
      merchant: "approved-supplier",
      product: "food-grade containers",
      quantity: 500,
      amount: 742000,
      currency: "INR",
      deliveryTerms: "deliver before 2026-12-30",
      consequenceLevel: "HIGH",
      parameters: {},
    },
    domain: {
      packId: "procurement",
      payload: {
        supplier: {
          id: "approved-supplier",
          name: "Approved Supplier",
          approved: true,
          approvalEvidenceId: "approval-evidence",
        },
        item: {
          specification: "food-grade containers",
        },
        foodGradeEvidenceId: "food-evidence",
        evidenceIds: [
          "food-evidence",
          "quote-evidence",
          "approval-evidence",
          "quantity-evidence",
        ],
        delivery: {
          terms: "deliver before 2026-12-30",
          deadline: "2026-12-30T23:59:59.000Z",
        },
      },
    },
    idempotencyKey: "generic-procurement-e2e",
    ...overrides,
  };
}

export function explicitConstraint(
  id: string,
  concept: string,
  operator: ConstraintOperator,
  value: unknown,
  kind: ConstraintKind = ConstraintKind.HARD,
  sourceText: string = concept,
) {
  return {
    id,
    concept,
    operator,
    value,
    kind,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
    grounding: {
      sourceText,
      quoteExact: false,
    },
  };
}

export function temporalConstraint(
  id: string,
  concept: string,
  resolvedValue: string,
  originalExpression: string,
) {
  return {
    ...explicitConstraint(
      id,
      concept,
      ConstraintOperator.LTE,
      resolvedValue,
      ConstraintKind.TEMPORAL,
    ),
    temporalResolution: {
      originalExpression,
      resolvedValue,
      resolutionTimestamp: NOW,
      timezone: "UTC",
    },
  };
}

function claim(id: string, concept: string, value: unknown): AcceptedEvidenceClaim {
  return {
    id,
    concept,
    value,
    source: "verifier",
    trustClass: "ELEVATED_EXTERNAL",
    capturedAt: NOW,
  };
}

function executionEnvelope(
  contractId: string,
  status: "SUCCESS" | "FAILED" | "UNKNOWN",
  idempotencyKey: string,
  extra: Record<string, unknown> = {},
) {
  return createEnvelope({
    eventId: `evt-${idempotencyKey}`,
    type: "execution.completed",
    aggregateId: contractId,
    aggregateVersion: 1,
    causationId: "c",
    correlationId: "corr",
    actorService: "gateway",
    payloadHash: "h",
    idempotencyKey,
    provenanceRefs: [],
    payload: { contractId, status, now: NOW, ...extra },
    occurredAt: NOW,
  });
}

function evidenceEnvelope(
  contractId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  return createEnvelope({
    eventId: `evt-${idempotencyKey}`,
    type: "evidence.observed",
    aggregateId: contractId,
    aggregateVersion: 2,
    causationId: "c",
    correlationId: "corr",
    actorService: "observability",
    payloadHash: "h",
    idempotencyKey,
    provenanceRefs: [],
    payload: { contractId, now: NOW, ...payload },
    occurredAt: NOW,
  });
}

function requirementValue(
  contract: {
    readonly requirements?: readonly { readonly concept?: string; readonly value?: unknown }[];
  },
  concept: string,
) {
  return contract.requirements?.find((requirement) => requirement.concept === concept)?.value;
}

function positiveTravelOutcomeClaims(contract: {
  readonly merchant?: string;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly requirements?: readonly { readonly concept?: string; readonly value?: unknown }[];
}): AcceptedEvidenceClaim[] {
  const parameters = contract.parameters ?? {};
  return [
    claim("travel-provider", "provider", String(contract.merchant ?? "travel-provider")),
    claim("travel-approved", "approved_provider", true),
    claim("travel-booking", "booking_confirmed", true),
    claim("travel-count", "traveler_count", 2),
    claim("travel-amount", "total_amount", 3200),
    claim("travel-refundable", "refundable", true),
    claim("travel-property", "property_name", String(parameters.lodgingName ?? contract.product ?? "Seaside Lodge")),
    claim("travel-date", "stay_start_date", String(parameters.checkInDate ?? parameters.travelDate ?? "2026-12-20T00:00:00.000Z")),
    claim("travel-checkout", "check_out_date", String(parameters.checkOutDate ?? "2026-12-22T00:00:00.000Z")),
    claim(
      "travel-deadline",
      "completion_deadline",
      String(requirementValue(contract, "completion_deadline") ?? "2026-12-31T00:00:00.000Z"),
    ),
  ];
}

function partialTravelOutcomeClaims(contract: {
  readonly merchant?: string;
  readonly product?: string;
  readonly parameters?: Record<string, unknown>;
  readonly requirements?: readonly { readonly concept?: string; readonly value?: unknown }[];
}): AcceptedEvidenceClaim[] {
  const parameters = contract.parameters ?? {};
  return [
    claim("travel-provider", "provider", String(contract.merchant ?? "travel-provider")),
    claim("travel-approved", "approved_provider", true),
    claim("travel-booking", "booking_confirmed", true),
    claim("travel-count", "traveler_count", 1),
    claim("travel-amount", "total_amount", 3200),
    claim("travel-refundable", "refundable", true),
    claim("travel-property", "property_name", String(parameters.lodgingName ?? contract.product ?? "Seaside Lodge")),
    claim("travel-date", "stay_start_date", String(parameters.checkInDate ?? parameters.travelDate ?? "2026-12-20T00:00:00.000Z")),
    claim("travel-checkout", "check_out_date", String(parameters.checkOutDate ?? "2026-12-22T00:00:00.000Z")),
    claim(
      "travel-deadline",
      "completion_deadline",
      String(requirementValue(contract, "completion_deadline") ?? "2026-12-31T00:00:00.000Z"),
    ),
  ];
}

export function replaceConstraints(rawText: string, constraints: Array<Record<string, unknown>>) {
  return (output: unknown) => {
    const value = output as Record<string, unknown>;
    return {
      ...value,
      ambiguities: [],
      readiness: "EXECUTABLE",
      constraints: constraints.map((constraint) => {
        const temporalResolution = (
          constraint as { temporalResolution?: { originalExpression?: string } }
        ).temporalResolution;
        if (temporalResolution?.originalExpression) {
          const expression = temporalResolution.originalExpression;
          const start = rawText.indexOf(expression);
          return {
            ...constraint,
            grounding: start >= 0
              ? {
                  sourceText: expression,
                  sourceSpan: { start, end: start + expression.length },
                  quoteExact: true,
                }
              : {
                  sourceText: expression,
                  quoteExact: false,
                },
          };
        }
        return {
          ...constraint,
          grounding: {
            ...((
              (() => {
                const sourceText = String(
                  (
                    constraint as { grounding?: { sourceText?: string } }
                  ).grounding?.sourceText ?? "",
                );
                const start = rawText.indexOf(sourceText);
                return start >= 0
                  ? {
                      sourceText,
                      sourceSpan: { start, end: start + sourceText.length },
                      quoteExact: true,
                    }
                  : {
                      sourceText,
                      quoteExact: false,
                    };
              })()
            )),
          },
        };
      }),
    };
  };
}

describe("GenericWorkflowEngine pre-execution E2E", () => {
  it("stops an industrial-grade workflow before Authority, Outcome, PREPARE, mint, and token issuance", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request("industrial-grade containers"), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0, outbox: 0 });
    expect((await r.gateway.getPreparedActionStore().get("unknown")).value).toBeUndefined();
  });

  it("blocks before Authority when a required HARD obligation is genuinely unsatisfied (quantity 450 vs 500)", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), quantity: 450, expectedIntentStateId: r.state.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    // Deterministic obligation satisfaction: quantity 450 cannot satisfy the
    // derived quantity=500 HARD obligation; the flow must block before any
    // Authority / Outcome / PREPARE / mint / token activity.
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0, outbox: 0 });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("takes a valid time-bounded food-grade procurement through real owner routes to an unconsumed CommitToken only", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as { state: string; evaluation: { evaluation: { id: string; materializationEligible: boolean } }; outcomeContract: { id: string }; authorization: { commitToken: { id: string }; grant: { id: string; preparedActionId: string } } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.evaluation.evaluation.materializationEligible).toBe(true);
    const token = await r.gateway.getCommitTokenStore().get(value.authorization.commitToken.id);
    expect(token.ok && token.value?.consumed).toBe(false);
    // Proof-obligation identity continuity: the plan-bound obligation IDs
    // (derived fields + planStepId) must reach the Authority input unchanged.
    const planArtifact = r.owner.artifacts.get(value.artifacts.plan.id);
    const actionArtifact = r.owner.artifacts.get(value.artifacts.action.id);
    expect(planArtifact).toBeDefined();
    expect(actionArtifact).toBeDefined();
    if (planArtifact && actionArtifact) {
      const planObligations = ((planArtifact.payload as Record<string, unknown>).plan as { proofObligations: readonly { constraintId?: string; planStepId?: string }[] }).proofObligations;
      const boundIds = planObligations.map((o) => proofObligationId(o)).sort();
      const actionIds = [...(((actionArtifact.payload as Record<string, unknown>).requiredProofObligationIds as string[]).sort())];
      expect(actionIds).toEqual(boundIds);
      const derived = deriveRequiredProofObligations(r.state.constraints, { temporalAuthority: r.state.temporalAuthority });
      for (const bound of planObligations) {
        const match = derived.find((o) => o.constraintId === bound.constraintId);
        expect(match).toBeDefined();
        if (match) {
          const { planStepId: _bound, ...rest } = bound as Record<string, unknown>;
          void _bound;
          expect(rest).toMatchObject(match as unknown as Record<string, unknown>);
          expect(bound.planStepId).toBeTruthy();
        }
      }
      const proofArtifacts = (value.artifacts.proofs as readonly { id: string }[]).map((p) => r.owner.artifacts.get(p.id));
      for (const proof of proofArtifacts) {
        expect(boundIds).toContain((proof?.payload as Record<string, unknown> | undefined)?.obligationId);
      }
      const evaluationBody = r.calls.evaluationBody as { action?: { id: string; hash: string } } | undefined;
      expect(evaluationBody?.action?.id).toBe(value.artifacts.action.id);
      expect(evaluationBody?.action?.hash).toBe(actionArtifact.contentHash);
    }
    // Exact deterministic execution and Authority provenance are persisted before token issuance.
    expect(r.owner.provenance.getNode(`execution-action-${value.authorization.grant.preparedActionId}`).ok).toBe(true);
    expect(r.owner.provenance.getNode(`authority-grant-${value.authorization.grant.id}`).ok).toBe(true);
    expect(r.calls).toMatchObject({ evaluation: 1, outcome: 1, prepare: 1, mint: 1, authorize: 1, commit: 0, paymentAdapter: 0, outbox: 0 });
    const replay = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    expect(replay.ok).toBe(true);
    // A coordinator retry after readiness resolves through its existing workflow,
    // never rematerializing authority, outcome, preparation, grant, or token.
    expect(r.calls).toMatchObject({ evaluation: 1, outcome: 1, prepare: 1, mint: 1, authorize: 1, commit: 0, paymentAdapter: 0, outbox: 0 });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("runs the canonical generic workflow path for procurement and never leaks authorization material", async () => {
    const r = await runtime();
    const result = await r.dispatcher.submitWorkflow(
      genericRequest({
        intent: {
          kind: "REFERENCE",
          intentId: "intent-e2e",
          expectedIntentStateId: r.state.id,
        },
      }),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      workflowId: string;
      state: string;
      execution?: { status?: string };
      authorization?: unknown;
    };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.execution?.status).toBe("AUTHORIZED");
    expect(value).not.toHaveProperty("authorization");
    const authorizationArtifact = [...r.owner.artifacts.values()].find(
      (artifact) =>
        artifact.workflowId === value.workflowId &&
        artifact.kind === "EXECUTION_AUTHORIZATION",
    );
    expect(authorizationArtifact).toBeDefined();
    expect(authorizationArtifact?.payload.commitTokenId).toBeDefined();
  });

  it("preserves retryable readiness semantics for raw-intent generic submit", async () => {
    const r = await runtime();
    const result = await r.dispatcher.submitWorkflow({
      ...genericRequest(),
      intent: {
        kind: "RAW",
        principalId: "principal-e2e",
        rawText:
          "Buy 500 food-grade containers from an approved supplier for under INR 800000 before 2026-12-31T17:00:00.000Z",
      },
      idempotencyKey: "generic-raw-intent-e2e",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INTENT_STATE_NOT_READY);
    expect(result.details?.retryable).toBe(true);
  });

  it("keeps the exact same raw-intent request blocked after compile finalization until an authoritative proof snapshot exists", async () => {
    const r = await runtime();
    const body = {
      ...genericRequest(),
      intent: {
        kind: "RAW",
        principalId: "principal-e2e",
        rawText:
          "Buy 500 food-grade containers from an approved supplier for under INR 800000 before 2026-12-31T17:00:00.000Z",
      },
      idempotencyKey: "generic-raw-intent-retry-e2e",
    };
    const first = await r.dispatcher.submitWorkflow(body);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe(ErrorCode.INTENT_STATE_NOT_READY);
    expect(first.details?.retryable).toBe(true);

    const published = r.intentPublisher.published.find(
      (entry) => entry.topic === "intent.events" && entry.envelope.type === "INTENT_RECORDED",
    );
    expect(published).toBeDefined();
    if (!published) return;

    const compiled = await handleIntentCompileEvent(published.envelope, {
      intents: r.owner as never,
      provenance: r.provenance,
      compilerModel: r.compiler,
      verifierModel: r.verifier,
      modelSecurity: new FakeModelArmor({
        defaultStatus: ModelInspectionStatus.CLEAN,
      }),
    });
    expect(compiled.ok).toBe(true);

    const retried = await r.dispatcher.submitWorkflow(body);
    if (!retried.ok) throw new Error(`${retried.code}: ${retried.message}`);
    expect((retried.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({
      evaluation: 0,
      outcome: 0,
      prepare: 0,
      mint: 0,
      authorize: 0,
      commit: 0,
    });
  });

  it("commits by workflowId through the generic dispatcher without exposing the commit token", async () => {
    const r = await runtime();
    const submitted = await r.dispatcher.submitWorkflow(
      genericRequest({
        intent: {
          kind: "REFERENCE",
          intentId: "intent-e2e",
          expectedIntentStateId: r.state.id,
        },
      }),
    );
    if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
    const workflowId = String((submitted.value as { workflowId: string }).workflowId);
    const committed = await r.dispatcher.commitWorkflow(workflowId);
    if (!committed.ok) throw new Error(`${committed.code}: ${committed.message}`);
    expect(committed.value).toMatchObject({ status: "SUCCESS" });
    expect(committed.value).not.toHaveProperty("grantId");
    expect(committed.value).not.toHaveProperty("commitToken");
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const replay = await r.dispatcher.commitWorkflow(workflowId);
    if (!replay.ok) throw new Error(`${replay.code}: ${replay.message}`);
    expect(replay.value).toMatchObject({ status: "IDEMPOTENT_REPLAY" });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
  });

  it("fails closed when a foreign workflow index contains another workflow's authorization handle", async () => {
    const r = await runtime();
    const submitted = await r.dispatcher.submitWorkflow(
      genericRequest({
        intent: {
          kind: "REFERENCE",
          intentId: "intent-e2e",
          expectedIntentStateId: r.state.id,
        },
      }),
    );
    if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
    const workflowId = String((submitted.value as { workflowId: string }).workflowId);
    const workflow = r.owner.artifacts.get(workflowId)!;
    const authorization = r.owner.artifacts.get(`execution-authorization-${workflowId}`)!;
    const foreignWorkflowId = "wf-foreign";
    const foreignWorkflowPayload = { ...workflow.payload, workflowId: foreignWorkflowId };
    r.owner.artifacts.set(foreignWorkflowId, {
      ...workflow,
      id: foreignWorkflowId,
      workflowId: foreignWorkflowId,
      payload: foreignWorkflowPayload,
      contentHash: hashCanonical(foreignWorkflowPayload),
    });
    r.owner.artifacts.set(`execution-authorization-${foreignWorkflowId}`, {
      ...authorization,
      id: `execution-authorization-${foreignWorkflowId}`,
      workflowId: foreignWorkflowId,
      predecessors: [{
        id: foreignWorkflowId,
        kind: "WORKFLOW",
        contentHash: hashCanonical(foreignWorkflowPayload),
      }],
      // The payload remains bound to the original workflow and must be rejected.
      contentHash: hashCanonical(authorization.payload),
    });

    const committed = await r.dispatcher.commitWorkflow(foreignWorkflowId);
    expect(committed.ok).toBe(false);
    if (committed.ok) return;
    expect(committed.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(committed.message).toContain("invalid lineage");
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("keeps the procurement compatibility alias on the same governed lifecycle as the canonical generic route", async () => {
    const canonical = await runtime();
    const alias = await runtime();
    const canonicalResult = await canonical.dispatcher.submitWorkflow(
      genericRequest({
        intent: {
          kind: "REFERENCE",
          intentId: "intent-e2e",
          expectedIntentStateId: canonical.state.id,
        },
      }),
    );
    const aliasResult = await alias.dispatcher.run({
      ...request(),
      expectedIntentStateId: alias.state.id,
    });
    if (!canonicalResult.ok) throw new Error(`${canonicalResult.code}: ${canonicalResult.message}`);
    if (!aliasResult.ok) throw new Error(`${aliasResult.code}: ${aliasResult.message}`);
    expect((canonicalResult.value as { state: string }).state).toBe("AUTHORIZED");
    expect((aliasResult.value as { state: string }).state).toBe("AUTHORIZED");
    expect(canonical.calls).toMatchObject({ evaluation: 1, outcome: 1, prepare: 1, mint: 1, authorize: 1 });
    expect(alias.calls).toMatchObject({ evaluation: 1, outcome: 1, prepare: 1, mint: 1, authorize: 1 });
  });

  it("creates a MonitoringContract for ALLOW_WITH_MONITORING and forwards monitoringContractId into outcome creation", async () => {
    const r = await runtime({
      capabilities: { execute_payment: AuthorityDecision.ALLOW_WITH_MONITORING },
    });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      state: string;
      evaluation: { evaluation: { materializationEligible: boolean } };
      monitoringContract?: { id?: string };
    };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.evaluation.evaluation.materializationEligible).toBe(true);
    expect(r.calls.monitoringBodies).toHaveLength(1);
    expect(r.calls.sequence.indexOf("monitoring")).toBeGreaterThanOrEqual(0);
    expect(r.calls.sequence.indexOf("outcome")).toBeGreaterThan(r.calls.sequence.indexOf("monitoring"));
    expect(r.calls.monitoringBodies[0]).toMatchObject({
      id: expect.stringMatching(/^monitoring-/),
      intentId: "intent-e2e",
      intentStateId: r.state.id,
    });
    expect(r.calls.outcomeBodies[0]).toMatchObject({
      monitoringContractId: expect.stringMatching(/^monitoring-/),
    });
    expect((value.monitoringContract as { id?: string } | undefined)?.id).toMatch(/^monitoring-/);
  });

  it("fails open when MonitoringContract creation fails and still authorizes the initial execution", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runtime({
      capabilities: { execute_payment: AuthorityDecision.ALLOW_WITH_MONITORING },
      monitoringCreate: async () => err(ErrorCode.VALIDATION_FAILED, "monitoring unavailable"),
    });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    try {
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      const value = result.value as { state: string; evaluation: { evaluation: { materializationEligible: boolean } } };
      expect(value.state).toBe("AUTHORIZED");
      expect(value.evaluation.evaluation.materializationEligible).toBe(true);
      expect(r.calls.monitoringBodies).toHaveLength(1);
      expect(r.calls.outcomeBodies[0]).not.toHaveProperty("monitoringContractId");
      expect(r.calls).toMatchObject({ outcome: 1, prepare: 1, mint: 1, authorize: 1 });
      expect(warn).toHaveBeenCalled();
      const payload = JSON.parse(String(warn.mock.calls[0]?.[0] ?? "{}")) as { event?: string; workflowId?: string };
      expect(payload.event).toBe("tm.monitoring.create_failed");
      expect(payload.workflowId).toBe(String((r.calls.monitoringBodies[0] as { workflowId?: string }).workflowId));
    } finally {
      warn.mockRestore();
    }
  });

  it("fails open and emits a visible warning when MonitoringContract creation throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runtime({
      capabilities: { execute_payment: AuthorityDecision.ALLOW_WITH_MONITORING },
      monitoringCreate: async () => {
        throw new Error("monitoring exception");
      },
    });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    try {
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      const value = result.value as { state: string; evaluation: { evaluation: { materializationEligible: boolean } } };
      expect(value.state).toBe("AUTHORIZED");
      expect(value.evaluation.evaluation.materializationEligible).toBe(true);
      expect(r.calls.monitoringBodies).toHaveLength(1);
      expect(r.calls.outcomeBodies[0]).not.toHaveProperty("monitoringContractId");
      expect(warn).toHaveBeenCalled();
      const payload = JSON.parse(String(warn.mock.calls[0]?.[0] ?? "{}")) as { event?: string; workflowId?: string; message?: string };
      expect(payload.event).toBe("tm.monitoring.create_failed");
      expect(payload.workflowId).toBe(String((r.calls.monitoringBodies[0] as { workflowId?: string }).workflowId));
      expect(payload.message).toBe("Monitoring create threw unexpectedly");
    } finally {
      warn.mockRestore();
    }
  });

  it("threads adaptiveSubjectId into the durable AuthorityRequest and tightens only through Authority adaptive consumption", async () => {
    const r = await runtime({
      learning: {
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
                    contentHash: H("c"),
                  },
                }
              : { workflowRule: null },
          ),
      },
    });
    const result = await r.coordinator.run({
      ...request(),
      adaptiveSubjectId: "principal:owner@example.com",
      expectedIntentStateId: r.state.id,
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      state: string;
      approval?: { id: string; status: string };
      artifacts: { action: { id: string } };
    };
    expect(value.state).toBe("AWAITING_APPROVAL");
    expect(value.approval?.status).toBe("PENDING");
    const actionArtifact = r.owner.artifacts.get(value.artifacts.action.id);
    expect(actionArtifact).toBeDefined();
    expect(
      ((actionArtifact?.payload as Record<string, unknown>)?.authorityRequest as {
        adaptiveSubjectId?: string;
      })?.adaptiveSubjectId,
    ).toBe("principal:owner@example.com");
    expect(r.calls).toMatchObject({
      evaluation: 1,
      outcome: 0,
      prepare: 0,
      mint: 0,
      authorize: 0,
    });
  });
  it("blocks when the executable purchase plan lacks the privileged ECONOMIC execution step", async () => {
    const r = await runtime({
      plannerTransform: (output) => {
        const o = output as { steps: { id: string }[] };
        return { ...o, steps: o.steps.filter((step) => step.id !== "s9") };
      },
    });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    // The deterministic plan-shape gate rejects the planner output before any
    // Authority / Outcome / PREPARE / mint / token activity.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PLAN_COVERAGE_GAP);
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0, outbox: 0 });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });
  it("keeps deterministic readiness below privileged planning for an under-specified purchase", async () => {
    const r = await runtime({
      compilerTransform: (output) => {
        const o = output as { constraints: { concept: string }[] };
        return { ...o, constraints: o.constraints.filter((c) => c.concept !== "approved_supplier") };
      },
      plannerTransform: (output) => {
        const o = output as { steps: { id: string }[] };
        return { ...o, steps: o.steps.filter((step) => step.id !== "s9") };
      },
    });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; artifacts: { plan?: { id: string } } };
    expect(value.state).not.toBe("AUTHORIZED");
    // Deterministic readiness below privileged planning: the plan must never
    // gain an ECONOMIC execution step, and no privileged activity may occur.
    if (value.artifacts.plan) {
      const planArtifact = r.owner.artifacts.get(value.artifacts.plan.id);
      const steps = ((planArtifact?.payload as Record<string, unknown> | undefined)?.plan as { steps: { commitmentLevel: string }[] } | undefined)?.steps ?? [];
      expect(steps.some((step) => step.commitmentLevel === "ECONOMIC")).toBe(false);
    }
    expect(r.calls).toMatchObject({ prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0, outbox: 0 });
  });

describe("Phase B — Controlled Economic Execution (reference-only COMMIT)", () => {
  it("commits the Phase A token exactly once: one mock payment, durable ExecutionResult, token consumed", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { authorization: { commitToken: { id: string } }; state: string };
    expect(value.state).toBe("AUTHORIZED");

    const res = await r.commitRoute.handler({ body: { commitTokenId: value.authorization.commitToken.id }, headers: {}, params: {} });
    expect(res.status).toBe(200);
    const body = res.body as { status: string; resultRef?: string; grantId: string; executionId?: string };
    expect(body.status).toBe("SUCCESS");
    expect(body.resultRef).toBeDefined();
    expect(body.executionId).toBeDefined();

    const token = await r.gateway.getCommitTokenStore().get(value.authorization.commitToken.id);
    expect(token.ok && token.value?.consumed).toBe(true);
    const ledger = await r.gateway.getSideEffectLedger().listAll();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.resultState).toBe("SUCCESS");
    expect(ledger[0]!.externalReference).toBeDefined();

    // Replay: idempotent, no second effect.
    const replay = await r.commitRoute.handler({ body: { commitTokenId: value.authorization.commitToken.id }, headers: {}, params: {} });
    expect((replay.body as { status: string }).status).toBe("IDEMPOTENT_REPLAY");
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);
    // Phase B does not interpret outcomes: no SATISFIED/PARTIAL/BREACHED claims.
    expect(r.calls).toMatchObject({ paymentAdapter: 0 });
  });

  it("rejects caller-supplied execution parameters on the COMMIT route", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { authorization: { commitToken: { id: string } } };
    const res = await r.commitRoute.handler({
      body: { commitTokenId: value.authorization.commitToken.id, amount: 1, merchant: "evil", adapterMode: "success" },
      headers: {}, params: {},
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe(ErrorCode.SCHEMA_PARSE_FAILED);
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("rejects unknown CommitTokens without adapter invocation", async () => {
    const r = await runtime();
    const res = await r.commitRoute.handler({ body: { commitTokenId: "ct-does-not-exist" }, headers: {}, params: {} });
    expect(res.status).toBe(400);
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("Phase A still terminates at an unconsumed CommitToken without invoking COMMIT", async () => {
    const r = await runtime();
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { authorization: { commitToken: { id: string } }; state: string };
    expect(value.state).toBe("AUTHORIZED");
    const token = await r.gateway.getCommitTokenStore().get(value.authorization.commitToken.id);
    expect(token.ok && token.value?.consumed).toBe(false);
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
    expect(r.calls).toMatchObject({ commit: 0, paymentAdapter: 0, outbox: 0 });
  });
});

describe("Wave 1 — REQUIRE_APPROVAL durable human approval lifecycle", () => {
  it("halts a REQUIRE_APPROVAL capability at AWAITING_APPROVAL with a durable PENDING request and zero economic activity", async () => {
    const r = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const result = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; approval: { id: string; status: string } };
    expect(value.state).toBe("AWAITING_APPROVAL");
    expect(value.approval.status).toBe("PENDING");
    // Durable: the approval row is owned by the authority store.
    const stored = r.approvalStore.get(value.approval.id);
    expect(stored?.status).toBe("PENDING");
    expect(stored?.requestedCapability).toBe("execute_payment");
    // Zero economic activity: no outcome contract, PREPARE, mint, or token.
    expect(r.calls).toMatchObject({ outcome: 0, prepare: 0, mint: 0, authorize: 0, commit: 0, paymentAdapter: 0, outbox: 0 });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(0);
  });

  it("closes the trusted path: human APPROVE → fresh revalidation → PREPARE → approval-unlocked mint → AUTHORIZED", async () => {
    const r = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const first = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!first.ok) throw new Error(`${first.code}: ${first.message}`);
    const awaiting = first.value as { state: string; approval: { id: string }; artifacts: { workflowId: string } };
    expect(awaiting.state).toBe("AWAITING_APPROVAL");
    const workflowId = awaiting.artifacts.workflowId as unknown as string;

    const decided = await r.decideApproval(awaiting.approval.id, { decision: "APPROVE", reason: "bounded and verified" });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: "APPROVED", decidedBy: "human-approver@example.com" });
    expect(r.approvalEvents.has(`approval-event-${awaiting.approval.id}-decided`)).toBe(true);

    const resumed = await r.coordinator.resumeWithApproval({ workflowId, approvalId: awaiting.approval.id });
    if (!resumed.ok) throw new Error(`${resumed.code}: ${resumed.message}`);
    const value = resumed.value as { state: string; authorization: { commitToken: { id: string }; grant: { id: string; preparedActionId: string } } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.authorization.commitToken.id).toBeDefined();
    // The minted grant carries the evaluated bounds, never widened by approval.
    const grant = await r.authority.getGrantStore().get(value.authorization.grant.id);
    expect(grant.ok && grant.value?.amount).toBe(742000);
    expect(grant.ok && grant.value?.merchant).toBe("approved-supplier");
    expect(r.calls).toMatchObject({ mint: 1, authorize: 1 });
  });

  it("REJECT is terminal: resumption fails closed with no economic activity", async () => {
    const r = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const first = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!first.ok) throw new Error(`${first.code}: ${first.message}`);
    const awaiting = first.value as { state: string; approval: { id: string }; artifacts: { workflowId: string } };
    const decided = await r.decideApproval(awaiting.approval.id, { decision: "DENY", reason: "risk" });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: "REJECTED" });
    const resumed = await r.coordinator.resumeWithApproval({ workflowId: awaiting.artifacts.workflowId as unknown as string, approvalId: awaiting.approval.id });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(ErrorCode.APPROVAL_NOT_PENDING);
    expect(r.calls).toMatchObject({ outcome: 0, prepare: 0, mint: 0, authorize: 0, paymentAdapter: 0 });
  });

  it("an undecided PENDING approval cannot unlock materialization", async () => {
    const r = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const first = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!first.ok) throw new Error(`${first.code}: ${first.message}`);
    const awaiting = first.value as { state: string; approval: { id: string }; artifacts: { workflowId: string } };
    const resumed = await r.coordinator.resumeWithApproval({ workflowId: awaiting.artifacts.workflowId as unknown as string, approvalId: awaiting.approval.id });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.code).toBe(ErrorCode.APPROVAL_NOT_PENDING);
    expect(r.calls).toMatchObject({ outcome: 0, prepare: 0, mint: 0, authorize: 0, paymentAdapter: 0 });
  });

  it("an approval cannot unlock a different workflow's evaluation (foreign action)", async () => {
    const r = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const first = await r.coordinator.run({ ...request(), expectedIntentStateId: r.state.id });
    if (!first.ok) throw new Error(`${first.code}: ${first.message}`);
    const awaiting = first.value as { state: string; approval: { id: string }; artifacts: { workflowId: string } };
    await r.decideApproval(awaiting.approval.id, { decision: "APPROVE" });
    const other = await runtime({ capabilities: { execute_payment: AuthorityDecision.REQUIRE_APPROVAL } });
    const otherRun = await other.coordinator.run({ ...request(), expectedIntentStateId: other.state.id });
    if (!otherRun.ok) throw new Error(`${otherRun.code}: ${otherRun.message}`);
    const otherAwaiting = otherRun.value as { artifacts: { workflowId: string } };
    // Shared durable store: the first workflow's APPROVED approval is visible
    // to the second owner, exactly as in production (one Firestore namespace).
    other.approvalStore.set(awaiting.approval.id, r.approvalStore.get(awaiting.approval.id)!);
    // Present the first workflow's APPROVED approval to the second workflow.
    const resumed = await other.coordinator.resumeWithApproval({ workflowId: otherAwaiting.artifacts.workflowId as unknown as string, approvalId: awaiting.approval.id });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    // The approval is bound to its own workflow — never usable elsewhere.
    expect(resumed.code).toBe(ErrorCode.APPROVAL_FOREIGN_ACTION);
    expect(other.calls).toMatchObject({ outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });
});

describe("Wave 4.6 multi-domain packs on the shared workflow runtime", () => {
  it("authorizes a governed travel workflow and opens travel-specific outcome requirements", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-1", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence"],
        },
      },
      idempotencyKey: "travel-success",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; outcomeContract?: { requirements?: Array<{ concept: string }> } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.outcomeContract?.requirements?.some((req) => req.concept === "travel_provider_match")).toBe(true);
    expect(value.outcomeContract?.requirements?.some((req) => req.concept === "travel_refundable")).toBe(true);
  });

  it("fails closed on a non-refundable travel booking before authority materialization", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: false,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-2", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence"],
        },
      },
      idempotencyKey: "travel-fail",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });

  it("materializes an ALLOW_WITH_MONITORING travel workflow instead of blocking when proofs and readiness are satisfied", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW_WITH_MONITORING },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-monitoring", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence"],
        },
      },
      idempotencyKey: "travel-monitoring-success",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      state: string;
      evaluation?: { decision?: string };
      monitoringContract?: { id?: string };
      outcomeContract?: { monitoringContractId?: string };
    };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.evaluation?.decision).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
    expect(value.monitoringContract?.id).toBeTruthy();
    expect(value.outcomeContract?.monitoringContractId).toBe(value.monitoringContract?.id);
    expect(r.calls.sequence.slice(0, 2)).toEqual(["monitoring", "outcome"]);
    expect(r.calls).toMatchObject({ evaluation: 1, outcome: 1, prepare: 1, mint: 1, authorize: 1 });
  });

  it("keeps the live-shape travel workflow materializable once stay_date coverage and hotel_stay_count binding are present", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW_WITH_MONITORING },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "hotel_stay_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-property", "property_name", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "Seaside Lodge"),
        explicitConstraint("travel-budget", "total_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-stay-date", "stay_date", "2026-12-20T00:00:00.000Z", "December 20, 2026"),
        temporalConstraint("travel-deadline", "completion_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-live-shape", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence", "hotel-offer-evidence"],
        },
      },
      idempotencyKey: "travel-live-shape-monitoring",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      workflowId: string;
      state: string;
      evaluation?: { decision?: string };
      monitoringContract?: { id?: string };
      artifacts?: { proofs?: Array<{ id: string }> };
    };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.evaluation?.decision).toBe(AuthorityDecision.ALLOW_WITH_MONITORING);
    expect(value.monitoringContract?.id).toBeTruthy();
    const planArtifact = await r.owner.getSemanticArtifact(`plan-${value.workflowId}`);
    expect(planArtifact.ok).toBe(true);
    if (!planArtifact.ok) return;
    const planPayload = (planArtifact.value as {
      payload?: {
        plan?: {
          intentStateId?: string;
          semanticVerificationId?: string;
          readinessAtPlan?: string;
          ambiguityClassAtPlan?: string;
        };
      };
    }).payload?.plan;
    const currentVerification = r.owner.artifacts.get(`semantic-verification-${r.state.id}`)?.payload
      .verification as { id?: string; readiness?: string; ambiguityClass?: string } | undefined;
    const planVerificationArtifact = await r.owner.getSemanticArtifact(`plan-verification-${value.workflowId}`);
    const guardianArtifact = await r.owner.getSemanticArtifact(`guardian-${value.workflowId}`);
    expect(planVerificationArtifact.ok).toBe(true);
    expect(guardianArtifact.ok).toBe(true);
    if (!planVerificationArtifact.ok || !guardianArtifact.ok) return;
    expect(planPayload).toMatchObject({
      intentStateId: r.state.id,
      semanticVerificationId: currentVerification?.id,
      readinessAtPlan: currentVerification?.readiness,
      ambiguityClassAtPlan: currentVerification?.ambiguityClass,
    });
    expect((planVerificationArtifact.value as { payload?: { intentStateId?: string } }).payload?.intentStateId).toBe(r.state.id);
    expect((guardianArtifact.value as { payload?: { intentStateId?: string } }).payload?.intentStateId).toBe(r.state.id);
    const proofObligations =
      ((planArtifact.value as { payload?: { plan?: { proofObligations?: Array<{ constraintId?: string }> } } })
        .payload?.plan?.proofObligations) ?? [];
    expect(proofObligations.some((row) => row.constraintId === "travel-stay-date")).toBe(true);
    const countObligation = proofObligations.find((row) => row.constraintId === "travel-count");
    expect(countObligation).toBeDefined();
    const proofArtifacts = ((value.artifacts?.proofs ?? []).map((proof) => r.owner.artifacts.get(proof.id)));
    const countProof = proofArtifacts.find(
      (artifact) =>
        artifact?.payload.obligationId ===
        (countObligation ? proofObligationId(countObligation) : "missing"),
    );
    expect(countProof?.payload.evidenceRefs?.[0]?.id).toBe("traveler-count-evidence");
    expect(countProof?.payload.status).toBe("SATISFIED");
  });

  it("still blocks privileged travel execution at PLANNABLE readiness even after the live-shape proof coverage fix", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW_WITH_MONITORING },
      verificationReadiness: "PLANNABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "hotel_stay_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-property", "property_name", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "Seaside Lodge"),
        explicitConstraint("travel-budget", "total_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-stay-date", "stay_date", "2026-12-20T00:00:00.000Z", "December 20, 2026"),
        temporalConstraint("travel-deadline", "completion_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-live-shape-plannable", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence", "hotel-offer-evidence"],
        },
      },
      idempotencyKey: "travel-live-shape-plannable",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as { workflowId: string; state: string };
    expect(value.state).toBe("BLOCKED");
    const verificationArtifact = await r.owner.getSemanticArtifact(`plan-verification-${value.workflowId}`);
    expect(verificationArtifact.ok).toBe(true);
    if (!verificationArtifact.ok) return;
    const findings =
      (((verificationArtifact.value as { payload?: { verification?: { findings?: Array<{ code?: string }> } } })
        .payload?.verification?.findings) ?? []);
    expect(findings.some((finding) => finding.code === ErrorCode.INAPPROPRIATE_COMMITMENT)).toBe(true);
    expect(findings.some((finding) => finding.code === ErrorCode.PROOF_OBLIGATION_MISSING)).toBe(false);
  });

  it("rejects a travel booking plan that stays read-only for an executable governed workflow", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      plannerTransform: (output) => {
        const plan = output as {
          steps: Array<{ id: string; requestedCapabilities: string[]; requiredFutureCapabilities: string[]; privileged: boolean; commitmentLevel: string }>;
        };
        return {
          ...plan,
          steps: plan.steps.map((step) =>
            step.id === "t3"
              ? {
                  ...step,
                  requestedCapabilities: ["search"],
                  requiredFutureCapabilities: [],
                  privileged: false,
                  commitmentLevel: "READ_ONLY",
                }
              : step,
          ),
        };
      },
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-read-only", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence", "hotel-offer-evidence"],
        },
      },
      idempotencyKey: "travel-read-only-reject",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PLAN_COVERAGE_GAP);
  });

  it("rejects a travel booking plan when execution-critical travel date proof coverage is missing", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      plannerTransform: (output) => {
        const plan = output as {
          proofObligations: Array<{ constraintId?: string }>;
          coverage: Array<{ constraintId: string; status: string; planStepIds: string[] }>;
        };
        return {
          ...plan,
          proofObligations: plan.proofObligations.filter((row) => row.constraintId !== "travel-deadline"),
          coverage: plan.coverage.map((row) =>
            row.constraintId === "travel-deadline"
              ? { ...row, planStepIds: [] }
              : row,
          ),
        };
      },
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-proof-gap", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence", "hotel-offer-evidence"],
        },
      },
      idempotencyKey: "travel-proof-gap",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as { workflowId: string; state: string };
    expect(value.state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
    const verificationArtifact = await r.owner.getSemanticArtifact(`plan-verification-${value.workflowId}`);
    expect(verificationArtifact.ok).toBe(true);
    if (!verificationArtifact.ok) return;
    const findings = (((verificationArtifact.value as { payload?: { verification?: { findings?: Array<{ code?: string }> } } }).payload?.verification?.findings) ?? []);
    expect(findings.some((finding) => finding.code === ErrorCode.PROOF_OBLIGATION_MISSING)).toBe(true);
  });

  it("may tighten a travel ALLOW_WITH_MONITORING baseline to approval when adaptive trust adds friction", async () => {
    const rawText = "Book 2 refundable hotel stays with an approved provider for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW_WITH_MONITORING },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
        explicitConstraint("travel-count", "traveler_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
        explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
        explicitConstraint("travel-budget", "travel_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
        temporalConstraint("travel-deadline", "travel_date", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
      learning: {
        getTrustSignal: async (subjectType, subjectId, domain) =>
          ok(
            subjectType === "COUNTERPARTY" && subjectId === "travel-provider" && domain === "travel"
              ? {
                  learnedContext: {
                    id: "ctx-travel-counterparty",
                    learningProposalId: "lp-travel-counterparty",
                    principalId: "principal",
                    domain: "travel",
                    proposalType: "COUNTERPARTY_TRUST",
                    content: {},
                    confirmedAt: NOW,
                    confirmedBy: "principal",
                    contentHash: "c".repeat(64),
                  },
                  trustSignal: {
                    subjectType: "COUNTERPARTY",
                    subjectId: "travel-provider",
                    domain: "travel",
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
      },
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      adaptiveSubjectId: "principal:owner@example.com",
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel on 2026-12-20",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "travel",
        payload: {
          provider: { id: "travel-provider", name: "Travel Provider", approved: true, approvalEvidenceId: "approval-evidence" },
          booking: { itineraryId: "it-monitoring-tighten", lodgingName: "Seaside Lodge", travelDate: "2026-12-20T00:00:00.000Z", travelerCount: 2 },
          policy: { refundableRequired: true },
          evidenceIds: ["approval-evidence", "traveler-count-evidence", "refund-evidence"],
        },
      },
      idempotencyKey: "travel-monitoring-tighten",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as {
      state: string;
      evaluation?: { decision?: string };
      approval?: { id?: string };
    };
    expect(value.state).toBe("AWAITING_APPROVAL");
    expect(value.evaluation?.decision).toBe(AuthorityDecision.REQUIRE_APPROVAL);
    expect(value.approval?.id).toBeTruthy();
    expect(r.calls).toMatchObject({ evaluation: 1, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });

  it("authorizes a governed SaaS/IT spend workflow and opens SaaS outcome requirements", async () => {
    const rawText = "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term for under USD 12000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { manage_saas_subscription: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("saas-vendor", "approved_vendor", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved SaaS plan"),
        explicitConstraint("saas-seats", "seat_count", ConstraintOperator.EQ, 10, ConstraintKind.HARD, "10 seats"),
        explicitConstraint("saas-term", "term_months", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12 month term"),
        explicitConstraint("saas-renewal", "renewal_setting", ConstraintOperator.EQ, "MANUAL", ConstraintKind.HARD, "manual renewal"),
        explicitConstraint("saas-budget", "saas_budget", ConstraintOperator.LTE, 12000, ConstraintKind.FINANCIAL, "under USD 12000"),
        temporalConstraint("saas-deadline", "subscription_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "manage_saas_subscription",
        merchant: "approved-vendor",
        product: "Business Plan",
        quantity: 10,
        amount: 9000,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "saas_it_spend",
        payload: {
          vendor: { id: "approved-vendor", name: "Approved Vendor", approved: true, approvalEvidenceId: "approval-evidence" },
          subscription: { planId: "plan-business", planName: "Business Plan", termMonths: 12, renewalSetting: "MANUAL", seatCount: 10 },
          evidenceIds: ["approval-evidence", "seat-count-evidence", "term-renewal-evidence"],
        },
      },
      idempotencyKey: "saas-success",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; outcomeContract?: { requirements?: Array<{ concept: string }> } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.outcomeContract?.requirements?.some((req) => req.concept === "saas_plan_active")).toBe(true);
  });

  it("fails closed on a SaaS renewal mismatch before authorize", async () => {
    const rawText = "Purchase 10 seats of an approved SaaS plan with manual renewal and 12 month term before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { manage_saas_subscription: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("saas-vendor", "approved_vendor", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved SaaS plan"),
        explicitConstraint("saas-seats", "seat_count", ConstraintOperator.EQ, 10, ConstraintKind.HARD, "10 seats"),
        explicitConstraint("saas-term", "term_months", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12 month term"),
        explicitConstraint("saas-renewal", "renewal_setting", ConstraintOperator.EQ, "MANUAL", ConstraintKind.HARD, "manual renewal"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "manage_saas_subscription",
        merchant: "approved-vendor",
        product: "Business Plan",
        quantity: 10,
        amount: 9000,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "saas_it_spend",
        payload: {
          vendor: { id: "approved-vendor", name: "Approved Vendor", approved: true, approvalEvidenceId: "approval-evidence" },
          subscription: { planId: "plan-business", planName: "Business Plan", termMonths: 12, renewalSetting: "AUTO", seatCount: 10 },
          evidenceIds: ["approval-evidence", "seat-count-evidence", "term-renewal-evidence"],
        },
      },
      idempotencyKey: "saas-fail",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });

  it("authorizes a governed invoice/vendor payment workflow and opens invoice outcome requirements", async () => {
    const rawText = "Pay approved vendor invoice INV-2026-001 one time for under USD 25000 before November 30, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { pay_invoice: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("invoice-payee", "approved_payee", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved vendor"),
        explicitConstraint("invoice-id", "invoice_identity", ConstraintOperator.EQ, "INV-2026-001", ConstraintKind.HARD, "invoice INV-2026-001"),
        explicitConstraint("invoice-budget", "invoice_budget", ConstraintOperator.LTE, 25000, ConstraintKind.FINANCIAL, "under USD 25000"),
        temporalConstraint("invoice-deadline", "invoice_due_date", "2026-11-30T00:00:00.000Z", "before November 30, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "pay_invoice",
        merchant: "approved-payee",
        product: "INV-2026-001",
        quantity: 1,
        amount: 24000,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "invoice_vendor_payment",
        payload: {
          payee: { id: "approved-payee", name: "Approved Payee", approved: true, approvalEvidenceId: "approval-evidence" },
          invoice: { invoiceId: "INV-2026-001", poReference: "PO-77", dueDate: "2026-11-20T00:00:00.000Z", duplicateCheckKey: "dup-1", remittanceReference: "remit-1" },
          evidenceIds: ["approval-evidence", "invoice-evidence"],
        },
      },
      idempotencyKey: "invoice-success",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; outcomeContract?: { requirements?: Array<{ concept: string }> } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.outcomeContract?.requirements?.some((req) => req.concept === "invoice_settled_exactly_once")).toBe(true);
  });

  it("fails closed on an invoice identity mismatch before authorize", async () => {
    const rawText = "Pay approved vendor invoice INV-2026-001 one time before November 30, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { pay_invoice: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("invoice-payee", "approved_payee", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved vendor"),
        explicitConstraint("invoice-id", "invoice_identity", ConstraintOperator.EQ, "INV-2026-001", ConstraintKind.HARD, "invoice INV-2026-001"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "pay_invoice",
        merchant: "approved-payee",
        product: "INV-2026-999",
        quantity: 1,
        amount: 24000,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "invoice_vendor_payment",
        payload: {
          payee: { id: "approved-payee", name: "Approved Payee", approved: true, approvalEvidenceId: "approval-evidence" },
          invoice: { invoiceId: "INV-2026-999", poReference: "PO-77", dueDate: "2026-11-20T00:00:00.000Z", duplicateCheckKey: "dup-1", remittanceReference: "remit-1" },
          evidenceIds: ["approval-evidence", "invoice-evidence"],
        },
      },
      idempotencyKey: "invoice-fail",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });

  it("authorizes a governed logistics workflow and opens logistics outcome requirements", async () => {
    const rawText = "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { arrange_fulfillment: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("logistics-provider", "approved_carrier", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved carrier"),
        explicitConstraint("logistics-destination", "destination", ConstraintOperator.EQ, "Mumbai Warehouse", ConstraintKind.HARD, "Mumbai Warehouse"),
        explicitConstraint("logistics-service", "service_level", ConstraintOperator.EQ, "EXPRESS", ConstraintKind.HARD, "EXPRESS"),
        explicitConstraint("logistics-count", "fulfill_count", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12"),
        temporalConstraint("logistics-deadline", "shipment_deadline", "2026-10-01T00:00:00.000Z", "before October 1, 2026"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "arrange_fulfillment",
        merchant: "approved-carrier",
        product: "EXPRESS",
        quantity: 12,
        amount: 3500,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "logistics_fulfillment",
        payload: {
          provider: { id: "approved-carrier", name: "Approved Carrier", approved: true, approvalEvidenceId: "approval-evidence" },
          shipment: { serviceLevel: "EXPRESS", destination: "Mumbai Warehouse", shipBy: "2026-09-20T00:00:00.000Z", fulfillCount: 12 },
          evidenceIds: ["approval-evidence", "fulfill-count-evidence", "shipment-evidence"],
        },
      },
      idempotencyKey: "logistics-success",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const value = result.value as { state: string; outcomeContract?: { requirements?: Array<{ concept: string }> } };
    expect(value.state).toBe("AUTHORIZED");
    expect(value.outcomeContract?.requirements?.some((req) => req.concept === "logistics_destination_correct")).toBe(true);
  });

  it("fails closed on a logistics destination mismatch before authorize", async () => {
    const rawText = "Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { arrange_fulfillment: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: replaceConstraints(rawText, [
        explicitConstraint("logistics-provider", "approved_carrier", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved carrier"),
        explicitConstraint("logistics-destination", "destination", ConstraintOperator.EQ, "Mumbai Warehouse", ConstraintKind.HARD, "Mumbai Warehouse"),
        explicitConstraint("logistics-service", "service_level", ConstraintOperator.EQ, "EXPRESS", ConstraintKind.HARD, "EXPRESS"),
        explicitConstraint("logistics-count", "fulfill_count", ConstraintOperator.EQ, 12, ConstraintKind.HARD, "12"),
      ]),
    });
    const result = await r.dispatcher.submitWorkflow({
      intent: { kind: "REFERENCE", intentId: "intent-e2e", expectedIntentStateId: r.state.id },
      action: {
        capability: "arrange_fulfillment",
        merchant: "approved-carrier",
        product: "EXPRESS",
        quantity: 12,
        amount: 3500,
        currency: "USD",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: {
        packId: "logistics_fulfillment",
        payload: {
          provider: { id: "approved-carrier", name: "Approved Carrier", approved: true, approvalEvidenceId: "approval-evidence" },
          shipment: { serviceLevel: "EXPRESS", destination: "Delhi Hub", shipBy: "2026-09-20T00:00:00.000Z", fulfillCount: 12 },
          evidenceIds: ["approval-evidence", "fulfill-count-evidence", "shipment-evidence"],
        },
      },
      idempotencyKey: "logistics-fail",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls).toMatchObject({ evaluation: 0, outcome: 0, prepare: 0, mint: 0, authorize: 0 });
  });
});

describe("Repair 18 authoritative proof handoff", () => {
  function travelCompiler(rawText: string) {
    return replaceConstraints(rawText, [
      explicitConstraint("travel-provider", "approved_provider", ConstraintOperator.EQ, true, ConstraintKind.HARD, "approved provider"),
      explicitConstraint("travel-count", "hotel_stay_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
      explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
      explicitConstraint("travel-property", "property_name", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "Seaside Lodge"),
      explicitConstraint("travel-budget", "total_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
      temporalConstraint("travel-stay-date", "stay_date", "2026-12-20T00:00:00.000Z", "December 20, 2026"),
      temporalConstraint("travel-deadline", "completion_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
    ]);
  }

  function travelCompilerWithProviderIdentity(rawText: string) {
    return replaceConstraints(rawText, [
      explicitConstraint("travel-provider", "booking_provider", ConstraintOperator.EQ, "Meridian Travel Partners", ConstraintKind.HARD, "Meridian Travel Partners"),
      explicitConstraint("travel-count", "hotel_stay_count", ConstraintOperator.EQ, 2, ConstraintKind.HARD, "2"),
      explicitConstraint("travel-refundable", "refundable", ConstraintOperator.EQ, true, ConstraintKind.HARD, "refundable"),
      explicitConstraint("travel-property", "property_name", ConstraintOperator.EQ, "Seaside Lodge", ConstraintKind.HARD, "Seaside Lodge"),
      explicitConstraint("travel-budget", "total_budget", ConstraintOperator.LTE, 5000, ConstraintKind.FINANCIAL, "under USD 5000"),
      temporalConstraint("travel-stay-date", "stay_date", "2026-12-20T00:00:00.000Z", "December 20, 2026"),
      temporalConstraint("travel-deadline", "completion_deadline", "2026-12-31T00:00:00.000Z", "before December 31, 2026"),
    ]);
  }

  function travelWorkflowBody(expectedIntentStateId: string, evidenceIds: string[] = ["ev-opaque-1"]) {
    return {
      intent: { kind: "REFERENCE" as const, intentId: "intent-e2e", expectedIntentStateId },
      action: {
        capability: "book_travel",
        merchant: "travel-provider",
        product: "Seaside Lodge",
        quantity: 2,
        amount: 3200,
        currency: "USD",
        refundable: true,
        deliveryTerms: "travel from 2026-12-20 to 2026-12-22",
        parameters: {
          checkInDate: "2026-12-20T00:00:00.000Z",
          checkOutDate: "2026-12-22T00:00:00.000Z",
        },
        consequenceLevel: "HIGH" as const,
      },
      domain: {
        packId: "travel" as const,
        payload: {
          provider: {
            id: "travel-provider",
            name: "Travel Provider",
            approved: true,
            approvalEvidenceId: evidenceIds[0],
          },
          booking: {
            itineraryId: "it-repair18",
            lodgingName: "Seaside Lodge",
            travelDate: "2026-12-20T00:00:00.000Z",
            checkInDate: "2026-12-20T00:00:00.000Z",
            checkOutDate: "2026-12-22T00:00:00.000Z",
            travelerCount: 2,
          },
          policy: { refundableRequired: true },
          evidenceIds,
        },
      },
      idempotencyKey: `repair18-${evidenceIds.join("-")}`,
    };
  }

  it("invokes Authority when v2 travel proofs are SATISFIED even if the evidence id has no semantic hint", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompiler(rawText),
    });
    const result = await r.dispatcher.submitWorkflow(
      travelWorkflowBody(r.state.id, ["ev-opaque-1"]),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect((result.value as { state: string }).state).toBe("AUTHORIZED");
    expect(r.calls.evaluation).toBe(1);
  });

  it("reaches Authority when the authoritative travel proof set is complete for a booking_provider identity constraint", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompilerWithProviderIdentity(rawText),
    });
    const result = await r.dispatcher.submitWorkflow(
      {
        ...travelWorkflowBody(r.state.id, ["ev-opaque-1"]),
        domain: {
          packId: "travel" as const,
          payload: {
            ...travelWorkflowBody(r.state.id, ["ev-opaque-1"]).domain.payload,
            provider: {
              id: "travel-provider",
              name: "Meridian Travel Partners",
              approved: true,
              approvalEvidenceId: "ev-opaque-1",
            },
          },
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { state: string }).state).toBe("AUTHORIZED");
    expect(r.calls.evaluation).toBe(1);
  });

  it("stitches the production-shaped travel lifecycle through commit, outcome SATISFIED, replay safety, and a non-satisfied ResolutionCase", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const runtimeOptions = {
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompilerWithProviderIdentity(rawText),
    } as const;
    const r = await runtime(runtimeOptions);

    const submitTravel = async (
      idempotencyKey: string,
      claimsFactory: (contract: {
        readonly merchant?: string;
        readonly product?: string;
        readonly parameters?: Record<string, unknown>;
        readonly requirements?: readonly { readonly concept?: string; readonly value?: unknown }[];
      }) => AcceptedEvidenceClaim[],
    ) => {
      const workflowRequest = {
        ...travelWorkflowBody(r.state.id, ["ev-opaque-1"]),
        idempotencyKey,
        domain: {
          packId: "travel" as const,
          payload: {
            ...travelWorkflowBody(r.state.id, ["ev-opaque-1"]).domain.payload,
            provider: {
              id: "travel-provider",
              name: "Meridian Travel Partners",
              approved: true,
              approvalEvidenceId: "ev-opaque-1",
            },
          },
        },
      };
      const submitted = await r.dispatcher.submitWorkflow(workflowRequest);
      if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
      const workflow = submitted.value as {
        workflowId: string;
        state: string;
        outcomeContract?: { id?: string };
        artifacts?: { planVerification?: { id?: string }; guardian?: { id?: string }; proofs?: Array<{ id: string }> };
      };
      expect(workflow.state).toBe("AUTHORIZED");
      expect(r.calls.evaluation).toBeGreaterThan(0);

      const planVerificationArtifact = await r.owner.getSemanticArtifact(`plan-verification-${workflow.workflowId}`);
      expect(planVerificationArtifact.ok).toBe(true);
      if (!planVerificationArtifact.ok) return;
      expect((planVerificationArtifact.value as { payload?: { verification?: { status?: string } } }).payload?.verification?.status).toBe("VERIFIED");
      const guardianArtifact = await r.owner.getSemanticArtifact(`guardian-${workflow.workflowId}`);
      expect(guardianArtifact.ok).toBe(true);

      const committed = await r.dispatcher.commitWorkflow(workflow.workflowId);
      if (!committed.ok) throw new Error(`${committed.code}: ${committed.message}`);
      expect(committed.value).toMatchObject({ status: "SUCCESS" });

      const outcomeContractId = String(workflow.outcomeContract?.id);
      expect(outcomeContractId).toBeTruthy();

      const paymentEvent = await handleExecutionEvent(
        executionEnvelope(outcomeContractId, "SUCCESS", `${idempotencyKey}-payment`),
        {
          outcomes: r.outcomes,
          resolution: r.resolution,
          getIntentState: async (id) => {
            const loaded = await r.owner.getIntentState(id);
            return loaded.ok ? loaded.value : undefined;
          },
        },
      );
      expect(paymentEvent.ok).toBe(true);
      if (!paymentEvent.ok) return;

      const paid = await r.outcomes.getContract(outcomeContractId);
      expect(paid.ok).toBe(true);
      if (!paid.ok) return;
      expect(paid.value.paymentStatus).toBe("SUCCESS");
      expect(paid.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);

      const derived = deriveObservations(paid.value, claimsFactory(paid.value));
      expect(derived.ok).toBe(true);
      if (!derived.ok) return;

      const outcomeEvent = await handleEvidenceEvent(
        evidenceEnvelope(
          outcomeContractId,
          {
            facts: derived.value.facts,
            conflictedConcepts: derived.value.conflictedConcepts,
          },
          `${idempotencyKey}-evidence`,
        ),
        {
          outcomes: r.outcomes,
          resolution: r.resolution,
          getIntentState: async (id) => {
            const loaded = await r.owner.getIntentState(id);
            return loaded.ok ? loaded.value : undefined;
          },
        },
      );
      expect(outcomeEvent.ok).toBe(true);
      if (!outcomeEvent.ok) return;

      const finalContract = await r.outcomes.getContract(outcomeContractId);
      expect(finalContract.ok).toBe(true);
      if (!finalContract.ok) return;

      return {
        workflowId: workflow.workflowId,
        outcomeContractId,
        committed: committed.value as { status: string },
        derivedFacts: derived.value.facts,
        finalContract: finalContract.value,
      };
    };

    const positive = await submitTravel("travel-stitched-positive", (contract) => positiveTravelOutcomeClaims(contract));
    expect(positive).toBeDefined();
    if (!positive) return;
    expect(positive.finalContract.state).toBe(OutcomeContractState.SATISFIED);
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const replay = await r.dispatcher.commitWorkflow(positive.workflowId);
    if (!replay.ok) throw new Error(`${replay.code}: ${replay.message}`);
    expect(replay.value).toMatchObject({ status: "IDEMPOTENT_REPLAY" });
    expect(await r.gateway.getSideEffectLedger().listAll()).toHaveLength(1);

    const negativeRuntime = await runtime(runtimeOptions);
    const negative = await (async () => {
      const submitTravelWith = async (
        active: Awaited<ReturnType<typeof runtime>>,
        idempotencyKey: string,
        claimsFactory: (contract: {
          readonly merchant?: string;
          readonly product?: string;
          readonly parameters?: Record<string, unknown>;
          readonly requirements?: readonly { readonly concept?: string; readonly value?: unknown }[];
        }) => AcceptedEvidenceClaim[],
      ) => {
        const workflowRequest = {
          ...travelWorkflowBody(active.state.id, ["ev-opaque-1"]),
          idempotencyKey,
          domain: {
            packId: "travel" as const,
            payload: {
              ...travelWorkflowBody(active.state.id, ["ev-opaque-1"]).domain.payload,
              provider: {
                id: "travel-provider",
                name: "Meridian Travel Partners",
                approved: true,
                approvalEvidenceId: "ev-opaque-1",
              },
            },
          },
        };
        const submitted = await active.dispatcher.submitWorkflow(workflowRequest);
        if (!submitted.ok) throw new Error(`${submitted.code}: ${submitted.message}`);
        const workflow = submitted.value as {
          workflowId: string;
          state: string;
          outcomeContract?: { id?: string };
        };
        expect(workflow.state).toBe("AUTHORIZED");

        const committed = await active.dispatcher.commitWorkflow(workflow.workflowId);
        if (!committed.ok) throw new Error(`${committed.code}: ${committed.message}`);
        expect(committed.value).toMatchObject({ status: "SUCCESS" });

        const outcomeContractId = String(workflow.outcomeContract?.id);
        const paymentEvent = await handleExecutionEvent(
          executionEnvelope(outcomeContractId, "SUCCESS", `${idempotencyKey}-payment`),
          {
            outcomes: active.outcomes,
            resolution: active.resolution,
            getIntentState: async (id) => {
              const loaded = await active.owner.getIntentState(id);
              return loaded.ok ? loaded.value : undefined;
            },
          },
        );
        expect(paymentEvent.ok).toBe(true);
        if (!paymentEvent.ok) return;

        const paid = await active.outcomes.getContract(outcomeContractId);
        expect(paid.ok).toBe(true);
        if (!paid.ok) return;
        const derived = deriveObservations(paid.value, claimsFactory(paid.value));
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;

        const outcomeEvent = await handleEvidenceEvent(
          evidenceEnvelope(
            outcomeContractId,
            {
              facts: derived.value.facts,
              conflictedConcepts: derived.value.conflictedConcepts,
            },
            `${idempotencyKey}-evidence`,
          ),
          {
            outcomes: active.outcomes,
            resolution: active.resolution,
            getIntentState: async (id) => {
              const loaded = await active.owner.getIntentState(id);
              return loaded.ok ? loaded.value : undefined;
            },
          },
        );
        expect(outcomeEvent.ok).toBe(true);
        if (!outcomeEvent.ok) return;

        const finalContract = await active.outcomes.getContract(outcomeContractId);
        expect(finalContract.ok).toBe(true);
        if (!finalContract.ok) return;

        return {
          workflowId: workflow.workflowId,
          outcomeContractId,
          finalContract: finalContract.value,
        };
      };
      return submitTravelWith(
        negativeRuntime,
        "travel-stitched-breached",
        (contract) => partialTravelOutcomeClaims(contract),
      );
    })();
    expect(negative).toBeDefined();
    if (!negative) return;
    expect(
      negative.finalContract.state === OutcomeContractState.PARTIAL ||
      negative.finalContract.state === OutcomeContractState.BREACHED,
    ).toBe(true);
    expect(negative.finalContract.paymentStatus).toBe("SUCCESS");

    const resolutionCase = negativeRuntime.resolution.getCaseByContract(negative.outcomeContractId);
    expect(resolutionCase.ok).toBe(true);
    if (!resolutionCase.ok) return;
    expect(resolutionCase.value.contractId).toBe(negative.outcomeContractId);
  });

  it("fails closed when the authoritative proof snapshot is stale", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompiler(rawText),
      proofSummaryMutator: ({ summary }) => ({
        ...summary,
        intentStateHash: "f".repeat(64),
      }),
    });
    const result = await r.dispatcher.submitWorkflow(travelWorkflowBody(r.state.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls.evaluation).toBe(0);
  });

  it("fails closed when a required proof row is missing from the authoritative snapshot", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompiler(rawText),
      proofSummaryMutator: ({ summary }) => {
        const proofRows = ((summary.proofRows as Array<Record<string, unknown>>) ?? []).filter(
          (row) => row.constraintId !== "travel-count",
        );
        const coverage = summary.coverage as Record<string, unknown>;
        return {
          ...summary,
          proofRows,
          coverage: {
            ...coverage,
            evaluatedConstraintIds: (coverage.evaluatedConstraintIds as string[]).filter(
              (id) => id !== "travel-count",
            ),
            missingEvaluationConstraintIds: ["travel-count"],
            allRequiredCovered: false,
          },
        };
      },
    });
    const result = await r.dispatcher.submitWorkflow(travelWorkflowBody(r.state.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls.evaluation).toBe(0);
  });

  it("fails closed when a required proof row is UNKNOWN", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompiler(rawText),
      proofSummaryMutator: ({ summary }) => ({
        ...summary,
        proofRows: ((summary.proofRows as Array<Record<string, unknown>>) ?? []).map((row) =>
          row.constraintId === "travel-count"
            ? { ...row, status: "UNKNOWN", reason: "repair18-unknown-proof" }
            : row,
        ),
      }),
    });
    const result = await r.dispatcher.submitWorkflow(travelWorkflowBody(r.state.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls.evaluation).toBe(0);
  });

  it("fails closed when a required proof row is contradictory", async () => {
    const rawText = "Book 2 refundable hotel stays at Seaside Lodge with an approved provider on December 20, 2026 for under USD 5000 before December 31, 2026.";
    const r = await runtime({
      rawText,
      capabilities: { book_travel: AuthorityDecision.ALLOW },
      verificationReadiness: "EXECUTABLE",
      compilerTransform: travelCompiler(rawText),
      proofSummaryMutator: ({ summary }) => ({
        ...summary,
        proofRows: ((summary.proofRows as Array<Record<string, unknown>>) ?? []).map((row) =>
          row.constraintId === "travel-count"
            ? { ...row, status: "UNSATISFIED", reason: "repair18-contradictory-proof" }
            : row,
        ),
      }),
    });
    const result = await r.dispatcher.submitWorkflow(travelWorkflowBody(r.state.id));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { state: string }).state).toBe("BLOCKED");
    expect(r.calls.evaluation).toBe(0);
  });
});
});
