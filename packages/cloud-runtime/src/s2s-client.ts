import { SpanStatusCode } from "@opentelemetry/api";
import { injectTraceParent, setSpanAttribute, withSpan } from "@truemandate/observability";
import {
  ErrorCode,
  err,
  ok,
  type Intent,
  type IntentState,
  type EvidenceEnvelope,
  type EvidenceClaim,
  type PreparedAction,
  type ProvenanceEdge,
  type ProvenanceNode,
  type Result,
} from "@truemandate/protocol";

export interface IdentityTokenProvider {
  getIdentityToken(audience: string): Promise<string>;
}

/** Test-only static bearer. Production uses ADC identity tokens. */
export function staticTokenProvider(token: string): IdentityTokenProvider {
  return {
    getIdentityToken: async () => token,
  };
}

function authorizationFromHeaders(headers: unknown): string {
  if (headers && typeof headers === "object") {
    const rec = headers as Record<string, unknown> & {
      get?(name: string): string | null;
    };
    if (typeof rec.get === "function") {
      const fromGet = rec.get("Authorization") ?? rec.get("authorization") ?? "";
      if (fromGet) return fromGet;
    }
    const direct = rec.Authorization ?? rec.authorization;
    if (typeof direct === "string") return direct;
  }
  return "";
}

export async function adcIdentityTokenProvider(): Promise<IdentityTokenProvider> {
  const mod = await import("google-auth-library");
  const GoogleAuth =
    "GoogleAuth" in mod
      ? (mod as {
          GoogleAuth: new () => {
            getIdTokenClient(audience: string): Promise<{
              getRequestHeaders(): Promise<unknown>;
            }>;
          };
        }).GoogleAuth
      : undefined;
  if (!GoogleAuth) {
    throw new Error("google-auth-library GoogleAuth unavailable");
  }
  const auth = new GoogleAuth();
  return {
    getIdentityToken: async (audience: string) => {
      const client = await auth.getIdTokenClient(audience);
      const headers = await client.getRequestHeaders();
      const raw = authorizationFromHeaders(headers);
      return raw.replace(/^Bearer\s+/i, "").trim();
    },
  };
}

export interface S2SJsonResponse {
  readonly status: number;
  readonly body: unknown;
}

function isHtmlOrNonJsonBody(body: unknown): boolean {
  if (body === null || typeof body !== "object") return true;
  const rec = body as Record<string, unknown>;
  if (typeof rec.raw === "string") {
    const raw = rec.raw;
    if (/<html/i.test(raw) || rec.error === "MALFORMED_JSON") return true;
  }
  return false;
}

/**
 * GFE HTML 404/403 (Internal Cloud Run unreachable without VPC) is retryable.
 * Application JSON 4xx is a permanent validation failure.
 */
export function s2sHttpRetryable(response: S2SJsonResponse): boolean {
  if (response.status === 429 || response.status >= 500) return true;
  if (
    (response.status === 404 || response.status === 403) &&
    isHtmlOrNonJsonBody(response.body)
  ) {
    return true;
  }
  return false;
}

