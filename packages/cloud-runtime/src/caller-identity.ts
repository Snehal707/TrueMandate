import type { IncomingHttpHeaders } from "node:http";

export interface GoogleIdTokenClient {
  verifyIdToken(input: Readonly<{
    idToken: string;
    audience: string;
  }>): Promise<{
    getPayload(): Readonly<{ email?: string; email_verified?: boolean }> | undefined;
  }>;
}

export interface VerifiedInternalCaller {
  readonly email: string;
}

export interface InternalCallerIdentityVerifier {
  verify(headers: IncomingHttpHeaders, audience: string): Promise<VerifiedInternalCaller | undefined>;
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const authorization = headerValue(headers, "authorization");
  if (!authorization) return undefined;
  const match = /^Bearer\s+([^.\s]+\.[^.\s]+\.[^.\s]+)$/i.exec(authorization.trim());
  return match?.[1];
}

export function googleIdentityVerifier(
  clientFactory: () => Promise<GoogleIdTokenClient>,
): InternalCallerIdentityVerifier {
  return {
    async verify(headers, audience) {
      const token = bearerToken(headers);
      if (!token) return undefined;
      try {
        const ticket = await (await clientFactory()).verifyIdToken({
          idToken: token,
          audience,
        });
        const payload = ticket.getPayload();
        if (
          !payload ||
          payload.email_verified !== true ||
          typeof payload.email !== "string" ||
          !payload.email.includes("@")
        ) {
          return undefined;
        }
        return { email: payload.email };
      } catch {
        return undefined;
      }
    },
  };
}

export function adcGoogleIdentityVerifier(): InternalCallerIdentityVerifier {
  return googleIdentityVerifier(async () => {
    const mod = await import("google-auth-library");
    if (!("OAuth2Client" in mod)) {
      throw new Error("google-auth-library OAuth2Client unavailable");
    }
    return new mod.OAuth2Client() as GoogleIdTokenClient;
  });
}

export function callerAllowed(
  email: string | undefined,
  allowed: readonly string[],
): boolean {
  if (!email) return false;
  return allowed.includes(email);
}
