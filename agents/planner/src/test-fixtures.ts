import {
  CommitmentLevel,
  ConsequenceLevel,
  ConstraintCoverageStatus,
  asConstraintId,
  asPlanStepId,
  type Constraint,
} from "@truemandate/protocol";
import { deriveRequiredProofObligations } from "@truemandate/semantic-readiness";

function stepIds(...ids: string[]) {
  return ids.map((id) => asPlanStepId(id));
}

export function researchPlanOutput(constraints: readonly Constraint[]) {
  const byConcept = (name: string) =>
    constraints.find((c) => c.concept.includes(name))?.id ?? asConstraintId(name);

  const approval = byConcept("approved");
  const food = byConcept("food");
  const budget = byConcept("budget");
  const qty = byConcept("quantity");

  return {
    steps: [
      {
        id: "s-resolve-approval",
        objective: "Discover applicable supplier approval source",
        assignedAgent: "research-agent",
        requiredConstraintIds: [approval],
        requestedCapabilities: ["search", "request_evidence"],
        requiredFutureCapabilities: [],
        inputs: ["intent"],
        expectedOutput: "approval_source_candidate",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.LOW,
        commitmentLevel: CommitmentLevel.READ_ONLY,
        privileged: false,
        dependsOn: [],
        applicableConstraintIds: [approval],
        inheritedConstraintIds: [approval, food, budget, qty],
        irrelevantConstraintIds: [],
      },
      {
        id: "s-list-suppliers",
        objective: "Retrieve approved supplier list",
        assignedAgent: "research-agent",
        requiredConstraintIds: [approval],
        requestedCapabilities: ["search"],
        requiredFutureCapabilities: [],
        inputs: ["approval_source_candidate"],
        expectedOutput: "approved_supplier_list",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.LOW,
        commitmentLevel: CommitmentLevel.READ_ONLY,
        privileged: false,
        dependsOn: stepIds("s-resolve-approval"),
        applicableConstraintIds: [approval],
        inheritedConstraintIds: [approval, food, budget, qty],
        irrelevantConstraintIds: [],
      },
      {
        id: "s-verify-supplier",
        objective: "Verify candidate supplier against approval list",
        assignedAgent: "research-agent",
        requiredConstraintIds: [approval],
        requestedCapabilities: ["compare", "request_evidence"],
        requiredFutureCapabilities: ["execute_payment"],
        inputs: ["approved_supplier_list"],
        expectedOutput: "verified_supplier_candidates",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.MEDIUM,
        commitmentLevel: CommitmentLevel.READ_ONLY,
        privileged: false,
        dependsOn: stepIds("s-list-suppliers"),
        applicableConstraintIds: [approval],
        inheritedConstraintIds: [approval, food, budget, qty],
        irrelevantConstraintIds: [],
      },
    ],
    coverage: [
      {
        constraintId: approval,
        status: ConstraintCoverageStatus.PROPAGATED,
        planStepIds: stepIds("s-resolve-approval", "s-list-suppliers", "s-verify-supplier"),
      },
      {
        constraintId: food,
        status: ConstraintCoverageStatus.DEFERRED,
        planStepIds: stepIds("s-resolve-approval", "s-list-suppliers", "s-verify-supplier"),
        notes: "Still relevant; not yet enforced until economic planning",
      },
      {
        constraintId: budget,
        status: ConstraintCoverageStatus.DEFERRED,
        planStepIds: stepIds("s-resolve-approval", "s-list-suppliers", "s-verify-supplier"),
        notes: "Still relevant; deferred until economic planning",
      },
      {
        constraintId: qty,
        status: ConstraintCoverageStatus.DEFERRED,
        planStepIds: stepIds("s-resolve-approval", "s-list-suppliers", "s-verify-supplier"),
        notes: "Still relevant; deferred until offer search",
      },
    ],
    proofObligations: [],
    operationalizations: [],
    assumptionIds: [],
  };
}

