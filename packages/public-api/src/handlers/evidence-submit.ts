import { PublicEvidenceSubmissionSchema } from "@truemandate/schemas";
import { ErrorCode, err } from "@truemandate/protocol";
import type { EvidenceSubmitPort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

export function createEvidenceSubmitHandler(port: EvidenceSubmitPort): RouteHandler {
  return async ({ res, body }) => {
    const parsed = PublicEvidenceSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      sendResult(
        res,
        err(ErrorCode.SCHEMA_PARSE_FAILED, "Invalid evidence submission request", {
          issues: parsed.error.issues,
        }),
      );
      return;
    }
    sendResult(res, await Promise.resolve(port.submitEvidence(parsed.data)));
  };
}
