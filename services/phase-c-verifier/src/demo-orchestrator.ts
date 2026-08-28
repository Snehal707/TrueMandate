import { hashCanonical } from "@truemandate/crypto";
import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import {
  demoScenarioTemplate,
  isAllowedDemoVariant,
  type DemoActionFixture,
  type DemoScenarioTemplate,
} from "./demo-evidence-templates.js";

/**
 * Trusted demo-evidence orchestration. Runs as the existing `phase-c-verifier`
 * service identity — the sole identity allowlisted to call
 * `/internal/evidence/verifications` (`TM_EVIDENCE_VERIFY_CALLER_EMAILS`,
 * unchanged by this module). Nothing here mints a new identity, widens that
 * allowlist, or accepts browser-supplied action/evidence/claim content —
 * every value that reaches evidence-service or the public workflow route
 * comes from `demo-evidence-templates.ts`, selected only by the caller's
 * `scenarioId`/`variantId` enum pair.
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
    submitEvidence(body: unknown): Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>;
    verifyEvidence(body: unknown): Promise<Result<{ envelopeIds: readonly string[]; claimIds: readonly string[] }>>;
  };
  readonly intents: {
    getTip(intentId: string): Promise<Result<{ id: string; stateHash: string }>>;
  };
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
}

export interface DemoAttackOrchestrationResult {
  readonly intentId: string;
  readonly controlWorkflowId: string;
  readonly attackWorkflowId: string;
  readonly control: Record<string, unknown>;
  readonly attack: Record<string, unknown>;
  readonly boundIntentStateId: string;
  readonly boundIntentStateHash: string;
}

export type DemoOrchestrationResult =
  | ({ readonly kind: "control" } & DemoControlOrchestrationResult)
  | ({ readonly kind: "attack" } & DemoAttackOrchestrationResult);

function evidenceEnvelopeId(scenarioId: string, runId: string): string {
  return `demo-${scenarioId}-${runId}-offer`;
}

function evidenceClaimId(scenarioId: string, runId: string, concept: string): string {
  return `demo-${scenarioId}-${runId}-${concept}`;
}

function contentHashFor(template: DemoScenarioTemplate): string {
  return hashCanonical({ scenarioId: template.scenarioId, claims: template.evidenceClaims }).padEnd(64, "0").slice(0, 64);
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
    const tip = await ports.intents.getTip(intentId);
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
  const envelopeId = evidenceEnvelopeId(template.scenarioId, runId);
  const claimIds = template.evidenceClaims.map((claim) => evidenceClaimId(template.scenarioId, runId, claim.concept));
  const contentHash = contentHashFor(template);

  const submitted = await ports.evidence.submitEvidence({
    envelopes: [
      {
        id: envelopeId,
        source: template.evidenceSource,
        contentHash,
        captureTime: template.evidenceCaptureTime,
        mimeType: "application/json",
      },
    ],
    claims: template.evidenceClaims.map((claim, index) => ({
      id: claimIds[index],
      evidenceId: envelopeId,
      concept: claim.concept,
      value: claim.value,
      confidence: 1,
    })),
    lineage: { intentId, intentStateId },
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
    return ok({ kind: "control", intentId, workflowId, workflow: submitted.value });
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

  return ok({
    kind: "attack",
    intentId,
    controlWorkflowId,
    attackWorkflowId,
    control: controlSubmitted.value,
    attack: attackSubmitted.value,
    boundIntentStateId,
    boundIntentStateHash,
  });
}