export function cleanProcurementPlanOutput(
  constraints: readonly Constraint[],
  options: { readonly requiredProofObligations?: readonly import("@truemandate/protocol").ProofObligation[] } = {},
) {
  const findConstraintId = (...patterns: string[]) =>
    constraints.find((c) => patterns.some((pattern) => c.concept.includes(pattern)))?.id;
  const approval = findConstraintId("approved", "provider", "vendor", "payee", "carrier", "supplier") ?? asConstraintId("approved");
  const food = findConstraintId("food") ?? asConstraintId("food");
  const budget = findConstraintId("budget", "cost", "amount", "price", "spend") ?? asConstraintId("budget");
  const qty = findConstraintId("quantity", "traveler", "seat", "license", "fulfill", "count") ?? asConstraintId("quantity");
  const coveredCoreIds = new Set([approval, food, budget, qty]);
  const extraConstraintIds = constraints
    .map((constraint) => constraint.id)
    .filter((id) => !coveredCoreIds.has(id));

  const steps = [
    {
      id: "s1",
      objective: "Resolve or load applicable approved supplier source",
      assignedAgent: "research-agent",
      requiredConstraintIds: [approval],
      requestedCapabilities: ["search"],
      requiredFutureCapabilities: [],
      inputs: ["intent"],
      expectedOutput: "approval_source",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.LOW,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: [],
      applicableConstraintIds: [approval],
      inheritedConstraintIds: [approval],
      irrelevantConstraintIds: [],
    },
    {
      id: "s2",
      objective: "Discover candidate approved suppliers",
      assignedAgent: "supplier-search-agent",
      requiredConstraintIds: [approval],
      requestedCapabilities: ["search"],
      requiredFutureCapabilities: [],
      inputs: ["approval_source"],
      expectedOutput: "supplier_candidates",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.LOW,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s1"),
      applicableConstraintIds: [approval],
      inheritedConstraintIds: [approval],
      irrelevantConstraintIds: [],
    },
    {
      id: "s3",
      objective: "Search for 500-unit food grade compliant offers",
      assignedAgent: "catalog-agent",
      requiredConstraintIds: [qty, food, approval],
      requestedCapabilities: ["search", "compare"],
      requiredFutureCapabilities: [],
      inputs: ["supplier_candidates"],
      expectedOutput: "offers",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.MEDIUM,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s2"),
      applicableConstraintIds: [qty, food, approval],
      inheritedConstraintIds: [qty, food, approval],
      irrelevantConstraintIds: [],
    },
    {
      id: "s4",
      objective: "Obtain food-grade evidence / certification",
      assignedAgent: "evidence-agent",
      requiredConstraintIds: [food],
      requestedCapabilities: ["request_evidence"],
      requiredFutureCapabilities: [],
      inputs: ["offers"],
      expectedOutput: "food_grade_evidence",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.HIGH,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s3"),
      applicableConstraintIds: [food],
      inheritedConstraintIds: [food],
      irrelevantConstraintIds: [],
    },
    {
      id: "s5",
      objective: "Verify food_grade certification evidence",
      assignedAgent: "evidence-agent",
      requiredConstraintIds: [food],
      requestedCapabilities: ["request_evidence", "compare"],
      requiredFutureCapabilities: [],
      inputs: ["food_grade_evidence"],
      expectedOutput: "food_grade_verified",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.HIGH,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s4"),
      applicableConstraintIds: [food],
      inheritedConstraintIds: [food],
      irrelevantConstraintIds: [],
    },
    {
      id: "s6",
      objective: "Verify quantity and budget under INR 800000",
      assignedAgent: "compare-agent",
      requiredConstraintIds: [qty, budget],
      requestedCapabilities: ["compare"],
      requiredFutureCapabilities: [],
      inputs: ["offers", "food_grade_verified"],
      expectedOutput: "qty_budget_ok",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.MEDIUM,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s5"),
      applicableConstraintIds: [qty, budget],
      inheritedConstraintIds: [qty, budget],
      irrelevantConstraintIds: [],
    },
    {
      id: "s7",
      objective: "Compare compliant candidates",
      assignedAgent: "compare-agent",
      requiredConstraintIds: [food, budget, approval, qty],
      requestedCapabilities: ["compare"],
      requiredFutureCapabilities: [],
      inputs: ["qty_budget_ok"],
      expectedOutput: "ranked_candidates",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.MEDIUM,
      commitmentLevel: CommitmentLevel.READ_ONLY,
      privileged: false,
      dependsOn: stepIds("s6"),
      applicableConstraintIds: [food, budget, approval, qty, ...extraConstraintIds],
      inheritedConstraintIds: [food, budget, approval, qty, ...extraConstraintIds],
      irrelevantConstraintIds: [],
    },
    {
      id: "s8",
      objective: "Produce ActionProposal candidate",
      assignedAgent: "proposal-agent",
      requiredConstraintIds: [food, budget, approval, qty],
      requestedCapabilities: ["compare"],
      requiredFutureCapabilities: ["execute_payment"],
      inputs: ["ranked_candidates"],
      expectedOutput: "action_proposal",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.HIGH,
      commitmentLevel: CommitmentLevel.REVERSIBLE_WRITE,
      privileged: false,
      dependsOn: stepIds("s7"),
      applicableConstraintIds: [food, budget, approval, qty],
      inheritedConstraintIds: [food, budget, approval, qty],
      irrelevantConstraintIds: [],
    },
    {
      id: "s9",
      objective: "Identify future authority requirement for payment",
      assignedAgent: "authority-planner",
      requiredConstraintIds: [budget],
      requestedCapabilities: [],
      requiredFutureCapabilities: ["execute_payment"],
      inputs: ["action_proposal"],
      expectedOutput: "authority_requirement",
      assumptionIds: [],
      consequenceLevel: ConsequenceLevel.HIGH,
      commitmentLevel: CommitmentLevel.ECONOMIC,
      privileged: true,
      dependsOn: stepIds("s8"),
      applicableConstraintIds: [budget, food, approval, qty, ...extraConstraintIds],
      inheritedConstraintIds: [budget, food, approval, qty, ...extraConstraintIds],
      irrelevantConstraintIds: [],
    },
  ];

  const coverage = [
    {
      constraintId: approval,
      status: ConstraintCoverageStatus.VERIFIED,
      planStepIds: stepIds("s1", "s2", "s3", "s7", "s8"),
    },
    {
      constraintId: food,
      status: ConstraintCoverageStatus.ENFORCED,
      planStepIds: stepIds("s3", "s4", "s5", "s7", "s8", "s9"),
    },
    {
      constraintId: budget,
      status: ConstraintCoverageStatus.VERIFIED,
      planStepIds: stepIds("s6", "s7", "s8", "s9"),
    },
    {
      constraintId: qty,
      status: ConstraintCoverageStatus.PROPAGATED,
      planStepIds: stepIds("s3", "s6", "s7", "s8"),
    },
    ...constraints
      .filter((constraint) => !coveredCoreIds.has(constraint.id))
      .map((constraint) => ({
        constraintId: constraint.id,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("s6", "s7", "s8", "s9"),
      })),
  ];

  return {
    steps,
    coverage,
    // Required obligations are derived deterministically from the authoritative
    // constraints (production contract); the plan binds only the satisfying
    // planStepId for each. The planner model payload supplies the exact derived
    // set; the fallback derivation covers direct fixture use.
    proofObligations: (options.requiredProofObligations ?? deriveRequiredProofObligations(constraints)).map((obligation) => {
      const concept = obligation.constraintId
        ? constraints.find((c) => c.id === obligation.constraintId)?.concept ?? ""
        : "";
      const step = concept.includes("approved") ? "s2"
        : concept.includes("food") ? "s5"
        : concept.includes("budget") ? "s6"
        : "s6";
      return { ...obligation, planStepId: asPlanStepId(step) };
    }),
    operationalizations: [],
    assumptionIds: [],
  };
}

