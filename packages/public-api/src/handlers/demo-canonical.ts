import { err, ok, type Result } from "@truemandate/protocol";
import type { CanonicalProjection } from "@truemandate/read-model";
import type { DemoCanonicalReadPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

/**
 * GET /v1/demo/canonical-phase-c-v5
 *
 * Read-only canonical proof projection for the judge demo.
 *
 * Security contract:
 *   - only the FIXED allowlisted canonical document ids below are read —
 *     the route accepts no caller-controlled Firestore document ids and is
 *     not a generic Firestore proxy;
 *   - only the fields the judge UI requires are picked per document (field
 *     allowlist — no raw document passthrough, no nonces, no internal state);
 *   - the handler performs no writes and creates no mutation surface.
 */

export function createDemoCanonicalHandler(
  port: DemoCanonicalReadPort,
): RouteHandler {
  return async ({ res }) => {
    const result = await Promise.resolve(port.readCanonicalPhaseCv5());
    sendResult(res, result);
  };
}

/** Fixed canonical Phase C v5 document ids (frozen — do not extend). */
export const CANONICAL_PHASE_C_V5_DOC_IDS = {
  intent: "intents/phase-c-food-grade-500-v5",
  intentState: "intentStates/state-phase-c-food-grade-500-v5-compiled-2204ac8d4a058fd8",
  evaluation: "authorityEvaluations/evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890",
  grant: "authorityGrants/grant-ede4729da9e842dc",
  preparedAction: "preparedActions/prep-d5fa7a308b07",
  commitToken: "commitTokens/ct-352434dd4a7b",
  phaseAToken: "commitTokens/ct-92ceb56769a0",
  sideEffect: "sideEffects/exec-phase-c-food-grade-500-v5",
  idempotency: "idempotencyRecords/phase-c-food-grade-500-v5",
  outcomeContract:
    "outcomeContracts/outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e",
  paymentEvent:
    "outcomeEvents/ev-pay-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e",
  partialEvent:
    "outcomeEvents/ev-OUTCOME_PARTIAL-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a",
  resolutionCase:
    "resolutionCases/rc-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a421f",
  resolutionTrigger: "resolutionTriggers/dfb7100e519a421f9542bfc03d4e7286991d084d744bf046e807c17d9673f538",
  artifactSupplierApproval: "evidenceArtifacts/phase-c-evidence-v5-supplier-approval",
  artifactFoodGradeCertificate: "evidenceArtifacts/phase-c-evidence-v5-food-grade-certificate",
  artifactQuote: "evidenceArtifacts/phase-c-evidence-v5-quote",
  artifactPayment: "evidenceArtifacts/phase-c-evidence-v5-payment",
  artifactMerchant: "evidenceArtifacts/phase-c-evidence-v5-merchant",
  artifactCertificate: "evidenceArtifacts/phase-c-evidence-v5-certificate",
  artifactDispatch: "evidenceArtifacts/phase-c-evidence-v5-dispatch",
  artifactCarrier: "evidenceArtifacts/phase-c-evidence-v5-carrier",
  artifactReceipt: "evidenceArtifacts/phase-c-evidence-v5-receipt",
  claimPricePaid: "evidenceClaims/phase-c-claim-v5-price_paid",
  claimMerchantObserved: "evidenceClaims/phase-c-claim-v5-merchant_observed",
  claimCertificateValid: "evidenceClaims/phase-c-claim-v5-certificate_valid",
  claimDispatchedQuantity: "evidenceClaims/phase-c-claim-v5-dispatched_quantity",
  claimCarrierCount: "evidenceClaims/phase-c-claim-v5-carrier_acceptance_count",
  claimQuantityReceived: "evidenceClaims/phase-c-claim-v5-quantity_received",
} as const;

type CanonicalDocs = Partial<Record<keyof typeof CANONICAL_PHASE_C_V5_DOC_IDS, Record<string, unknown>>>;

function str(rec: Record<string, unknown>, field: string): string {
  const v = rec[field];
  return typeof v === "string" ? v : String(v);
}
function num(rec: Record<string, unknown>, field: string): number {
  const v = rec[field];
  return typeof v === "number" ? v : Number(v);
}
function bool(rec: Record<string, unknown>, field: string): boolean {
  return rec[field] === true;
}

/* Deployment digests — immutable infra facts of the canonical deployment. */
const VERIFIER_IMAGE_DIGEST =
  "sha256:ba710a934a91c5df6bfb686e0809e9b7c5c8790396cd279ef5641fa5da34f59f";
const OUTCOME_RESOLUTION_IMAGE_DIGEST =
  "sha256:d19b6211bfcbed317e0f4ca8b7920c303295c255c7669b35929803d104d609e6";

/* Log/closure-derived canonical facts (frozen at capture, 2026-08-18).
 * These live outside the durable document store: verifier closure payload
 * and Cloud Run service request logs. */
const TIMELINE: CanonicalProjection["timeline"] = [
  { at: "2026-08-18T12:58:31.744Z", type: "evidence", summary: "9 evidence envelopes accepted through caller-bound fixture route", source: "evidence-service request log" },
  { at: "2026-08-18T12:58:45.845Z", type: "intent", summary: "Human intent recorded (phase-c-food-grade-500-v5)", source: "Firestore intents" },
  { at: "2026-08-18T12:59:30.108Z", type: "semantic", summary: "IntentState compiled — 6 constraints grounded in the human sentence", source: "Firestore intentStates" },
  { at: "2026-08-18T12:59:31.846Z", type: "guardian", summary: "Guardian verdict: REQUIRE_APPROVAL (5 judges OK, fidelity 0.80)", source: "Firestore preparedActions verdict" },
  { at: "2026-08-18T12:59:31.846Z", type: "authority", summary: "Authority ALLOW — execute_payment, ₹742,000 INR, phase-b-supplier only", source: "Firestore authorityEvaluations" },
  { at: "2026-08-18T13:00:26.310Z", type: "contract", summary: "OutcomeContract created (bounded to evaluation + intent state)", source: "outcome-resolution request log" },
  { at: "2026-08-18T13:00:27.719Z", type: "prepare", summary: "PreparedAction bound to guardian verdict + authority scope", source: "Firestore preparedActions" },
  { at: "2026-08-18T13:00:29.614Z", type: "execution", summary: "Commit token consumed — mock payment SUCCESS (exactly once)", source: "Firestore sideEffects/commitTokens" },
  { at: "2026-08-18T13:00:29.614Z", type: "payment", summary: "payment_settled event durably advances contract → AWAITING_OUTCOME/SUCCESS", source: "Firestore outcomeEvents" },
  { at: "2026-08-18T13:00:30.870Z", type: "replay", summary: "Built-in replay returns same result — IDEMPOTENT_REPLAY", source: "agent-runtime request log" },
  { at: "2026-08-18T13:00:31.126Z", type: "outcome", summary: "evaluate-evidence (exactly once) → PARTIAL: 450/500 received", source: "outcome-resolution request log" },
  { at: "2026-08-18T13:00:31.752Z", type: "resolution", summary: "ResolutionCase opened — responsibility UNKNOWN", source: "Firestore resolutionCases" },
  { at: "2026-08-18T13:00:39.342Z", type: "verifier", summary: "Verifier exit 0 — full closure proven", source: "Cloud Run execution status" },
];

const PROVENANCE_CHAIN: CanonicalProjection["provenanceChain"] = [
  { step: "Human Intent", canonicalId: "phase-c-food-grade-500-v5", kind: "intents" },
  { step: "IntentState", canonicalId: "state-phase-c-food-grade-500-v5-compiled-2204ac8d4a058fd8", kind: "intentStates" },
  { step: "Guardian Verdict", canonicalId: "gv-fc62d0f73a08", kind: "guardianVerdict" },
  { step: "Authority Evaluation", canonicalId: "evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890", kind: "authorityEvaluations" },
  { step: "AuthorityGrant", canonicalId: "grant-ede4729da9e842dc", kind: "authorityGrants" },
  { step: "PreparedAction", canonicalId: "prep-d5fa7a308b07", kind: "preparedActions" },
  { step: "Commit Token", canonicalId: "ct-352434dd4a7b", kind: "commitTokens" },
  { step: "Execution", canonicalId: "exec-phase-c-food-grade-500-v5", kind: "sideEffects" },
  { step: "OutcomeContract", canonicalId: "outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e", kind: "outcomeContracts" },
  { step: "ResolutionCase", canonicalId: "rc-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a421f", kind: "resolutionCases" },
];

/* Resolution planner output captured from the verifier closure (canonical). */
const EVIDENCE_REQUESTS: CanonicalProjection["resolution"]["evidenceRequests"] = [
  {
    id: "phase-c-request-1",
    questionResolved: "what quantity was actually received at the destination?",
    evidenceSought: "warehouse receiving record",
    targetSource: "warehouse-receiving-record",
    requiresAuthority: false,
    hypothesesDistinguished: ["supplier short-shipped", "carrier lost units", "warehouse miscounted"],
    urgency: "HIGH",
  },
  {
    id: "phase-c-request-2",
    questionResolved: "was the full ordered quantity handed to the carrier at pickup?",
    evidenceSought: "supplier pickup weight/count",
    targetSource: "supplier-pickup-record",
    requiresAuthority: false,
    hypothesesDistinguished: ["supplier short-shipped", "carrier lost units"],
    urgency: "HIGH",
  },
  {
    id: "phase-c-request-3",
    questionResolved: "did the carrier accept the full ordered quantity?",
    evidenceSought: "carrier acceptance count/weight",
    targetSource: "carrier-acceptance-record",
    requiresAuthority: false,
    hypothesesDistinguished: ["supplier short-shipped", "carrier lost units"],
    urgency: "MEDIUM",
  },
];

interface EnvelopeRec { id: string; source: string }
interface ClaimRec { id: string; evidenceId?: string; concept?: string; value?: unknown }

function envelopeOf(rec: Record<string, unknown> | undefined): EnvelopeRec | undefined {
  if (!rec) return undefined;
  return {
    id: str(rec, "id"),
    source: str(rec, "source"),
  };
}

function claimOf(rec: Record<string, unknown> | undefined): ClaimRec | undefined {
  if (!rec) return undefined;
  return {
    id: str(rec, "id"),
    evidenceId: typeof rec.evidenceId === "string" ? rec.evidenceId : undefined,
    concept: typeof rec.concept === "string" ? rec.concept : undefined,
    value: rec.value,
  };
}

/**
 * Assembles the judge-UI projection from the allowlisted durable docs.
 * Every field is picked explicitly — nothing else leaves the BFF.
 */
export function buildCanonicalProjection(docs: CanonicalDocs): Result<CanonicalProjection> {
  const intent = docs.intent;
  const intentState = docs.intentState;
  const evaluation = docs.evaluation;
  const grant = docs.grant;
  const prepared = docs.preparedAction;
  const token = docs.commitToken;
  const phaseAToken = docs.phaseAToken;
  const sideEffect = docs.sideEffect;
  const idempotency = docs.idempotency;
  const contract = docs.outcomeContract;
  const paymentEvent = docs.paymentEvent;
  const partialEvent = docs.partialEvent;
  const resolutionCase = docs.resolutionCase;
  if (!intent || !intentState || !evaluation || !grant || !prepared || !token || !sideEffect || !idempotency || !contract || !paymentEvent || !partialEvent || !resolutionCase) {
    return err("VALIDATION_FAILED", "Canonical projection incomplete", {});
  }

  const pa = prepared.preparedAction as Record<string, unknown> | undefined;
  const verdict = prepared.verdict as Record<string, unknown> | undefined;
  const judgeResults = (verdict?.judgeResults ?? []) as { judgeId?: unknown; status?: unknown; schemaId?: unknown }[];

  const constraints = (intentState.constraints ?? []) as {
    concept?: unknown; operator?: unknown; value?: unknown; kind?: unknown;
    mutability?: unknown; sourceText?: unknown; sourceSpan?: { start?: unknown; end?: unknown };
  }[];

  const qtyRequirement = ((contract.requirements ?? []) as { concept?: unknown; state?: unknown; value?: unknown }[])
    .find((r) => r.concept === "quantity_received");
  const claimQty = claimOf(docs.claimQuantityReceived);
  const requiredQuantity = num(qtyRequirement ?? {}, "value");
  const verifiedReceived = typeof claimQty?.value === "number" ? claimQty.value : NaN;

  const deliveryClaims = [
    claimOf(docs.claimPricePaid),
    claimOf(docs.claimMerchantObserved),
    claimOf(docs.claimCertificateValid),
    claimOf(docs.claimDispatchedQuantity),
    claimOf(docs.claimCarrierCount),
    claimOf(docs.claimQuantityReceived),
  ];
  const deliveryEnvelopes = deliveryClaims
    .filter((c): c is ClaimRec => Boolean(c?.evidenceId))
    .map((c) => {
      const envByEvidence: Record<string, Record<string, unknown> | undefined> = {
        "phase-c-evidence-v5-payment": docs.artifactPayment,
        "phase-c-evidence-v5-merchant": docs.artifactMerchant,
        "phase-c-evidence-v5-certificate": docs.artifactCertificate,
        "phase-c-evidence-v5-dispatch": docs.artifactDispatch,
        "phase-c-evidence-v5-carrier": docs.artifactCarrier,
        "phase-c-evidence-v5-receipt": docs.artifactReceipt,
      };
      const env = envelopeOf(envByEvidence[c.evidenceId ?? ""]);
      return {
        id: c.id,
        source: env?.source ?? "",
        concept: c.concept ?? "",
        value: (c.value ?? null) as string | number | boolean | null,
      };
    });

  // Authorization-era envelope values are canonical fixture facts (the
  // envelope stores hash, not value — values below are the frozen fixture
  // values behind those hashes, captured at acceptance).
  const authorizationEnvelopes = [
    { id: "phase-c-evidence-v5-supplier-approval", source: "supplier-approval-registry", concept: "supplier_approved", value: true },
    { id: "phase-c-evidence-v5-food-grade-certificate", source: "inspection-certificate-system", concept: "food_grade_certified", value: true },
    { id: "phase-c-evidence-v5-quote", source: "supplier-quote-system", concept: "quote", value: "500 units · ₹742,000 · INR" as string | number | boolean },
  ];

  const claims = deliveryClaims.map((c) => ({
    id: c?.id ?? "",
    concept: c?.concept ?? "",
    value: (c?.value ?? null) as string | number | boolean | null,
  }));

  const qtyState = typeof qtyRequirement?.state === "string" ? qtyRequirement.state : "UNKNOWN";

  return ok({
    meta: {
      projectionKind: "canonical-phase-c-v5-live-read",
      capturedAt: new Date().toISOString(),
      executionId: "tm-dev-phase-c-verifier-zwjnb",
      executionStart: "2026-08-18T12:57:15.234Z",
      executionEnd: "2026-08-18T13:00:39.342Z",
      exitCode: 0,
      verifierImageDigest: VERIFIER_IMAGE_DIGEST,
      outcomeResolutionImageDigest: OUTCOME_RESOLUTION_IMAGE_DIGEST,
      readOnly: true,
    },
    intent: {
      id: str(intent, "id"),
      rawText: str(intent, "rawText"),
      principalId: str(intent, "principalId"),
      createdAt: str(intent, "createdAt"),
      contentHash: str(intent, "contentHash"),
      intentStateId: str(intentState, "id"),
    },
    constraints: constraints.map((c) => ({
      concept: str(c as Record<string, unknown>, "concept"),
      operator: str(c as Record<string, unknown>, "operator"),
      value: (c.value as string | number) ?? "",
      kind: str(c as Record<string, unknown>, "kind"),
      mutability: str(c as Record<string, unknown>, "mutability"),
      sourceText: str(c as Record<string, unknown>, "sourceText"),
      sourceSpan: {
        start: Number(c.sourceSpan?.start ?? 0),
        end: Number(c.sourceSpan?.end ?? 0),
      },
    })),
    guardian: {
      verdictId: str(verdict ?? {}, "id"),
      decision: str(verdict ?? {}, "decision"),
      semanticStatus: str(verdict ?? {}, "semanticStatus"),
      criticalFailure: verdict?.criticalFailure === true,
      overallFidelity: num(verdict ?? {}, "overallFidelity"),
      modelName: str(verdict ?? {}, "modelName"),
      createdAt: str(verdict ?? {}, "createdAt"),
      judges: judgeResults.map((j) => ({
        judgeId: str(j as Record<string, unknown>, "judgeId"),
        status: str(j as Record<string, unknown>, "status"),
        schema: str(j as Record<string, unknown>, "schemaId"),
      })),
    },
    authority: {
      evaluationId: str(evaluation, "id"),
      decision: str(evaluation, "decision"),
      capability: str(evaluation, "capability"),
      merchant: str(evaluation, "merchant"),
      amount: num(evaluation, "amount"),
      currency: str(evaluation, "currency"),
      expiresAt: str(evaluation, "expiresAt"),
      materializationEligible: evaluation.materializationEligible === true,
      recordHash: str(evaluation, "recordHash"),
      grantId: str(grant, "id"),
      grantState: str(grant, "consumptionState"),
      grantConsumedAt: str(grant, "consumedAt"),
    },
    preparedAction: {
      id: str(pa ?? {}, "id"),
      toolId: str(pa ?? {}, "toolId"),
      amount: num(pa ?? {}, "amount"),
      currency: str(pa ?? {}, "currency"),
      merchant: str(pa ?? {}, "merchant"),
      quantity: num(pa ?? {}, "quantity"),
      product: str(pa ?? {}, "product"),
      lifecycle: str(prepared, "lifecycle"),
      parameterHash: str(pa ?? {}, "parameterHash"),
      guardianVerdictHash: str(pa ?? {}, "guardianVerdictHash"),
      createdAt: str(pa ?? {}, "createdAt"),
    },
    execution: {
      commitTokenId: str(token, "id"),
      commitTokenConsumed: token.consumed === true,
      sideEffectId: str(sideEffect, "id"),
      toolId: str(sideEffect, "toolId"),
      resultState: str(sideEffect, "resultState"),
      externalReference: str(sideEffect, "externalReference"),
      amount: num(sideEffect, "amount"),
      currency: str(sideEffect, "currency"),
      counterparty: str(sideEffect, "counterparty"),
      requestTimestamp: str(sideEffect, "requestTimestamp"),
      replayStatus: "IDEMPOTENT_REPLAY", // verifier closure: replay asserted same resultRef
      replaySameResultRef: idempotency.resultRef === sideEffect.externalReference,
      idempotencyKey: str(idempotency, "key"),
      sideEffectCountForFixture: 1,
    },
    outcome: {
      contractId: str(contract, "id"),
      state: str(contract, "state"),
      paymentStatus: str(contract, "paymentStatus"),
      createdAt: str(contract, "createdAt"),
      executionBegunAt: str(contract, "executionBegunAt"),
      updatedAt: str(contract, "updatedAt"),
      version: num(contract, "version"),
      definitionHash: str(contract, "definitionHash"),
      paymentSettledAt: str(paymentEvent, "observedAt"),
      partialAt: str(partialEvent, "observedAt"),
      requirements: ((contract.requirements ?? []) as { concept?: unknown; state?: unknown; value?: unknown }[]).map((r) => ({
        concept: str(r as Record<string, unknown>, "concept"),
        state: str(r as Record<string, unknown>, "state"),
        expected: (r.value as string | number) ?? "",
      })),
      divergence: {
        requiredQuantity,
        verifiedReceived,
        shortfall: requiredQuantity - verifiedReceived,
        evidenceClaimIds: ["phase-c-claim-v5-quantity_received"],
      },
    },
    evidence: {
      authorizationEnvelopes,
      deliveryEnvelopes,
      claims,
    },
    resolution: {
      caseId: str(resolutionCase, "id"),
      state: str(resolutionCase, "state"),
      responsibilityState: str(resolutionCase, "responsibilityState"),
      openedAt: str(resolutionCase, "openedAt"),
      triggerEventId: str(resolutionCase, "triggerEventId"),
      triggerIdentity: str(resolutionCase, "triggerIdentity"),
      caseVersion: num(resolutionCase, "caseVersion"),
      recursionDepth: num(resolutionCase, "recursionDepth"),
      firstDivergence: `received quantity ${requiredQuantity} unmet vs ordered requirement`,
      rootCauseEstablished: false,
      evidenceRequests: EVIDENCE_REQUESTS,
      remedyExecutions: 0, // remediationMandates verified empty at capture
    },
    preservation: {
      phaseACanonicalTokenId: "ct-92ceb56769a0",
      phaseACanonicalTokenConsumed: phaseAToken?.consumed === true,
      phaseBAndCv1to4Intact: true, // verified at capture (2026-08-18); demo never mutates
      remediationMandatesCount: 0,
    },
    timeline: TIMELINE,
    provenanceChain: PROVENANCE_CHAIN,
  });
}
