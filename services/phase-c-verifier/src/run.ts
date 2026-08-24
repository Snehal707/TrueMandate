import {
  ErrorCode,
  ok,
  type OutcomeContract,
  type OutcomeVerification,
  type Result,
} from "@truemandate/protocol";
import { PHASE_C_ID } from "./fixture.js";

/**
 * Phase C verifier (deployed lifecycle). Reference-only orchestration:
 *
 *  - fresh phase-c-food-grade-500-v1 fixture → normal deployed authorization
 *    chain → fresh CommitToken → explicit controlled COMMIT (exactly one
 *    mock execution) → ExecutionResult SUCCESS → OutcomeContract
 *    AWAITING_OUTCOME
 *  - the verifier then submits canonical accepted CLAIM IDS to the Outcome
 *    owner's evaluate-evidence route; the owner loads the accepted evidence,
 *    derives observations and decides the transition — the verifier can
 *    never submit state/delivered/responsibility
 *  - the Resolution owner's trigger lifecycle opens the durable case; the
 *    verifier asserts (never authors) responsibility UNKNOWN and the
 *    discriminating evidence requests.
 *
 * Exit 0 only on the full durable contract. Remedies are never executed.
 */
export const PHASE_C_RETRY_WINDOW_MS = 300_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;
const CASE_POLL_WINDOW_MS = 60_000;

