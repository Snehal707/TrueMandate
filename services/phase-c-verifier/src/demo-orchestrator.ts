import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import { SemanticVerificationArtifactPayloadSchema } from "@truemandate/schemas";
import {
  demoScenarioTemplate,
  evidenceClaimId,
  evidenceEnvelopeId,
  isAllowedDemoVariant,
  type DemoActionFixture,
  type DemoScenarioTemplate,
} from "@truemandate/demo-fixtures";
import {
  type AuthoritativeVerifiedStateView,
  deriveComparisonIntegrity,
  unavailableComparisonIntegrity,
  type ComparisonIntegrityView,
} from "./comparison-integrity.js";

/**
 * Trusted demo-evidence orchestration. Runs as the existing `phase-c-verifier`
 * service identity — the sole identity allowlisted to call
 * `/internal/evidence/verifications` (`TM_EVIDENCE_VERIFY_CALLER_EMAILS`,
 * unchanged by this module). Nothing here mints a new identity, widens that
 * allowlist, or accepts browser-supplied action/evidence/claim content —
 * every value that reaches evidence-service or the public workflow route
 * comes from the shared `@truemandate/demo-fixtures` catalog, selected only
 * by the caller's `scenarioId`/`variantId` enum pair.
 *
 * Source evidence content authority: this module does NOT submit evidence
 * envelopes/claims directly to evidence-service. It sends only
 * `{scenarioId, runId, intentId, intentStateId}` to public-bff's narrow
 * `/internal/demo/evidence-provisioning` route, which independently
 * reconstructs the deterministic fixture from the SAME shared catalog and
 * submits it as its own (public-bff) identity. This orchestrator process
 * never has the ability to choose submitted claim content — only which
 * pre-approved scenario/run to provision. Verification
 * (`/internal/evidence/verifications`) remains direct, unchanged, under this
 * service's own `phase-c-verifier` identity.
 *
 * CAVEAT — compiler fidelity: this module's fixtures are proven, in this
 * repository's own tests, against the deterministic test compiler
 * (`cleanCompilerOutput`/`replaceConstraints` in
 * `services/agent-runtime/src/generic-workflow.e2e.test.ts`), not against a
 * live run of the real deployed LLM compiler — no live model call happens in
 * this local implementation/testing pass. Before any real deployment, a
 * dev-environment smoke test against the actual compiler is required to
 * confirm it derives the same constraint concepts from each fixture's
 * `rawText` that `evidenceClaims` assumes.
 *
 * Sequencing (see the approved design): leg 1 establishes the intent once;
 * evidence is provisioned and verified once; for an attack variant, control's
 * leg 2 is submitted UNPINNED first (the only call in this whole flow
 * allowed to trigger evidence-backed supersession), its exact bound
 * IntentState is read back, and only then is attack's leg 2 submitted,
 * explicitly PINNED to that exact id/hash. The two leg-2 submissions are
 * never concurrent.
 */

export interface DemoOrchestratorPorts {
  /** Plain HTTP POST to the public generic workflow route. No special auth —
   * this route accepts any caller, exactly as it accepts a browser. */
  readonly submitWorkflow: (body: unknown) => Promise<Result<Record<string, unknown>>>;
  readonly evidence: {
    /** Sends only {scenarioId, runId, intentId, intentStateId} to public-bff's
     * narrow demo evidence-provisioning route — never envelope/claim content.
     * public-bff reconstructs and submits the fixture as its own identity. */
    submitEvidence(body: unknown): Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>;
    /** Direct call to evidence-service, under this service's own
     * phase-c-verifier identity. Unchanged by the A-Prime redesign. */
    verifyEvidence(body: unknown): Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>;
  };
  readonly intents: {
    getTip(intentId: string): Promise<Result<{ id: string; stateHash: string }>>;
    getIntentState(stateId: string): Promise<Result<Record<string, unknown>>>;
    getSemanticArtifact(id: string): Promise<Result<Record<string, unknown>>>;
  };
  readonly readWorkspace: (intentId: string, workflowId: string) => Promise<Result<Record<string, unknown>>>;
  readonly readApproval: (approvalId: string) => Promise<Result<Record<string, unknown>>>;
  /** Fresh id for a new orchestration run. Injected so tests can prove retry
   * safety by invoking the orchestrator twice with the SAME runId. */
  readonly newRunId: () => string;
  readonly now?: () => string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxTipPollAttempts?: number;
}

