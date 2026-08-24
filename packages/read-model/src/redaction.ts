const SECRET_KEYS = new Set([
  "credential",
  "credentials",
  "oauthToken",
  "accessToken",
  "refreshToken",
  "privateKey",
  "signingKey",
  "apiKey",
  "secret",
  "providerSecret",
  "rawModelResponse",
  "authorizationHeader",
]);

/**
 * Strip secrets from read-model payloads. Pure — does not mutate input.
 */
export function redactForUi<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k) || /secret|token|credential|privatekey/i.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}
