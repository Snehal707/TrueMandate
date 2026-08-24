import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import {
  ModelInspectionStatus,
  isModelInspectionSafe,
  preserveTaintThroughInspection,
  type ModelSecurityAuditRecord,
  type ModelSecurityInspectInput,
  type ModelSecurityInspectResult,
  type ModelSecurityPort,
} from "./model-security-port.js";

export interface ModelArmorAdapterOptions {
  readonly projectId?: string;
  readonly templateId?: string;
  readonly location?: string;
  /** Test seams only — production uses ADC and the platform fetch. */
  readonly tokenProvider?: () => Promise<string | undefined>;
  readonly fetchImpl?: typeof fetch;
  /** Test seam: probe retry backoff base in ms (production policy default). */
  readonly probeBackoffMs?: number;
}

export type ModelArmorProbeFailureClass =
  | "DNS_RESOLUTION"
  | "CONNECTION"
  | "TLS"
  | "AUTH"
  | "HTTP_STATUS"
  | "API_ERROR"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN";

export interface ModelArmorProbeDiagnostic {
  readonly hostname: string;
  readonly templateId?: string;
  readonly classification: ModelArmorProbeFailureClass;
  readonly httpStatus?: number;
  readonly causeCode?: string;
  readonly elapsedMs: number;
}

const DEFAULT_LOCATION = "us-central1";
const DEFAULT_TEMPLATE =
  "projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response";

function regionalHost(location: string): string {
  return `https://modelarmor.${location}.rep.googleapis.com`;
}

function templateResource(templateId: string): string {
  if (templateId.startsWith("projects/")) return templateId;
  return templateId;
}

async function resolveAdcAccessToken(): Promise<string | undefined> {
  try {
    const mod = await import("google-auth-library");
    const GoogleAuth =
      "GoogleAuth" in mod
        ? (mod as { GoogleAuth: new (opts?: { scopes?: string[] }) => {
            getClient(): Promise<{ getAccessToken(): Promise<{ token?: string | null }> }>;
          } }).GoogleAuth
        : undefined;
    if (!GoogleAuth) return undefined;
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token ?? undefined;
  } catch {
    return undefined;
  }
}

interface SanitizeResponse {
  sanitizationResult?: {
    filterMatchState?: string;
    sanitizedContent?: { text?: string };
  };
}

/**
 * Bounded deterministic startup probe retry policy (2026-08-18).
 *
 * Derived from the deployed contract:
 * - per-attempt connect timeout 10s — matches the observed platform fetch
 *   connect timeout (UND_ERR_CONNECT_TIMEOUT ≈ 10.4–10.8s) and is now an
 *   explicit AbortSignal so the bound never depends on platform defaults;
 * - backoff 1s doubling, capped at 8s;
 * - worst-case elapsed budget ≈ maxAttempts × (10s + overhead) + backoff
 *   ≈ 8 × 10.3s + 39s ≈ 121s.
 *
 * This covers the documented minute-scale Direct VPC connection-establishment
 * delay during cold start and stays inside the Cloud Run startup budget of
 * vpc-attached services (initial 10s + 12 × 13s = 166s). Exhausting the whole
 * window keeps the adapter fail-closed — availability requires an actual
 * successful probe.
 */
export const PROBE_POLICY = {
  maxAttempts: 8,
  connectTimeoutMs: 10_000,
  initialBackoffMs: 1_000,
  maxBackoffMs: 8_000,
} as const;

/** Classify a fetch-level failure from its system error code/name (sanitized). */
function classifyNetworkFailure(
  causeCode: string | undefined,
  errorName: string | undefined,
): ModelArmorProbeFailureClass {
  if (/TimeoutError|ABORT_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/i.test(errorName ?? "")) return "CONNECTION";
  if (!causeCode) return "UNKNOWN";
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME|ENODATA/i.test(causeCode)) return "DNS_RESOLUTION";
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_CONNECT_REFUSED|UND_ERR_SOCKET/i.test(causeCode)) return "CONNECTION";
  if (/CERT_|UNABLE_TO_VERIFY|SSL_|TLS/i.test(causeCode)) return "TLS";
  return "UNKNOWN";
}

