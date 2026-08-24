import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.js";
import { hashCanonical } from "./hash.js";

describe("canonicalize RFC 8785-compatible vectors", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("handles nested objects and arrays", () => {
    const value = {
      z: [{ b: 2, a: 1 }, true],
      a: { y: null, x: "ok" },
    };
    expect(canonicalize(value)).toBe(
      '{"a":{"x":"ok","y":null},"z":[{"a":1,"b":2},true]}',
    );
  });

  it("normalizes negative zero to 0", () => {
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
  });

  it("rejects NaN and Infinity", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => canonicalize({ n: Number.NEGATIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("preserves Unicode code units without NFC rewrite", () => {
    const nfc = "café"; // U+00E9
    const nfd = "cafe\u0301"; // e + combining acute
    expect(canonicalize(nfc)).not.toBe(canonicalize(nfd));
    expect(hashCanonical(nfc)).not.toBe(hashCanonical(nfd));
  });

  it("skips undefined object properties", () => {
    expect(canonicalize({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
  });

  it("canonicalizes empty object and array", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
  });

  it("rejects unsupported types fail-closed", () => {
    expect(() => canonicalize(undefined)).toThrow(/undefined/);
    expect(() => canonicalize(10n)).toThrow(/bigint/);
    expect(() => canonicalize(new Date())).toThrow(/Date/);
    expect(() => canonicalize(new Map())).toThrow(/Map/);
    expect(() => canonicalize(new Set())).toThrow(/Set/);
    class Foo {
      x = 1;
    }
    expect(() => canonicalize(new Foo())).toThrow(/non-plain/);
  });

  it("produces stable hashes across insertion order", () => {
    expect(hashCanonical({ amount: 100, currency: "INR" })).toBe(
      hashCanonical({ currency: "INR", amount: 100 }),
    );
  });
});