export interface DemoControlOrchestrationResult {
  readonly intentId: string;
  readonly workflowId: string;
  readonly workflow: Record<string, unknown>;
  readonly verifiedEvidenceIds: readonly string[];
  readonly verifiedClaimIds: readonly string[];
}

export interface DemoAttackOrchestrationResult {
  readonly intentId: string;
  readonly controlWorkflowId: string;
  readonly attackWorkflowId: string;
  readonly control: Record<string, unknown>;
  readonly attack: Record<string, unknown>;
  readonly boundIntentStateId: string;
  readonly boundIntentStateHash: string;
  readonly verifiedEvidenceIds: readonly string[];
  readonly verifiedClaimIds: readonly string[];
  readonly comparisonIntegrity: ComparisonIntegrityView;
}

export type DemoOrchestrationResult =
  | ({ readonly kind: "control" } & DemoControlOrchestrationResult)
  | ({ readonly kind: "attack" } & DemoAttackOrchestrationResult);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function countSatisfiedProofs(rows: readonly unknown[]): number {
  return rows.reduce<number>((count, row) => {
    const status = asRecord(row)?.status;
    return status === "SATISFIED" ? count + 1 : count;
  }, 0);
}

function requiredProofsSatisfied(
  requiredProofObligationIds: readonly string[],
  proofRows: readonly unknown[],
): boolean {
  if (requiredProofObligationIds.length === 0) return false;

  const rowsByObligation = new Map<string, Record<string, unknown>[]>();
  for (const row of proofRows) {
    const parsed = asRecord(row);
    if (!parsed) continue;
    const obligationId = asString(parsed?.obligationId);
    if (!obligationId) continue;
    const existing = rowsByObligation.get(obligationId);
    if (existing) {
      existing.push(parsed);
    } else {
      rowsByObligation.set(obligationId, [parsed]);
    }
  }

  return requiredProofObligationIds.every((obligationId) => {
    const matches = rowsByObligation.get(obligationId) ?? [];
    return matches.length === 1 && matches[0]?.status === "SATISFIED";
  });
}

async function readAuthoritativeVerifiedState(
  ports: DemoOrchestratorPorts,
  boundIntentStateId: string,
): Promise<AuthoritativeVerifiedStateView | undefined> {
  const [state, artifact] = await Promise.all([
    ports.intents.getIntentState(boundIntentStateId),
    ports.intents.getSemanticArtifact(`semantic-verification-${boundIntentStateId}`),
  ]);
  if (!state.ok || !artifact.ok) return undefined;

  const stateValue = asRecord(state.value);
  const stateId = asString(stateValue?.id);
  const stateHash = asString(stateValue?.stateHash);
  if (!stateId || !stateHash) return undefined;

  const artifactValue = asRecord(artifact.value);
  const payload = SemanticVerificationArtifactPayloadSchema.safeParse(artifactValue?.payload);
  if (!payload.success) return undefined;
  if (payload.data.intentStateId !== stateId || payload.data.intentStateHash !== stateHash) {
    return undefined;
  }

  const proofSummary = payload.data.proofSummary;
  const requiredProofCount = proofSummary?.requiredProofObligationIds.length ?? 0;
  const satisfiedProofCount = proofSummary ? countSatisfiedProofs(proofSummary.proofRows) : 0;
  const allRequiredSatisfied = Boolean(
    proofSummary &&
      proofSummary.coverage.allRequiredCovered &&
      requiredProofsSatisfied(
        proofSummary.requiredProofObligationIds,
        proofSummary.proofRows,
      ),
  );

  return {
    stateId,
    stateHash,
    readiness: payload.data.verification.readiness,
    previousStateId: asString(stateValue?.previousStateId) ?? payload.data.previousIntentStateId,
    previousStateHash: payload.data.previousIntentStateHash,
    requiredProofCount,
    satisfiedProofCount,
    allRequiredSatisfied,
    semanticArtifactPresent: true,
  };
}

