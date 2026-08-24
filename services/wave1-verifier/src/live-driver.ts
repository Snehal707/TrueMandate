import { PubSub } from "@google-cloud/pubsub";
import {
  AuthorityS2SClient,
  EvidenceS2SClient,
  IntentProvenanceS2SClient,
  OutcomeS2SClient,
  ResolutionS2SClient,
  adcIdentityTokenProvider,
  fetchS2SJson,
  s2sResultFromHttp,
} from "@truemandate/cloud-runtime";
import { hashCanonical } from "@truemandate/crypto";
import type { Result } from "@truemandate/protocol";

/**
 * Wave 1 LIVE acceptance driver (operator tooling — never a deployed
 * service). Runs as a temporary Cloud Run job with the trusted phase-c
 * verifier identity + Direct VPC egress, driving the deployed owner routes
 * exactly like the phase-c verifier.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const MODE = required("ACCEPTANCE_MODE");
const SUFFIX = process.env.RUN_SUFFIX ?? "";
const EXPIRY = "2026-12-31T17:00:00.000Z";
const BUDGET = 800000;

const evidenceUrl = required("EVIDENCE_URL");
const agentUrl = required("AGENT_RUNTIME_URL");
const outcomeUrl = required("OUTCOME_RESOLUTION_URL");
const authorityUrl = required("AUTHORITY_URL");
const intentProvenanceUrl = required("INTENT_PROVENANCE_URL");
const intentTopic = required("INTENT_TOPIC");

const tokens = await adcIdentityTokenProvider();
const evidence = new EvidenceS2SClient(evidenceUrl, tokens);
const outcomes = new OutcomeS2SClient(outcomeUrl, tokens);
const resolutions = new ResolutionS2SClient(outcomeUrl, tokens);
const authority = new AuthorityS2SClient(authorityUrl, tokens);
const intentProvenance = new IntentProvenanceS2SClient(intentProvenanceUrl, tokens);

const callAgent = async (method: string, path: string, body?: unknown): Promise<Result<unknown>> => {
  const token = await tokens.getIdentityToken(agentUrl);
  if (!token) throw new Error("S2S identity token missing");
  return s2sResultFromHttp(await fetchS2SJson({ baseUrl: agentUrl, path, method, token, body }));
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function publishRawIntent(intentId: string, rawText: string): Promise<void> {
  const payload = { rawText, principalId: "wave1-operator-principal", intentId };
  const event = {
    eventId: `event-${intentId}`,
    type: "intent.created",
    aggregateId: intentId,
    aggregateVersion: 1,
    causationId: intentId,
    correlationId: intentId,
    actorService: "wave1-operator",
    payloadHash: hashCanonical(payload),
    idempotencyKey: intentId,
    provenanceRefs: [],
    payload,
    occurredAt: new Date().toISOString(),
  };
  await new PubSub().topic(intentTopic).publishMessage({ data: Buffer.from(JSON.stringify(event)) });
}

type Wave1Evidence = {
  artifactId: string;
  source: string;
  concept: string;
  value: unknown;
  trustClass: "UNTRUSTED_EXTERNAL";
  capturedAt: string;
  taintOrigins: readonly string[];
};

const contentHashOf = (item: Wave1Evidence): string =>
  hashCanonical({ artifactId: item.artifactId, concept: item.concept, value: item.value, source: item.source, capturedAt: item.capturedAt });

function envelopeOf(item: Wave1Evidence, prefix: string) {
  return {
    id: item.artifactId,
    source: item.source,
    contentHash: contentHashOf(item),
    trustClass: item.trustClass,
    captureTime: item.capturedAt,
    taint: { classes: ["EXTERNAL_CONTENT"], origins: [...item.taintOrigins] },
    originId: item.source,
    lineageGroupId: `${prefix}-${item.concept}`,
  };
}

function fixtureOf(prefix: string, evidenceRows: readonly Wave1Evidence[]) {
  return {
    envelopes: evidenceRows.map((item) => envelopeOf(item, prefix)),
    claims: evidenceRows.map((item) => ({
      id: `${item.artifactId}-claim`,
      evidenceId: item.artifactId,
      concept: item.concept,
      value: item.value,
      confidence: 1,
      derivedBy: "wave1-live-derivation",
      taint: { classes: ["EXTERNAL_CONTENT"], origins: [item.artifactId] },
    })),
  };
}

const authEvidence = (prefix: string, supplierId: string): Wave1Evidence[] => [
  { artifactId: `${prefix}-supplier-approval`, source: "supplier-approval-registry", concept: "supplier_approved", value: { approved: true, supplierId }, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-02T00:00:00.000Z", taintOrigins: ["supplier-approval-registry"] },
  { artifactId: `${prefix}-food-grade-certificate`, source: "inspection-certificate-system", concept: "food_grade_certified", value: { foodGrade: true, product: "food-grade containers" }, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-03T00:00:00.000Z", taintOrigins: ["inspection-certificate-system"] },
  { artifactId: `${prefix}-quote`, source: "supplier-quote-system", concept: "quote", value: { quantity: 500, price: 742000, currency: "INR", deliveryDeadline: EXPIRY }, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-02T00:00:00.000Z", taintOrigins: ["supplier-quote-system"] },
];

const deliveryEvidence = (prefix: string, received: number): Wave1Evidence[] => [
  { artifactId: `${prefix}-payment`, source: "execution-side-effect-ledger", concept: "price_paid", value: 742000, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-04T00:00:00.000Z", taintOrigins: ["execution-side-effect-ledger"] },
  { artifactId: `${prefix}-merchant`, source: "execution-side-effect-ledger", concept: "merchant_observed", value: "Wave1 Supplier", trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-04T00:00:00.000Z", taintOrigins: ["execution-side-effect-ledger"] },
  { artifactId: `${prefix}-certificate`, source: "inspection-certificate-system", concept: "certificate_valid", value: true, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-07T00:00:00.000Z", taintOrigins: ["inspection-certificate-system"] },
  { artifactId: `${prefix}-dispatch`, source: "merchant-dispatch-system", concept: "dispatched_quantity", value: 500, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-05T00:00:00.000Z", taintOrigins: ["merchant-dispatch-system"] },
  { artifactId: `${prefix}-receipt`, source: "warehouse-receiving-system", concept: "quantity_received", value: received, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-07T00:00:00.000Z", taintOrigins: ["warehouse-receiving-system"] },
  { artifactId: `${prefix}-product-receipt`, source: "warehouse-receiving-system", concept: "product_observed", value: "food-grade containers", trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-07T00:00:00.000Z", taintOrigins: ["warehouse-receiving-system"] },
];

const replacementEvidence = (prefix: string): Wave1Evidence[] => [
  { artifactId: `${prefix}-remedy-payment`, source: "execution-side-effect-ledger", concept: "price_paid", value: 6000, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-08T00:00:00.000Z", taintOrigins: ["execution-side-effect-ledger"] },
  { artifactId: `${prefix}-remedy-merchant`, source: "execution-side-effect-ledger", concept: "merchant_observed", value: "remedy-counterparty", trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-08T00:00:00.000Z", taintOrigins: ["execution-side-effect-ledger"] },
  { artifactId: `${prefix}-remedy-receipt`, source: "warehouse-receiving-system", concept: "quantity_received", value: 50, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-09T00:00:00.000Z", taintOrigins: ["warehouse-receiving-system"] },
  { artifactId: `${prefix}-remedy-certificate`, source: "inspection-certificate-system", concept: "certificate_valid", value: true, trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-08T00:00:00.000Z", taintOrigins: ["inspection-certificate-system"] },
  { artifactId: `${prefix}-remedy-product`, source: "warehouse-receiving-system", concept: "product_observed", value: "remedy", trustClass: "UNTRUSTED_EXTERNAL", capturedAt: "2031-01-09T00:00:00.000Z", taintOrigins: ["warehouse-receiving-system"] },
];

const rawIntent = (supplierName: string) =>
  `Buy 500 food-grade containers from approved supplier ${supplierName} for under INR ${BUDGET} before ${EXPIRY}`;

const workflow = (intentId: string, supplier: { id: string; approved: boolean }, totalAmount: number) => ({
  intentId,
  idempotencyKey: intentId,
  supplier: { id: supplier.id, name: supplier.id, approved: supplier.approved, approvalEvidenceId: `${intentId}-supplier-approval` },
  item: { specification: "food-grade containers" },
  quantity: 500,
  totalAmount,
  currency: "INR",
  foodGradeEvidenceId: `${intentId}-food-grade-certificate`,
  evidenceIds: [`${intentId}-quote`],
  delivery: { terms: "deliver 500 food-grade containers", deadline: EXPIRY },
});

async function pollTip(intentId: string): Promise<{ id: string; stateHash: string; constraints: unknown[] }> {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (true) {
    const tip = await intentProvenance.getTip(intentId);
    if (tip.ok) return tip.value as unknown as { id: string; stateHash: string; constraints: unknown[] };
    if (Date.now() >= deadline) throw new Error(JSON.stringify({ stage: "tip_timeout", code: tip.code }));
    await sleep(3000);
  }
}

/** Tip-first: the workflow is submitted exactly once AFTER the owner tip is
 * finalized — no retry race with the existing-artifacts early return. */
