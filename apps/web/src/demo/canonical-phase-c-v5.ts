/**
 * Frozen canonical Phase C v5 demo projection.
 *
 * This module IS a hard-coded data file, accurately described: it is a
 * READ-ONLY FROZEN PROJECTION of the canonical deployed Phase C v5 proof
 * records, retained as an OFFLINE DEMO FALLBACK. The live Public BFF
 * (`GET /v1/demo/canonical-phase-c-v5`, same-origin via the web proxy) is
 * the preferred live proof source when configured and healthy; this snapshot
 * renders only when that endpoint is unavailable.
 *
 * PROVENANCE — every value below was captured from the canonical durable
 * records of the Phase C v5 closure (execution `tm-dev-phase-c-verifier-zwjnb`,
 * 2026-08-18, GCP project elite-crossbar-505104-t9):
 *
 *   - Firestore collections (read-only GETs, 2026-08-18 ~13:02Z):
 *       intents/phase-c-food-grade-500-v5
 *       intentStates/state-phase-c-food-grade-500-v5-compiled-2204ac8d4a058fd8
 *       authorityEvaluations/evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890
 *       authorityGrants/grant-ede4729da9e842dc
 *       preparedActions/prep-d5fa7a308b07
 *       commitTokens/ct-352434dd4a7b
 *       sideEffects/exec-phase-c-food-grade-500-v5
 *       idempotencyRecords/phase-c-food-grade-500-v5
 *       outcomeContracts/outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e
 *       outcomeEvents/* (payment_settled + OUTCOME_PARTIAL)
 *       resolutionCases/rc-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a421f
 *       resolutionTriggers/dfb7100e519a421f9542bfc03d4e7286991d084d744bf046e807c17d9673f538
 *       evidenceArtifacts/phase-c-evidence-v5-* (9 envelopes)
 *       evidenceClaims/phase-c-claim-v5-* (6 claims)
 *       remediationMandates (empty — zero remedies)
 *   - Cloud Run verifier execution logs (closure JSON payload), exit code 0
 *   - Cloud Run service request logs for outcome-resolution, agent-runtime,
 *     evidence-service (auth-verified request traces)
 *
 * READ-ONLY: the demo UI never mutates these records and never re-runs the
 * scenario. Fields that are presentational (labels, explanations) live in the
 * UI layer and are marked there; this module only carries canonical values
 * plus explicit source pointers.
 *
 * Regenerate: `scripts/demo/refresh-projection.mjs` re-reads the captured
 * Firestore JSON dumps under infrastructure/terraform/stages/runtime/_v5-*.json
 * and rewrites the raw projection JSON this module is based on.
 */

import type { CanonicalProjection } from "@truemandate/read-model";

