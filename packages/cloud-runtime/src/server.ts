import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { context as otelContext, SpanStatusCode } from "@opentelemetry/api";
import {
  endSpan,
  extractOrStartSpan,
  setSpanAttribute,
} from "@truemandate/observability";
import {
  decodePubSubPush,
  InMemoryPubSubBus,
  type PubSubTopic,
} from "@truemandate/cloud-pubsub";
import type { RuntimeConfig } from "./config.js";
import { eventHttpStatus } from "./event-status.js";
import {
  adcGoogleIdentityVerifier,
  callerAllowed,
  type InternalCallerIdentityVerifier,
  type VerifiedInternalCaller,
} from "./caller-identity.js";

export interface CloudRunHealthState {
  ready: boolean;
  reason?: string;
}

export interface ReadinessProbe {
  (): Promise<{ ready: boolean; reason?: string }>;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export interface InternalRouteRequest {
  readonly params: Record<string, string>;
  readonly body: unknown;
  readonly headers: IncomingMessage["headers"];
  readonly caller?: VerifiedInternalCaller;
}

export interface InternalRouteResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface InternalRoute {
  readonly method: string;
  readonly pattern: string;
  handler(req: InternalRouteRequest): Promise<InternalRouteResponse>;
  readonly allowedCallers?: readonly string[];
}

export function matchInternalPattern(
  pattern: string,
  path: string,
): Record<string, string> | undefined {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}

function hasAuthorization(headers: IncomingMessage["headers"]): boolean {
  const auth = headers.authorization;
  return typeof auth === "string" && auth.trim().length > 0;
}

export interface CloudRunServerOptions {
  readonly config: RuntimeConfig;
  readonly bus: InMemoryPubSubBus;
  readonly acceptedTopics: readonly PubSubTopic[];
  readonly health: CloudRunHealthState;
  readonly readinessProbe?: ReadinessProbe;
  readonly extraHealth?: Record<string, unknown>;
  readonly enableEvents: boolean;
  readonly internalRoutes?: readonly InternalRoute[];
  readonly identityVerifier?: InternalCallerIdentityVerifier;
}

export interface CloudRunHttpServer {
  readonly server: Server;
  readonly bus: InMemoryPubSubBus;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createCloudRunHttpServer(
  options: CloudRunServerOptions,
): CloudRunHttpServer {
  const {
    config,
    bus,
    acceptedTopics,
    health,
    readinessProbe,
    extraHealth,
    enableEvents,
    internalRoutes,
    identityVerifier = adcGoogleIdentityVerifier(),
  } = options;
  const accepted = new Set<string>(acceptedTopics);
  const routes = internalRoutes ?? [];

  const authDiagnostic = (input: {
    readonly path: string;
    readonly method: string;
    readonly authorizationPresent: boolean;
    readonly verification: "NOT_ATTEMPTED" | "FAILED" | "SUCCEEDED";
    readonly verifiedCallerEmail?: string;
    readonly allowlistResult: "NOT_EVALUATED" | "ALLOWED" | "DENIED";
    readonly routePolicyResult: "ALLOWED" | "DENIED";
  }) => {
    console.info(JSON.stringify({
      event: "internal_auth_verification",
      service: config.serviceName,
      expectedAudience: config.internalAuthAudience,
      ...input,
    }));
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    // Wave 2 observability: extract an inbound traceparent (if present) or
    // start a new root span for every request, on every route in this
    // handler (health, internal routes, and the Pub/Sub push endpoint).
    // Fail-open: extractOrStartSpan/endSpan never throw, so tracing failures
    // can never affect the response below.
    const { span, context: requestContext } = extractOrStartSpan(
      `${config.serviceName} ${method} ${path}`,
      req.headers,
      {
        "http.method": method,
        "http.route": path,
        "service.name": config.serviceName,
      },
    );

    void otelContext.with(requestContext, () => requestHandler(req, res, span));
  });

  async function requestHandler(
    req: IncomingMessage,
    res: ServerResponse,
    span: ReturnType<typeof extractOrStartSpan>["span"],
  ): Promise<void> {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/healthz") {
        sendJson(res, 200, {
          status: "ok",
          service: config.serviceName,
          ...extraHealth,
        });
        return;
      }

      if (method === "GET" && path === "/readyz") {
        const probed = readinessProbe
          ? await readinessProbe()
          : { ready: health.ready, reason: health.reason };
        if (!probed.ready) {
          sendJson(res, 503, {
            status: "not_ready",
            service: config.serviceName,
            reason: probed.reason ?? "not_ready",
          });
          return;
        }
        sendJson(res, 200, {
          status: "ready",
          service: config.serviceName,
          persistence: config.persistence,
          ...extraHealth,
        });
        return;
      }