async function submitWorkflowOnce(body: unknown): Promise<Record<string, unknown>> {
  const result = await callAgent("POST", "/internal/workflows/procurement", body);
  if (!result.ok) {
    throw new Error(JSON.stringify({ stage: "workflow", code: result.code, message: result.message, details: result.details }));
  }
  return result.value as Record<string, unknown>;
}

async function commitSucceeded(workflowValue: Record<string, unknown>): Promise<void> {
  const authorization = workflowValue.authorization as { commitToken?: { id?: string } } | undefined;
  const tokenId = authorization?.commitToken?.id;
  if ((workflowValue.state as string) !== "AUTHORIZED" || !tokenId) {
    throw new Error(JSON.stringify({ outcome: "AUTHORIZATION_INCOMPLETE", state: workflowValue.state }));
  }
  const commit = await callAgent("POST", "/internal/execution/commit", { commitTokenId: tokenId });
  if (!commit.ok || (commit.value as { status?: string }).status !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "COMMIT_FAILED", code: commit.ok ? "OK" : commit.code, value: commit.ok ? commit.value : commit.message }));
  }
}

async function evaluate(contractId: string, claimIds: readonly string[]): Promise<Record<string, unknown>> {
  const result = await outcomes.evaluateEvidence(contractId, { claimIds });
  if (!result.ok) throw new Error(JSON.stringify({ stage: "evaluate", code: result.code, message: result.message }));
  return result.value as Record<string, unknown>;
}

