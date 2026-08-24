import {
  ResolutionCaseState,
  ResolutionEventType,
  err,
  ok,
  type ResolutionEvent,
  type Result,
} from "@truemandate/protocol";

/**
 * Deterministic append-only governance reconstruction (Wave 1).
 *
 * The resolution event log is the source of truth: replaying it in append
 * order must reproduce every case's final state with no hidden in-memory
 * context. Events imply their intermediate hops (the live service may
 * transition without emitting an event for internal multi-hop paths), and a
 * tampered or incomplete log fails closed instead of silently reconstructing
 * a false state.
 */

export interface ReconstructedCase {
  readonly caseId: string;
  readonly state: ResolutionCaseState;
  readonly mandateIds: readonly string[];
  readonly mandateConsumed: boolean;
  readonly remedyOutcomeContractId?: string;
}

interface Draft {
  state: ResolutionCaseState;
  mandateIds: string[];
  mandateConsumed: boolean;
  remedyOutcomeContractId?: string;
}

/** The states an event may legally leave behind (implied hops included). */
function assertFrom(draft: Draft, allowed: readonly ResolutionCaseState[], label: string, caseId: string): Result<void> {
  if (!allowed.includes(draft.state)) {
    return err("ILLEGAL_RECONSTRUCTION_TRANSITION" as never, `Illegal reconstructed ${label}: ${draft.state}`, { caseId, state: draft.state });
  }
  return ok();
}

function applyEvent(drafts: Map<string, Draft>, event: ResolutionEvent): Result<void> {
  const caseId = String(event.resolutionCaseId);
  if (event.type === ResolutionEventType.CASE_OPENED) {
    if (drafts.has(caseId)) return err("DUPLICATE_CASE_OPENED" as never, "Duplicate CASE_OPENED in reconstruction", { caseId });
    drafts.set(caseId, { state: ResolutionCaseState.OPEN, mandateIds: [], mandateConsumed: false });
    return ok();
  }
  const draft = drafts.get(caseId);
  if (!draft) return err("ORPHAN_EVENT" as never, "ResolutionEvent precedes CASE_OPENED", { caseId, type: event.type });
  switch (event.type) {
    case ResolutionEventType.REMEDY_PROPOSED: {
      const gate = assertFrom(draft, [ResolutionCaseState.OPEN, ResolutionCaseState.ANALYZING, ResolutionCaseState.GATHERING_EVIDENCE, ResolutionCaseState.REMEDY_PROPOSED], "REMEDY_PROPOSED", caseId);
      if (!gate.ok) return gate;
      draft.state = ResolutionCaseState.REMEDY_PROPOSED;
      return ok();
    }
    case ResolutionEventType.EVIDENCE_REQUESTED:
    case ResolutionEventType.DIVERGENCE_IDENTIFIED:
    case ResolutionEventType.HYPOTHESIS_PROPOSED: {
      // Evidence/hypothesis planning implies the GATHERING_EVIDENCE hop when
      // the case is still OPEN.
      if (draft.state === ResolutionCaseState.OPEN && event.type === ResolutionEventType.EVIDENCE_REQUESTED) {
        draft.state = ResolutionCaseState.GATHERING_EVIDENCE;
      }
      return ok();
    }
    case ResolutionEventType.MANDATE_ISSUED: {
      const mandateId = String((event.payload as { mandateId?: unknown }).mandateId ?? "");
      if (!mandateId) return err("MANDATE_EVENT_INCOMPLETE" as never, "MANDATE_ISSUED lacks mandateId", { caseId });
      if (draft.mandateIds.includes(mandateId)) return err("DUPLICATE_MANDATE" as never, "Duplicate MANDATE_ISSUED", { mandateId });
      const gate = assertFrom(draft, [ResolutionCaseState.REMEDY_PROPOSED, ResolutionCaseState.AWAITING_AUTHORITY], "MANDATE_ISSUED", caseId);
      if (!gate.ok) return gate;
      draft.mandateIds = [...draft.mandateIds, mandateId];
      draft.state = ResolutionCaseState.AWAITING_AUTHORITY;
      return ok();
    }
    case ResolutionEventType.AUTHORITY_REQUESTED:
      return assertFrom(draft, [ResolutionCaseState.REMEDY_PROPOSED, ResolutionCaseState.AWAITING_AUTHORITY], "AUTHORITY_REQUESTED", caseId);
    case ResolutionEventType.MANDATE_CONSUMED: {
      const gate = assertFrom(draft, [ResolutionCaseState.AWAITING_AUTHORITY, ResolutionCaseState.REMEDIATING, ResolutionCaseState.VERIFYING_REMEDY], "MANDATE_CONSUMED", caseId);
      if (!gate.ok) return gate;
      draft.mandateConsumed = true;
      if (draft.state === ResolutionCaseState.AWAITING_AUTHORITY) draft.state = ResolutionCaseState.REMEDIATING;
      return ok();
    }
    case ResolutionEventType.REMEDY_EXECUTED: {
      // REMEDY_EXECUTED implies the REMEDIATING hop (the live service
      // transitions without an event for it).
      const gate = assertFrom(draft, [ResolutionCaseState.AWAITING_AUTHORITY, ResolutionCaseState.REMEDIATING, ResolutionCaseState.VERIFYING_REMEDY], "REMEDY_EXECUTED", caseId);
      if (!gate.ok) return gate;
      draft.state = ResolutionCaseState.VERIFYING_REMEDY;
      const contractId = String((event.payload as { remedyOutcomeContractId?: unknown }).remedyOutcomeContractId ?? "");
      if (contractId) draft.remedyOutcomeContractId = contractId;
      return ok();
    }
    case ResolutionEventType.REMEDY_OUTCOME_OBSERVED:
      return assertFrom(draft, [ResolutionCaseState.VERIFYING_REMEDY, ResolutionCaseState.REMEDIATING], "REMEDY_OUTCOME_OBSERVED", caseId);
    case ResolutionEventType.CASE_RESOLVED: {
      const gate = assertFrom(draft, [ResolutionCaseState.VERIFYING_REMEDY, ResolutionCaseState.REMEDIATING], "CASE_RESOLVED", caseId);
      if (!gate.ok) return gate;
      draft.state = ResolutionCaseState.RESOLVED;
      return ok();
    }
    case ResolutionEventType.VARIANCE_ACCEPTED:
      draft.state = ResolutionCaseState.RESOLVED;
      return ok();
    case ResolutionEventType.CASE_ESCALATED:
      draft.state = ResolutionCaseState.ESCALATED;
      return ok();
    default:
      return ok();
  }
}

/** Replay the append-only log; returns every case's reconstructed state. */
export function reconstructResolutionState(
  events: readonly ResolutionEvent[],
): Result<readonly ReconstructedCase[]> {
  const drafts = new Map<string, Draft>();
  const ordered = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const event of ordered) {
    const applied = applyEvent(drafts, event);
    if (!applied.ok) return applied;
  }
  return ok(
    [...drafts.entries()].map(([caseId, draft]) => ({
      caseId,
      state: draft.state,
      mandateIds: draft.mandateIds,
      mandateConsumed: draft.mandateConsumed,
      ...(draft.remedyOutcomeContractId ? { remedyOutcomeContractId: draft.remedyOutcomeContractId } : {}),
    })),
  );
}