export async function fetchS2SJson(input: {
  readonly baseUrl: string;
  readonly path: string;
  readonly method: string;
  readonly token: string;
  readonly body?: unknown;
}): Promise<S2SJsonResponse> {
  const url = `${input.baseUrl.replace(/\/$/, "")}${input.path}`;

  // Wave 2 observability: every outbound S2S call gets a child span, and the
  // active traceparent is injected into outbound headers so the downstream
  // service's createCloudRunHttpServer can link to the same trace. Fail-open:
  // withSpan/injectTraceParent never throw, so a tracing failure can never
  // change this call's result (success response or the existing 503 fallback).
  return withSpan(
    `S2S ${input.method} ${input.path}`,
    {
      "http.method": input.method,
      "peer.service": input.baseUrl,
      "http.route": input.path,
    },
    async (span) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${input.token}`,
        ...(input.body !== undefined
          ? { "content-type": "application/json; charset=utf-8" }
          : {}),
      };
      injectTraceParent(headers);

      try {
        const response = await fetch(url, {
          method: input.method,
          headers,
          body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        });
        const text = await response.text();
        let body: unknown = {};
        if (text.trim()) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = { error: "MALFORMED_JSON", raw: text };
          }
        }
        setSpanAttribute(span, "http.status_code", response.status);
        if (response.status >= 500) {
          try {
            span?.setStatus({ code: SpanStatusCode.ERROR });
          } catch {
            // Fail-open: span status must never affect the returned result.
          }
        }
        return { status: response.status, body };
      } catch (e) {
        const message = e instanceof Error ? e.message : "S2S network failure";
        try {
          span?.setStatus({ code: SpanStatusCode.ERROR, message });
        } catch {
          // Fail-open: span status must never affect the returned result.
        }
        return {
          status: 503,
          body: {
            error: ErrorCode.VALIDATION_FAILED,
            message,
            retryable: true,
          },
        };
      }
    },
  );
}

export function s2sResultFromHttp<T>(
  response: S2SJsonResponse,
): Result<T> {
  if (response.status >= 200 && response.status < 300) {
    return ok(response.body as T);
  }
  const rec =
    response.body !== null && typeof response.body === "object"
      ? (response.body as Record<string, unknown>)
      : {};
  const raw =
    typeof rec.error === "string"
      ? rec.error
      : typeof rec.code === "string"
        ? rec.code
        : ErrorCode.VALIDATION_FAILED;
  const known = (Object.values(ErrorCode) as string[]).includes(raw)
    ? (raw as ErrorCode)
    : ErrorCode.VALIDATION_FAILED;
  const message =
    typeof rec.message === "string" ? rec.message : `S2S request failed (${response.status})`;
  const retryable =
    rec.retryable === true || s2sHttpRetryable(response);
  return err(known, message, { status: response.status, retryable });
}

/**
 * Typed client for intent-provenance owner APIs.
 * Callers must not persist intents/provenance locally.
 */
export class IntentProvenanceS2SClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: IdentityTokenProvider,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<S2SJsonResponse> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) {
      throw new Error("S2S identity token missing");
    }
    return fetchS2SJson({
      baseUrl: this.baseUrl,
      path,
      method,
      token,
      body,
    });
  }

  async createIntent(raw: unknown): Promise<Result<Intent>> {
    return s2sResultFromHttp<Intent>(
      await this.call("POST", "/internal/intents", raw),
    );
  }

  async getIntent(intentId: string): Promise<Result<Intent>> {
    return s2sResultFromHttp<Intent>(
      await this.call("GET", `/internal/intents/${encodeURIComponent(intentId)}`),
    );
  }

  async getTip(intentId: string): Promise<Result<IntentState>> {
    return s2sResultFromHttp<IntentState>(
      await this.call(
        "GET",
        `/internal/intents/${encodeURIComponent(intentId)}/tip`,
      ),
    );
  }

  async getIntentState(stateId: string): Promise<Result<IntentState>> {
    return s2sResultFromHttp<IntentState>(
      await this.call("GET", `/internal/intent-states/${encodeURIComponent(stateId)}`),
    );
  }

  /** Owner-held pre-state lifecycle. These records are deliberately not
   * IntentStates: only the owner finalization route can create one. */
  async createCompilation(raw: unknown): Promise<Result<unknown>> {
    return this.putSemanticArtifact(raw);
  }
  async createCompilationVerification(raw: unknown): Promise<Result<unknown>> {
    return this.putSemanticArtifact(raw);
  }
  async finalizeCompilation(raw: unknown): Promise<Result<IntentState>> {
    return s2sResultFromHttp<IntentState>(
      await this.call("POST", "/internal/compilations/finalize", raw),
    );
  }

  /** Owner-side capability-policy ingress (verified caller identities only). */
  async createIntentState(raw: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/intent-states", raw),
    );
  }

  async supersedeSemanticVerification(
    stateId: string,
    raw: unknown,
  ): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call(
        "POST",
        `/internal/intent-states/${encodeURIComponent(stateId)}/semantic-supersession`,
        raw,
      ),
    );
  }

  async recordNode(raw: unknown): Promise<Result<ProvenanceNode>> {
    return s2sResultFromHttp<ProvenanceNode>(
      await this.call("POST", "/internal/provenance/nodes", raw),
    );
  }

  async recordEdge(raw: unknown): Promise<Result<ProvenanceEdge>> {
    return s2sResultFromHttp<ProvenanceEdge>(
      await this.call("POST", "/internal/provenance/edges", raw),
    );
  }

  async getNode(id: string): Promise<Result<ProvenanceNode>> {
    return s2sResultFromHttp<ProvenanceNode>(
      await this.call(
        "GET",
        `/internal/provenance/nodes/${encodeURIComponent(id)}`,
      ),
    );
  }

  async getEdge(id: string): Promise<Result<ProvenanceEdge>> {
    return s2sResultFromHttp<ProvenanceEdge>(
      await this.call(
        "GET",
        `/internal/provenance/edges/${encodeURIComponent(id)}`,
      ),
    );
  }

  /** Narrow owner operation; generic callers cannot append AUTHORIZES edges. */
  async createAuthorityBinding(raw: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/provenance/authority-bindings", raw),
    );
  }

  async putSemanticArtifact(raw: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("POST", "/internal/semantic-artifacts", raw));
  }
  async getSemanticArtifact(id: string): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("GET", `/internal/semantic-artifacts/${encodeURIComponent(id)}`));
  }
  async listWorkflowArtifacts(workflowId: string): Promise<Result<readonly unknown[]>> {
    return s2sResultFromHttp(await this.call("GET", `/internal/workflows/${encodeURIComponent(workflowId)}/artifacts`));
  }

  /** Durable append used by ProvenanceService's in-process graph. */
  async appendNode(node: {
    readonly id: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }): Promise<void> {
    const result = await this.recordNode(node.payload);
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  async appendEdge(edge: {
    readonly id: string;
    readonly fromId: string;
    readonly toId: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }): Promise<void> {
    const result = await this.recordEdge(edge.payload);
    if (!result.ok) {
      throw new Error(result.message);
    }
  }
}

/**
 * Typed client for reference-only Gateway preparation and authorization.
 * Does not expose adapterMode, now, or a generic mutation mechanism.
 */
export class GatewayS2SClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: IdentityTokenProvider,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<S2SJsonResponse> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) {
      throw new Error("S2S identity token missing");
    }
    return fetchS2SJson({
      baseUrl: this.baseUrl,
      path,
      method,
      token,
      body,
    });
  }

  async prepareFromReferences(body: unknown): Promise<Result<PreparedAction>> {
    return s2sResultFromHttp<PreparedAction>(await this.call("POST", "/internal/gateway/prepare-references", body));
  }

  async getPreparedAction(id: string): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("GET", `/internal/gateway/prepared-actions/${encodeURIComponent(id)}`));
  }

  async authorize(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/gateway/authorize", body),
    );
  }

  /** Reference-only COMMIT: only the CommitToken identifier may be supplied. */
  async commit(body: { readonly commitTokenId: string }): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/gateway/commit", body),
    );
  }

}

/** Domain-neutral governed workflow client. Never exposes raw Gateway commit
 * or token construction; callers operate by workflow identity only. */
export class AgentRuntimeS2SClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: IdentityTokenProvider,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<S2SJsonResponse> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) {
      throw new Error("S2S identity token missing");
    }
    return fetchS2SJson({
      baseUrl: this.baseUrl,
      path,
      method,
      token,
      body,
    });
  }

  async submitWorkflow(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/workflows", body),
    );
  }

  async getWorkflow(workflowId: string): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call(
        "GET",
        `/internal/workflows/${encodeURIComponent(workflowId)}`,
      ),
    );
  }

  async resumeWorkflowApproval(
    workflowId: string,
    body: unknown,
  ): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call(
        "POST",
        `/internal/workflows/${encodeURIComponent(workflowId)}/resume-approval`,
        body,
      ),
    );
  }

  async commitWorkflow(workflowId: string): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call(
        "POST",
        `/internal/workflows/${encodeURIComponent(workflowId)}/commit`,
        {},
      ),
    );
  }

  async evaluatePreExecutionReadiness(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(
      await this.call("POST", "/internal/pre-execution-readiness", body),
    );
  }
}

/** Reference-only Authority evaluation client; intentionally exposes no grant or Gateway mutation. */
export interface AuthorityWorkflowReferences {
  readonly workflowId: string;
  readonly intentStateId: string;
  readonly intentStateHash: string;
  readonly workflow: { readonly id: string; readonly hash: string };
  readonly plan: { readonly id: string; readonly hash: string };
  readonly planVerification: { readonly id: string; readonly hash: string };
  readonly action: { readonly id: string; readonly hash: string };
  readonly guardian: { readonly id: string; readonly hash: string };
  readonly proofs: readonly { readonly id: string; readonly hash: string }[];
  readonly idempotencyKey: string;
  readonly correlationId?: string;
}

export class AuthorityS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  async evaluateWorkflow(body: AuthorityWorkflowReferences): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/authority/evaluate", method: "POST", token, body }));
  }
  async evaluateProcurement(body: AuthorityWorkflowReferences): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/authority/procurement", method: "POST", token, body }));
  }
  async getEvaluation(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/authority/evaluations/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  async bindAndMint(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/authority/bind-and-mint", method: "POST", token, body }));
  }
  /** Durable ApprovalRequest creation (scope is derived from the evaluation, never caller-supplied). */
  async createApproval(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/approvals", method: "POST", token, body }));
  }
  async decideApproval(id: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/approvals/${encodeURIComponent(id)}/decide`, method: "POST", token, body }));
  }
  async getApproval(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/approvals/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  /** Mandate-bound remedy evaluation: the Authority owner independently
   * validates the RemediationMandate before creating an executable record. */
  async evaluateRemedyProcurement(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/authority/remedy-evaluations", method: "POST", token, body }));
  }
}