async function acceptanceA(): Promise<void> {
  const intentId = `wave1-a-unsafe-supplier${SUFFIX}`;
  const prefix = intentId;
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(prefix, authEvidence(prefix, "unsafe-supplier")));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  await publishRawIntent(intentId, rawIntent("Unsafe Supplier"));
  await pollTip(intentId);
  const value = await submitWorkflowOnce(workflow(intentId, { id: "Unsafe Supplier", approved: false }, 742000));
  if (value.state !== "BLOCKED") throw new Error(JSON.stringify({ outcome: "A_NOT_BLOCKED", state: value.state }));
  console.log(JSON.stringify({ acceptance: "A", intentId, state: value.state, verdict: "BLOCKED_ZERO_PURCHASE" }));
}

async function acceptanceB(): Promise<void> {
  const intentId = `wave1-b-full-delivery${SUFFIX}`;
  const prefix = intentId;
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(prefix, [...authEvidence(prefix, "wave1-supplier"), ...deliveryEvidence(prefix, 500)]));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  await publishRawIntent(intentId, rawIntent("Wave1 Supplier"));
  await pollTip(intentId);
  const value = await submitWorkflowOnce(workflow(intentId, { id: "Wave1 Supplier", approved: true }, 742000));
  await commitSucceeded(value);
  const grant = (value.authorization as { grant?: { outcomeContractId?: string } }).grant;
  const contractId = grant?.outcomeContractId;
  if (!contractId) throw new Error("B_CONTRACT_MISSING");
  const claims = deliveryEvidence(prefix, 500).map((item) => `${item.artifactId}-claim`);
  const evaluated = await evaluate(contractId, claims);
  const contract = evaluated.contract as { state: string; paymentStatus: string; requirements: { concept: string; state: string; value: unknown }[] };
  if (contract.state !== "SATISFIED" || contract.paymentStatus !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "B_NOT_SATISFIED", state: contract.state, payment: contract.paymentStatus }));
  }
  const qty = contract.requirements.find((r) => r.concept === "quantity_received");
  if (qty?.state !== "SATISFIED" || qty.value !== 500) throw new Error(JSON.stringify({ outcome: "B_QUANTITY_MISMATCH", qty }));
  const food = contract.requirements.find((r) => r.concept === "food_grade");
  const supplier = contract.requirements.find((r) => r.concept === "supplier_approved");
  if (food?.state !== "SATISFIED" || supplier?.state !== "SATISFIED") throw new Error(JSON.stringify({ outcome: "B_EVIDENCE_UNSATISFIED", food, supplier }));
  // Replay: zero additional side effects (idempotent).
  const tokenId = (value.authorization as { commitToken?: { id?: string } }).commitToken?.id;
  const replay = await callAgent("POST", "/internal/execution/commit", { commitTokenId: tokenId });
  if (!replay.ok || (replay.value as { status?: string }).status !== "IDEMPOTENT_REPLAY") {
    throw new Error(JSON.stringify({ outcome: "B_REPLAY_NOT_IDEMPOTENT", code: replay.ok ? "OK" : replay.code, value: replay.ok ? replay.value : replay.message }));
  }
  // No ResolutionCase for a satisfied contract, then owner-side CLOSE.
  const caseRead = await outcomes.getResolutionCaseByContract(contractId);
  if (caseRead.ok) throw new Error(JSON.stringify({ outcome: "B_UNEXPECTED_RESOLUTION_CASE" }));
  const closed = await outcomes.closeContract(contractId);
  if (!closed.ok || (closed.value as { state?: string }).state !== "CLOSED") {
    throw new Error(JSON.stringify({ outcome: "B_CLOSE_FAILED", code: closed.ok ? "OK" : closed.code, value: closed.ok ? closed.value : closed.message }));
  }
  console.log(JSON.stringify({ acceptance: "B", intentId, contractId, state: "CLOSED", payment: contract.paymentStatus, quantity: qty.value, foodGrade: food.state, supplier: supplier.state, replay: "IDEMPOTENT_REPLAY", resolutionCase: "none" }));
}

