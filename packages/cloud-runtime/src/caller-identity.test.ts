import { describe, expect, it } from "vitest";
import { googleIdentityVerifier, type GoogleIdTokenClient } from "./caller-identity.js";

const audience = "https://intent-provenance.example";
const authority = "tm-dev-authority@test.iam.gserviceaccount.com";
const jwt = "header.payload.signature";

function client(
  result: Readonly<{ email?: string; email_verified?: boolean }> | Error,
): () => Promise<GoogleIdTokenClient> {
  return async () => ({
    verifyIdToken: async (input) => {
      expect(input.audience).toBe(audience);
      expect(input.idToken).toBe(jwt);
      if (result instanceof Error) throw result;
      return { getPayload: () => result };
    },
  });
}

describe("Google internal caller identity verifier", () => {
  it("accepts a verified Authority service-account token", async () => {
    const verifier = googleIdentityVerifier(client({ email: authority, email_verified: true }));
    await expect(verifier.verify({ authorization: `Bearer ${jwt}` }, audience)).resolves.toEqual({ email: authority });
  });

  it.each([
    ["missing bearer", undefined],
    ["malformed bearer", "Bearer not-a-jwt"],
  ])("rejects %s", async (_label, authorization) => {
    const verifier = googleIdentityVerifier(client({ email: authority, email_verified: true }));
    await expect(verifier.verify({ authorization }, audience)).resolves.toBeUndefined();
  });

  it.each([
    "invalid signature",
    "wrong audience",
    "expired token",
  ])("rejects a %s verification failure", async (reason) => {
    const verifier = googleIdentityVerifier(client(new Error(reason)));
    await expect(verifier.verify({ authorization: `Bearer ${jwt}` }, audience)).resolves.toBeUndefined();
  });

  it("rejects an unverified or malformed Google token payload", async () => {
    for (const payload of [
      { email: authority, email_verified: false },
      { email_verified: true },
      { email: "not-an-email", email_verified: true },
    ]) {
      const verifier = googleIdentityVerifier(client(payload));
      await expect(verifier.verify({ authorization: `Bearer ${jwt}` }, audience)).resolves.toBeUndefined();
    }
  });

  it("returns a verified non-Authority caller for route policy to deny", async () => {
    const verifier = googleIdentityVerifier(client({ email: "gateway@test.iam.gserviceaccount.com", email_verified: true }));
    await expect(verifier.verify({ authorization: `Bearer ${jwt}` }, audience)).resolves.toEqual({ email: "gateway@test.iam.gserviceaccount.com" });
  });
});
