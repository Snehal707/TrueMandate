import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.js";
import { hashCanonical } from "./hash.js";

describe("canonicalize", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("is stable across key insertion order", () => {
    const a = canonicalize({ z: true, m: [3, 1], a: { y: 1, x: 2 } });
    const b = canonicalize({ a: { x: 2, y: 1 }, m: [3, 1], z: true });
    expect(a).toBe(b);
  });

  it("produces identical hashes for semantically equal objects", () => {
    expect(hashCanonical({ amount: 100, currency: "INR" })).toBe(
      hashCanonical({ currency: "INR", amount: 100 }),
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(/non-finite/);
  });
});