/**
 * Model Armor adapter. UNAVAILABLE is treated as NOT safe (fail-closed).
 * CLEAN never clears taint (preserveTaintThroughInspection).
 *
 * Availability comes from a successful ADC probe against the regional REP.
 * setAvailable is a test-only hook and does not call the live API.
 */
export class ModelArmorAdapter implements ModelSecurityPort {
  private readonly _requested: ModelSecurityAuditRecord[] = [];
  private readonly _results: ModelSecurityAuditRecord[] = [];
  private readonly _failures: ModelSecurityAuditRecord[] = [];
  private available = false;
  private live = false;
  private probeDiagnostic: ModelArmorProbeDiagnostic | undefined;
  private readonly tokenProvider: () => Promise<string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly probeBackoffMs: number;
  readonly projectId?: string;
  readonly templateId?: string;
  readonly location: string;

  constructor(options: ModelArmorAdapterOptions = {}) {
    this.projectId = options.projectId;
    this.templateId = options.templateId;
    this.location = options.location ?? DEFAULT_LOCATION;
    this.tokenProvider = options.tokenProvider ?? resolveAdcAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probeBackoffMs = options.probeBackoffMs ?? PROBE_POLICY.initialBackoffMs;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ModelArmorAdapter {
    const template =
      env.TM_MODEL_ARMOR_TEMPLATE?.trim() || env.MODEL_ARMOR_TEMPLATE?.trim();
    const projectId = env.GOOGLE_CLOUD_PROJECT ?? env.GCP_PROJECT;
    const location =
      env.TM_MODEL_ARMOR_LOCATION?.trim() ||
      env.MODEL_ARMOR_LOCATION?.trim() ||
      DEFAULT_LOCATION;
    return new ModelArmorAdapter({
      projectId: projectId?.trim() || undefined,
      templateId: template || undefined,
      location,
    });
  }

  get configured(): boolean {
    return Boolean(this.templateId);
  }

  get liveEnabled(): boolean {
    return this.live;
  }

  get inspectionRequested(): readonly ModelSecurityAuditRecord[] {
    return this._requested;
  }

  get inspectionResults(): readonly ModelSecurityAuditRecord[] {
    return this._results;
  }

  get inspectionFailures(): readonly ModelSecurityAuditRecord[] {
    return this._failures;
  }

  get sanitizeEndpoint(): string {
    const template = templateResource(this.templateId ?? DEFAULT_TEMPLATE);
    return `${regionalHost(this.location)}/v1/${template}:sanitizeUserPrompt`;
  }

  /** Test hook — production wiring sets availability from probe(), not this. */
  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.live = false;
  }

  get lastProbeDiagnostic(): ModelArmorProbeDiagnostic | undefined {
    return this.probeDiagnostic;
  }

  /**
   * Non-destructive ADC probe with a bounded startup retry window. Transient
   * connection-establishment failures (observed intermittent PSC connect
   * timeouts) receive at most PROBE_POLICY.maxAttempts attempts with deterministic
   * modest backoff; every failed attempt emits the sanitized structured
   * diagnostic (no credentials, prompts, headers, or response bodies). The
   * adapter never falls back to a public endpoint and remains fail-closed:
   * the final result is exactly as before — false unless an attempt succeeds.
   */
  async probe(): Promise<boolean> {
    if (!this.templateId) return false;
    let ok = false;
    let backoffMs = this.probeBackoffMs;
    for (let attempt = 1; attempt <= PROBE_POLICY.maxAttempts; attempt += 1) {
      const started = Date.now();
      const result = await this.sanitize("health-probe", { timeoutMs: PROBE_POLICY.connectTimeoutMs });
      const elapsedMs = Date.now() - started;
      if (result.ok) {
        ok = true;
        break;
      }
      const diagnostic: ModelArmorProbeDiagnostic = {
        hostname: regionalHost(this.location),
        templateId: this.templateId,
        classification: result.failure?.classification ?? "UNKNOWN",
        httpStatus: result.failure?.httpStatus,
        causeCode: result.failure?.causeCode,
        elapsedMs,
      };
      this.probeDiagnostic = diagnostic;
      // Operational diagnostics only: no credentials, prompts, headers, or
      // sensitive API response content is ever included.
      console.error(JSON.stringify({ event: "model_armor_probe_failed", attempt, ...diagnostic }));
      if (attempt < PROBE_POLICY.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        backoffMs = Math.min(backoffMs * 2, PROBE_POLICY.maxBackoffMs);
      }
    }
    this.available = ok;
    this.live = ok;
    return ok;
  }