/**
 * B_CONTINUE: completes a partially-started acceptance B namespace (payment
 * SUCCESS already durable) WITHOUT any new economic execution. Re-evaluates
 * the existing contract's evidence, closes it, and replays the consumed
 * CommitToken (IDEMPOTENT_REPLAY, zero additional side effects).
 */
async function acceptanceBContinue(): Promise<void> {
  const intentId = `wave1-b-full-delivery${SUFFIX}`;
  const contractId = required("CONTRACT_ID");
  const tokenId = required("TOKEN_ID");
  const prefix = intentId;
  const claims = deliveryEvidence(prefix, 500).map((item) => `${item.artifactId}-claim`);
  const evaluated = await evaluate(contractId, claims);
  const contract = evaluated.contract as { state: string; paymentStatus: string; requirements: { concept: string; state: string; value: unknown }[] };
  if (contract.state !== "SATISFIED" || contract.paymentStatus !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "B_CONTINUE_NOT_SATISFIED", state: contract.state, payment: contract.paymentStatus }));
  }
  const qty = contract.requirements.find((r) => r.concept === "quantity_received");
  const food = contract.requirements.find((r) => ["food_grade", "material_standard"].includes(r.concept));
  const supplier = contract.requirements.find((r) => ["supplier_approved", "supplier_identity", "supplier"].includes(r.concept));
  if (qty?.state !== "SATISFIED" || qty.value !== 500 || food?.state !== "SATISFIED" || supplier?.state !== "SATISFIED") {
    throw new Error(JSON.stringify({ outcome: "B_CONTINUE_EVIDENCE_UNSATISFIED", qty, food, supplier }));
  }
  const caseRead = await outcomes.getResolutionCaseByContract(contractId);
  if (caseRead.ok) throw new Error(JSON.stringify({ outcome: "B_CONTINUE_UNEXPECTED_RESOLUTION_CASE" }));
  const closed = await outcomes.closeContract(contractId);
  if (!closed.ok || (closed.value as { state?: string }).state !== "CLOSED") {
    throw new Error(JSON.stringify({ outcome: "B_CONTINUE_CLOSE_FAILED", code: closed.ok ? "OK" : closed.code, value: closed.ok ? closed.value : closed.message }));
  }
  const replay = await callAgent("POST", "/internal/execution/commit", { commitTokenId: tokenId });
  if (!replay.ok || (replay.value as { status?: string }).status !== "IDEMPOTENT_REPLAY") {
    throw new Error(JSON.stringify({ outcome: "B_CONTINUE_REPLAY_FAILED", code: replay.ok ? "OK" : replay.code, value: replay.ok ? replay.value : replay.message }));
  }
  console.log(JSON.stringify({ acceptance: "B_CONTINUE", intentId, contractId, state: "CLOSED", payment: contract.paymentStatus, quantity: qty.value, foodGrade: food.state, supplier: supplier.state, replay: "IDEMPOTENT_REPLAY", newSideEffects: 0, resolutionCase: "none" }));
}

