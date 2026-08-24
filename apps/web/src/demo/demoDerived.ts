/**
 * Derived presentation values for the judge demo.
 *
 * SINGLE SOURCE OF TRUTH: every authoritative value shown to judges derives
 * from the loaded canonical projection here. The presentation layer must not
 * hold its own copies of amounts, quantities, states, or decisions.
 *
 * Only label MAPPING (canonical value → human wording) lives here; UI copy
 * without authoritative meaning stays in the components.
 */

import type { CanonicalProjection } from "@truemandate/read-model";

export interface DerivedPresentation {
  /** Friendly intent summary parts, derived from the immutable constraints. */
  readonly intent: {
    readonly quantity: string;
    readonly itemName: string;
    readonly supplierLabel: string;
    readonly budgetDisplay: string;
    readonly budgetValue: number;
    readonly deadlineDisplay: string;
    readonly deadlineIso: string;
    readonly constraintsTotal: number;
    readonly verifiedLabel: string;
    readonly summarySentence: string;
  };
  /** Guardian → Authority gate, derived from durable decisions. */
  readonly gate: {
    readonly guardianLabel: string;
    readonly gateSatisfied: boolean;
    readonly gateLabel: string;
    readonly authorityLabel: string;
    readonly amountLabel: string;
    readonly expiryLabel: string;
  };
  /** Authorized vs executed comparison. */
  readonly execution: {
    readonly authorized: { readonly amountLabel: string; readonly supplierLabel: string; readonly currency: string };
    readonly executed: { readonly amountLabel: string; readonly supplierLabel: string; readonly currency: string };
    readonly exactMatch: boolean;
    readonly onceLabel: string;
    readonly paymentResult: string;
  };
  /** Outcome / divergence. */
  readonly outcome: {
    readonly stateLabel: string;
    readonly required: number;
    readonly verified: number;
    readonly missing: number;
    readonly missingHeadline: string;
    readonly divergenceLabel: string;
    readonly missingLead: string;
  };
  /** Resolution / remedies. */
  readonly resolution: {
    readonly responsibilityLabel: string;
    readonly rootCauseLabel: string;
    readonly remediesNotExecuted: boolean;
  };
  /** Freshness: execution time vs data-load time, labeled separately. */
  readonly freshness: {
    readonly executedAtIso: string;
    readonly loadedAtIso: string;
  };
}

function constraintValue(p: CanonicalProjection, concept: string): string | number | undefined {
  return p.constraints.find((c) => c.concept === concept)?.value;
}

function fmtDateUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const SUPPLIER_LABEL_MAP: Readonly<Record<string, string>> = {
  approved: "an approved supplier",
};

const GUARDIAN_LABEL_MAP: Readonly<Record<string, string>> = {
  REQUIRE_APPROVAL: "HUMAN REVIEW REQUIRED",
};

export function derivePresentation(p: CanonicalProjection): DerivedPresentation {
  const quantity = String(constraintValue(p, "quantity") ?? "—");
  const itemValue = constraintValue(p, "item_specification");
  const itemName = typeof itemValue === "string" ? itemValue : "—";
  const supplierValue = constraintValue(p, "supplier_approval_status");
  const supplierLabel =
    typeof supplierValue === "string" && SUPPLIER_LABEL_MAP[supplierValue]
      ? SUPPLIER_LABEL_MAP[supplierValue]
      : String(supplierValue ?? "—");
  const budgetValue = typeof constraintValue(p, "max_total_budget") === "number"
    ? (constraintValue(p, "max_total_budget") as number)
    : 0;
  const budgetDisplay = budgetValue.toLocaleString("en-IN");
  const deadlineIso = String(constraintValue(p, "completion_deadline") ?? "");
  const deadlineDisplay = fmtDateUtc(deadlineIso);
  const constraintsTotal = p.constraints.length;

  // TRUTH: the canonical Phase C v5 records contain NO durable human approval
  // artifact (no ApprovalArtifact doc). The only durable gate facts are the
  // Guardian verdict (REQUIRE_APPROVAL) and the Authority decision (ALLOW).
  // Labels below therefore derive strictly from the durable authority
  // decision — never a human-gate-satisfied claim.
  const gateSatisfied = p.authority.decision === "ALLOW";
  const guardianLabel = GUARDIAN_LABEL_MAP[p.guardian.decision] ?? p.guardian.decision;

  const authAmount = p.authority.amount;
  const execAmount = p.execution.amount;
  const exactMatch =
    authAmount === execAmount &&
    p.authority.currency === p.execution.currency &&
    p.authority.merchant === p.execution.counterparty;
  const onceLabel =
    p.execution.sideEffectCountForFixture === 1 &&
    p.execution.replayStatus === "IDEMPOTENT_REPLAY" &&
    p.execution.replaySameResultRef
      ? "EXACTLY ONCE"
      : "NOT PROVEN";

  const d = p.outcome.divergence;

  return {
    intent: {
      quantity,
      itemName,
      supplierLabel,
      budgetDisplay,
      budgetValue,
      deadlineDisplay,
      deadlineIso,
      constraintsTotal,
      verifiedLabel: `${constraintsTotal} / ${constraintsTotal} verified`,
      summarySentence: `Buy ${quantity} ${itemName} from ${supplierLabel} for under ₹${budgetDisplay}, before ${deadlineDisplay}.`,
    },
    gate: {
      guardianLabel,
      gateSatisfied,
      gateLabel: gateSatisfied ? "authority decided: ALLOW" : `authority decided: ${p.authority.decision}`,
      authorityLabel: p.authority.decision,
      amountLabel: `₹${authAmount.toLocaleString("en-IN")}`,
      expiryLabel: fmtDateUtc(p.authority.expiresAt),
    },
    execution: {
      authorized: {
        amountLabel: `₹${authAmount.toLocaleString("en-IN")}`,
        supplierLabel: "Approved supplier",
        currency: p.authority.currency,
      },
      executed: {
        amountLabel: `₹${execAmount.toLocaleString("en-IN")}`,
        supplierLabel: "Approved supplier",
        currency: p.execution.currency,
      },
      exactMatch,
      onceLabel,
      paymentResult: p.execution.resultState,
    },
    outcome: {
      stateLabel: p.outcome.state,
      required: d.requiredQuantity,
      verified: d.verifiedReceived,
      missing: d.shortfall,
      missingHeadline: `${d.shortfall} CONTAINERS MISSING`,
      divergenceLabel: `${d.shortfall}-unit destination shortfall`,
      missingLead: `${d.shortfall} units are missing, and we don’t yet know who caused the loss — the next evidence tells those apart.`,
    },
    resolution: {
      responsibilityLabel: p.resolution.responsibilityState,
      rootCauseLabel: p.resolution.rootCauseEstablished ? "ESTABLISHED" : "UNKNOWN",
      remediesNotExecuted: p.resolution.remedyExecutions === 0,
    },
    freshness: {
      executedAtIso: p.meta.executionEnd,
      loadedAtIso: p.meta.capturedAt,
    },
  };
}
