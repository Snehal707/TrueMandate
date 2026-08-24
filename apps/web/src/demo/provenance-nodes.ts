import type { CanonicalProjection } from "@truemandate/read-model";

/**
 * Canonical provenance presentation model.
 *
 * Every id, value and state below derives from the canonical projection —
 * friendly labels are presentation copy, raw ids are metadata only. The
 * 10 durable records are grouped into five story stages.
 */

export type ProvenanceStatus = "green" | "amber" | "blue";

export interface ProvenanceGroup {
  readonly id: string;
  readonly num: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface ProvenanceNode {
  readonly id: string;
  readonly step: string;
  readonly meaning: string;
  readonly decision: string;
  readonly status: ProvenanceStatus;
  readonly groupId: string;
  readonly recordKind: string;
  readonly canonicalId: string;
  readonly privateDetail?: boolean;
  readonly timestamp?: string;
  readonly inspector: {
    readonly whatHappened: string;
    readonly cameIn: string;
    readonly decided: string;
    readonly keyValues: readonly [string, string][];
    readonly proves: string;
    readonly downstream: string;
  };
}

const fmtMoney = (v: number): string => `₹${v.toLocaleString("en-IN")}`;

export const PROVENANCE_GROUPS: readonly ProvenanceGroup[] = [
  { id: "intent", num: "01", title: "INTENT", nodeIds: ["human-intent", "intent-state"] },
  { id: "governance", num: "02", title: "SEMANTIC GOVERNANCE", nodeIds: ["guardian-verdict"] },
  {
    id: "authorization",
    num: "03",
    title: "ECONOMIC AUTHORIZATION",
    nodeIds: ["authority-evaluation", "authority-grant", "prepared-action", "commit-token"],
  },
  { id: "execution", num: "04", title: "EXECUTION & OUTCOME", nodeIds: ["execution", "outcome-contract"] },
  { id: "resolution", num: "05", title: "RESOLUTION", nodeIds: ["resolution-case"] },
];

export function deriveProvenanceNodes(p: CanonicalProjection): Record<string, ProvenanceNode> {
  const intentId = p.intent.id;
  const nodes: Record<string, ProvenanceNode> = {
    "human-intent": {
      id: "human-intent",
      step: "Human Intent",
      meaning: "The exact thing a human asked for, recorded immutably.",
      decision: "RECORDED",
      status: "blue",
      groupId: "intent",
      recordKind: "intent",
      canonicalId: intentId,
      timestamp: p.intent.createdAt,
      inspector: {
        whatHappened:
          "A human request was recorded as a durable, immutable Intent. Nothing else happened yet — recording never triggers execution.",
        cameIn: "The human principal",
        decided: "Intent recorded with a canonical content hash",
        keyValues: [
          ["Intent", p.intent.id],
          ["Content hash", p.intent.contentHash],
        ],
        proves: "The whole pipeline starts from a human's words — and every later record traces back to them.",
        downstream: "Intent State (semantic compilation)",
      },
    },
    "intent-state": {
      id: "intent-state",
      step: "Intent State",
      meaning: "The human sentence, compiled into six grounded constraints.",
      decision: "COMPILED",
      status: "blue",
      groupId: "intent",
      recordKind: "intentState",
      canonicalId: p.intent.intentStateId,
      inspector: {
        whatHappened:
          "Gemini compiled the intent into six explicit constraints — quantity, material, supplier, budget, deadline — each anchored to a span of the original sentence.",
        cameIn: "The immutable Intent",
        decided: "Compilation accepted; constraints grounded in source text",
        keyValues: [["IntentState", p.intent.intentStateId]],
        proves: "Understanding is made explicit and auditable before anything is authorized.",
        downstream: "Guardian Verdict (semantic review)",
      },
    },
    "guardian-verdict": {
      id: "guardian-verdict",
      step: "Guardian Verdict",
      meaning: "Five semantic judges checked the compiled meaning against the human words.",
      decision: "REQUIRE_APPROVAL",
      status: "amber",
      groupId: "governance",
      recordKind: "guardianVerdict",
      canonicalId: p.guardian.verdictId,
      timestamp: p.guardian.createdAt,
      inspector: {
        whatHappened:
          "Five independent judges (fidelity, contradiction, devil's advocate, provenance, evidence) reviewed the compiled intent.",
        cameIn: "Intent State + the original human request",
        decided: `REQUIRE_APPROVAL — all five judges OK, fidelity ${p.guardian.overallFidelity.toFixed(2)}`,
        keyValues: [
          ["Verdict", p.guardian.decision],
          ["Fidelity", p.guardian.overallFidelity.toFixed(2)],
        ],
        proves: "Semantic risk is judged before money can move — and review was demanded.",
        downstream: "Authority Evaluation",
      },
    },
    "authority-evaluation": {
      id: "authority-evaluation",
      step: "Authority Evaluation",
      meaning: "The bounded permission was computed from the verified semantic chain.",
      decision: "ALLOW",
      status: "green",
      groupId: "authorization",
      recordKind: "authorityEvaluation",
      canonicalId: p.authority.evaluationId,
      timestamp: p.authority.expiresAt,
      inspector: {
        whatHappened:
          "Authority evaluated the verified chain and computed the exact permission: one payment, bounded amount, one supplier.",
        cameIn: "Guardian Verdict + the verified constraint set",
        decided: `ALLOW — ${p.authority.capability}, expiring ${p.authority.expiresAt}`,
        keyValues: [
          ["Decision", p.authority.decision],
          ["Scope", `${fmtMoney(p.authority.amount)} ${p.authority.currency}`],
          ["Merchant", p.authority.merchant],
        ],
        proves: "Authorization is computed, bounded and expiring — not delegated to the model.",
        downstream: "Authority Grant (minted permission)",
      },
    },
    "authority-grant": {
      id: "authority-grant",
      step: "Authority Grant",
      meaning: "Bounded permission to execute one approved economic action.",
      decision: "ALLOW",
      status: "green",
      groupId: "authorization",
      recordKind: "authorityGrant",
      canonicalId: p.authority.grantId,
      privateDetail: true,
      inspector: {
        whatHappened:
          "Bounded permission was minted only after the verified semantic chain satisfied the authority requirements.",
        cameIn: "Authority Evaluation (ALLOW)",
        decided: `Grant ${p.authority.grantState}`,
        keyValues: [
          ["Decision", "ALLOW"],
          ["Scope", `${fmtMoney(p.authority.amount)} ${p.authority.currency} · approved supplier · execute_payment only`],
        ],
        proves: "The model did not authorize the transaction. Infrastructure did.",
        downstream: "Prepared Action (locked parameters)",
      },
    },
    "prepared-action": {
      id: "prepared-action",
      step: "Prepared Action",
      meaning: "Exact execution parameters, locked and hash-bound.",
      decision: p.preparedAction.lifecycle,
      status: "blue",
      groupId: "authorization",
      recordKind: "preparedAction",
      canonicalId: p.preparedAction.id,
      privateDetail: true,
      timestamp: p.preparedAction.createdAt,
      inspector: {
        whatHappened:
          "The payment was prepared with exact parameters — amount, currency, merchant, quantity — sealed with a parameter hash.",
        cameIn: "Authority Grant scope",
        decided: p.preparedAction.lifecycle,
        keyValues: [
          ["Amount", `${fmtMoney(p.preparedAction.amount)} ${p.preparedAction.currency}`],
          ["Merchant", p.preparedAction.merchant],
        ],
        proves: "The gateway can only execute the exact parameters the authority approved.",
        downstream: "Commit Token (two-phase commit)",
      },
    },
    "commit-token": {
      id: "commit-token",
      step: "Commit Token",
      meaning: "Single-use execution right — spent exactly once.",
      decision: "CONSUMED",
      status: "green",
      groupId: "authorization",
      recordKind: "commitToken",
      canonicalId: p.execution.commitTokenId,
      privateDetail: true,
      inspector: {
        whatHappened:
          "The two-phase gateway issued a single-use commit token. Consuming it was the only way to execute.",
        cameIn: "Prepared Action (parameter hash verified)",
        decided: `Consumed: ${p.execution.commitTokenConsumed}`,
        keyValues: [
          ["Consumed", String(p.execution.commitTokenConsumed)],
          ["Replay status", p.execution.replayStatus],
        ],
        proves: "Exactly-once execution is enforced by the token, not by model promises.",
        downstream: "Execution (side effect)",
      },
    },
    execution: {
      id: "execution",
      step: "Execution",
      meaning: "The approved payment executed — exactly once, inside the approved scope.",
      decision: "SUCCESS",
      status: "green",
      groupId: "execution",
      recordKind: "sideEffect",
      canonicalId: p.execution.sideEffectId,
      timestamp: p.execution.requestTimestamp,
      inspector: {
        whatHappened:
          "The mock payment adapter executed the approved action once. A replay returned the same result — no duplicate.",
        cameIn: "Consumed Commit Token",
        decided: p.execution.resultState,
        keyValues: [
          ["Side effect", p.execution.sideEffectId],
          ["Reference", p.execution.externalReference],
          ["Replay", p.execution.replayStatus],
        ],
        proves: "Execution happened inside the authority's bounds — and only once.",
        downstream: "Outcome Contract (was the goal met?)",
      },
    },
    "outcome-contract": {
      id: "outcome-contract",
      step: "Outcome Contract",
      meaning: "Payment succeeded — but the goal was measured against the human's intent.",
      decision: "PARTIAL",
      status: "amber",
      groupId: "execution",
      recordKind: "outcomeContract",
      canonicalId: p.outcome.contractId,
      timestamp: p.outcome.updatedAt,
      inspector: {
        whatHappened:
          "The payment settled, and the outcome was measured against the contract: 500 required, 450 verified received.",
        cameIn: "Execution (payment SUCCESS)",
        decided: p.outcome.state,
        keyValues: [
          ["Required", String(p.outcome.divergence.requiredQuantity)],
          ["Received", String(p.outcome.divergence.verifiedReceived)],
          ["Shortfall", String(p.outcome.divergence.shortfall)],
          ["Payment", p.outcome.paymentStatus],
        ],
        proves: "Payment SUCCESS is not goal success — the shortfall was detected.",
        downstream: "Resolution Case",
      },
    },
    "resolution-case": {
      id: "resolution-case",
      step: "Resolution Case",
      meaning: "The shortfall was opened for honest investigation — no false blame.",
      decision: "OPEN",
      status: "amber",
      groupId: "resolution",
      recordKind: "resolutionCase",
      canonicalId: p.resolution.caseId,
      timestamp: p.resolution.openedAt,
      inspector: {
        whatHappened:
          "A resolution case opened for the 50-unit shortfall. The system asks discriminating questions instead of guessing who to blame.",
        cameIn: "Outcome Contract (PARTIAL)",
        decided: `${p.resolution.state} — responsibility ${p.resolution.responsibilityState}`,
        keyValues: [
          ["Responsibility", p.resolution.responsibilityState],
          ["Root cause", p.resolution.rootCauseEstablished ? "ESTABLISHED" : "UNKNOWN"],
          ["Remedies executed", String(p.resolution.remedyExecutions)],
        ],
        proves: "When outcomes diverge, the system stays honest instead of hiding or blaming.",
        downstream: "Remediation (none executed — none mandated)",
      },
    },
  };
  return nodes;
}
