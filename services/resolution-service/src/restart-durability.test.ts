import {
  ErrorCode,
  ResolutionCaseState,
  type RemedyProposal,
  type ResolutionCase,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { ResolutionService } from "./service.js";
import { OutcomeService } from "@truemandate/outcome-service";

/**
 * Wave 1 restart durability: deployed revisions and recycled instances must
 * serve the remedy lifecycle for cases opened by earlier instances. The
 * durable case row (with embedded planned remedies), the append-only event
 * log and the single-slot mandate claim are the restart-safe sources.
 */

const CASE_ID = "rc-restart-case-1";

function kvStore(seed: Map<string, unknown> = new Map()) {
  return {
    map: seed,
    put: async (id: string, value: unknown) => {
      seed.set(id, value);
    },
    get: async (id: string) => seed.get(id),
    putIfAbsent: async (id: string, value: unknown) => {
      if (seed.has(id)) return false;
      seed.set(id, value);
      return true;
    },
  };
}

function caseRow(overrides: Partial<ResolutionCase> = {}): ResolutionCase {
  return {
    id: CASE_ID as never,
    contractId: "outcome-original" as never,
    intentId: "intent-restart" as never,
    intentStateId: "state-restart" as never,
    openedAt: "2026-08-20T00:00:00.000Z",
    responsibilityState: "UNKNOWN" as never,
    missingEvidence: [],
    state: ResolutionCaseState.OPEN,
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function remedyOf(id: string): RemedyProposal {
  return {
    id,
    caseId: CASE_ID as never,
    kind: "replacement",
    description: "replacement remedy",
    requiresFinancialAction: true,
    financialCost: 5000,
    currency: "INR",
    quantity: 50,
    proposedAt: "2026-08-20T00:00:00.000Z",
  } as never;
}

describe("Wave 1 resolution restart durability", () => {
  it("hydrateCase restores a durable case with embedded remedies on a fresh instance", async () => {
    const cases = kvStore();
    const remedyId = `remedy-${CASE_ID}-0`;
    await cases.put(CASE_ID, {
      ...caseRow(),
      plannedRemedies: [remedyOf(remedyId)],
    });
    const service = new ResolutionService(new OutcomeService(), undefined, {
      cases: cases,
    });
    const hydrated = await service.hydrateCase(CASE_ID);
    expect(hydrated.ok).toBe(true);
    expect(service.getCase(CASE_ID).ok).toBe(true);
    expect(service.listRemedies(CASE_ID).map((r) => r.id)).toEqual([remedyId]);
    expect(service.getRemedy(CASE_ID, remedyId).ok).toBe(true);
  });

  it("hydrateCase initializes ephemeral remedy counters without erasing durable history", async () => {
    const cases = kvStore();
    await cases.put(CASE_ID, {
      ...caseRow({ state: ResolutionCaseState.REMEDIATING }),
      plannedRemedies: [remedyOf(`remedy-${CASE_ID}-0`)],
    });
    const service = new ResolutionService(new OutcomeService(), undefined, {
      cases: cases,
    });
    const hydrated = await service.hydrateCase(CASE_ID);
    expect(hydrated.ok).toBe(true);
    expect(hydrated.ok && hydrated.value.state).toBe(ResolutionCaseState.REMEDIATING);
    expect(service.getCounters(CASE_ID)).toEqual({
      remedyAttempts: 0,
      economicExposure: 0,
      evidenceRequests: 0,
    });
    // Authoritative durable case row is unchanged (not reset by hydrate).
    const row = (await cases.get(CASE_ID)) as ResolutionCase & {
      plannedRemedies?: unknown[];
    };
    expect(row.state).toBe(ResolutionCaseState.REMEDIATING);
    expect(row.plannedRemedies?.length).toBe(1);
  });

  it("hydrateCase fails closed for an unknown case", async () => {
    const service = new ResolutionService(new OutcomeService(), undefined, {
      cases: kvStore(),
    });
    const hydrated = await service.hydrateCase("rc-missing");
    expect(hydrated.ok).toBe(false);
    if (!hydrated.ok) expect(hydrated.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("transitions persist the case row (flushCases checkpoint)", async () => {
    const cases = kvStore();
    await cases.put(CASE_ID, caseRow());
    const service = new ResolutionService(new OutcomeService(), undefined, {
      cases: cases,
    });
    const c = (await service.hydrateCase(CASE_ID)).value;
    const advanced = service.transition(
      c.id,
      ResolutionCaseState.ANALYZING,
      "2026-08-20T00:01:00.000Z",
      "analysis",
    );
    expect(advanced.ok).toBe(true);
    await service.flushCases();
    const row = await cases.get(CASE_ID);
    expect((row as ResolutionCase).state).toBe(ResolutionCaseState.ANALYZING);
  });

  it("planRemedies embeds planned remedies in the durable row", async () => {
    const cases = kvStore();
    const outcomes = new OutcomeService();
    const contract = await outcomes.createContractFromIntent({
      id: "outcome-original",
      intentState: {
        id: "state-restart",
        intentId: "intent-restart",
        constraints: [],
        stateHash: "h-restart",
      } as never,
      principalId: "principal-1",
      merchant: "ApprovedFoodChem",
      quantity: 500,
      budgetMax: 800000,
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    expect(contract.ok).toBe(true);
    await outcomes.onPaymentSuccess(contract.value.id, "2026-08-20T00:00:10.000Z");
    await outcomes.applyObservations(
      contract.value.id,
      {
        quantityReceived: 450,
        quantityOrdered: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "ApprovedFoodChem",
        merchantExpected: "ApprovedFoodChem",
        certificateValid: true,
        productObserved: "fg",
        productExpected: "fg",
      },
      "2026-08-20T00:00:20.000Z",
    );
    const trigger = outcomes
      .listEvents(contract.value.id)
      .find((e) => e.type === "OUTCOME_PARTIAL");
    expect(trigger).toBeDefined();
    const opened = await new ResolutionService(outcomes, undefined, {
      cases: cases,
    }).openCaseFromTrigger({
      intentState: { id: "state-restart", intentId: "intent-restart", constraints: [], stateHash: "h-restart" } as never,
      principalId: "principal-1",
      contractId: contract.value.id as never,
      triggerEvent: trigger as never,
      now: "2026-08-20T00:00:30.000Z",
    });
    expect(opened.ok).toBe(true);
    const openedId = opened.value.id;
    // A fresh instance hydrates the durable case, then plans idempotently.
    const service = new ResolutionService(outcomes, undefined, {
      cases: cases,
    });
    const hydrated = await service.hydrateCase(openedId);
    expect(hydrated.ok).toBe(true);
    const planned = await service.planRemedies(openedId, "2026-08-20T00:02:00.000Z");
    expect(planned.ok).toBe(true);
    await service.flushCases();
    const row = (await cases.get(openedId)) as ResolutionCase & {
      plannedRemedies?: unknown[];
    };
    expect(Array.isArray(row.plannedRemedies)).toBe(true);
    expect(row.plannedRemedies!.length).toBeGreaterThan(0);
  });

  it("mandate claim is single-slot across instances (durable putIfAbsent)", async () => {
    const claims = kvStore();
    const mandateId = "mandate-restart-0";
    const a = new ResolutionService(new OutcomeService(), undefined, {
      mandateClaims: claims,
    });
    const b = new ResolutionService(new OutcomeService(), undefined, {
      mandateClaims: claims,
    });
    const first = await a.claimMandateForExecution(mandateId, {
      idempotencyKey: "remedy:rc-restart-case-1:r0",
      caseId: CASE_ID,
      remedyId: "r0",
      claimedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(first.ok).toBe(true);
    expect(first.value).toBe("CLAIMED");
    // Same attempt on a fresh instance converges (CONTINUATION).
    const same = await b.claimMandateForExecution(mandateId, {
      idempotencyKey: "remedy:rc-restart-case-1:r0",
      caseId: CASE_ID,
      remedyId: "r0",
      claimedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(same.ok).toBe(true);
    expect(same.value).toBe("CONTINUATION");
    // A different attempt is rejected before any economic state exists.
    const other = await b.claimMandateForExecution(mandateId, {
      idempotencyKey: "remedy:rc-restart-case-1:r0:attempt-2",
      caseId: CASE_ID,
      remedyId: "r0",
      claimedAt: "2026-08-20T00:01:00.000Z",
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe(ErrorCode.REMEDIATION_MANDATE_INVALID);
  });
});
