import type { PublicBffConfig } from "./config.js";
import { createHealthHandlers, type HealthState } from "./handlers/health.js";
import { createDemoCanonicalHandler } from "./handlers/demo-canonical.js";
import { createDemoOrchestrationHandler } from "./handlers/demo-orchestration.js";
import { createApprovalHandler } from "./handlers/approvals.js";
import { createApprovalReadHandler } from "./handlers/approval-read.js";
import { createApprovalDecideHandler } from "./handlers/approval-decide.js";
import { createEvidenceHandler } from "./handlers/evidence.js";
import { createEvidenceSubmitHandler } from "./handlers/evidence-submit.js";
import { createIntentHandler } from "./handlers/intents.js";
import { createProcurementWorkflowHandler } from "./handlers/procurement.js";
import {
  createWorkflowReadHandler,
  createWorkflowCommitHandler,
  createWorkflowResumeHandler,
  createWorkflowSubmitHandler,
} from "./handlers/workflows.js";
import { createOutcomeReadHandler } from "./handlers/outcomes.js";
import { createWorkspaceHandler } from "./handlers/workspace.js";
import {
  createResolutionCaseByOutcomeHandler,
  createResolutionCaseHandler,
  createResolutionMandateHandler,
  createResolutionRemediesHandler,
} from "./handlers/resolutions.js";
import {
  methodNotAllowed,
  notFound,
  readJsonBody,
  type RouteHandler,
} from "./http.js";
import type { PublicBffPorts } from "./ports.js";

interface Route {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: RouteHandler;
}

function route(
  method: "GET" | "POST",
  path: string,
  handler: RouteHandler,
): Route {
  const paramNames: string[] = [];
  const patternSource = path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return {
    method,
    pattern: new RegExp(`^${patternSource}$`),
    paramNames,
    handler,
  };
}

export function createPublicBffRouter(
  ports: PublicBffPorts,
  config: PublicBffConfig,
  healthState?: HealthState,
): (method: string, pathname: string, req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void> {
  const { healthz, readyz } = createHealthHandlers(config, healthState);

  const routes: Route[] = [
    route("GET", "/healthz", healthz),
    route("GET", "/readyz", readyz),
    route("POST", "/v1/intents", createIntentHandler(ports.intentCreate)),
    route("GET", "/v1/workspace/:intentId", createWorkspaceHandler(ports.workspaceRead)),
    route("POST", "/v1/approvals", createApprovalHandler(ports.approvalSubmit)),
    ...(ports.approvalRead
      ? [route("GET", "/v1/approvals/:id", createApprovalReadHandler(ports.approvalRead))]
      : []),
    ...(ports.approvalDecide
      ? [route("POST", "/v1/approvals/:id/decide", createApprovalDecideHandler(ports.approvalDecide))]
      : []),
    route("GET", "/v1/evidence/:id", createEvidenceHandler(ports.evidenceRead)),
    ...(ports.workflowSubmit
      ? [route("POST", "/v1/workflows", createWorkflowSubmitHandler(ports.workflowSubmit))]
      : []),
    ...(ports.workflowRead
      ? [route("GET", "/v1/workflows/:workflowId", createWorkflowReadHandler(ports.workflowRead))]
      : []),
    ...(ports.workflowResume
      ? [
          route(
            "POST",
            "/v1/workflows/:workflowId/resume-approval",
            createWorkflowResumeHandler(ports.workflowResume),
          ),
        ]
      : []),
    ...(ports.workflowCommit
      ? [
          route(
            "POST",
            "/v1/workflows/:workflowId/commit",
            createWorkflowCommitHandler(ports.workflowCommit),
          ),
        ]
      : []),
    ...(ports.resolutionRead
      ? [
          route("GET", "/v1/resolutions/cases/:id", createResolutionCaseHandler(ports.resolutionRead)),
          route(
            "GET",
            "/v1/resolutions/cases/by-outcome/:outcomeContractId",
            createResolutionCaseByOutcomeHandler(ports.resolutionRead),
          ),
          route("GET", "/v1/resolutions/cases/:id/remedies", createResolutionRemediesHandler(ports.resolutionRead)),
          route("GET", "/v1/resolutions/mandates/:id", createResolutionMandateHandler(ports.resolutionRead)),
        ]
      : []),
    ...(ports.outcomeRead
      ? [route("GET", "/v1/outcomes/contracts/:id", createOutcomeReadHandler(ports.outcomeRead))]
      : []),
    ...(ports.workflowSubmit
      ? [route("POST", "/v1/procurement/offers", createProcurementWorkflowHandler(ports.workflowSubmit))]
      : []),
    ...(ports.evidenceSubmit
      ? [route("POST", "/v1/evidence", createEvidenceSubmitHandler(ports.evidenceSubmit))]
      : []),
    ...(ports.demoCanonical
      ? [route("GET", "/v1/demo/canonical-phase-c-v5", createDemoCanonicalHandler(ports.demoCanonical))]
      : []),
    ...(ports.demoOrchestration
      ? [
          route(
            "POST",
            "/v1/demo/scenarios/:scenarioId/variants/:variantId/run",
            createDemoOrchestrationHandler(ports.demoOrchestration),
          ),
        ]
      : []),
  ];

  return async (method, pathname, req, res) => {
    const upper = method.toUpperCase();
    for (const r of routes) {
      if (r.method !== upper) continue;
      const match = r.pattern.exec(pathname);
      if (!match) continue;

      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? "");
      });

      const body = upper === "POST" ? await readJsonBody(req) : undefined;
      await r.handler({ req, res, params, body });
      return;
    }

    const allowed = routes.some((r) => r.pattern.test(pathname));
    if (allowed) {
      methodNotAllowed(res);
      return;
    }
    notFound(res);
  };
}
