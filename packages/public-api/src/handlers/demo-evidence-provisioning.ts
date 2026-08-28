import { z } from "zod";
import { ErrorCode, err } from "@truemandate/protocol";
import { callerAllowed, type InternalCallerIdentityVerifier } from "@truemandate/cloud-runtime";
import type { DemoEvidenceProvisionPort } from "../ports.js";
import { sendJson, sendResult, type RouteHandler } from "../http.js";

/**
 * Closed request shape: exactly these four identifiers, nothing else.
 * `.strict()` rejects any additional field outright — there is no field
 * through which a caller (compromised or not) could supply envelope,
 * claim, concept, value, confidence, trustClass, taint, or raw intent text.
 */
export const DemoEvidenceProvisioningRequestSchema = z
  .object({
    scenarioId: z.string().min(1),
    runId: z.string().min(1),
    intentId: z.string().min(1),
    intentStateId: z.string().min(1),
  })
  .strict();

export interface DemoEvidenceProvisioningAuth {
  readonly identityVerifier: InternalCallerIdentityVerifier;
  readonly audience: string;
  readonly allowedCallers: readonly string[];
}

/**
 * Application-level caller restriction, independent of and in addition to
 * Cloud Run IAM: only identities in `auth.allowedCallers` (deployed as
 * phase-c-verifier only) may reach this route at all. This check is
 * unconditional — not gated behind any config flag — since this handler is
 * the only enforcement point (public-bff's router has no built-in internal-
 * auth dispatch layer of its own, unlike createCloudRunHttpServer).
 */
export function createDemoEvidenceProvisioningHandler(
  port: DemoEvidenceProvisionPort,
  auth: DemoEvidenceProvisioningAuth,
): RouteHandler {
  return async ({ req, res, body }) => {
    const caller = await auth.identityVerifier.verify(req.headers, auth.audience);
    if (!callerAllowed(caller?.email, auth.allowedCallers)) {
      sendJson(res, 403, {
        error: { code: "PERMISSION_DENIED", message: "Unknown demo evidence provisioning caller" },
      });
      return;
    }

    const parsed = DemoEvidenceProvisioningRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid demo evidence provisioning request", {
          issues: parsed.error.issues,
        }),
      );
      return;
    }

    sendResult(res, await Promise.resolve(port.provisionDemoEvidence(parsed.data)));
  };
}
