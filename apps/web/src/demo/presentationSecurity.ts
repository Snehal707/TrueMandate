const PRIVATE_KEY_NAMES = new Set([
  "committoken",
  "committokenid",
  "authoritygrant",
  "authoritygrantid",
  "rawauthoritygrant",
  "preparedaction",
  "preparedactionid",
  "rawpreparedaction",
  "executionauthorization",
  "executionauthorizationpayload",
  "credential",
  "credentials",
  "privatekey",
  "secret",
  "verifiersecret",
  "verifiermetadata",
  "internalurl",
  "internalendpoint",
]);

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

export function isPrivatePresentationKey(key: string): boolean {
  return PRIVATE_KEY_NAMES.has(normalizedKey(key));
}

export function isProtectedInternalUrl(value: string): boolean {
  return /(?:\/internal\/|https?:\/\/[^\s/]+\.a\.run\.app(?:\/|$))/i.test(value);
}

export function sanitizePublicPresentationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePublicPresentationValue);
  if (typeof value === "string" && isProtectedInternalUrl(value)) {
    return "[private internal reference removed]";
  }
  const row = asRecord(value);
  if (!row) return value;
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !isPrivatePresentationKey(key))
      .map(([key, item]) => [key, sanitizePublicPresentationValue(item)]),
  );
}
