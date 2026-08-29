import { describe, expect, it } from "vitest";
import {
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  SourceType,
  type ActionProposal,
  type Constraint,
  type IntentState,
} from "@truemandate/protocol";
import { evaluateActionChecks, type ActionFidelityCheck } from "./action-fidelity.js";
import type {
  ActionProposalContext,
  DomainActionFields,
  DomainPlanningDescriptor,
} from "./domain-pack.js";
import { ProcurementDomainPack, type ProcurementInput } from "./procurement-domain-pack.js";

const NOW = "2026-08-29T00:00:00.000Z";

function constraint(id: string, concept: string, operator: ConstraintOperator, value: unknown): Constraint {
  return {
    id,
    concept,
    operator,
    value,
    kind: ConstraintKind.HARD,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
  } as unknown as Constraint;
}

function intentState(constraints: readonly Constraint[]): IntentState {
  return {
    id: "state-test-1",
    intentId: "intent-test-1",
    rawIntentHash: "hash-raw-test-1",
    version: 1,
    constraints,
    assumptions: [],
    createdAt: NOW,
    createdBy: "principal-test-1",
    stateHash: "hash-state-test-1",
  } as unknown as IntentState;
}

describe("evaluateActionChecks — fail-closed silent-drop rule", () => {
  const planning = {
    conceptFamilies: [{ canonicalConcept: "widget", aliases: ["widget"] }],
  } as unknown as DomainPlanningDescriptor;

  const widgetCheck: ActionFidelityCheck = {
    canonicalConcept: "widget",
    field: "action.quantity",
    actualValue: 7,
  };

  it("gives an unresolved required constraint an explicit UNKNOWN row and flips preservesIntent false", () => {
    const state = intentState([
      constraint("c-widget", "widget", ConstraintOperator.EQ, 7),
      constraint("c-mystery", "totally_unknown_concept_xyz", ConstraintOperator.REQUIRE, true),
    ]);

    const result = evaluateActionChecks(state, planning, [widgetCheck]);

    const widgetRow = result.rows.find((row) => row.constraintId === "c-widget");
    const mysteryRow = result.rows.find((row) => row.constraintId === "c-mystery");
    expect(widgetRow?.status).toBe("MATCH");
    expect(mysteryRow).toBeDefined();
    expect(mysteryRow?.status).toBe("UNKNOWN");
    expect(mysteryRow?.reason).toBe(
      "Constraint concept does not resolve to any canonical concept in this domain's ontology",
    );
    // The silent-drop danger is precisely this: one unresolved required
    // constraint must be enough to flip preservesIntent, even though every
    // other constraint is satisfied.
    expect(result.preservesIntent).toBe(false);
  });

  it("does not flag a concept the check list enumerates but this state never asserts", () => {
    const state = intentState([constraint("c-widget", "widget", ConstraintOperator.EQ, 7)]);
    const checks: ActionFidelityCheck[] = [
      widgetCheck,
      { canonicalConcept: "gadget", field: "action.other", actualValue: undefined },
    ];

    const result = evaluateActionChecks(state, planning, checks);

    // A compiled state legitimately omits many canonical concepts a domain
    // pack's check list enumerates. Only a constraint that is present and
    // unresolvable is fail-closed — not every check with zero matches.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.status).toBe("MATCH");
    expect(result.preservesIntent).toBe(true);
  });
});

describe("ProcurementDomainPack.evaluateActionFidelity — five canonical constraints", () => {
  const input: ProcurementInput = {
    intentId: "intent-test-1",
    idempotencyKey: "idem-test-1",
    capability: "execute_payment",
    supplier: { id: "supplier-1", name: "Acme Corp", approved: true },
    item: { specification: "food-grade containers" },
    quantity: 500,
    totalAmount: 742000,
    currency: "INR",
    delivery: { deadline: "2026-12-15T00:00:00.000Z" },
    parameters: {},
    consequenceLevel: "HIGH",
    evidenceIds: [],
  };

  const ctx: ActionProposalContext = {
    workflowId: "wf-test-1",
    intentId: "intent-test-1",
    intentStateId: "state-test-1",
    createdAt: NOW,
    offerNodeId: "offer-test-1",
  };

  function toActionProposal(fields: DomainActionFields): ActionProposal {
    return {
      id: "action-test-1",
      intentId: "intent-test-1",
      intentStateId: "state-test-1",
      agentId: "agent-test-1",
      createdAt: NOW,
      ...fields,
    } as unknown as ActionProposal;
  }

  // The five canonical concepts a domain-aware compilation of the Part 8
  // scenario ("500 food-grade containers from an approved supplier, under
  // 800000, delivered before 2026-12-31") persists — quantity EQ 500,
  // material REQUIRE "food-grade containers", supplier REQUIRE "approved
  // supplier", budget LT 800000, delivery_deadline LT 2026-12-31.
  const canonicalConstraints = [
    constraint("c-quantity", "quantity", ConstraintOperator.EQ, 500),
    constraint("c-material", "material", ConstraintOperator.REQUIRE, "food-grade containers"),
    constraint("c-supplier", "supplier", ConstraintOperator.REQUIRE, "approved supplier"),
    constraint("c-budget", "budget", ConstraintOperator.LT, 800000),
    constraint("c-deadline", "delivery_deadline", ConstraintOperator.LT, "2026-12-31T00:00:00.000Z"),
  ];

  it("gives all five canonical concepts a row, all MATCH, for a legitimate control action", () => {
    const state = intentState(canonicalConstraints);
    const action = toActionProposal(ProcurementDomainPack.buildActionProposal(input, ctx));

    const result = ProcurementDomainPack.evaluateActionFidelity(input, state, action);

    const concepts = result.rows.map((row) => row.canonicalConcept).sort();
    expect(concepts).toEqual(["budget", "delivery_deadline", "material", "quantity", "supplier"]);
    for (const row of result.rows) {
      expect(row.status).toBe("MATCH");
    }
    expect(result.preservesIntent).toBe(true);
  });

  it("mismatches only the tampered concept when the action is mutated after compilation", () => {
    const state = intentState(canonicalConstraints);
    const legitimateAction = ProcurementDomainPack.buildActionProposal(input, ctx);
    // Same action the verified intent authorized, except quantity is
    // silently reduced post-verification — the QUANTITY_REDUCTION pattern.
    const mutatedAction = toActionProposal({ ...legitimateAction, quantity: 450 });

    const result = ProcurementDomainPack.evaluateActionFidelity(input, state, mutatedAction);

    const byConcept = new Map(result.rows.map((row) => [row.canonicalConcept, row]));
    expect(byConcept.get("quantity")?.status).toBe("MISMATCH");
    expect(byConcept.get("material")?.status).toBe("MATCH");
    expect(byConcept.get("supplier")?.status).toBe("MATCH");
    expect(byConcept.get("budget")?.status).toBe("MATCH");
    expect(byConcept.get("delivery_deadline")?.status).toBe("MATCH");
    expect(result.preservesIntent).toBe(false);
  });
});