export class LearningS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  async getTrustSignal(
    subjectType: "AGENT" | "COUNTERPARTY",
    subjectId: string,
    domain: string,
  ): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(
      await fetchS2SJson({
        baseUrl: this.baseUrl,
        path: `/internal/trust-signals/${encodeURIComponent(subjectType)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(domain)}`,
        method: "GET",
        token,
      }),
    );
  }
  async getPreference(
    subjectId: string,
    domain: string,
    concept: string,
  ): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(
      await fetchS2SJson({
        baseUrl: this.baseUrl,
        path: `/internal/preferences/${encodeURIComponent(subjectId)}/${encodeURIComponent(domain)}/${encodeURIComponent(concept)}`,
        method: "GET",
        token,
      }),
    );
  }
  async getWorkflowRule(
    subjectId: string,
    domain: string,
    concept: string,
  ): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(
      await fetchS2SJson({
        baseUrl: this.baseUrl,
        path: `/internal/workflow-rules/${encodeURIComponent(subjectId)}/${encodeURIComponent(domain)}/${encodeURIComponent(concept)}`,
        method: "GET",
        token,
      }),
    );
  }
}

/** Wave 4.3: reference-only MonitoringContract client. Never mints grants. */
export class MonitoringS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  async createContract(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/monitoring", method: "POST", token, body }));
  }
  async getContract(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/monitoring/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  async getByWorkflow(workflowId: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/monitoring/by-workflow/${encodeURIComponent(workflowId)}`, method: "GET", token }));
  }
  async recordSignal(id: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/monitoring/${encodeURIComponent(id)}/signals`, method: "POST", token, body }));
  }
  async markOutcomeFailure(id: string, body?: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/monitoring/${encodeURIComponent(id)}/outcome-failure`, method: "POST", token, body: body ?? {} }));
  }
}

/** Reference-only OutcomeContract creation client. */
/** Reference-only OutcomeContract creation client. */
export class OutcomeS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  async createContract(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/outcomes/contracts", method: "POST", token, body }));
  }
  async createProcurementContract(body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: "/internal/outcomes/procurement-contract", method: "POST", token, body }));
  }
  async getContract(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/outcomes/contracts/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  async evaluateEvidence(contractId: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/outcomes/${encodeURIComponent(contractId)}/evaluate-evidence`, method: "POST", token, body }));
  }
  async getResolutionCaseByContract(contractId: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/by-contract/${encodeURIComponent(contractId)}`, method: "GET", token }));
  }
  /** Owner-side contract CLOSE (SATISFIED/RESOLVED with no open case). */
  async closeContract(contractId: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/outcomes/contracts/${encodeURIComponent(contractId)}/close`, method: "POST", token, body: {} }));
  }
}

