import { describe, expect, it } from "vitest";
import {
  allocateDemoSessionId,
  assertPreferenceSubjectMatches,
  demoSubjectId,
  principalSubjectId,
  resolvePreferenceSubjectId,
} from "./subject-identity.js";

describe("preference subject identity", () => {
  it("derives principal subjectId from verified caller email", () => {
    const resolved = resolvePreferenceSubjectId({
      callerEmail: "Judge-A@Example.com",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.kind).toBe("principal");
    expect(resolved.value.subjectId).toBe("principal:judge-a@example.com");
    expect(principalSubjectId("Judge-A@Example.com")).toBe(
      resolved.value.subjectId,
    );
  });

  it("derives demo subjectId only when session exists in ledger", () => {
    const missing = resolvePreferenceSubjectId({
      demoSessionId: "ds-abc",
      demoSessionExists: false,
    });
    expect(missing.ok).toBe(false);

    const ok = resolvePreferenceSubjectId({
      demoSessionId: "ds-abc",
      demoSessionExists: true,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.subjectId).toBe(demoSubjectId("ds-abc"));
    expect(ok.value.kind).toBe("demo");
  });

  it("prefers verified caller over demoSessionId", () => {
    const resolved = resolvePreferenceSubjectId({
      callerEmail: "a@example.com",
      demoSessionId: "ds-other",
      demoSessionExists: true,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.subjectId).toBe("principal:a@example.com");
  });

  it("fails closed when neither caller nor demo session is present", () => {
    const resolved = resolvePreferenceSubjectId({});
    expect(resolved.ok).toBe(false);
  });

  it("assertPreferenceSubjectMatches rejects mismatched content.subjectId", () => {
    const expected = {
      subjectId: "principal:a@example.com",
      kind: "principal" as const,
    };
    expect(assertPreferenceSubjectMatches(expected.subjectId, expected).ok).toBe(
      true,
    );
    expect(
      assertPreferenceSubjectMatches("principal:b@example.com", expected).ok,
    ).toBe(false);
    expect(assertPreferenceSubjectMatches(undefined, expected).ok).toBe(false);
  });

  it("allocateDemoSessionId returns opaque non-empty ids", () => {
    const a = allocateDemoSessionId(1);
    const b = allocateDemoSessionId(2);
    expect(a.startsWith("ds-")).toBe(true);
    expect(b.startsWith("ds-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