export function cleanTravelPlanOutput(
  constraints: readonly Constraint[],
  options: { readonly requiredProofObligations?: readonly import("@truemandate/protocol").ProofObligation[] } = {},
) {
  const findConstraintId = (...patterns: string[]) =>
    constraints.find((c) => patterns.some((pattern) => c.concept.includes(pattern)))?.id;
  const provider = findConstraintId("approved_provider", "provider", "vendor", "merchant") ?? asConstraintId("approved_provider");
  const property = findConstraintId("lodging", "hotel", "property") ?? asConstraintId("lodging");
  const dates = findConstraintId("travel_date", "check_in", "check_out", "stay_date") ?? asConstraintId("travel_date");
  const travelers = findConstraintId("traveler", "stay_count", "quantity", "count") ?? asConstraintId("traveler_count");
  const refundability = findConstraintId("refund") ?? asConstraintId("refundability");
  const budget = findConstraintId("budget", "cost", "amount", "price", "spend") ?? asConstraintId("travel_budget");
  const coveredCoreIds = new Set([provider, property, dates, travelers, refundability, budget]);
  const extraConstraintIds = constraints
    .map((constraint) => constraint.id)
    .filter((id) => !coveredCoreIds.has(id));

  return {
    steps: [
      {
        id: "t1",
        objective: "Verify approved travel provider and eligible lodging offer",
        assignedAgent: "travel-search-agent",
        requiredConstraintIds: [provider, property],
        requestedCapabilities: ["search", "compare"],
        requiredFutureCapabilities: [],
        inputs: ["intent"],
        expectedOutput: "verified_travel_offer",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.MEDIUM,
        commitmentLevel: CommitmentLevel.READ_ONLY,
        privileged: false,
        dependsOn: [],
        applicableConstraintIds: [provider, property, dates, budget],
        inheritedConstraintIds: [provider, property, dates, travelers, refundability, budget, ...extraConstraintIds],
        irrelevantConstraintIds: [],
      },
      {
        id: "t2",
        objective: "Bind travel evidence for traveler count, refundability, dates, and price",
        assignedAgent: "evidence-agent",
        requiredConstraintIds: [travelers, refundability, dates, budget],
        requestedCapabilities: ["request_evidence", "compare"],
        requiredFutureCapabilities: [],
        inputs: ["verified_travel_offer"],
        expectedOutput: "travel_constraints_bound",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.HIGH,
        commitmentLevel: CommitmentLevel.READ_ONLY,
        privileged: false,
        dependsOn: stepIds("t1"),
        applicableConstraintIds: [travelers, refundability, dates, budget, ...extraConstraintIds],
        inheritedConstraintIds: [provider, property, dates, travelers, refundability, budget, ...extraConstraintIds],
        irrelevantConstraintIds: [],
      },
      {
        id: "t3",
        objective: "Book selected travel option under the authoritative travel constraints",
        assignedAgent: "travel-booking-agent",
        requiredConstraintIds: [provider, property, dates, travelers, refundability, budget],
        requestedCapabilities: ["book_travel"],
        requiredFutureCapabilities: ["book_travel"],
        inputs: ["travel_constraints_bound"],
        expectedOutput: "travel_booking_confirmation",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.HIGH,
        commitmentLevel: CommitmentLevel.ECONOMIC,
        privileged: true,
        dependsOn: stepIds("t2"),
        applicableConstraintIds: [provider, property, dates, travelers, refundability, budget, ...extraConstraintIds],
        inheritedConstraintIds: [provider, property, dates, travelers, refundability, budget, ...extraConstraintIds],
        irrelevantConstraintIds: [],
      },
      {
        id: "t4",
        objective: "Verify booked travel outcome against the authoritative itinerary",
        assignedAgent: "travel-verifier-agent",
        requiredConstraintIds: [provider, property, dates, travelers],
        requestedCapabilities: ["compare"],
        requiredFutureCapabilities: [],
        inputs: ["travel_booking_confirmation"],
        expectedOutput: "verified_travel_booking",
        assumptionIds: [],
        consequenceLevel: ConsequenceLevel.HIGH,
        commitmentLevel: CommitmentLevel.REVERSIBLE_WRITE,
        privileged: false,
        dependsOn: stepIds("t3"),
        applicableConstraintIds: [provider, property, dates, travelers],
        inheritedConstraintIds: [provider, property, dates, travelers, refundability, budget],
        irrelevantConstraintIds: [],
      },
    ],
    coverage: [
      {
        constraintId: provider,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("t1", "t3", "t4"),
      },
      {
        constraintId: property,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("t1", "t3", "t4"),
      },
      {
        constraintId: dates,
        status: ConstraintCoverageStatus.ENFORCED,
        planStepIds: stepIds("t1", "t2", "t3", "t4"),
      },
      {
        constraintId: travelers,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("t2", "t3", "t4"),
      },
      {
        constraintId: refundability,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("t2", "t3"),
      },
      {
        constraintId: budget,
        status: ConstraintCoverageStatus.VERIFIED,
        planStepIds: stepIds("t1", "t2", "t3"),
      },
      ...constraints
        .filter((constraint) => !coveredCoreIds.has(constraint.id))
        .map((constraint) => ({
          constraintId: constraint.id,
          status: ConstraintCoverageStatus.VERIFIED,
          planStepIds: stepIds("t2", "t3"),
        })),
    ],
    proofObligations: (options.requiredProofObligations ?? deriveRequiredProofObligations(constraints)).map((obligation) => {
      const concept = obligation.constraintId
        ? constraints.find((c) => c.id === obligation.constraintId)?.concept ?? ""
        : "";
      const step = /approved|provider|vendor|merchant/.test(concept) ? "t1"
        : /lodging|hotel|property/.test(concept) ? "t1"
        : /travel_date|check_in|check_out|stay_date|date/.test(concept) ? "t2"
        : /traveler|quantity|count/.test(concept) ? "t2"
        : /refund/.test(concept) ? "t2"
        : /budget|cost|amount|price|spend/.test(concept) ? "t2"
        : "t2";
      return { ...obligation, planStepId: asPlanStepId(step) };
    }),
    operationalizations: [],
    assumptionIds: [],
  };
}

