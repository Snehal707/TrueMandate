import { hashCanonical, proofObligationId } from "@truemandate/crypto";
import { ErrorCode, err, ok, type IntentState, type Result } from "@truemandate/protocol";

export interface SemanticArtifactClient {
  getSemanticArtifact(id: string): Promise<Result<unknown>>;
  getIntentState?(id: string): Promise<
    Result<
      Pick<
        IntentState,
        "id" | "intentId" | "stateHash" | "version" | "constraints" | "temporalAuthority"
      >
    >
  >;
  getTip?(intentId: string): Promise<Result<{ id: string; intentId: string; stateHash: string; version: number }>>;
}

const EXECUTION_BOUND_OPERATORS = new Set(["LT", "LTE", "REQUIRE"]);

export function resolveTemporalExecutionBound(
  state: Pick<IntentState, "constraints" | "temporalAuthority">,
  now: string,
  parentExpiry?: string,
  policyExpiry?: string,
): Result<{ expiresAt: string; notBefore?: string }> {
  const bound = state.temporalAuthority;
  if (!bound || (bound.source !== "EXPLICIT_HUMAN" && bound.source !== "ENTERPRISE_POLICY") || !bound.sourceRef) return err(ErrorCode.VALIDATION_FAILED, "MISSING_TEMPORAL_AUTHORITY");
  const source = state.constraints.find((constraint) => constraint.id === bound.sourceRef);
  if (
    !source ||
    source.kind !== "TEMPORAL" ||
    !EXECUTION_BOUND_OPERATORS.has(source.operator) ||
    (bound.source === "EXPLICIT_HUMAN" &&
      (source.sourceType !== "HUMAN" || source.meaningClass !== "EXPLICIT"))
  ) {
    return err(ErrorCode.VALIDATION_FAILED, "Temporal authority sourceRef is invalid");
  }
  if (typeof source.value === "string") {
    const sourceValue = Date.parse(source.value);
    const boundValue = Date.parse(bound.executionNotAfter);
    if (
      !Number.isNaN(sourceValue) &&
      !Number.isNaN(boundValue) &&
      new Date(sourceValue).toISOString() !==
        new Date(boundValue).toISOString()
    ) {
      return err(ErrorCode.VALIDATION_FAILED, "Temporal authority disagrees with source constraint");
    }
  }
  const dates = [bound.executionNotAfter, parentExpiry, policyExpiry].filter((x): x is string => Boolean(x));
  if (dates.some((date) => Number.isNaN(Date.parse(date))) || (bound.executionNotBefore && Number.isNaN(Date.parse(bound.executionNotBefore)))) return err(ErrorCode.VALIDATION_FAILED, "Malformed temporal authority bound");
  if (bound.executionNotBefore && Date.parse(bound.executionNotBefore) > Date.parse(bound.executionNotAfter)) return err(ErrorCode.VALIDATION_FAILED, "Invalid temporal authority range");
  const expiresAt = dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
  if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(now) > Date.parse(expiresAt)) return err(ErrorCode.GRANT_EXPIRED, "Temporal authority expired");
  return ok({ expiresAt, notBefore: bound.executionNotBefore });
}

export { proofObligationId } from "@truemandate/crypto";

export async function assertCurrentIntentState(
  client: SemanticArtifactClient,
  input: { intentId: string; intentStateId: string; intentStateHash: string },
): Promise<
  Result<
    Pick<
      IntentState,
      "id" | "intentId" | "stateHash" | "version" | "constraints" | "temporalAuthority"
    >
  >
> {
  if (!client.getIntentState || !client.getTip) return err(ErrorCode.VALIDATION_FAILED, "Authority owner freshness client unavailable");
  const state = await client.getIntentState(input.intentStateId);
  if (!state.ok) return state;
  if (state.value.intentId !== input.intentId || state.value.stateHash !== input.intentStateHash) return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Authority IntentState binding mismatch");
  const tip = await client.getTip(input.intentId);
  if (!tip.ok) return tip;
  if (tip.value.id !== state.value.id || tip.value.stateHash !== state.value.stateHash) return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Authority IntentState is no longer current");
  return ok(state.value);
}

export interface SemanticArtifactReference {
  readonly id: string;
  readonly hash: string;
  readonly kind: "PLAN" | "PLAN_VERIFICATION" | "PROOF" | "ACTION" | "GUARDIAN" | "WORKFLOW";
}