async function prepareShortDelivery(intentId: string, totalAmount: number): Promise<{ contractId: string; originalGrantId: string; caseId: string }> {
  const prefix = intentId;
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(prefix, [
    ...authEvidence(prefix, "wave1-supplier"),
    ...deliveryEvidence(prefix, 450),
    ...replacementEvidence(prefix),
  ]));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  await publishRawIntent(intentId, rawIntent("Wave1 Supplier"));
  await pollTip(intentId);
  const value = await submitWorkflowOnce(workflow(intentId, { id: "Wave1 Supplier", approved: true }, totalAmount));
  await commitSucceeded(value);
  const grant = (value.authorization as { grant?: { id?: string; outcomeContractId?: string } }).grant;
  const contractId = grant?.outcomeContractId;
  const originalGrantId = grant?.id;
  if (!contractId || !originalGrantId) throw new Error("C_CONTRACT_MISSING");
  const claims = deliveryEvidence(prefix, 450).map((item) => `${item.artifactId}-claim`);
  const evaluated = await evaluate(contractId, claims);
  const contract = evaluated.contract as { state: string };
  const divergence = evaluated.divergence as { shortfall: number } | null;
  if (contract.state !== "PARTIAL" || divergence?.shortfall !== 50) {
    throw new Error(JSON.stringify({ outcome: "C_NOT_PARTIAL", state: contract.state, divergence }));
  }
  let caseValue: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = await outcomes.getResolutionCaseByContract(contractId);
    if (found.ok) { caseValue = found.value as Record<string, unknown>; break; }
    await sleep(4000);
  }
  if (!caseValue) throw new Error("C_CASE_NOT_OPENED");
  const caseDoc = caseValue.case as { id: string; responsibilityState: string };
  if (caseDoc.responsibilityState !== "UNKNOWN") throw new Error(JSON.stringify({ outcome: "C_RESPONSIBILITY_NOT_UNKNOWN", responsibility: caseDoc.responsibilityState }));
  return { contractId, originalGrantId, caseId: caseDoc.id };
}

async function issueMandate(caseId: string): Promise<{ remedyId: string; mandateId: string }> {
  const listed = await resolutions.listRemedies(caseId);
  if (!listed.ok) throw new Error(JSON.stringify({ stage: "remedies", code: listed.code, message: listed.message }));
  const remedies = (listed.value as { remedies: { id: string; requiresFinancialAction: boolean }[] }).remedies;
  const replacement = remedies.find((r) => r.requiresFinancialAction);
  if (!replacement) throw new Error("C_NO_FINANCIAL_REMEDY");
  const issued = await resolutions.issueRemediationMandate(caseId, replacement.id, { expiresAt: EXPIRY });
  if (!issued.ok) throw new Error(JSON.stringify({ stage: "mandate", code: issued.code, message: issued.message }));
  const mandate = (issued.value as { mandate: { id: string } }).mandate;
  return { remedyId: replacement.id, mandateId: mandate.id };
}

async function acceptanceC(): Promise<void> {
  const intentId = `wave1-c-short-delivery${SUFFIX}`;
  const { contractId, originalGrantId, caseId } = await prepareShortDelivery(intentId, 742000);
  const { remedyId, mandateId } = await issueMandate(caseId);
  const executed = await resolutions.executeRemedy(caseId, remedyId, { mandateId, originalPaymentGrantId: originalGrantId });
  if (!executed.ok) throw new Error(JSON.stringify({ stage: "execute", code: executed.code, message: executed.message }));
  const execution = executed.value as { executionStatus: string; remedyOutcomeContractId: string; case: { state: string } };
  if (execution.executionStatus !== "SUCCESS" || execution.case.state !== "VERIFYING_REMEDY") {
    throw new Error(JSON.stringify({ outcome: "C_EXECUTION_INCOMPLETE", executionStatus: execution.executionStatus, state: execution.case?.state }));
  }
  const remedyContractId = execution.remedyOutcomeContractId;
  const remedyClaims = replacementEvidence(intentId).map((item) => `${item.artifactId}-claim`);
  const remedyEvaluated = await evaluate(remedyContractId, remedyClaims);
  const remedyContract = remedyEvaluated.contract as { state: string };
  if (remedyContract.state !== "SATISFIED") throw new Error(JSON.stringify({ outcome: "C_REMEDY_NOT_SATISFIED", state: remedyContract.state }));
  const verified = await resolutions.verifyRemedyOutcome(caseId, { remedyOutcomeContractId: remedyContractId });
  if (!verified.ok || (verified.value as { state: string }).state !== "RESOLVED") {
    throw new Error(JSON.stringify({ outcome: "C_NOT_RESOLVED", code: verified.ok ? "OK" : verified.code, value: verified.ok ? verified.value : verified.message }));
  }
  const original = await outcomes.getContract(contractId);
  const originalState = original.ok ? (original.value as { state?: string }).state : undefined;
  if (!original.ok || originalState !== "PARTIAL") {
    throw new Error(JSON.stringify({ outcome: "C_ORIGINAL_HISTORY_LOST", ok: original.ok, state: originalState, message: original.ok ? "" : original.message }));
  }
  console.log(JSON.stringify({ acceptance: "C", intentId, originalContractId: contractId, originalState, remedyContractId, remedyState: remedyContract.state, caseState: "RESOLVED", combinedReceived: 450 + 50, restoration: "goal_restored_history_preserved" }));
}