  async inspect(
    input: ModelSecurityInspectInput,
  ): Promise<Result<ModelSecurityInspectResult>> {
    const at = new Date().toISOString();
    this._requested.push({ requestId: input.requestId, at });

    if (!this.available) {
      this._failures.push({
        requestId: input.requestId,
        at,
        detail: "model_armor_unavailable",
      });
      const result = preserveTaintThroughInspection(
        input,
        ModelInspectionStatus.UNAVAILABLE,
        ["model_armor_unavailable"],
      );
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        "Model Armor unavailable — fail-closed",
        { safe: isModelInspectionSafe(result), taint: result.taint },
      );
    }

    if (!this.live) {
      const result = preserveTaintThroughInspection(
        input,
        ModelInspectionStatus.CLEAN,
      );
      this._results.push({ requestId: input.requestId, at, detail: "CLEAN" });
      return ok(result);
    }

    const sanitized = await this.sanitize(input.content);
    if (!sanitized.ok) {
      this._failures.push({
        requestId: input.requestId,
        at,
        detail: "model_armor_unavailable",
      });
      const result = preserveTaintThroughInspection(
        input,
        ModelInspectionStatus.UNAVAILABLE,
        ["model_armor_unavailable"],
      );
      return err(
        ErrorCode.MODEL_UNAVAILABLE,
        "Model Armor unavailable — fail-closed",
        { safe: isModelInspectionSafe(result), taint: result.taint },
      );
    }

    const status = sanitized.blocked
      ? ModelInspectionStatus.BLOCKED
      : ModelInspectionStatus.CLEAN;
    const result = preserveTaintThroughInspection(
      input,
      status,
      sanitized.blocked ? ["model_armor_match"] : undefined,
    );
    this._results.push({ requestId: input.requestId, at, detail: status });
    return ok(result);
  }

  private async sanitize(
    text: string,
    opts?: { timeoutMs?: number },
  ): Promise<{
    ok: boolean;
    blocked: boolean;
    failure?: { classification: ModelArmorProbeFailureClass; httpStatus?: number; causeCode?: string };
  }> {
    const token = await this.tokenProvider();
    if (!token || !this.templateId) {
      return { ok: false, blocked: false, failure: { classification: "AUTH" } };
    }
    try {
      const response = await this.fetchImpl(this.sanitizeEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(opts?.timeoutMs !== undefined ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
        body: JSON.stringify({
          userPromptData: { text },
        }),
      });
      if (!response.ok) {
        const classification: ModelArmorProbeFailureClass =
          response.status === 401 || response.status === 403
            ? "AUTH"
            : response.status >= 500
              ? "API_ERROR"
              : "HTTP_STATUS";
        return { ok: false, blocked: false, failure: { classification, httpStatus: response.status } };
      }
      let body: SanitizeResponse;
      try {
        body = (await response.json()) as SanitizeResponse;
      } catch {
        return { ok: false, blocked: false, failure: { classification: "MALFORMED_RESPONSE", httpStatus: response.status } };
      }
      const match = body.sanitizationResult?.filterMatchState;
      return {
        ok: true,
        blocked: match === "MATCH_FOUND",
      };
    } catch (e) {
      const causeCode = (e as { cause?: { code?: string } } | undefined)?.cause?.code;
      const errorName = (e as { name?: string } | undefined)?.name;
      const classification = classifyNetworkFailure(causeCode, errorName);
      return { ok: false, blocked: false, failure: { classification, causeCode } };
    }
  }
}

/** Fail-closed gate: only explicit CLEAN when adapter returns ok and safe. */
export function requireModelArmorSafe(
  result: Result<ModelSecurityInspectResult>,
): Result<ModelSecurityInspectResult> {
  if (!result.ok) {
    return result;
  }
  if (!isModelInspectionSafe(result.value)) {
    return err(
      ErrorCode.MODEL_UNAVAILABLE,
      `Model inspection not safe: ${result.value.status}`,
      { status: result.value.status },
    );
  }
  return result;
}
