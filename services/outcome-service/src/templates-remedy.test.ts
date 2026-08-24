import { ConstraintKind, ConstraintOperator, ConstraintMutability, MeaningClass, SourceType, asConstraintId } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { buildProcurementRequirements } from "./templates.js";

function constraint(
  concept: string,
  value: unknown,
  kind: ConstraintKind = ConstraintKind.HARD,
) {
  return {
    id: asConstraintId(`c-${concept}`),
    concept,
    operator: ConstraintOperator.EQ,
    value,
    kind,
    importance: 1,
    confidence: 1,
    sourceType: SourceType.HUMAN,
    sourceText: concept,
    mutability: ConstraintMutability.IMMUTABLE,
    meaningClass: MeaningClass.EXPLICIT,
  };
}

describe("Wave 1 remedy-safe procurement requirements", () => {
  it("does not re-emit original quantity/supplier constraints that poison remedy OCs", () => {
    const reqs = buildProcurementRequirements(
      [
        constraint("quantity", 500),
        constraint("item_quantity", 500),
        constraint("supplier_name", "Wave1 Supplier"),
        constraint("supplier_selection", "Wave1 Supplier"),
        constraint("food_grade_compliance", true, ConstraintKind.SAFETY_CRITICAL),
        constraint("food_grade_containers", "food-grade containers", ConstraintKind.SAFETY_CRITICAL),
      ],
      {
        quantity: 50,
        budgetMax: 6000,
        merchant: "remedy-counterparty",
        product: "remedy",
      },
    );
    const concepts = reqs.map((r) => r.concept);
    expect(concepts).toContain("supplier_approved");
    expect(concepts).toContain("quantity_received");
    expect(concepts).toContain("price_within");
    expect(concepts).toContain("product_matches");
    expect(concepts).toContain("food_grade");
    expect(concepts.filter((c) => c === "food_grade")).toHaveLength(1);
    expect(concepts).not.toContain("item_quantity");
    expect(concepts).not.toContain("supplier_name");
    expect(concepts).not.toContain("supplier_selection");
    expect(concepts).not.toContain("food_grade_containers");
    expect(concepts).not.toContain("item_specification");
    expect(concepts).not.toContain("product_specification");
    expect(concepts).not.toContain("supplier_identity");
    expect(reqs.find((r) => r.concept === "quantity_received")?.value).toBe(50);
    expect(reqs.find((r) => r.concept === "supplier_approved")?.value).toBe("remedy-counterparty");
  });

  it("keeps item_specification on original purchases without an explicit commercial product override", () => {
    const reqs = buildProcurementRequirements(
      [
        constraint("item_specification", "food-grade containers"),
        constraint("product_specification", "food-grade containers"),
      ],
      { quantity: 500, budgetMax: 800000, merchant: "Wave1 Supplier" },
    );
    const concepts = reqs.map((r) => r.concept);
    expect(concepts).toContain("item_specification");
    expect(concepts).toContain("product_specification");
  });
});
