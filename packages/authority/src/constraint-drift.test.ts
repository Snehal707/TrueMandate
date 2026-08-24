import { ConstraintKind, ConstraintOperator, asConstraintId } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { detectWeakenedConstraints } from "./constraint-drift.js";
import { makeConstraint } from "./fixtures.js";

describe("Wave 3.6 detectWeakenedConstraints", () => {
  it("detects a loosened upper bound (LTE)", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("budget"),
        concept: "budget_max",
        kind: ConstraintKind.FINANCIAL,
        operator: ConstraintOperator.LTE,
        value: 800000,
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("budget"),
        concept: "budget_max",
        kind: ConstraintKind.FINANCIAL,
        operator: ConstraintOperator.LTE,
        value: 950000,
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ concept: "budget_max", reason: "BOUND_LOOSENED" });
  });

  it("does not report a tightened upper bound as weakened", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("budget"),
        concept: "budget_max",
        kind: ConstraintKind.FINANCIAL,
        operator: ConstraintOperator.LTE,
        value: 800000,
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("budget"),
        concept: "budget_max",
        kind: ConstraintKind.FINANCIAL,
        operator: ConstraintOperator.LTE,
        value: 700000,
      }),
    ];
    expect(detectWeakenedConstraints(previous, next)).toHaveLength(0);
  });

  it("detects a loosened lower bound (GTE)", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("qty"),
        concept: "quantity_min",
        kind: ConstraintKind.HARD,
        operator: ConstraintOperator.GTE,
        value: 500,
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("qty"),
        concept: "quantity_min",
        kind: ConstraintKind.HARD,
        operator: ConstraintOperator.GTE,
        value: 450,
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toMatchObject([{ concept: "quantity_min", reason: "BOUND_LOOSENED" }]);
  });

  it("detects a widened BETWEEN range", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("delivery"),
        concept: "delivery_window_days",
        kind: ConstraintKind.TEMPORAL,
        operator: ConstraintOperator.BETWEEN,
        value: [3, 5],
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("delivery"),
        concept: "delivery_window_days",
        kind: ConstraintKind.TEMPORAL,
        operator: ConstraintOperator.BETWEEN,
        value: [2, 7],
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toMatchObject([{ concept: "delivery_window_days", reason: "RANGE_WIDENED" }]);
  });

  it("detects a widened IN set", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("merchant"),
        concept: "approved_merchant",
        kind: ConstraintKind.ORGANIZATIONAL_POLICY,
        operator: ConstraintOperator.IN,
        value: ["ApprovedFoodChem"],
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("merchant"),
        concept: "approved_merchant",
        kind: ConstraintKind.ORGANIZATIONAL_POLICY,
        operator: ConstraintOperator.IN,
        value: ["ApprovedFoodChem", "AnyVendorLLC"],
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toMatchObject([{ concept: "approved_merchant", reason: "SET_WIDENED" }]);
  });

  it("detects a shrunk NOT_IN exclusion set (fewer things forbidden)", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("banned"),
        concept: "banned_merchant",
        kind: ConstraintKind.ORGANIZATIONAL_POLICY,
        operator: ConstraintOperator.NOT_IN,
        value: ["Bad Co", "Worse Co"],
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("banned"),
        concept: "banned_merchant",
        kind: ConstraintKind.ORGANIZATIONAL_POLICY,
        operator: ConstraintOperator.NOT_IN,
        value: ["Bad Co"],
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toMatchObject([{ concept: "banned_merchant", reason: "SET_WIDENED" }]);
  });

  it("detects a dropped REQUIRE constraint (true -> false)", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("cert"),
        concept: "food_grade_certificate",
        kind: ConstraintKind.SAFETY_CRITICAL,
        operator: ConstraintOperator.REQUIRE,
        value: true,
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("cert"),
        concept: "food_grade_certificate",
        kind: ConstraintKind.SAFETY_CRITICAL,
        operator: ConstraintOperator.REQUIRE,
        value: false,
      }),
    ];
    const drift = detectWeakenedConstraints(previous, next);
    expect(drift).toMatchObject([{ concept: "food_grade_certificate", reason: "REQUIREMENT_DROPPED" }]);
  });

  it("detects a removed constraint as weakened", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("food"),
        concept: "food_grade",
        kind: ConstraintKind.SAFETY_CRITICAL,
      }),
    ];
    const drift = detectWeakenedConstraints(previous, []);
    expect(drift).toMatchObject([{ concept: "food_grade", reason: "REMOVED" }]);
  });

  it("does not fabricate a verdict for incomparable operator families", () => {
    const previous = [
      makeConstraint({
        id: asConstraintId("c1"),
        concept: "delivery_method",
        kind: ConstraintKind.METHOD_CONSTRAINT,
        operator: ConstraintOperator.EQ,
        value: "AIR",
      }),
    ];
    const next = [
      makeConstraint({
        id: asConstraintId("c1"),
        concept: "delivery_method",
        kind: ConstraintKind.METHOD_CONSTRAINT,
        operator: ConstraintOperator.IN,
        value: ["AIR", "SEA"],
      }),
    ];
    expect(detectWeakenedConstraints(previous, next)).toHaveLength(0);
  });

  it("returns empty for identical constraint sets", () => {
    const constraints = [
      makeConstraint({
        id: asConstraintId("c1"),
        concept: "budget_max",
        kind: ConstraintKind.FINANCIAL,
        operator: ConstraintOperator.LTE,
        value: 800000,
      }),
    ];
    expect(detectWeakenedConstraints(constraints, constraints)).toHaveLength(0);
  });
});