      const matched = routes.find((route) => {
        if (route.method !== method) return false;
        return matchInternalPattern(route.pattern, path) !== undefined;
      });
      if (matched) {
        const authorizationPresent = hasAuthorization(req.headers);
        if (config.requireInternalAuth && !authorizationPresent) {
          authDiagnostic({ path, method, authorizationPresent, verification: "NOT_ATTEMPTED", allowlistResult: "NOT_EVALUATED", routePolicyResult: "DENIED" });
          sendJson(res, 401, { error: "UNAUTHENTICATED" });
          return;
        }
        let caller: VerifiedInternalCaller | undefined;
        if (config.requireInternalAuth && config.verifyInternalAuth) {
          caller = await identityVerifier.verify(
            req.headers,
            config.internalAuthAudience!,
          );
          if (!caller) {
            authDiagnostic({ path, method, authorizationPresent, verification: "FAILED", allowlistResult: "NOT_EVALUATED", routePolicyResult: "DENIED" });
            sendJson(res, 403, { error: "PERMISSION_DENIED" });
            return;
          }
          setSpanAttribute(span, "caller.email", caller.email);
        }
        const allowedCallers = matched.allowedCallers ?? config.internalAllowedCallers;
        if (
          config.requireInternalAuth &&
          allowedCallers.length > 0
        ) {
          if (!callerAllowed(caller?.email, allowedCallers)) {
            authDiagnostic({ path, method, authorizationPresent, verification: config.verifyInternalAuth ? "SUCCEEDED" : "NOT_ATTEMPTED", verifiedCallerEmail: caller?.email, allowlistResult: "DENIED", routePolicyResult: "DENIED" });
            sendJson(res, 403, { error: "PERMISSION_DENIED" });
            return;
          }
        }
        if (config.requireInternalAuth) {
          authDiagnostic({ path, method, authorizationPresent, verification: config.verifyInternalAuth ? "SUCCEEDED" : "NOT_ATTEMPTED", verifiedCallerEmail: caller?.email, allowlistResult: allowedCallers.length > 0 ? "ALLOWED" : "NOT_EVALUATED", routePolicyResult: "ALLOWED" });
        }
        const params = matchInternalPattern(matched.pattern, path) ?? {};
        let body: unknown = {};
        if (method !== "GET" && method !== "HEAD") {
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { error: "MALFORMED_JSON" });
            return;
          }
        }
        const result = await matched.handler({
          params,
          body,
          headers: req.headers,
          caller,
        });
        sendJson(res, result.status, result.body);
        return;
      }

      if (method === "POST" && path === "/internal/events") {
        if (!enableEvents) {
          sendJson(res, 404, { error: "NOT_FOUND" });
          return;
        }
        if (config.requirePushAuth && !hasAuthorization(req.headers)) {
          sendJson(res, 401, { error: "UNAUTHENTICATED" });
          return;
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          sendJson(res, 400, { error: "MALFORMED_JSON" });
          return;
        }

        const decoded = decodePubSubPush(body);
        if (!decoded.ok) {
          sendJson(res, 400, {
            error: "MALFORMED_EVENT",
            message: decoded.message,
          });
          return;
        }
        if (!accepted.has(decoded.value.topic)) {
          sendJson(res, 400, {
            error: "UNEXPECTED_TOPIC",
            topic: decoded.value.topic,
          });
          return;
        }

        const published = await bus.publish(
          decoded.value.topic,
          decoded.value.envelope,
        );
        const status = eventHttpStatus(published);
        if (!published.ok) {
          sendJson(res, status, {
            error: "EVENT_REJECTED",
            message: published.message,
            code: published.code,
          });
          return;
        }
        sendJson(res, status, { status: "ok" });
        return;
      }

      sendJson(res, 404, { error: "NOT_FOUND" });
    } catch (err) {
      sendJson(res, 500, {
        error: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Internal error",
      });
    } finally {
      setSpanAttribute(span, "http.status_code", res.statusCode);
      if (res.statusCode >= 500) {
        try {
          span?.setStatus({ code: SpanStatusCode.ERROR });
        } catch {
          // Fail-open: span status must never affect the response already sent.
        }
      }
      endSpan(span);
    }
  }

  return {
    server,
    bus,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
