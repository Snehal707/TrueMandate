import type { InternalRoute } from "@truemandate/cloud-runtime";
import { runDemoOrchestration, type DemoOrchestratorPorts } from "./demo-orchestrator.js";

/**
 * The one internal route this service exposes beyond the existing Phase C
 * acceptance job. Gated to whichever callers are configured
 * (TM_DEMO_PROVISION_CALLER_EMAILS — public-bff only, in the deployed
 * config). The route itself accepts nothing but the two path params;
 * everything else comes from the shared `@truemandate/demo-fixtures`
 * catalog (action/domainPayload/variants). Source evidence content is a
 * separate concern, handled by public-bff's own provisioning route — see
 * demo-orchestrator.ts's module docstring.
 */
export function createDemoInternalRoutes(
  ports: DemoOrchestratorPorts,
  allowedCallers: readonly string[],
): readonly InternalRoute[] {
  if (allowedCallers.length === 0) return [];
  return [
    {
      method: "POST",
      pattern: "/internal/demo/scenarios/:scenarioId/variants/:variantId/run",
      allowedCallers,
      handler: async ({ params }: { params: Record<string, string | undefined> }) => {
        const result = await runDemoOrchestration(ports, {
          scenarioId: params.scenarioId ?? "",
          variantId: params.variantId ?? "",
        });
        return result.ok
          ? { status: 200, body: result.value }
          : { status: result.details?.retryable === true ? 503 : 400, body: { error: result.code, message: result.message, details: result.details } };
      },
    },
  ];
}