export function omitFoodGradePlan(constraints: readonly Constraint[]) {
  const base = cleanProcurementPlanOutput(constraints);
  return {
    ...base,
    steps: base.steps.map((s) => ({
      ...s,
      requiredConstraintIds: s.requiredConstraintIds.filter(
        (id) => !String(id).includes("food") && !constraints.find((c) => c.id === id)?.concept.includes("food"),
      ),
      applicableConstraintIds: [],
      inheritedConstraintIds: [],
      objective: s.objective.replace(/food grade/gi, "containers"),
    })),
    coverage: base.coverage.map((c) =>
      constraints.find((x) => x.id === c.constraintId)?.concept.includes("food")
        ? { ...c, status: ConstraintCoverageStatus.MISSING, planStepIds: [] }
        : c,
    ),
    proofObligations: base.proofObligations.filter(
      (p) => !constraints.find((c) => c.id === p.constraintId)?.concept.includes("food"),
    ),
  };
}

export function industrialPlan(constraints: readonly Constraint[]) {
  const base = cleanProcurementPlanOutput(constraints);
  return {
    ...base,
    steps: base.steps.map((s) =>
      s.id === "s3"
        ? {
            ...s,
            objective: "Search for affordable industrial containers",
            expectedOutput: "industrial_offers",
          }
        : s,
    ),
  };
}