function actionBody(action: DemoActionFixture): Record<string, unknown> {
  return {
    capability: action.capability,
    merchant: action.merchant,
    product: action.product,
    quantity: action.quantity,
    amount: action.amount,
    currency: action.currency,
    ...(action.refundable !== undefined ? { refundable: action.refundable } : {}),
    ...(action.deliveryTerms ? { deliveryTerms: action.deliveryTerms } : {}),
    consequenceLevel: action.consequenceLevel,
    parameters: action.parameters,
  };
}

function workflowRequestBody(options: {
  readonly template: DemoScenarioTemplate;
  readonly action: DemoActionFixture;
  readonly intent:
    | { readonly kind: "RAW"; readonly intentId: string; readonly createdAt: string }
    | { readonly kind: "REFERENCE"; readonly intentId: string; readonly expectedIntentStateId?: string; readonly expectedIntentStateHash?: string };
  readonly idempotencyKey: string;
  readonly evidenceIds: readonly string[];
}): Record<string, unknown> {
  const { template, action, intent, idempotencyKey, evidenceIds } = options;
  return {
    idempotencyKey,
    intent:
      intent.kind === "RAW"
        ? {
            kind: "RAW",
            principalId: "demo-orchestrator",
            id: intent.intentId,
            createdAt: intent.createdAt,
            rawText: template.rawText,
          }
        : {
            kind: "REFERENCE",
            intentId: intent.intentId,
            ...(intent.expectedIntentStateId ? { expectedIntentStateId: intent.expectedIntentStateId } : {}),
            ...(intent.expectedIntentStateHash ? { expectedIntentStateHash: intent.expectedIntentStateHash } : {}),
          },
    action: actionBody(action),
    domain: { packId: template.packId, payload: template.domainPayload(evidenceIds, action) },
  };
}

type TipResult = Result<{ id: string; stateHash: string }>;

function tipResultCategory(tip: TipResult): "READY" | "NOT_READY" | "ERROR" {
  if (tip.ok) return "READY";
  return tip.details?.status === 404 ? "NOT_READY" : "ERROR";
}

function logTipPoll(input: {
  readonly intentId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly phase: "PRIMARY" | "IMMEDIATE_RETRY";
  readonly tip: TipResult;
}): void {
  console.log(
    JSON.stringify({
      msg: "demo-orchestrator tip poll",
      intentId: input.intentId,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      phase: input.phase,
      status: input.tip.ok ? 200 : input.tip.details?.status,
      retryable: input.tip.ok ? undefined : input.tip.details?.retryable,
      result: tipResultCategory(input.tip),
    }),
  );
}

/**
 * One outer polling attempt: a primary getTip call, plus — ONLY when that
 * call fails with the exact transport-unavailable shape (status 503,
 * retryable true), never for an ordinary 404/not-ready response — a single
 * immediate retry, whose result is then used as-is (never retried again).
 *
 * Deliberately scoped to this one call site, not to IntentProvenanceS2SClient
 * or fetchS2SJson: the production failure that motivated this (a GET that
 * reached intent-provenance once, then reached it zero more times for the
 * rest of a ~137s retry budget, despite the outer loop genuinely running to
 * completion) has only been demonstrated on this newly introduced polling
 * path. GET /tip is idempotent, so one immediate retry here is safe. This is
 * NOT a claim that the underlying transport-level cause (most consistent
 * with a stale pooled keep-alive connection) has been definitively proven,
 * and it is NOT evidence that any other deployed service sharing
 * fetchS2SJson has the same exposure — every other S2S caller keeps its
 * current behavior unchanged.
 */
async function pollTip(
  ports: DemoOrchestratorPorts,
  intentId: string,
  attempt: number,
  maxAttempts: number,
): Promise<TipResult> {
  const primary = await ports.intents.getTip(intentId);
  logTipPoll({ intentId, attempt, maxAttempts, phase: "PRIMARY", tip: primary });
  if (primary.ok) return primary;

  const isRetryableTransportFailure = primary.details?.status === 503 && primary.details?.retryable === true;
  if (!isRetryableTransportFailure) return primary;

  const retry = await ports.intents.getTip(intentId);
  logTipPoll({ intentId, attempt, maxAttempts, phase: "IMMEDIATE_RETRY", tip: retry });
  return retry;
}