/** Fail-closed verifier for the immutable artifact envelope owned by intent-provenance. */
export async function resolveSemanticArtifactChain(input: {
  readonly client: SemanticArtifactClient;
  readonly workflowId: string;
  readonly intentStateId: string;
  readonly intentStateHash?: string;
  readonly references: readonly SemanticArtifactReference[];
}): Promise<Result<readonly Record<string, unknown>[]>> {
  const resolved: Record<string, unknown>[] = [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const ref of input.references) {
    const found = await input.client.getSemanticArtifact(ref.id);
    if (!found.ok || !found.value || typeof found.value !== "object") {
      return err(ErrorCode.VALIDATION_FAILED, "Missing semantic artifact", { artifactId: ref.id });
    }
    const artifact = found.value as Record<string, unknown>;
    if (artifact.workflowId !== input.workflowId || artifact.kind !== ref.kind) {
      return err(ErrorCode.VALIDATION_FAILED, "Semantic artifact workflow/kind mismatch", { artifactId: ref.id });
    }
    if (artifact.contentHash !== ref.hash || hashCanonical(artifact.payload) !== ref.hash) {
      return err(ErrorCode.VALIDATION_FAILED, "Semantic artifact hash mismatch", { artifactId: ref.id });
    }
    const payload = artifact.payload;
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).intentStateId !== input.intentStateId) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Semantic artifact IntentState mismatch", { artifactId: ref.id });
    }
    if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).intentStateHash !== "string") {
      return err(ErrorCode.VALIDATION_FAILED, "Semantic artifact lacks immutable IntentState hash", { artifactId: ref.id });
    }
    if (input.intentStateHash !== undefined && payload && typeof payload === "object" && (payload as Record<string, unknown>).intentStateHash !== input.intentStateHash) {
      return err(ErrorCode.GRANT_INTENT_STATE_MISMATCH, "Semantic artifact IntentState hash mismatch", { artifactId: ref.id });
    }
    resolved.push(artifact);
    byId.set(ref.id, artifact);
  }
  // Every declared relationship must point at an artifact included in this
  // authority request and retain the owner-computed predecessor hash. This
  // prevents a caller from splicing an otherwise valid record from another
  // semantic chain into the request.
  for (const artifact of resolved) {
    const predecessors = artifact.predecessors;
    if (!Array.isArray(predecessors)) {
      return err(ErrorCode.VALIDATION_FAILED, "Semantic artifact lacks immutable predecessor metadata");
    }
    for (const predecessor of predecessors) {
      if (!predecessor || typeof predecessor !== "object") {
        return err(ErrorCode.VALIDATION_FAILED, "Malformed semantic predecessor");
      }
      const ref = predecessor as Record<string, unknown>;
      const parent = typeof ref.id === "string" ? byId.get(ref.id) : undefined;
      if (!parent || parent.kind !== ref.kind || parent.contentHash !== ref.contentHash) {
        return err(ErrorCode.VALIDATION_FAILED, "Semantic predecessor binding mismatch", { artifactId: artifact.id });
      }
    }
  }
  const one = (kind: string) => resolved.filter((item) => item.kind === kind);
  const workflow = one("WORKFLOW");
  const plan = one("PLAN");
  const verification = one("PLAN_VERIFICATION");
  const action = one("ACTION");
  const guardian = one("GUARDIAN");
  const proofs = one("PROOF");
  if (workflow.length !== 1 || plan.length !== 1 || verification.length !== 1 || action.length !== 1 || guardian.length !== 1) {
    return err(ErrorCode.VALIDATION_FAILED, "Incomplete or ambiguous canonical semantic chain");
  }
  const parentIds = (artifact: Record<string, unknown>) => new Set((artifact.predecessors as readonly Record<string, unknown>[]).map((x) => x.id));
  const requires = (artifact: Record<string, unknown>, ids: readonly unknown[]) => ids.every((id) => typeof id === "string" && parentIds(artifact).has(id));
  if (!requires(verification[0]!, [plan[0]!.id]) || !requires(action[0]!, [plan[0]!.id, verification[0]!.id]) ||
      !proofs.every((proof) => requires(proof, [action[0]!.id])) ||
      !requires(guardian[0]!, [plan[0]!.id, verification[0]!.id, action[0]!.id, ...proofs.map((proof) => proof.id)]) ||
      !requires(workflow[0]!, [guardian[0]!.id])) {
    return err(ErrorCode.VALIDATION_FAILED, "Semantic predecessor topology is not canonical");
  }
  const planBody = plan[0]!.payload as Record<string, unknown>;
  const actionBody = action[0]!.payload as Record<string, unknown>;
  const guardianBody = guardian[0]!.payload as Record<string, unknown>;
  const planObligations = Array.isArray(planBody.proofObligations) ? planBody.proofObligations : undefined;
  const required = Array.isArray(actionBody.requiredProofObligationIds) ? actionBody.requiredProofObligationIds : undefined;
  if (!planObligations || !required || !Array.isArray(guardianBody.evaluatedProofs)) return err(ErrorCode.VALIDATION_FAILED, "Missing durable proof obligation bindings");
  const expected = new Set<string>(planObligations.map(proofObligationId));
  const requiredSet = new Set(required.filter((id): id is string => typeof id === "string"));
  if (requiredSet.size !== required.length || requiredSet.size !== expected.size || [...expected].some((id) => !requiredSet.has(id))) return err(ErrorCode.VALIDATION_FAILED, "Action required proof obligations do not match Plan");
  const satisfied = new Map<string, Record<string, unknown>>();
  for (const proof of proofs) {
    const body = proof.payload as Record<string, unknown>;
    if (body.status !== "SATISFIED" || body.actionArtifactId !== action[0]!.id || body.actionPayloadHash !== action[0]!.contentHash || typeof body.obligationId !== "string" || !expected.has(body.obligationId) || !Array.isArray(body.evidenceRefs) || typeof body.method !== "string") return err(ErrorCode.VALIDATION_FAILED, "Invalid durable proof result", { artifactId: proof.id });
    if (satisfied.has(body.obligationId)) return err(ErrorCode.VALIDATION_FAILED, "Conflicting proof results for obligation", { obligationId: body.obligationId });
    satisfied.set(body.obligationId, proof);
  }
  if (satisfied.size !== expected.size || [...expected].some((id) => !satisfied.has(id))) return err(ErrorCode.VALIDATION_FAILED, "Required proof obligations are not exactly satisfied");
  const guardianSet = new Set((guardianBody.evaluatedProofs as unknown[]).map((ref) => typeof ref === "object" && ref ? `${(ref as Record<string, unknown>).id}:${(ref as Record<string, unknown>).hash}` : ""));
  const proofSet = new Set(proofs.map((proof) => `${proof.id}:${proof.contentHash}`));
  if (guardianSet.size !== proofSet.size || [...proofSet].some((ref) => !guardianSet.has(ref))) return err(ErrorCode.VALIDATION_FAILED, "Guardian proof set does not match authoritative proof set");
  return ok(resolved);
}
