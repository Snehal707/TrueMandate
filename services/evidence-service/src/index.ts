export { EvidenceService } from "./service.js";
export { OutcomeEventBus } from "./event-bus.js";
export type { OutcomeEventHandler } from "./event-bus.js";
export {
  composeEvidenceSubmitCallerEmails,
  composeEvidenceReaderEmails,
  createEvidenceInternalRoutes,
  makeAcceptanceFixtureSchema,
  type AcceptanceFixtureWriter,
} from "./internal-routes.js";
export {
  normalizeEvidenceSubmission,
  validateEvidenceSubmissionLineage,
  type EvidenceSubmissionLineageDeps,
  type ValidatedEvidenceLineage,
} from "./submissions.js";