export const CANONICAL_PHASE_C_V5: CanonicalProjection = {
  meta: {
    projectionKind: "canonical-phase-c-v5-frozen",
    capturedAt: "2026-08-18T13:05:00Z",
    executionId: "tm-dev-phase-c-verifier-zwjnb",
    executionStart: "2026-08-18T12:57:15.234Z",
    executionEnd: "2026-08-18T13:00:39.342Z",
    exitCode: 0,
    verifierImageDigest:
      "sha256:ba710a934a91c5df6bfb686e0809e9b7c5c8790396cd279ef5641fa5da34f59f",
    outcomeResolutionImageDigest:
      "sha256:d19b6211bfcbed317e0f4ca8b7920c303295c255c7669b35929803d104d609e6",
    readOnly: true,
  },
  intent: {
    id: "phase-c-food-grade-500-v5",
    rawText:
      "Buy 500 food-grade containers from approved supplier Phase B Supplier for under INR 800000 before 2030-12-31T23:59:59.000Z.",
    principalId: "phase-c-human-principal",
    createdAt: "2026-08-18T12:58:45.845Z",
    contentHash: "d825ea77a5d0b54e107f3e8186a29f785ebc4101160eb874d685c612faa393d9",
    intentStateId: "state-phase-c-food-grade-500-v5-compiled-2204ac8d4a058fd8",
  },
  constraints: [
    { concept: "quantity", operator: "EQ", value: 500, kind: "HARD", mutability: "HUMAN_REVISABLE", sourceText: "500", sourceSpan: { start: 4, end: 7 } },
    { concept: "item_specification", operator: "REQUIRE", value: "food-grade containers", kind: "SAFETY_CRITICAL", mutability: "IMMUTABLE", sourceText: "food-grade containers", sourceSpan: { start: 8, end: 29 } },
    { concept: "supplier_approval_status", operator: "REQUIRE", value: "approved", kind: "ORGANIZATIONAL_POLICY", mutability: "IMMUTABLE", sourceText: "approved supplier", sourceSpan: { start: 35, end: 52 } },
    { concept: "supplier_identity", operator: "EQ", value: "Phase B Supplier", kind: "HARD", mutability: "HUMAN_REVISABLE", sourceText: "Phase B Supplier", sourceSpan: { start: 53, end: 69 } },
    { concept: "max_total_budget", operator: "LT", value: 800000, kind: "FINANCIAL", mutability: "HUMAN_REVISABLE", sourceText: "under INR 800000", sourceSpan: { start: 74, end: 90 } },
    { concept: "completion_deadline", operator: "LT", value: "2030-12-31T23:59:59.000Z", kind: "TEMPORAL", mutability: "HUMAN_REVISABLE", sourceText: "before 2030-12-31T23:59:59.000Z", sourceSpan: { start: 91, end: 122 } },
  ],
  guardian: {
    verdictId: "gv-fc62d0f73a08",
    decision: "REQUIRE_APPROVAL",
    semanticStatus: "CONFLICTED",
    criticalFailure: false,
    overallFidelity: 0.8,
    modelName: "guardian-orchestrator",
    createdAt: "2026-08-18T12:59:31.846Z",
    judges: [
      { judgeId: "FIDELITY", status: "OK", schema: "judge.fidelity.v1" },
      { judgeId: "CONTRADICTION", status: "OK", schema: "judge.contradiction.v1" },
      { judgeId: "DEVILS_ADVOCATE", status: "OK", schema: "judge.devils_advocate.v1" },
      { judgeId: "PROVENANCE", status: "OK", schema: "judge.provenance.v1" },
      { judgeId: "EVIDENCE", status: "OK", schema: "judge.evidence.v1" },
    ],
  },
  authority: {
    evaluationId: "evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890",
    decision: "ALLOW",
    capability: "execute_payment",
    merchant: "phase-b-supplier",
    amount: 742000,
    currency: "INR",
    expiresAt: "2030-12-31T23:59:59.000Z",
    materializationEligible: true,
    recordHash: "696a8f8b6a2832b37dfa3be4a3b5e7bad786682d04df3fcb6171e08bee10391c",
    grantId: "grant-ede4729da9e842dc",
    grantState: "CONSUMED",
    grantConsumedAt: "2026-08-18T13:00:29.614Z",
  },
  preparedAction: {
    id: "prep-d5fa7a308b07",
    toolId: "payment.execute",
    amount: 742000,
    currency: "INR",
    merchant: "phase-b-supplier",
    quantity: 500,
    product: "food-grade containers",
    lifecycle: "SUCCEEDED",
    parameterHash: "6d5f9fcd07c9671a339e462ba1ac7f733b39f1d6b2ce92df6826d1e26d43bad0",
    guardianVerdictHash: "2752d8a487add5e1c4b46120fa0d041f9ba9f782906d6b8b6fed4045973e7785",
    createdAt: "2026-08-18T13:00:27.719Z",
  },
  execution: {
    commitTokenId: "ct-352434dd4a7b",
    commitTokenConsumed: true,
    sideEffectId: "exec-phase-c-food-grade-500-v5",
    toolId: "payment.execute",
    resultState: "SUCCESS",
    externalReference: "mock-pay-phase-c-food-grade-500-v5",
    amount: 742000,
    currency: "INR",
    counterparty: "phase-b-supplier",
    requestTimestamp: "2026-08-18T13:00:29.614Z",
    replayStatus: "IDEMPOTENT_REPLAY",
    replaySameResultRef: true,
    idempotencyKey: "phase-c-food-grade-500-v5",
    sideEffectCountForFixture: 1,
  },
  outcome: {
    contractId:
      "outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e",
    state: "PARTIAL",
    paymentStatus: "SUCCESS",
    createdAt: "2026-08-18T12:59:31.846Z",
    executionBegunAt: "2026-08-18T13:00:29.614Z",
    updatedAt: "2026-08-18T13:00:31.752Z",
    version: 1,
    definitionHash: "872cf000c4734c3b9776bf205c280c5047c3554190f736232a3765e1d0947289",
    paymentSettledAt: "2026-08-18T13:00:29.614Z",
    partialAt: "2026-08-18T13:00:31.752Z",
    requirements: [
      { concept: "supplier_approved", state: "SATISFIED", expected: "phase-b-supplier" },
      { concept: "price_within", state: "SATISFIED", expected: 742000 },
      { concept: "quantity_received", state: "PARTIAL", expected: 500 },
      { concept: "product_matches", state: "PENDING", expected: "food-grade containers" },
      { concept: "quantity", state: "PENDING", expected: 500 },
      { concept: "item_specification", state: "PENDING", expected: "food-grade containers" },
      { concept: "supplier_identity", state: "PENDING", expected: "Phase B Supplier" },
    ],
    divergence: {
      requiredQuantity: 500,
      verifiedReceived: 450,
      shortfall: 50,
      evidenceClaimIds: ["phase-c-claim-v5-quantity_received"],
    },
  },
  evidence: {
    authorizationEnvelopes: [
      { id: "phase-c-evidence-v5-supplier-approval", source: "supplier-approval-registry", concept: "supplier_approved", value: true },
      { id: "phase-c-evidence-v5-food-grade-certificate", source: "inspection-certificate-system", concept: "food_grade_certified", value: true },
      { id: "phase-c-evidence-v5-quote", source: "supplier-quote-system", concept: "quote", value: "500 units · ₹742,000 · INR" },
    ],
    deliveryEnvelopes: [
      { id: "phase-c-evidence-v5-payment", source: "execution-side-effect-ledger", concept: "price_paid", value: 742000 },
      { id: "phase-c-evidence-v5-merchant", source: "execution-side-effect-ledger", concept: "merchant_observed", value: "phase-b-supplier" },
      { id: "phase-c-evidence-v5-certificate", source: "inspection-certificate-system", concept: "certificate_valid", value: true },
      { id: "phase-c-evidence-v5-dispatch", source: "merchant-dispatch-system", concept: "dispatched_quantity", value: 500 },
      { id: "phase-c-evidence-v5-carrier", source: "carrier-manifest-system", concept: "carrier_acceptance_count", value: null },
      { id: "phase-c-evidence-v5-receipt", source: "warehouse-receiving-system", concept: "quantity_received", value: 450 },
    ],
    claims: [
      { id: "phase-c-claim-v5-price_paid", concept: "price_paid", value: 742000 },
      { id: "phase-c-claim-v5-merchant_observed", concept: "merchant_observed", value: "phase-b-supplier" },
      { id: "phase-c-claim-v5-certificate_valid", concept: "certificate_valid", value: true },
      { id: "phase-c-claim-v5-dispatched_quantity", concept: "dispatched_quantity", value: 500 },
      { id: "phase-c-claim-v5-carrier_acceptance_count", concept: "carrier_acceptance_count", value: null },
      { id: "phase-c-claim-v5-quantity_received", concept: "quantity_received", value: 450 },
    ],
  },
  resolution: {
    caseId:
      "rc-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a421f",
    state: "OPEN",
    responsibilityState: "UNKNOWN",
    openedAt: "2026-08-18T13:00:31.752Z",
    triggerEventId:
      "ev-OUTCOME_PARTIAL-outcome-evaluation-wf-4278136715e178494fb52890-authority-wf-4278136715e178494fb52890-ed2c392fd022e40e-dfb7100e519a",
    triggerIdentity: "dfb7100e519a421f9542bfc03d4e7286991d084d744bf046e807c17d9673f538",
    caseVersion: 1,
    recursionDepth: 0,
    firstDivergence: "received quantity 500 unmet vs ordered requirement",
    rootCauseEstablished: false,
    evidenceRequests: [
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
    ],
    remedyExecutions: 0,
  },
  preservation: {
    phaseACanonicalTokenId: "ct-92ceb56769a0",
    phaseACanonicalTokenConsumed: false,
    phaseBAndCv1to4Intact: true,
    remediationMandatesCount: 0,
  },
  timeline: [
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
  ],
  provenanceChain: [
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
  ],
};
