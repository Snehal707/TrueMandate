import { describe, expect, it } from "vitest";
import { ResolutionCaseState, ResolutionEventType, type ResolutionEvent } from "@truemandate/protocol";
import { reconstructResolutionState } from "./reconstruction.js";

const CASE = "rc-wave1-reconstruction";
const at = (minute: number) => `2031-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`;

function event(type: ResolutionEventType, minute: number, payload: Record<string, unknown> = {}, caseId = CASE): ResolutionEvent {
  return {
    id: `re-${caseId}-${type}-${minute}`,
    resolutionCaseId: caseId as never,
    type,
    at: at(minute),
    payload,
    dedupeKey: `recon:${type}:${minute}`,
  };
}

describe("deterministic append-only resolution reconstruction", () => {
  it("replays the full remedy lifecycle to the RESOLVED end state", () => {
    const log: ResolutionEvent[] = [
      event(ResolutionEventType.CASE_OPENED, 0),
      event(ResolutionEventType.DIVERGENCE_IDENTIFIED, 1),
      event(ResolutionEventType.EVIDENCE_REQUESTED, 2),
      event(ResolutionEventType.REMEDY_PROPOSED, 3, { id: "remedy-1" }),
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-remedy-1", remedyId: "remedy-1" }),
      event(ResolutionEventType.MANDATE_CONSUMED, 5, { mandateId: "mandate-remedy-1" }),
      event(ResolutionEventType.REMEDY_EXECUTED, 6, { remedyOutcomeContractId: "oc-remedy-bound" }),
      event(ResolutionEventType.REMEDY_OUTCOME_OBSERVED, 7, { state: "SATISFIED" }),
      event(ResolutionEventType.CASE_RESOLVED, 8, { reason: "restored" }),
    ];
    const result = reconstructResolutionState(log);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      caseId: CASE,
      state: ResolutionCaseState.RESOLVED,
      mandateIds: ["mandate-remedy-1"],
      mandateConsumed: true,
      remedyOutcomeContractId: "oc-remedy-bound",
    });
  });

  it("replays identically regardless of log order (append order is recovered from event time)", () => {
    const log = [
      event(ResolutionEventType.CASE_RESOLVED, 8, { reason: "restored" }),
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-remedy-1" }),
      event(ResolutionEventType.REMEDY_EXECUTED, 6, { remedyOutcomeContractId: "oc-remedy-bound" }),
      event(ResolutionEventType.CASE_OPENED, 0),
      event(ResolutionEventType.REMEDY_PROPOSED, 3, { id: "remedy-1" }),
      event(ResolutionEventType.MANDATE_CONSUMED, 5, { mandateId: "mandate-remedy-1" }),
      event(ResolutionEventType.REMEDY_OUTCOME_OBSERVED, 7, { state: "SATISFIED" }),
    ];
    const result = reconstructResolutionState(log);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.state).toBe(ResolutionCaseState.RESOLVED);
  });

  it("fails closed on an orphaned event (no CASE_OPENED)", () => {
    const result = reconstructResolutionState([
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-remedy-1" }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ORPHAN_EVENT");
  });

  it("fails closed on a tampered log (missing mandate consumption)", () => {
    // The execution event is removed from the tampered log: VERIFYING_REMEDY
    // can no longer be reached and the state machine refuses the jump.
    const result = reconstructResolutionState([
      event(ResolutionEventType.CASE_OPENED, 0),
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-remedy-1" }),
      event(ResolutionEventType.REMEDY_OUTCOME_OBSERVED, 7, { state: "SATISFIED" }),
      event(ResolutionEventType.CASE_RESOLVED, 8),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ILLEGAL_RECONSTRUCTION_TRANSITION");
  });

  it("a consumed mandate cannot be re-issued under a different id in the same case", () => {
    const result = reconstructResolutionState([
      event(ResolutionEventType.CASE_OPENED, 0),
      event(ResolutionEventType.REMEDY_PROPOSED, 3, { id: "remedy-1" }),
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-1" }),
      event(ResolutionEventType.MANDATE_CONSUMED, 5, { mandateId: "mandate-1" }),
      event(ResolutionEventType.REMEDY_EXECUTED, 6, { remedyOutcomeContractId: "oc-1" }),
      event(ResolutionEventType.REMEDY_OUTCOME_OBSERVED, 7),
      event(ResolutionEventType.CASE_RESOLVED, 8),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.mandateConsumed).toBe(true);
    // A second mandate for the same case is a reconstruction violation.
    const secondMandate = reconstructResolutionState([
      event(ResolutionEventType.CASE_OPENED, 0),
      event(ResolutionEventType.REMEDY_PROPOSED, 3, { id: "remedy-1" }),
      event(ResolutionEventType.MANDATE_ISSUED, 4, { mandateId: "mandate-1" }),
      event(ResolutionEventType.MANDATE_CONSUMED, 5, { mandateId: "mandate-1" }),
      event(ResolutionEventType.MANDATE_ISSUED, 9, { mandateId: "mandate-2" }),
    ]);
    expect(secondMandate.ok).toBe(false);
    if (secondMandate.ok) return;
    expect(secondMandate.code).toBe("ILLEGAL_RECONSTRUCTION_TRANSITION");
  });
});
