import type {
  InternalRoute,
  InternalRouteRequest,
  InternalRouteResponse,
} from "@truemandate/cloud-runtime";
import type { CrossWorkflowAnalyticsService } from "@truemandate/analytics-query";
import type { Result } from "@truemandate/protocol";

/**
 * Read-only cross-workflow analytics routes.
 * Never mint grants, CommitTokens, or call Gateway.
 */
export interface AnalyticsQueryRoutePorts {
  readonly analytics: CrossWorkflowAnalyticsService;
}

function fromResult<T>(result: Result<T>): InternalRouteResponse {
  if (result.ok) return { status: 200, body: result.value };
  return {
    status: 400,
    body: { error: result.code, message: result.message },
  };
}

function parseWindow(req: InternalRouteRequest): {
  limit?: number;
  since?: string;
  until?: string;
} {
  // Window via optional headers (x-tm-limit / x-tm-since / x-tm-until).
  const headers = req.headers;
  const limitRaw = header(headers, "x-tm-limit");
  const since = header(headers, "x-tm-since");
  const until = header(headers, "x-tm-until");
  const limit =
    limitRaw !== undefined && limitRaw !== ""
      ? Number.parseInt(limitRaw, 10)
      : undefined;
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    since,
    until,
  };
}

function header(
  headers: InternalRouteRequest["headers"],
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

export function createAnalyticsQueryRoutes(
  ports: AnalyticsQueryRoutePorts,
): readonly InternalRoute[] {
  return [
    {
      method: "GET",
      pattern: "/internal/analytics/weakened-constraints",
      async handler(req) {
        return fromResult(
          await ports.analytics.weakenedConstraints(parseWindow(req)),
        );
      },
    },
    {
      method: "GET",
      pattern: "/internal/analytics/guardian-intervention-agents",
      async handler(req) {
        return fromResult(
          await ports.analytics.guardianInterventionAgents(parseWindow(req)),
        );
      },
    },
    {
      method: "GET",
      pattern: "/internal/analytics/counterparty-outcome-correlation",
      async handler(req) {
        return fromResult(
          await ports.analytics.counterpartyOutcomeCorrelation(parseWindow(req)),
        );
      },
    },
    {
      method: "GET",
      pattern: "/internal/analytics/ambiguity-blocked-correlation",
      async handler(req) {
        return fromResult(
          await ports.analytics.ambiguityBlockedCorrelation(parseWindow(req)),
        );
      },
    },
    {
      method: "GET",
      pattern: "/internal/analytics/remedy-restoration-rate",
      async handler(req) {
        return fromResult(
          await ports.analytics.remedyRestorationRate(parseWindow(req)),
        );
      },
    },
    {
      method: "GET",
      pattern: "/internal/analytics/provenance-traversal/:startNodeId",
      async handler(req) {
        const startNodeId = req.params.startNodeId;
        if (!startNodeId) {
          return { status: 400, body: { error: "MISSING_START_NODE" } };
        }
        const depthRaw = header(req.headers, "x-tm-max-depth");
        const maxDepth =
          depthRaw !== undefined && depthRaw !== ""
            ? Number.parseInt(depthRaw, 10)
            : undefined;
        return fromResult(
          await ports.analytics.provenanceTraversal({
            startNodeId,
            maxDepth: Number.isFinite(maxDepth) ? maxDepth : undefined,
          }),
        );
      },
    },
  ];
}