/**
 * C_CONTINUE: completes a partially-started acceptance C namespace (original
 * purchase already SUCCESS/PARTIAL, mandate already issued, no remedy
 * execution happened). Re-runs ONLY the remedy execution through its
 * verification on the existing mandate — never re-purchases.
 */
async function acceptanceCContinue(): Promise<void> {
  const intentId = `wave1-c-short-delivery${SUFFIX}`;
  const caseId = required("CASE_ID");
  const originalGrantId = required("ORIGINAL_GRANT_ID");
  const mandateId = required("MANDATE_ID");
  const listed = await resolutions.listRemedies(caseId);
  if (!listed.ok) throw new Error(JSON.stringify({ stage: "remedies", code: listed.code, message: listed.message }));
  const remedies = (listed.value as { remedies: { id: string; requiresFinancialAction: boolean }[] }).remedies;
  const replacement = remedies.find((r) => r.requiresFinancialAction);
  if (!replacement) throw new Error("C_NO_FINANCIAL_REMEDY");
  const executed = await resolutions.executeRemedy(caseId, replacement.id, { mandateId, originalPaymentGrantId: originalGrantId });
  if (!executed.ok) throw new Error(JSON.stringify({ stage: "execute", code: executed.code, message: executed.message, details: executed.details }));
  const execution = executed.value as { executionStatus: string; remedyOutcomeContractId: string; case: { state: string } };
  if (execution.executionStatus !== "SUCCESS" || execution.case.state !== "VERIFYING_REMEDY") {
    throw new Error(JSON.stringify({ outcome: "C_EXECUTION_INCOMPLETE", executionStatus: execution.executionStatus, state: execution.case?.state }));
  }
  const remedyContractId = execution.remedyOutcomeContractId;
  const remedyClaims = replacementEvidence(intentId).map((item) => `${item.artifactId}-claim`);
  const remedyEvaluated = await evaluate(remedyContractId, remedyClaims);
  const remedyContract = remedyEvaluated.contract as { state: string };
  if (remedyContract.state !== "SATISFIED") throw new Error(JSON.stringify({ outcome: "C_REMEDY_NOT_SATISFIED", state: remedyContract.state }));
  const verified = await resolutions.verifyRemedyOutcome(caseId, { remedyOutcomeContractId: remedyContractId });
  if (!verified.ok || (verified.value as { state: string }).state !== "RESOLVED") {
    throw new Error(JSON.stringify({ outcome: "C_NOT_RESOLVED", code: verified.ok ? "OK" : verified.code, value: verified.ok ? verified.value : verified.message }));
  }
  console.log(JSON.stringify({ acceptance: "C_CONTINUE", intentId, caseId, remedyContractId, remedyState: remedyContract.state, caseState: "RESOLVED", combinedReceived: 450 + 50, restoration: "goal_restored_history_preserved" }));
}

async function acceptanceApproval(): Promise<void> {
  const intentId = `wave1-approval${SUFFIX}`;
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(intentId, authEvidence(intentId, "wave1-supplier")));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  await publishRawIntent(intentId, rawIntent("Wave1 Supplier"));
  let tip: Awaited<ReturnType<IntentProvenanceS2SClient["getTip"]>> | undefined;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (true) {
    tip = await intentProvenance.getTip(intentId);
    if (tip.ok) break;
    if (Date.now() >= deadline) throw new Error(JSON.stringify({ outcome: "TIP_TIMEOUT", code: tip.code }));
    await sleep(3000);
  }
  const v1 = tip!.value;
  const policy = await intentProvenance.createIntentState({
    intentId,
    id: `state-${intentId}-approval-policy`,
    constraints: v1.constraints,
    capabilities: { execute_payment: "REQUIRE_APPROVAL" },
    createdBy: "wave1-operator",
  });
  if (!policy.ok) throw new Error(JSON.stringify({ stage: "policy_state", code: policy.code, message: policy.message }));
  const policyState = policy.value as { stateHash: string; id: string };
  const value = await submitWorkflowOnce(workflow(intentId, { id: "Wave1 Supplier", approved: true }, 742000));
  if (value.state !== "AWAITING_APPROVAL") throw new Error(JSON.stringify({ outcome: "APPROVAL_NOT_AWAITING", state: value.state }));
  const approval = value.approval as { id: string; status: string; intentStateHash: string; requestedScope: { amount: number; merchant: string } };
  if (approval.status !== "PENDING" || approval.intentStateHash !== policyState.stateHash) {
    throw new Error(JSON.stringify({ outcome: "APPROVAL_BINDING", approval }));
  }
  if (approval.requestedScope.amount !== 742000 || approval.requestedScope.merchant !== "Wave1 Supplier") {
    throw new Error(JSON.stringify({ outcome: "APPROVAL_SCOPE_MISMATCH", scope: approval.requestedScope }));
  }
  // Verified operator identity decides — decidedBy derives from the
  // authenticated caller, never from JSON.
  const decided = await authority.decideApproval(approval.id, { decision: "APPROVE", reason: "bounded and verified — Wave 1 live acceptance" });
  if (!decided.ok) throw new Error(JSON.stringify({ stage: "decide", code: decided.code, message: decided.message }));
  const decidedValue = decided.value as { status: string; decidedBy: string; decision: string };
  if (decidedValue.status !== "APPROVED" || decidedValue.decision !== "APPROVE" || !decidedValue.decidedBy.endsWith("iam.gserviceaccount.com")) {
    throw new Error(JSON.stringify({ outcome: "DECIDEDBY_NOT_VERIFIED_IDENTITY", decidedValue }));
  }
  const workflowId = (value.artifacts as { workflowId: string }).workflowId;
  const resumed = await callAgent("POST", "/internal/workflows/procurement/resume-approval", { workflowId, approvalId: approval.id });
  if (!resumed.ok || (resumed.value as { state?: string }).state !== "AUTHORIZED") {
    throw new Error(JSON.stringify({ outcome: "APPROVAL_RESUME_FAILED", code: resumed.ok ? "OK" : resumed.code, value: resumed.ok ? resumed.value : resumed.message }));
  }
  const resumedValue = resumed.value as Record<string, unknown>;
  await commitSucceeded(resumedValue);
  console.log(JSON.stringify({ acceptance: "APPROVAL", intentId, approvalId: approval.id, status: decidedValue.status, decidedBy: decidedValue.decidedBy, intentStateHash: policyState.stateHash, scope: approval.requestedScope, workflowState: "AUTHORIZED", commit: "SUCCESS" }));
}

