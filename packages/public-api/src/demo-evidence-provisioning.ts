import { ErrorCode, err, type Intent, type IntentState, type Result } from "@truemandate/protocol";
import {
  contentHashFor,
  demoScenarioTemplate,
  evidenceClaimId,
  evidenceEnvelopeId,
} from "@truemandate/demo-fixtures";
import type { DemoEvidenceProvisionPort } from "./ports.js";

export interface DemoEvidenceProvisioningDeps {
  getIntent(intentId: string): Promise<Result<Intent>> | Result<Intent>;
  getTip(intentId: string): Promise<Result<IntentState>> | Result<IntentState>;
  submitEvidence(raw: unknown): Promise<Result<unknown>> | Result<unknown>;
}

/**
 * A-Prime content-authority boundary. The caller (demo-evidence-orchestrator,
 * running as phase-c-verifier) supplies only closed identifiers; every check
 * below runs BEFORE any evidence write, and evidence content is derived
 * exclusively from the server-owned @truemandate/demo-fixtures catalog —
 * never from the request. There is no code path here through which a
 * caller — compromised or not — can influence claim concept, value,
 * confidence, envelope source/contentHash, or trust class.
 */
export function createDemoEvidenceProvisionPort(
  deps: DemoEvidenceProvisioningDeps,
): DemoEvidenceProvisionPort {
  return {
    async provisionDemoEvidence(input): Promise<Result<unknown>> {
      const { scenarioId, runId, intentId, intentStateId } = input;

      const template = demoScenarioTemplate(scenarioId);
      if (!template) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown demo scenario", { scenarioId });
      }

      const expectedIntentId = `demo-${scenarioId}-${runId}-intent`;
      if (intentId !== expectedIntentId) {
        return err(ErrorCode.VALIDATION_FAILED, "intentId does not match the deterministic demo naming scheme", {
          scenarioId,
          runId,
          intentId,
          expectedIntentId,
        });
      }

      const intent = await Promise.resolve(deps.getIntent(intentId));
      if (!intent.ok) {
        return err(ErrorCode.VALIDATION_FAILED, "Unknown demo intent", { intentId });
      }
      if (intent.value.rawText !== template.rawText) {
        return err(
          ErrorCode.VALIDATION_FAILED,
          "Intent raw text does not match the expected server-owned scenario template",
          { intentId, scenarioId },
        );
      }

      const tip = await Promise.resolve(deps.getTip(intentId));
      if (!tip.ok) {
        return err(ErrorCode.VALIDATION_FAILED, "Intent has no compiled tip", { intentId });
      }
      if (tip.value.id !== intentStateId) {
        return err(ErrorCode.VALIDATION_FAILED, "intentStateId does not match the current compiled tip", {
          intentId,
          intentStateId,
          currentTipId: tip.value.id,
        });
      }

      // Only now, after every check above has passed, is content derived —
      // exclusively from the template, never from the request.
      const envelopeId = evidenceEnvelopeId(scenarioId, runId);
      const claimIds = template.evidenceClaims.map((claim) => evidenceClaimId(scenarioId, runId, claim.concept));
      const contentHash = contentHashFor(template);

      return Promise.resolve(
        deps.submitEvidence({
          envelopes: [
            {
              id: envelopeId,
              source: template.evidenceSource,
              contentHash,
              captureTime: template.evidenceCaptureTime,
              mimeType: "application/json",
            },
          ],
          claims: template.evidenceClaims.map((claim, index) => ({
            id: claimIds[index],
            evidenceId: envelopeId,
            concept: claim.concept,
            value: claim.value,
            confidence: 1,
          })),
          lineage: { intentId, intentStateId },
        }),
      );
    },
  };
}