export function missingApprovalPlan(constraints: readonly Constraint[]) {
  const base = cleanProcurementPlanOutput(constraints);
  return {
    ...base,
    steps: base.steps.filter((s) => s.id !== "s1" && s.id !== "s2"),
    coverage: base.coverage.map((c) =>
      constraints.find((x) => x.id === c.constraintId)?.concept.includes("approved")
        ? { ...c, status: ConstraintCoverageStatus.MISSING, planStepIds: [] }
        : c,
    ),
  };
}

export function missingBudgetPlan(constraints: readonly Constraint[]) {
  const base = cleanProcurementPlanOutput(constraints);
  return {
    ...base,
    steps: base.steps.filter((s) => s.id !== "s6"),
    coverage: base.coverage.map((c) =>
      constraints.find((x) => x.id === c.constraintId)?.concept.includes("budget")
        ? { ...c, status: ConstraintCoverageStatus.MISSING, planStepIds: [] }
        : c,
    ),
  };
}

export function aroundBudgetPlan(constraints: readonly Constraint[]) {
  const base = cleanProcurementPlanOutput(constraints);
  return {
    ...base,
    steps: base.steps.map((s) =>
      s.id === "s6"
        ? {
            ...s,
            objective: "Verify quantity and budget around INR 800000",
            expectedOutput: "approx_budget_ok",
          }
        : s,
    ),
  };
}

export function acceptPlanVerifier() {
  return { findings: [], criticalFailure: false };
}