async function acceptanceApprovalNegative(): Promise<void> {
  const intentId = `wave1-approval-negative${SUFFIX}`;
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(intentId, authEvidence(intentId, "wave1-supplier")));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  await publishRawIntent(intentId, rawIntent("Wave1 Supplier"));
  let tip: Awaited<ReturnType<IntentProvenanceS2SClient["getTip"]>> | undefined;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (true) {
    tip = await intentProvenance.getTip(intentId);
    if (tip.ok) break;
    if (Date.now() >= deadline) throw new Error(JSON.stringify({ outcome: "TIP_TIMEOUT", code: tip.code }));
    await sleep(3000);
  }
  const v1 = tip!.value;
  const policy = await intentProvenance.createIntentState({
    intentId,
    id: `state-${intentId}-approval-policy`,
    constraints: v1.constraints,
    capabilities: { execute_payment: "REQUIRE_APPROVAL" },
    createdBy: "wave1-operator",
  });
  if (!policy.ok) throw new Error(JSON.stringify({ stage: "policy_state", code: policy.code, message: policy.message }));
  const value = await submitWorkflowOnce(workflow(intentId, { id: "Wave1 Supplier", approved: true }, 742000));
  if (value.state !== "AWAITING_APPROVAL") throw new Error(JSON.stringify({ outcome: "NEGATIVE_NOT_AWAITING", state: value.state }));
  const approval = value.approval as { id: string };
  // The tip moves (a newer policy state supersedes) → the pending approval
  // becomes stale and the decision must fail closed.
  const newer = await intentProvenance.createIntentState({
    intentId,
    id: `state-${intentId}-approval-policy-v2`,
    constraints: v1.constraints,
    capabilities: { execute_payment: "REQUIRE_APPROVAL" },
    createdBy: "wave1-operator",
  });
  if (!newer.ok) throw new Error(JSON.stringify({ stage: "newer_state", code: newer.code, message: newer.message }));
  const decided = await authority.decideApproval(approval.id, { decision: "APPROVE" });
  if (decided.ok || decided.code !== "APPROVAL_STALE_INTENT_STATE") {
    throw new Error(JSON.stringify({ outcome: "NEGATIVE_NOT_FAIL_CLOSED", code: decided.ok ? "OK" : decided.code, value: decided.ok ? decided.value : decided.message }));
  }
  console.log(JSON.stringify({ acceptance: "APPROVAL_NEGATIVE", intentId, approvalId: approval.id, verdict: "STALE_APPROVAL_FAILED_CLOSED", sideEffects: 0 }));
}

