import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  assertPreferenceCannotTargetProtectedConcept,
  assertUserPreferenceContent,
} from "./preference-signal.js";

describe("INV_027 preference-signal", () => {
  it("rejects protected concepts", () => {
    for (const concept of [
      "budget",
      "quantity",
      "merchant",
      "deadline",
      "capability",
      "authority",
    ]) {
      const result = assertPreferenceCannotTargetProtectedConcept(concept);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ErrorCode.PREFERENCE_PROTECTED_CONCEPT);
      }
    }
  });

  it("allows soft concepts", () => {
    expect(assertPreferenceCannotTargetProtectedConcept("refundable").ok).toBe(
      true,
    );
  });

  it("assertUserPreferenceContent requires subjectId/concept/value/origin", () => {
    expect(
      assertUserPreferenceContent({
        subjectId: "principal:a@example.com",
        concept: "refundable",
        value: true,
        origin: "EXPLICIT_USER_INPUT",
      }).ok,
    ).toBe(true);

    expect(assertUserPreferenceContent({ concept: "refundable" }).ok).toBe(
      false,
    );
    expect(
      assertUserPreferenceContent({
        subjectId: "principal:a@example.com",
        concept: "budget",
        value: 100,
        origin: "EXPLICIT_USER_INPUT",
      }).ok,
    ).toBe(false);
    expect(
      assertUserPreferenceContent({
        subjectId: "principal:a@example.com",
        concept: "refundable",
        value: true,
        origin: "INVALID",
      }).ok,
    ).toBe(false);
  });
});
