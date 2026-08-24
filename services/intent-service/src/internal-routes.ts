import { ErrorCode, ok, type ProvenanceNode, type Result } from "@truemandate/protocol";
import type { InternalRoute, InternalRouteResponse } from "@truemandate/cloud-runtime";
import type { IntentService } from "./service.js";
import type { ProvenanceService } from "@truemandate/provenance-service";
import { hashCanonical } from "@truemandate/crypto";
import {
  AuthorityExecutionLineageSchema,
  authorityExecutionProvenance,
  executionActionNodeId,
  candidateConstraintProvenanceNodeId,
  principalIdentityMatches,
} from "@truemandate/provenance";
import { z } from "zod";
import {
  AssumptionSchema,
  AuthorityDecisionSchema,
  CandidateInterpretationSchema,
  ConstraintSchema,
  ExecutionAuthorizationArtifactPayloadSchema,
  SemanticArtifactKindSchema,
  SemanticVerificationResultSchema,
  parseWithSchema,
  type SemanticArtifactKind,
} from "@truemandate/schemas";
import { supersedeSemanticVerification } from "./semantic-supersession.js";

const EvidenceRefSchema = z.object({ id: z.string().min(1), hash: z.string().min(1) }).strict();
const GuardianProofRefSchema = z.object({ id: z.string().min(1), hash: z.string().min(1), obligationId: z.string().min(1) }).strict();
const SemanticArtifactSchema = z.object({
  id: z.string().min(1), intentId: z.string().min(1), workflowId: z.string().min(1),
  kind: SemanticArtifactKindSchema,
  // The owner, not the caller, establishes this hash from the immutable body.
  payload: z.record(z.unknown()),
  predecessors: z.array(z.object({ id: z.string().min(1), kind: z.string().min(1), contentHash: z.string().min(1) }).strict()).default([]),
  contentHash: z.string().min(1).optional(), createdAt: z.string().min(1),
}).strict().superRefine((artifact, ctx) => {
  const body = artifact.payload as Record<string, unknown>;
  if (artifact.kind !== "COMPILATION" && artifact.kind !== "COMPILATION_VERIFICATION" &&
    (typeof body.intentStateId !== "string" || typeof body.intentStateHash !== "string")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Semantic artifact payload lacks IntentState binding" });
  }
  if (artifact.kind === "PROOF") {
    const required = ["schemaVersion", "proofId", "obligationId", "actionArtifactId", "actionPayloadHash", "status", "evidenceRefs", "evaluatedAt", "method"];
    for (const key of required) if (!(key in body)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `PROOF payload missing ${key}` });
    if (body.status !== "SATISFIED" && body.status !== "UNSATISFIED" && body.status !== "UNKNOWN") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid proof status" });
    if (typeof body.actionPayloadHash !== "string" || !/^[a-f0-9]{64}$/i.test(body.actionPayloadHash)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid proof action payload hash" });
    if (typeof body.evaluatedAt !== "string" || Number.isNaN(Date.parse(body.evaluatedAt))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid proof evaluation time" });
    if (typeof body.method !== "string" || body.method.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid proof evaluation method" });
    if (!Array.isArray(body.evidenceRefs) || body.evidenceRefs.length === 0 || !body.evidenceRefs.every((ref) => EvidenceRefSchema.safeParse(ref).success)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid immutable evidence references" });
  }
  if (artifact.kind === "ACTION" && (!Array.isArray(body.requiredProofObligationIds) || new Set(body.requiredProofObligationIds).size !== body.requiredProofObligationIds.length || !body.requiredProofObligationIds.every((id) => typeof id === "string" && id.length > 0))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ACTION requiredProofObligationIds" });
  if (artifact.kind === "GUARDIAN" && (!Array.isArray(body.evaluatedProofs) || !body.actionArtifactId || !body.actionArtifactHash || !body.evaluatedProofs.every((ref) => GuardianProofRefSchema.safeParse(ref).success))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "GUARDIAN payload lacks evaluated immutable proof set" });
  if (artifact.kind === "EXECUTION_AUTHORIZATION") {
    const authorization = ExecutionAuthorizationArtifactPayloadSchema.safeParse(body);
    if (!authorization.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid EXECUTION_AUTHORIZATION payload" });
    } else if (
      artifact.id !== `execution-authorization-${artifact.workflowId}` ||
      authorization.data.workflowId !== artifact.workflowId
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "EXECUTION_AUTHORIZATION workflow binding mismatch" });
    }
    if (
      artifact.predecessors.length !== 1 ||
      artifact.predecessors[0]?.kind !== "WORKFLOW" ||
      artifact.predecessors[0]?.id !== artifact.workflowId
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "EXECUTION_AUTHORIZATION requires its canonical WORKFLOW predecessor" });
    }
  }
  if (artifact.kind === "COMPILATION") {
    const candidate = CandidateInterpretationSchema.safeParse(body.candidate);
    if (!candidate.success || body.schemaVersion !== 1 || body.rawIntentId !== artifact.intentId ||
      typeof body.rawIntentHash !== "string" || typeof body.intentRootNodeId !== "string" ||
      body.candidateHash !== candidate.data?.candidateHash) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid immutable compilation payload" });
  }
  if (artifact.kind === "COMPILATION_VERIFICATION") {
    const verification = SemanticVerificationResultSchema.safeParse(body.verification);
    if (!verification.success || body.schemaVersion !== 1 || body.rawIntentId !== artifact.intentId ||
      typeof body.compilationId !== "string" || typeof body.compilationHash !== "string" ||
      typeof body.rawIntentHash !== "string") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid immutable compilation verification payload" });
  }
});