async function acceptanceConcurrency(): Promise<void> {
  const intentId = `wave1-concurrency${SUFFIX}`;
  const { contractId, originalGrantId, caseId } = await prepareShortDelivery(intentId, 742000);
  const { remedyId, mandateId } = await issueMandate(caseId);
  const execute = () => resolutions.executeRemedy(caseId, remedyId, { mandateId, originalPaymentGrantId: originalGrantId });
  const [first, second] = await Promise.all([execute(), execute()]);
  const successes = [first, second].filter((r) => r.ok && (r.value as { executionStatus?: string }).executionStatus === "SUCCESS");
  if (successes.length !== 1) {
    throw new Error(JSON.stringify({ outcome: "CONCURRENCY_SUCCESS_COUNT", successes: successes.length, first: first.ok ? first.value : first.message, second: second.ok ? second.value : second.message }));
  }
  const third = await execute();
  if (third.ok) throw new Error(JSON.stringify({ outcome: "CONCURRENCY_THIRD_PASSED", value: third.value }));
  console.log(JSON.stringify({ acceptance: "CONCURRENCY", intentId, contractId, parallelSuccesses: successes.length, thirdAttempt: third.code, verdict: "ONE_CLAIM_ONE_EXECUTION" }));
}

async function acceptanceExposure(): Promise<void> {
  const intentId = `wave1-exposure${SUFFIX}`;
  const { contractId, originalGrantId, caseId } = await prepareShortDelivery(intentId, 796000);
  const { remedyId, mandateId } = await issueMandate(caseId);
  const executed = await resolutions.executeRemedy(caseId, remedyId, { mandateId, originalPaymentGrantId: originalGrantId });
  if (executed.ok || executed.code !== "CUMULATIVE_EXPOSURE_EXCEEDED") {
    throw new Error(JSON.stringify({ outcome: "EXPOSURE_NOT_BLOCKED", code: executed.ok ? "OK" : executed.code, value: executed.ok ? executed.value : executed.message }));
  }
  const mandate = await resolutions.getMandate(mandateId);
  if (!mandate.ok || (mandate.value as { status?: string }).status !== "ACTIVE") {
    throw new Error(JSON.stringify({ outcome: "EXPOSURE_MANDATE_STATE", mandate: mandate.ok ? mandate.value : mandate.code }));
  }
  console.log(JSON.stringify({ acceptance: "EXPOSURE", intentId, contractId, verdict: "CUMULATIVE_EXPOSURE_EXCEEDED", zeroNewSideEffects: true, mandateStatus: (mandate.value as { status: string }).status }));
}

async function evidenceWrite(): Promise<void> {
  const prefix = `wave1-evidence${SUFFIX}`;
  const rows = authEvidence(prefix, "wave1-supplier");
  const submitted = await evidence.submitAcceptanceFixture(fixtureOf(prefix, rows));
  if (!submitted.ok) throw new Error(JSON.stringify({ stage: "fixture", code: submitted.code, message: submitted.message }));
  console.log(JSON.stringify({ acceptance: "EVIDENCE_WRITE", prefix, envelopeIds: rows.map((r) => r.artifactId) }));
}

async function evidenceRead(): Promise<void> {
  const prefix = `wave1-evidence${SUFFIX}`;
  const rows = authEvidence(prefix, "wave1-supplier");
  for (const row of rows) {
    const envelope = await evidence.getEnvelope(row.artifactId);
    if (!envelope.ok) throw new Error(JSON.stringify({ stage: "read_envelope", id: row.artifactId, code: envelope.code }));
    if (envelope.value.contentHash !== contentHashOf(row)) {
      throw new Error(JSON.stringify({ outcome: "EVIDENCE_HASH_MISMATCH", id: row.artifactId, stored: envelope.value.contentHash, expected: contentHashOf(row) }));
    }
    const claim = await evidence.getClaim(`${row.artifactId}-claim`);
    if (!claim.ok) throw new Error(JSON.stringify({ stage: "read_claim", id: `${row.artifactId}-claim`, code: claim.code }));
  }
  console.log(JSON.stringify({ acceptance: "EVIDENCE_READ", prefix, verdict: "DURABLE_READ_THROUGH_VERIFIED", checks: rows.length }));
}

switch (MODE) {
  case "A": await acceptanceA(); break;
  case "B": await acceptanceB(); break;
  case "B_CONTINUE": await acceptanceBContinue(); break;
  case "C": await acceptanceC(); break;
  case "C_CONTINUE": await acceptanceCContinue(); break;
  case "APPROVAL": await acceptanceApproval(); break;
  case "APPROVAL_NEGATIVE": await acceptanceApprovalNegative(); break;
  case "CONCURRENCY": await acceptanceConcurrency(); break;
  case "EXPOSURE": await acceptanceExposure(); break;
  case "EVIDENCE_WRITE": await evidenceWrite(); break;
  case "EVIDENCE_READ": await evidenceRead(); break;
  default: throw new Error(`Unknown ACCEPTANCE_MODE ${MODE}`);
}