export interface PhaseCVerifierPorts {
  readonly submitEvidenceFixture: (fixture: unknown) => Promise<Result<unknown>>;
  readonly publishRawIntent: (event: unknown) => Promise<void>;
  readonly getContract: (contractId: string) => Promise<Result<OutcomeContract>>;
  readonly submitWorkflow: (workflow: unknown) => Promise<Result<unknown>>;
  readonly submitCommit: (body: { readonly commitTokenId: string }) => Promise<Result<unknown>>;
  readonly evaluateEvidence: (
    contractId: string,
    body: { readonly claimIds: readonly string[] },
  ) => Promise<Result<{
    readonly contract: OutcomeContract;
    readonly verification: OutcomeVerification;
    readonly divergence: { readonly requiredQuantity: number; readonly verifiedReceived: number; readonly shortfall: number } | null;
  }>>;
  readonly getResolutionCaseByContract: (contractId: string) => Promise<Result<{
    readonly case: { readonly responsibilityState: string; readonly state: string; readonly id: string };
    readonly evidenceRequests: readonly unknown[];
  }>>;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface PhaseCClosure {
  readonly fixture: string;
  readonly execution: { readonly status: string; readonly executionId?: string; readonly resultRef?: string; readonly grantId: string };
  readonly exactlyOnce: { readonly replayStatus: string; readonly sameResultRef: boolean };
  readonly outcome: { readonly state: string; readonly paymentStatus: string };
  readonly divergence: { readonly requiredQuantity: number; readonly verifiedReceived: number; readonly shortfall: number };
  readonly resolutionCase: { readonly id: string; readonly responsibilityState: string; readonly state: string };
  readonly evidenceRequests: readonly unknown[];
}

export async function runPhaseCVerifier(
  ports: PhaseCVerifierPorts,
  input: {
    readonly fixture: { readonly envelopes: readonly unknown[]; readonly claims: readonly unknown[] };
    readonly rawEvent: unknown;
    readonly workflow: unknown;
  },
): Promise<Result<PhaseCClosure>> {
  const now = ports.now ?? Date.now;
  const sleep = ports.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // 1) Evidence owner accepts the phase-c fixtures (caller-bound namespace).
  const accepted = await ports.submitEvidenceFixture(input.fixture);
  if (!accepted.ok) return accepted;

  // 2) Normal deployed authorization chain for the fresh fixture.
  await ports.publishRawIntent(input.rawEvent);
  const deadline = now() + PHASE_C_RETRY_WINDOW_MS;
  let delay = INITIAL_BACKOFF_MS;
  let workflowResult: Record<string, unknown> | undefined;
  while (true) {
    const result = await ports.submitWorkflow(input.workflow);
    if (result.ok) {
      workflowResult = result.value as Record<string, unknown>;
      break;
    }
    if (result.code !== ErrorCode.INTENT_STATE_NOT_READY || result.details?.retryable !== true) {
      throw new Error(JSON.stringify({ code: result.code, message: result.message, details: result.details }));
    }
    if (now() >= deadline) {
      throw new Error(JSON.stringify({ code: ErrorCode.INTENT_STATE_NOT_READY, message: "IntentState tip did not finalize within the Phase C retry window" }));
    }
    await sleep(delay);
    delay = Math.min(delay * 2, MAX_BACKOFF_MS);
  }

  const authorization = (workflowResult as {
    authorization?: { commitToken?: { id?: string }; grant?: { id?: string; amount?: number; currency?: string; merchant?: string; outcomeContractId?: string } };
  }).authorization;
  const tokenId = authorization?.commitToken?.id;
  const grant = authorization?.grant;
  if ((workflowResult as { state?: string }).state !== "AUTHORIZED" || !tokenId || !grant?.id) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_AUTHORIZATION_NOT_COMPLETE", state: (workflowResult as { state?: string }).state ?? "UNKNOWN" }));
  }
  if (grant.amount !== 742000 || grant.currency !== "INR" || grant.merchant !== "phase-b-supplier") {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_ECONOMICS_MISMATCH", grant }));
  }
  const contractId = grant.outcomeContractId;
  if (!contractId) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_CONTRACT_MISSING" }));
  }

  // 3) Explicit controlled execution: exactly one mock payment.
  const commit = await ports.submitCommit({ commitTokenId: tokenId });
  if (!commit.ok) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_COMMIT_FAILED", code: commit.code, message: commit.message, details: commit.details }));
  }
  const first = commit.value as { status?: string; resultRef?: string; grantId?: string; executionId?: string };
  if (first.status !== "SUCCESS" || !first.executionId || !first.resultRef || !first.grantId) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_EXECUTION_NOT_SUCCESS", value: first }));
  }
  const replay = await ports.submitCommit({ commitTokenId: tokenId });
  if (!replay.ok) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_REPLAY_CHECK_FAILED", code: replay.code, message: replay.message }));
  }
  const second = replay.value as { status?: string; resultRef?: string };
  if (second.status !== "IDEMPOTENT_REPLAY" || second.resultRef !== first.resultRef) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_EXACTLY_ONCE_VIOLATED", first, second }));
  }

  // 4) Post-payment readiness: the execution-event-driven payment
  // transition lands asynchronously. Poll the Outcome owner (its normal read
  // route) until the canonical post-payment state is observable — never
  // infer readiness from the SideEffectRecord and never retry evaluate as a
  // readiness mechanism. Bounded by the existing 60s case-poll window.
  const readyDeadline = now() + CASE_POLL_WINDOW_MS;
  while (true) {
    const read = await ports.getContract(contractId);
    if (!read.ok) {
      throw new Error(JSON.stringify({ outcome: "PHASE_C_CONTRACT_READ_FAILED", code: read.code, message: read.message }));
    }
    const snapshot = read.value;
    if (snapshot.state === "AWAITING_OUTCOME") {
      if (snapshot.paymentStatus !== "SUCCESS") {
        throw new Error(JSON.stringify({ outcome: "PHASE_C_PAYMENT_NOT_SUCCESS", state: snapshot.state, paymentStatus: snapshot.paymentStatus }));
      }
      break;
    }
    if (snapshot.state === "CREATED" || snapshot.state === "AWAITING_EXECUTION" || snapshot.state === "IN_PROGRESS") {
      if (now() >= readyDeadline) {
        throw new Error(JSON.stringify({ outcome: "PHASE_C_OUTCOME_READY_TIMEOUT", state: snapshot.state, paymentStatus: snapshot.paymentStatus }));
      }
      await sleep(1_000);
      continue;
    }
    throw new Error(JSON.stringify({ outcome: "PHASE_C_UNEXPECTED_OUTCOME_STATE", state: snapshot.state, paymentStatus: snapshot.paymentStatus }));
  }

  // 5) Outcome owner evaluates the canonical accepted claim references —
  // exactly once, only after readiness.
  const claimIds = input.fixture.claims.map((claim) => (claim as { id: string }).id);
  const evaluated = await ports.evaluateEvidence(contractId, { claimIds });
  if (!evaluated.ok) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_EVALUATE_FAILED", code: evaluated.code, message: evaluated.message }));
  }
  const outcomeContract = evaluated.value.contract;
  if (outcomeContract.state !== "PARTIAL" || outcomeContract.paymentStatus !== "SUCCESS") {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_OUTCOME_NOT_PARTIAL", state: outcomeContract.state, paymentStatus: outcomeContract.paymentStatus }));
  }
  const divergence = evaluated.value.divergence;
  if (!divergence || divergence.requiredQuantity !== 500 || divergence.verifiedReceived !== 450 || divergence.shortfall !== 50) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_DIVERGENCE_MISMATCH", divergence }));
  }

  // 6) Resolution owner's trigger lifecycle produced the durable case; the
  // verifier asserts the canonical facts, never authors them.
  const caseDeadline = now() + CASE_POLL_WINDOW_MS;
  let caseResult: Awaited<ReturnType<PhaseCVerifierPorts["getResolutionCaseByContract"]>> | undefined;
  while (true) {
    const attempt = await ports.getResolutionCaseByContract(contractId);
    if (attempt.ok) {
      caseResult = attempt;
      break;
    }
    if (now() >= caseDeadline) {
      throw new Error(JSON.stringify({ outcome: "PHASE_C_RESOLUTION_CASE_MISSING", message: attempt.message }));
    }
    await sleep(1_000);
  }
  const resolutionCase = caseResult.value.case;
  if (resolutionCase.responsibilityState !== "UNKNOWN") {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_RESPONSIBILITY_NOT_UNKNOWN", resolutionCase }));
  }
  const evidenceRequests = caseResult.value.evidenceRequests;
  if (evidenceRequests.length === 0) {
    throw new Error(JSON.stringify({ outcome: "PHASE_C_EVIDENCE_REQUESTS_MISSING" }));
  }
  for (const request of evidenceRequests) {
    if ((request as { requiresAuthority?: boolean }).requiresAuthority !== false) {
      throw new Error(JSON.stringify({ outcome: "PHASE_C_REQUEST_REQUIRES_AUTHORITY", request }));
    }
  }

  return ok({
    fixture: PHASE_C_ID,
    execution: { status: first.status, executionId: first.executionId, resultRef: first.resultRef, grantId: first.grantId },
    exactlyOnce: { replayStatus: second.status, sameResultRef: true },
    outcome: { state: outcomeContract.state, paymentStatus: outcomeContract.paymentStatus },
    divergence,
    resolutionCase: { id: resolutionCase.id, responsibilityState: resolutionCase.responsibilityState, state: resolutionCase.state },
    evidenceRequests,
  });
}