/** Reference-only Resolution owner client: case/mandate/remedy reads for the
 * independent authority evaluation of remedies. Exposes no case creation,
 * attribution, or remedy-execution mutation. */
export class ResolutionS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  async getCase(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  async getMandate(id: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/mandates/${encodeURIComponent(id)}`, method: "GET", token }));
  }
  async getRemedy(caseId: string, remedyId: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(caseId)}/remedies/${encodeURIComponent(remedyId)}`, method: "GET", token }));
  }
  async listRemedies(caseId: string): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(caseId)}/remedies`, method: "GET", token }));
  }
  /** Mandate issuance (policy approval) — server-derived bounds, caller supplies only expiry. */
  async issueRemediationMandate(caseId: string, remedyId: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(caseId)}/remedies/${encodeURIComponent(remedyId)}/mandates`, method: "POST", token, body }));
  }
  /** Remedy execution through the production PrivilegedRemedyPort. */
  async executeRemedy(caseId: string, remedyId: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(caseId)}/remedies/${encodeURIComponent(remedyId)}/execute`, method: "POST", token, body }));
  }
  /** Remedy outcome verification (owner-read contract state). */
  async verifyRemedyOutcome(caseId: string, body: unknown): Promise<Result<unknown>> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return s2sResultFromHttp(await fetchS2SJson({ baseUrl: this.baseUrl, path: `/internal/resolutions/cases/${encodeURIComponent(caseId)}/remedy-verification`, method: "POST", token, body }));
  }
}

/** Read-only evidence owner client. Coordinator callers never receive an evidence write method. */
export class EvidenceS2SClient {
  constructor(private readonly baseUrl: string, private readonly tokens: IdentityTokenProvider) {}
  private async call(method: string, path: string, body?: unknown): Promise<S2SJsonResponse> {
    const token = await this.tokens.getIdentityToken(this.baseUrl);
    if (!token) throw new Error("S2S identity token missing");
    return fetchS2SJson({ baseUrl: this.baseUrl, path, method, token, body });
  }
  async getEnvelope(id: string): Promise<Result<EvidenceEnvelope>> {
    return s2sResultFromHttp(await this.call("GET", `/internal/evidence/envelopes/${encodeURIComponent(id)}`));
  }
  async getClaim(id: string): Promise<Result<EvidenceClaim>> {
    return s2sResultFromHttp(await this.call("GET", `/internal/evidence/claims/${encodeURIComponent(id)}`));
  }
  async submitEvidence(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("POST", "/internal/evidence/submissions", body));
  }
  async verifyEvidence(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("POST", "/internal/evidence/verifications", body));
  }
  async submitAcceptanceFixture(body: unknown): Promise<Result<unknown>> {
    return s2sResultFromHttp(await this.call("POST", "/internal/evidence/acceptance-fixtures", body));
  }
}