const FinalizeCompilationSchema = z.object({
  compilationId: z.string().min(1), compilationHash: z.string().regex(/^[a-f0-9]{64}$/i),
  verificationId: z.string().min(1), verificationHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
const AuthorityBindingSchema = z
  .object({ lineage: AuthorityExecutionLineageSchema, createdAt: z.string().datetime() })
  .strict();

/**
 * Owner-side IntentState creation (capability-policy ingress). Caller-restricted
 * to the verified acceptance/operator identities; the state hash is always
 * computed owner-side. `capabilities` here are AUTHORITATIVE POLICY — they are
 * never model-injectable (the semantic pipeline has no path to this route).
 */
const IntentStateCreateSchema = z
  .object({
    intentId: z.string().min(1),
    id: z.string().min(1).optional(),
    constraints: z.array(ConstraintSchema),
    assumptions: z.array(AssumptionSchema).optional(),
    capabilities: z.record(AuthorityDecisionSchema).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1).optional(),
    previousStateId: z.string().min(1).optional(),
  })
  .strict();

const EXECUTION_BOUND_OPERATORS = new Set(["LT", "LTE", "REQUIRE"]);

function normalizeExecutionNotAfter(value: string): string | undefined {
  const trimmed = value.trim();
  // A model-provided value may stand in for temporalResolution only when it is
  // already an absolute ISO date or offset timestamp. Relative expressions
  // remain unresolved rather than acquiring a fabricated execution window.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(trimmed) &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)
  ) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const normalized = new Date(parsed).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && normalized.slice(0, 10) !== trimmed) {
    return undefined;
  }
  return normalized;
}

function resolveGroundedExecutionNotAfter(input: {
  readonly value: unknown;
  readonly grounding: { readonly sourceText: string };
  readonly temporalResolution?: { readonly resolvedValue: string };
}): string | undefined {
  if (input.temporalResolution) {
    return normalizeExecutionNotAfter(input.temporalResolution.resolvedValue);
  }
  if (typeof input.value !== "string") return undefined;
  const normalized = normalizeExecutionNotAfter(input.value);
  if (!normalized) return undefined;

  const source = input.grounding.sourceText;
  const isoDate = source.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const monthDate = source.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i,
  );
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const groundedDate = isoDate ?? (() => {
    if (!monthDate) return undefined;
    const month = monthNames.indexOf(monthDate[1]!.toLowerCase()) + 1;
    const day = Number(monthDate[2]);
    const year = Number(monthDate[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) return undefined;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  })();
  return groundedDate === normalized.slice(0, 10)
    ? normalized
    : undefined;
}

