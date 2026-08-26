export interface SanitizedProviderError {
  readonly status?: string;
  readonly reason?: string;
  readonly domain?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly quotaViolations?: readonly Readonly<{
    subject?: string;
    description?: string;
  }>[];
  readonly retryDelayMs?: number;
  readonly retryAfterMs?: number;
  readonly providerRequestId?: string;
}

const ALLOWED_METADATA = new Set([
  "service",
  "quotaMetric",
  "quota_metric",
  "quotaLimit",
  "quota_limit",
  "quotaLocation",
  "quota_location",
  "model",
  "location",
]);
const SAFE_TOKEN = /^[a-zA-Z0-9_ .,:/()\-]{1,240}$/;

function safeText(value: unknown, max = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  if (!trimmed || !SAFE_TOKEN.test(trimmed)) return undefined;
  if (/bearer|password|private[_ -]?key|credential|token=/i.test(trimmed)) return undefined;
  return trimmed;
}

function durationMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? Math.round(Number(match[1]) * 1_000) : undefined;
}

function retryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : undefined;
}

export function sanitizeGoogleProviderError(
  raw: unknown,
  headers?: Headers,
): SanitizedProviderError | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;
  const error = root.error && typeof root.error === "object"
    ? root.error as Record<string, unknown>
    : root;
  const details = Array.isArray(error.details) ? error.details : [];
  let reason: string | undefined;
  let domain: string | undefined;
  let retryDelay: number | undefined;
  const metadata: Record<string, string> = {};
  const quotaViolations: Array<{ subject?: string; description?: string }> = [];

  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const record = detail as Record<string, unknown>;
    const type = safeText(record["@type"]);
    if (type?.endsWith("google.rpc.ErrorInfo")) {
      reason = safeText(record.reason);
      domain = safeText(record.domain);
      if (record.metadata && typeof record.metadata === "object") {
        for (const [key, value] of Object.entries(record.metadata as Record<string, unknown>)) {
          if (!ALLOWED_METADATA.has(key)) continue;
          const safe = safeText(value);
          if (safe) metadata[key] = safe;
        }
      }
    }
    if (type?.endsWith("google.rpc.QuotaFailure") && Array.isArray(record.violations)) {
      for (const violation of record.violations.slice(0, 8)) {
        if (!violation || typeof violation !== "object") continue;
        const item = violation as Record<string, unknown>;
        const subject = safeText(item.subject);
        const description = safeText(item.description);
        if (subject || description) quotaViolations.push({ subject, description });
      }
    }
    if (type?.endsWith("google.rpc.RetryInfo")) {
      retryDelay = durationMs(record.retryDelay);
    }
  }

  const status = safeText(error.status);
  const providerRequestId = safeText(
    headers?.get("x-request-id") ?? headers?.get("x-goog-request-id"),
  );
  const parsedRetryAfter = retryAfterMs(headers?.get("retry-after") ?? null);
  const result: SanitizedProviderError = {
    status,
    reason,
    domain,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    quotaViolations: quotaViolations.length ? quotaViolations : undefined,
    retryDelayMs: retryDelay,
    retryAfterMs: parsedRetryAfter,
    providerRequestId,
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

export async function readSanitizedProviderError(
  response: Response,
): Promise<SanitizedProviderError | undefined> {
  try {
    const text = (await response.text()).slice(0, 65_536);
    return sanitizeGoogleProviderError(JSON.parse(text), response.headers);
  } catch {
    return sanitizeGoogleProviderError({}, response.headers);
  }
}
