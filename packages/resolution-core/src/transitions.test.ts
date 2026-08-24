import { ResolutionCaseState } from "@truemandate/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertResolutionTransition } from "./transitions.js";

describe("resolution-core transitions", () => {
  it("OPEN → RESOLVED is illegal", () => {
    const r = assertResolutionTransition(
      ResolutionCaseState.OPEN,
      ResolutionCaseState.RESOLVED,
    );
    expect(r.ok).toBe(false);
  });

  it("property: CLOSED has no outgoing transitions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...Object.values(ResolutionCaseState).filter(
            (s) => s !== ResolutionCaseState.CLOSED,
          ),
        ),
        (to) => {
          const r = assertResolutionTransition(ResolutionCaseState.CLOSED, to);
          expect(r.ok).toBe(false);
        },
      ),
      { numRuns: 9 },
    );
  });
});
