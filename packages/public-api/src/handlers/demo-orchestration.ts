import { z } from "zod";
import { ErrorCode, err } from "@truemandate/protocol";
import { sendResult, type RouteHandler } from "../http.js";
import type { DemoOrchestrationPort } from "../ports.js";

/**
 * Strict allowlisted enums — the entire request surface. There is no field
 * here for an action, a domain payload, a claim, evidence content, or a
 * free-text intent: the browser selects which of a small number of
 * predefined demos to run, never what that demo contains.
 */
const ScenarioIdSchema = z.enum([
  "procurement",
  "travel",
  "saas_it_spend",
  "invoice_vendor_payment",
  "logistics_fulfillment",
]);
const VariantIdSchema = z.enum([
  "control",
  "quantity_drift",
  "provider_substitution",
  "capability_expansion",
  "destination_substitution",
  "payee_substitution",
  "renewal_flip",
]);

export function createDemoOrchestrationHandler(port: DemoOrchestrationPort): RouteHandler {
  return async ({ res, params }) => {
    const scenarioId = ScenarioIdSchema.safeParse(params.scenarioId);
    const variantId = VariantIdSchema.safeParse(params.variantId);
    if (!scenarioId.success || !variantId.success) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Unknown demo scenario/variant", {
          issues: [...(scenarioId.success ? [] : scenarioId.error.issues), ...(variantId.success ? [] : variantId.error.issues)],
        }),
      );
      return;
    }
    const result = await port.runScenario(scenarioId.data, variantId.data);
    sendResult(res, result);
  };
}