async function establishIntent(
  ports: DemoOrchestratorPorts,
  template: DemoScenarioTemplate,
  runId: string,
): Promise<Result<{ intentId: string; intentStateId: string; intentStateHash: string }>> {
  const now = ports.now ?? (() => new Date().toISOString());
  const sleep = ports.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = ports.maxTipPollAttempts ?? 30;
  const intentId = `demo-${template.scenarioId}-${runId}-intent`;

  const control = template.variants.control;
  if (!control) {
    return err(ErrorCode.VALIDATION_FAILED, "Scenario has no control action fixture", { scenarioId: template.scenarioId });
  }

  const submitted = await ports.submitWorkflow(
    workflowRequestBody({
      template,
      action: control,
      intent: { kind: "RAW", intentId, createdAt: now() },
      idempotencyKey: `${runId}-leg1`,
      evidenceIds: [],
    }),
  );
  if (!submitted.ok && submitted.code !== ErrorCode.INTENT_STATE_NOT_READY) {
    return submitted as Result<never>;
  }

  let delayMs = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tip = await pollTip(ports, intentId, attempt + 1, maxAttempts);
    if (tip.ok) {
      return ok({ intentId, intentStateId: tip.value.id, intentStateHash: tip.value.stateHash });
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, 5_000);
  }
  return err(ErrorCode.INTENT_STATE_NOT_READY, "IntentState tip did not finalize within the demo orchestration window", {
    intentId,
    retryable: true,
  });
}

async function provisionAndVerifyEvidence(
  ports: DemoOrchestratorPorts,
  template: DemoScenarioTemplate,
  runId: string,
  intentId: string,
  intentStateId: string,
): Promise<Result<{ readonly evidenceIds: readonly string[]; readonly claimIds: readonly string[] }>> {
  // Deterministic ids this orchestrator predicts locally so it can name
  // exactly what to verify below — it does NOT construct or send the
  // envelope/claim content itself. public-bff derives the identical ids
  // from the same shared template and is the one that actually submits.
  const envelopeId = evidenceEnvelopeId(template.scenarioId, runId);
  const claimIds = template.evidenceClaims.map((claim) => evidenceClaimId(template.scenarioId, runId, claim.concept));

  // Narrow request: closed identifiers only. public-bff independently
  // reconstructs and submits the fixture as its own identity — this
  // orchestrator has no field through which it could alter the content.
  const submitted = await ports.evidence.submitEvidence({
    scenarioId: template.scenarioId,
    runId,
    intentId,
    intentStateId,
  });
  if (!submitted.ok) return submitted as Result<never>;

  const verificationId = `demo-${template.scenarioId}-${runId}-verify`;
  const verified = await ports.evidence.verifyEvidence({
    verificationId,
    envelopeId,
    claimIds,
    lineage: { intentId, intentStateId },
  });
  if (!verified.ok) return verified as Result<never>;

  return ok({ evidenceIds: verified.value.envelopeIds, claimIds: verified.value.claimIds });
}