function fromResult<T>(result: Result<T>, notFound = false): InternalRouteResponse {
  if (result.ok) {
    return { status: 200, body: result.value };
  }
  const unknown =
    notFound ||
    /unknown|no intentstate tip/i.test(result.message);
  return {
    status: unknown ? 404 : 400,
    body: {
      error: result.code,
      message: result.message,
      details: result.details,
    },
  };
}

export function createIntentProvenanceInternalRoutes(input: {
  readonly intents: IntentService;
  readonly provenance: ProvenanceService;
  readonly durableProvenance?: {
    getNode(id: string): Promise<{ payload?: unknown } | undefined>;
    getEdge(id: string): Promise<{ payload?: unknown } | undefined>;
  };
  readonly semanticArtifacts?: {
    putIfAbsent(record: { id: string; intentId: string; workflowId: string; kind: SemanticArtifactKind; payload: unknown; predecessors: readonly { id: string; kind: string; contentHash: string }[]; contentHash: string; createdAt: string }): Promise<boolean>;
    get(id: string): Promise<{ id: string; intentId: string; workflowId: string; kind: string; payload: unknown; predecessors: readonly { id: string; kind: string; contentHash: string }[]; contentHash: string; createdAt: string } | undefined>;
    listWorkflow(workflowId: string): Promise<readonly unknown[]>;
  };
  readonly authorityCallerEmail?: string;
  readonly globalCallers?: readonly string[];
  readonly outcomeResolutionCallerEmail?: string;
  readonly gatewayCallerEmail?: string;
  /** Owner-side capability-policy ingress: verified acceptance/operator
   * identities that may create IntentStates with authoritative
   * capabilities (never the model pipeline — the model path remains
   * capability-free). */
  readonly intentStateCallers?: readonly string[];
  /** Read-only tip/state visibility for the same verified identities. */
  readonly extraReadCallers?: readonly string[];
  readonly semanticSupersessionCallers?: readonly string[];
}): readonly InternalRoute[] {
  const { intents, provenance, durableProvenance, semanticArtifacts, authorityCallerEmail } = input;
  // Least-privilege owner READ authorization: Outcome Resolution and Gateway
  // gain exactly the read routes their owner-side contract requires — never
  // the global allowlist, and never any write/finalization route.
  const readCallers = [
    ...(input.globalCallers ?? []),
    ...(input.outcomeResolutionCallerEmail ? [input.outcomeResolutionCallerEmail] : []),
    ...(input.gatewayCallerEmail ? [input.gatewayCallerEmail] : []),
    ...(input.extraReadCallers ?? []),
  ].filter((value, index, all) => all.indexOf(value) === index);
  // Wave 1 remedy lifecycle: the outcome-resolution identity writes the
  // remedy semantic artifact chain and execution provenance (never intents,
  // never compilations/finalization). Route-scoped — it gains exactly these
  // three write routes and nothing else.
  const artifactWriters = [
    ...(input.globalCallers ?? []),
    ...(input.outcomeResolutionCallerEmail ? [input.outcomeResolutionCallerEmail] : []),
  ].filter((value, index, all) => all.indexOf(value) === index);
  const artifactWritersCallers = artifactWriters.length > 0 ? artifactWriters : undefined;

  return [
    {
      method: "POST",
      pattern: "/internal/intents",
      handler: async ({ body }) => fromResult(await intents.createIntent(body)),
    },
    ...(input.intentStateCallers && input.intentStateCallers.length > 0 ? [{
      method: "POST",
      pattern: "/internal/intent-states",
      allowedCallers: input.intentStateCallers,
      handler: async ({ body }) => {
        const parsed = parseWithSchema(IntentStateCreateSchema, body, "IntentStateCreate");
        if (!parsed.ok) return fromResult(parsed);
        const created = await intents.createIntentState(parsed.value);
        if (!created.ok) return fromResult(created);
        const state = created.value;
        // Owner-derived semantic-verification continuity: a policy state
        // created over an existing verified tip re-binds the prior immutable
        // verification lineage to the new state (the raw-intent semantics are
        // unchanged; only the authoritative policy field differs). The
        // artifact id/contentHash are derived owner-side, never caller-side.
        if (semanticArtifacts && state.previousStateId) {
          const priorVerification = await semanticArtifacts.get(`semantic-verification-${state.previousStateId}`);
          if (priorVerification) {
            const priorPayload = priorVerification.payload as Record<string, unknown>;
            const payload = {
              ...priorPayload,
              schemaVersion: 1,
              intentStateId: state.id,
              intentStateHash: state.stateHash,
              intentStateVersion: state.version,
              evaluatedAt: state.createdAt,
            };
            const record = {
              id: `semantic-verification-${state.id}`,
              intentId: state.intentId,
              workflowId: priorVerification.workflowId,
              kind: "SEMANTIC_VERIFICATION" as const,
              payload,
              predecessors: priorVerification.predecessors,
              contentHash: hashCanonical(payload),
              createdAt: state.createdAt,
            };
            const inserted = await semanticArtifacts.putIfAbsent(record);
            if (!inserted) {
              const durable = await semanticArtifacts.get(record.id);
              if (!durable || durable.kind !== record.kind || durable.contentHash !== record.contentHash) {
                return { status: 400, body: { error: ErrorCode.VALIDATION_FAILED, message: "Semantic verification artifact replay conflict" } };
              }
            }
          }
        }
        return fromResult(ok(state));
      },
    } satisfies InternalRoute] : []),
    ...(input.semanticSupersessionCallers && input.semanticSupersessionCallers.length > 0 ? [{
      method: "POST",
      pattern: "/internal/intent-states/:id/semantic-supersession",
      allowedCallers: input.semanticSupersessionCallers,
      handler: async ({ body, params }) =>
        fromResult(
          await supersedeSemanticVerification(
            intents,
            semanticArtifacts as never,
            params.id ?? "",
            body,
          ),
        ),
    } satisfies InternalRoute] : []),
    {
      method: "GET",
      pattern: "/internal/intents/:id",
      handler: async ({ params }) =>
        fromResult(await intents.getIntent(params.id ?? ""), true),
    },
    {
      method: "GET",
      pattern: "/internal/intents/:id/tip",
      allowedCallers: readCallers,
      handler: async ({ params }) =>
        fromResult(await intents.getCurrentIntentState(params.id ?? ""), true),
    },
    {
      method: "GET",
      pattern: "/internal/intent-states/:id",
      allowedCallers: readCallers,
      handler: async ({ params }) =>
        fromResult(await intents.getIntentState(params.id ?? ""), true),
    },
    ...(semanticArtifacts ? [{
      method: "POST", pattern: "/internal/compilations/finalize",
      handler: async ({ body }: { body: unknown }) => {
        const parsed = parseWithSchema(FinalizeCompilationSchema, body, "FinalizeCompilation");
        if (!parsed.ok) return fromResult(parsed);
        const compilation = await semanticArtifacts.get(parsed.value.compilationId);
        const verification = await semanticArtifacts.get(parsed.value.verificationId);
        if (!compilation || !verification || compilation.kind !== "COMPILATION" || verification.kind !== "COMPILATION_VERIFICATION" ||
          compilation.contentHash !== parsed.value.compilationHash || verification.contentHash !== parsed.value.verificationHash ||
          compilation.intentId !== verification.intentId) return { status: 400, body: { error: "VALIDATION_FAILED", message: "Compilation lineage reference invalid" } };
        const c = compilation.payload as Record<string, unknown>;
        const v = verification.payload as Record<string, unknown>;
        const candidate = CandidateInterpretationSchema.safeParse(c.candidate);
        const verified = SemanticVerificationResultSchema.safeParse(v.verification);
        if (!candidate.success || !verified.success || v.compilationId !== compilation.id || v.compilationHash !== compilation.contentHash ||
          c.rawIntentId !== compilation.intentId || c.rawIntentHash !== candidate.data.rawIntentHash ||
          (verified.data.lifecycle !== "VERIFIED" && verified.data.lifecycle !== "AMBIGUOUS") || verified.data.criticalFailure) return { status: 400, body: { error: "VALIDATION_FAILED", message: "Compilation verification is not finalizable" } };
        const intent = await intents.getIntent(compilation.intentId);
        if (!intent.ok || intent.value.contentHash !== c.rawIntentHash) return { status: 400, body: { error: "VALIDATION_FAILED", message: "Raw human intent lineage invalid" } };
        let temporalAuthority: { executionNotAfter: string; source: "EXPLICIT_HUMAN"; sourceRef: string; provenanceNodeId?: string } | undefined;
        const temporalCandidates = candidate.data.constraints.filter((x) =>
          x.kind === "TEMPORAL" &&
          x.sourceType === "HUMAN" &&
          x.meaningClass === "EXPLICIT" &&
          x.grounding.quoteExact &&
          x.grounding.sourceSpan,
        );
        const temporal = temporalCandidates.find((x) =>
          EXECUTION_BOUND_OPERATORS.has(x.operator) &&
          resolveGroundedExecutionNotAfter(x) !== undefined,
        );
        if (temporal) {
          const span = temporal.grounding.sourceSpan!;
          const exact = intent.value.rawText.slice(span.start, span.end) === temporal.grounding.sourceText;
          const executionNotAfter = resolveGroundedExecutionNotAfter(temporal);
          const nodeId = candidateConstraintProvenanceNodeId(candidate.data.candidateHash, temporal.id);
          const node = await durableProvenance?.getNode(nodeId);
          const payload = node?.payload as Record<string, unknown> | undefined;
          const taint = payload?.taint as Record<string, unknown> | undefined;
          if (!exact || !executionNotAfter || !payload || !Array.isArray(taint?.classes) || taint.classes.some((x) => x !== "NONE")) return { status: 400, body: { error: "VALIDATION_FAILED", message: "Temporal authority provenance invalid" } };
          temporalAuthority = { executionNotAfter, source: "EXPLICIT_HUMAN", sourceRef: temporal.id, provenanceNodeId: nodeId };
        }
        return fromResult(await intents.finalizeVerifiedCompilation({ intentId: compilation.intentId, candidate: candidate.data as never, verification: verified.data as never, compilationHash: compilation.contentHash, temporalAuthority: temporalAuthority as never, artifactLineage: { compilationId: parsed.value.compilationId, verificationId: parsed.value.verificationId, verificationHash: parsed.value.verificationHash, workflowId: compilation.workflowId } }));
      },
    }] : []),
    {
      method: "POST",
      pattern: "/internal/provenance/nodes",
      allowedCallers: artifactWritersCallers,
      handler: async ({ body }) => {
        const candidate = body as Record<string, unknown> | null;
        if (candidate?.kind === "AUTHORITY") {
          return { status: 400, body: { error: ErrorCode.VALIDATION_FAILED, message: "Authority provenance is owner-only" } };
        }
        return fromResult(await provenance.recordNode(body));
      },
    },
    {
      method: "POST",
      pattern: "/internal/provenance/edges",
      allowedCallers: artifactWritersCallers,
      handler: async ({ body }) => {
        const candidate = body as Record<string, unknown> | null;
        if (candidate?.relation === "AUTHORIZES") {
          return { status: 400, body: { error: ErrorCode.VALIDATION_FAILED, message: "AUTHORIZES provenance is Authority-only" } };
        }
        return fromResult(await provenance.recordEdge(body));
      },
    },
    ...(authorityCallerEmail ? [{
      method: "POST",
      pattern: "/internal/provenance/authority-bindings",
      allowedCallers: [authorityCallerEmail],
      handler: async ({ body }: { body: unknown }) => {
        const parsed = parseWithSchema(AuthorityBindingSchema, body, "AuthorityProvenanceBinding");
        if (!parsed.ok) return fromResult(parsed);
        const executionNodeId = executionActionNodeId(parsed.value.lineage);
        if (!provenance.getNode(executionNodeId).ok) {
          const durableExecution = await durableProvenance?.getNode(executionNodeId);
          const payload = durableExecution?.payload as Record<string, unknown> | undefined;
          if (!payload || payload.id !== executionNodeId) {
            return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Execution-action provenance node missing" });
          }
          const hydrated = await provenance.recordNode(payload);
          if (!hydrated.ok) return fromResult(hydrated);
        }
        const records = authorityExecutionProvenance(parsed.value.lineage, parsed.value.createdAt);
        // PRINCIPAL = stable actor identity, replay-stable across any number
        // of authorizations. The first legitimate occurrence creates the
        // canonical principal node; later authorizations verify the durable
        // identity content and reuse it without rewriting timestamps or
        // lineage. Genuinely divergent identity attributes still fail closed.
        const durablePrincipal = durableProvenance
          ? await durableProvenance.getNode(records.principal.id)
          : undefined;
        const existingPrincipal = durablePrincipal?.payload as ProvenanceNode | undefined;
        if (existingPrincipal) {
          if (!principalIdentityMatches(existingPrincipal, parsed.value.lineage.principalId)) {
            return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Principal provenance identity mismatch" });
          }
          if (!provenance.getNode(records.principal.id).ok) {
            const hydrated = await provenance.recordNode(existingPrincipal);
            if (!hydrated.ok) return fromResult(hydrated);
          }
        } else {
          // No durable row yet: first legitimate occurrence may create the
          // canonical principal. If the in-memory graph already holds a
          // divergent identity, fail closed before any write.
          const inMemory = provenance.getNode(records.principal.id);
          if (inMemory.ok && !principalIdentityMatches(inMemory.value, parsed.value.lineage.principalId)) {
            return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Principal provenance identity mismatch" });
          }
          const created = await provenance.recordNode(records.principal);
          if (!created.ok) return fromResult(created);
        }
        // The AUTHORITY node is per-authorization (grant-scoped id). The
        // mint-time binding is canonical (first-write-wins): a replay of the
        // SAME mint (same id, same lineage) reuses the durable record. The
        // grant's consumption state legitimately progresses after COMMIT, so
        // only the grant hash may differ from the mint-time snapshot — every
        // other lineage field must match, else fail closed.
        const stripMutableGrant = (node: Record<string, unknown>) => {
          const copy = { ...node };
          if (copy.metadata && typeof copy.metadata === "object") {
            const md = { ...(copy.metadata as Record<string, unknown>) } as Record<string, unknown>;
            delete md.grantHash;
            copy.metadata = md;
          }
          return copy;
        };
        const durableAuthority = durableProvenance
          ? await durableProvenance.getNode(records.authority.id)
          : undefined;
        const existingAuthorityPayload = durableAuthority?.payload as
          | Record<string, unknown>
          | undefined;
        if (existingAuthorityPayload) {
          if (
            hashCanonical(stripMutableGrant(existingAuthorityPayload)) !==
            hashCanonical(stripMutableGrant(records.authority as unknown as Record<string, unknown>))
          ) {
            return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Authority provenance immutable conflict" });
          }
          if (!provenance.getNode(records.authority.id).ok) {
            const hydrated = await provenance.recordNode(existingAuthorityPayload);
            if (!hydrated.ok) return fromResult(hydrated);
          }
          for (const edge of [records.principalEdge, records.authorizes]) {
            if (provenance.getGraph().listEdges().find((item) => item.id === edge.id)) continue;
            const durableEdge = durableProvenance?.getEdge
              ? await durableProvenance.getEdge(edge.id)
              : undefined;
            const edgePayload = durableEdge?.payload ?? edge;
            const rec = await provenance.recordEdge(edgePayload);
            if (!rec.ok) return fromResult(rec);
          }
          return { status: 200, body: records };
        }
        // No durable authority row yet: the first mint records it. The
        // in-memory graph keeps its immutable conflict checks.
        const existingAuthority = provenance.getNode(records.authority.id);
        if (existingAuthority.ok && hashCanonical(existingAuthority.value) !== hashCanonical(records.authority)) {
          return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Authority provenance immutable conflict" });
        }
        const recordedAuthority = await provenance.recordNode(records.authority);
        if (!recordedAuthority.ok) return fromResult(recordedAuthority);
        for (const edge of [records.principalEdge, records.authorizes]) {
          const existing = provenance.getGraph().listEdges().find((item) => item.id === edge.id);
          if (existing && hashCanonical(existing) !== hashCanonical(edge)) {
            return fromResult({ ok: false, code: ErrorCode.VALIDATION_FAILED, message: "Authority provenance immutable conflict" });
          }
          const recorded = await provenance.recordEdge(edge);
          if (!recorded.ok) return fromResult(recorded);
        }
        return { status: 200, body: records };
      },
    } satisfies InternalRoute] : []),
    {
      method: "GET",
      pattern: "/internal/provenance/nodes/:id",
      handler: async ({ params }) => {
        const id = params.id ?? "";
        const local = provenance.getNode(id);
        if (local.ok) return { status: 200, body: local.value };
        const durable = await durableProvenance?.getNode(id);
        if (durable?.payload) return { status: 200, body: durable.payload };
        return {
          status: 404,
          body: { error: "VALIDATION_FAILED", message: "Unknown provenance node" },
        };
      },
    },
    {
      method: "GET",
      pattern: "/internal/provenance/edges/:id",
      handler: async ({ params }) => {
        const id = params.id ?? "";
        const durable = await durableProvenance?.getEdge(id);
        if (durable?.payload) return { status: 200, body: durable.payload };
        return {
          status: 404,
          body: { error: "VALIDATION_FAILED", message: "Unknown provenance edge" },
        };
      },
    },
    ...(semanticArtifacts ? [{
      method: "POST", pattern: "/internal/semantic-artifacts",
      allowedCallers: artifactWritersCallers,
      handler: async ({ body }: { body: unknown }) => {
        const parsed = parseWithSchema(SemanticArtifactSchema, body, "SemanticArtifact");
        if (!parsed.ok) return fromResult(parsed);
        const payload = parsed.value.kind === "GUARDIAN"
          ? { ...parsed.value.payload, evaluatedProofs: [...((parsed.value.payload as Record<string, unknown>).evaluatedProofs as unknown[])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
          : parsed.value.payload;
        const contentHash = hashCanonical(payload);
        if (parsed.value.contentHash && parsed.value.contentHash !== contentHash) {
          return { status: 400, body: { error: "VALIDATION_FAILED", message: "Caller content hash disagrees with owner canonical hash" } };
        }
        const predecessors = parsed.value.predecessors ?? [];
        for (const predecessor of predecessors) {
          const existing = await semanticArtifacts.get(predecessor.id);
          if (!existing || existing.workflowId !== parsed.value.workflowId || existing.contentHash !== predecessor.contentHash || existing.kind !== predecessor.kind) {
            return { status: 400, body: { error: "VALIDATION_FAILED", message: "Invalid immutable predecessor reference" } };
          }
        }
        const owned = { ...parsed.value, payload, predecessors, contentHash };
        const inserted = await semanticArtifacts.putIfAbsent(owned);
        if (!inserted) {
          // Identical immutable replay is idempotent; divergent same-ID content
          // remains fail closed.
          const existing = await semanticArtifacts.get(parsed.value.id);
          if (
            existing &&
            existing.contentHash === owned.contentHash &&
            existing.kind === owned.kind &&
            existing.workflowId === owned.workflowId
          ) {
            return { status: 200, body: existing };
          }
          return { status: 409, body: { error: "VALIDATION_FAILED", message: "Semantic artifact immutable" } };
        }
        return { status: 200, body: owned };
      },
    }, {
      method: "GET", pattern: "/internal/semantic-artifacts/:id",
      allowedCallers: readCallers,
      handler: async ({ params }: { params: Record<string, string> }) => {
        const artifact = await semanticArtifacts.get(params.id ?? "");
        return artifact ? { status: 200, body: artifact } : { status: 404, body: { error: "VALIDATION_FAILED", message: "Unknown semantic artifact" } };
      },
    }, {
      method: "GET", pattern: "/internal/workflows/:workflowId/artifacts",
      handler: async ({ params }: { params: Record<string, string> }) => ({ status: 200, body: await semanticArtifacts.listWorkflow(params.workflowId ?? "") }),
    }] : []),
  ];
}
