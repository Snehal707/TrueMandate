import { describe, expect, it } from "vitest";
import {
  PROTECTED_PREFERENCE_CONCEPTS,
  isProtectedPreferenceConcept,
} from "./protected-concepts.js";

describe("protected preference concepts", () => {
  it("includes the required protected set", () => {
    for (const c of [
      "budget",
      "quantity",
      "merchant",
      "deadline",
      "capability",
      "authority",
    ]) {
      expect(PROTECTED_PREFERENCE_CONCEPTS.has(c)).toBe(true);
      expect(isProtectedPreferenceConcept(c)).toBe(true);
      expect(isProtectedPreferenceConcept(c.toUpperCase())).toBe(true);
    }
  });

  it("allows soft non-protected concepts", () => {
    expect(isProtectedPreferenceConcept("refundable")).toBe(false);
    expect(isProtectedPreferenceConcept("preferred_airline")).toBe(false);
  });
});