function approvalIdFromWorkflow(workflow: Record<string, unknown>): string | undefined {
  const approval = workflow.approval;
  if (approval && typeof approval === "object" && !Array.isArray(approval)) {
    const id = (approval as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

export async function runDemoOrchestration(
  ports: DemoOrchestratorPorts,
  input: { readonly scenarioId: string; readonly variantId: string },
): Promise<Result<DemoOrchestrationResult>> {
  if (!isAllowedDemoVariant(input.scenarioId, input.variantId)) {
    return err(ErrorCode.VALIDATION_FAILED, "Unknown scenario/variant combination", {
      scenarioId: input.scenarioId,
      variantId: input.variantId,
    });
  }
  const template = demoScenarioTemplate(input.scenarioId)!;
  const runId = ports.newRunId();

  const established = await establishIntent(ports, template, runId);
  if (!established.ok) return established as Result<never>;
  const { intentId } = established.value;

  const provisioned = await provisionAndVerifyEvidence(ports, template, runId, intentId, established.value.intentStateId);
  if (!provisioned.ok) return provisioned as Result<never>;
  const { evidenceIds } = provisioned.value;

  const controlAction = template.variants.control!;

  if (input.variantId === "control") {
    const submitted = await ports.submitWorkflow(
      workflowRequestBody({
        template,
        action: controlAction,
        intent: { kind: "REFERENCE", intentId },
        idempotencyKey: `${runId}-control`,
        evidenceIds,
      }),
    );
    if (!submitted.ok) return submitted as Result<never>;
    const workflowId = String(submitted.value.workflowId ?? "");
    return ok({
      kind: "control",
      intentId,
      workflowId,
      workflow: submitted.value,
      verifiedEvidenceIds: [...evidenceIds],
      verifiedClaimIds: [...provisioned.value.claimIds],
    });
  }

  // Attack variant: control leg 2 first, unpinned — the only call in this
  // flow allowed to trigger evidence-backed supersession.
  const controlSubmitted = await ports.submitWorkflow(
    workflowRequestBody({
      template,
      action: controlAction,
      intent: { kind: "REFERENCE", intentId },
      idempotencyKey: `${runId}-control`,
      evidenceIds,
    }),
  );
  if (!controlSubmitted.ok) return controlSubmitted as Result<never>;
  const controlWorkflowId = String(controlSubmitted.value.workflowId ?? "");

  // Read back the exact IntentState control's own submission established —
  // never independently derived, never assumed.
  const boundTip = await ports.intents.getTip(intentId);
  if (!boundTip.ok) return boundTip as Result<never>;
  const boundIntentStateId = boundTip.value.id;
  const boundIntentStateHash = boundTip.value.stateHash;

  const attackAction = template.variants[input.variantId as keyof typeof template.variants]!;
  const attackSubmitted = await ports.submitWorkflow(
    workflowRequestBody({
      template,
      action: attackAction,
      intent: {
        kind: "REFERENCE",
        intentId,
        expectedIntentStateId: boundIntentStateId,
        expectedIntentStateHash: boundIntentStateHash,
      },
      idempotencyKey: `${runId}-${input.variantId}`,
      evidenceIds,
    }),
  );
  if (!attackSubmitted.ok) return attackSubmitted as Result<never>;
  const attackWorkflowId = String(attackSubmitted.value.workflowId ?? "");

  const [controlWorkspace, attackWorkspace] = await Promise.all([
    ports.readWorkspace(intentId, controlWorkflowId),
    ports.readWorkspace(intentId, attackWorkflowId),
  ]);
  const controlApprovalId = approvalIdFromWorkflow(controlSubmitted.value);
  const controlApproval = controlApprovalId
    ? await ports.readApproval(controlApprovalId)
    : undefined;
  const authoritativeControlState = await readAuthoritativeVerifiedState(
    ports,
    boundIntentStateId,
  );
  const comparisonIntegrity = deriveComparisonIntegrity({
    intentId,
    compiledIntentStateId: established.value.intentStateId,
    compiledIntentStateHash: established.value.intentStateHash,
    boundIntentStateId,
    boundIntentStateHash,
    controlWorkflow: controlSubmitted.value,
    attackWorkflow: attackSubmitted.value,
    controlWorkspace: controlWorkspace.ok ? controlWorkspace.value : undefined,
    attackWorkspace: attackWorkspace.ok ? attackWorkspace.value : undefined,
    controlApproval: controlApproval?.ok ? controlApproval.value : undefined,
    controlVerifiedEvidenceIds: provisioned.value.evidenceIds,
    attackVerifiedEvidenceIds: provisioned.value.evidenceIds,
    controlVerifiedClaimIds: provisioned.value.claimIds,
    attackVerifiedClaimIds: provisioned.value.claimIds,
    authoritativeControlState,
  });

  return ok({
    kind: "attack",
    intentId,
    controlWorkflowId,
    attackWorkflowId,
    control: controlSubmitted.value,
    attack: attackSubmitted.value,
    boundIntentStateId,
    boundIntentStateHash,
    verifiedEvidenceIds: [...evidenceIds],
    verifiedClaimIds: [...provisioned.value.claimIds],
    comparisonIntegrity: comparisonIntegrity.available
      ? comparisonIntegrity
      : unavailableComparisonIntegrity("BACKEND_COMPARISON_UNAVAILABLE"),
  });
}
