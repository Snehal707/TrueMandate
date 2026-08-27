import type { ApprovalArtifact, Intent, Result } from "@truemandate/protocol";
import type { IntentWorkspaceView } from "@truemandate/read-model";
import type {
  PublicApprovalView,
  PublicEvidenceView,
  PublicOutcomeView,
  PublicResolutionCaseView,
} from "./dto.js";

/** Read-only canonical Phase C v5 projection (judge demo). Never mutates. */
export interface DemoCanonicalReadPort {
  readCanonicalPhaseCv5(): Promise<Result<unknown>> | Result<unknown>;
}

/** Injected port — public BFF must not import intent-service directly. */
export interface IntentCreatePort {
  createIntent(raw: unknown): Promise<Result<Intent>> | Result<Intent>;
}

/** Injected port — returns allowlisted workspace DTO only. */
export interface WorkspaceReadPort {
  /**
   * `workflowId` is additive and optional: a caller-supplied hint at which
   * workflow's durable artifacts to project into the response. It is never
   * trusted by itself — the implementation must verify the resolved workflow is
   * actually bound to `intentId` before using anything it contains. Omitting it
   * preserves the exact legacy response.
   */
  getWorkspace(
    intentId: string,
    workflowId?: string,
  ): Promise<Result<IntentWorkspaceView>> | Result<IntentWorkspaceView>;
}

/** Injected port — submit ApprovalArtifact only (no grant mint / commit). */
export interface ApprovalSubmitPort {
  submitApproval(raw: unknown): Promise<Result<ApprovalArtifact>> | Result<ApprovalArtifact>;
}

/** Injected port — allowed evidence metadata read (no privileged mutation). */
export interface EvidenceReadPort {
  getEvidence(id: string): Promise<Result<PublicEvidenceView>> | Result<PublicEvidenceView>;
}

/** Domain-neutral governed workflow submit (never a Gateway surface). */
export interface WorkflowSubmitPort {
  submitWorkflow(raw: unknown): Promise<Result<unknown>> | Result<unknown>;
}

/** Domain-neutral governed workflow read by workflow identity only. */
export interface WorkflowReadPort {
  getWorkflow(workflowId: string): Promise<Result<unknown>> | Result<unknown>;
}

/** Domain-neutral approval resumption by workflow identity only. */
export interface WorkflowResumePort {
  resumeWorkflow(workflowId: string, body: unknown): Promise<Result<unknown>> | Result<unknown>;
}

/** Domain-neutral COMMIT by workflow identity only. */
export interface WorkflowCommitPort {
  commitWorkflow(workflowId: string): Promise<Result<unknown>> | Result<unknown>;
}

/** Evidence is accepted by its owner before any outcome observation is emitted. */
export interface EvidenceSubmitPort {
  submitEvidence(raw: unknown): Promise<Result<unknown>> | Result<unknown>;
}

/** OutcomeContract inspection only. Never evaluate or mutate. */
export interface OutcomeReadPort {
  getOutcomeContract(id: string): Promise<Result<PublicOutcomeView>> | Result<PublicOutcomeView>;
}

/** Read a durable ApprovalRequest (hash-validated owner row). */
export interface ApprovalReadPort {
  getApproval(id: string): Promise<Result<PublicApprovalView>> | Result<PublicApprovalView>;
}

/**
 * Human decision on a PENDING durable ApprovalRequest. The owner service
 * derives decidedBy from the verified caller identity — the body carries only
 * {decision, reason}. Never mints grants or unlocks execution directly.
 */
export interface ApprovalDecidePort {
  decideApproval(id: string, body: unknown): Promise<Result<PublicApprovalView>> | Result<PublicApprovalView>;
}

/** Resolution inspection: case state, planned remedies, issued mandate. No
 * case creation, attribution, mandate issuance, or remedy execution. */
export interface ResolutionReadPort {
  getResolutionCase(id: string): Promise<Result<PublicResolutionCaseView>> | Result<PublicResolutionCaseView>;
  getResolutionCaseByOutcome(outcomeContractId: string): Promise<Result<PublicResolutionCaseView>> | Result<PublicResolutionCaseView>;
  listRemedies(caseId: string): Promise<Result<unknown>> | Result<unknown>;
  getMandate(id: string): Promise<Result<unknown>> | Result<unknown>;
}

export interface PublicBffPorts {
  readonly intentCreate: IntentCreatePort;
  readonly workspaceRead: WorkspaceReadPort;
  readonly approvalSubmit: ApprovalSubmitPort;
  readonly evidenceRead: EvidenceReadPort;
  /** Wave 1: durable human-approval lifecycle reads/decisions. */
  readonly approvalRead?: ApprovalReadPort;
  readonly approvalDecide?: ApprovalDecidePort;
  /** Wave 1: resolution/remedy inspection (never execution). */
  readonly resolutionRead?: ResolutionReadPort;
  readonly workflowSubmit?: WorkflowSubmitPort;
  readonly workflowRead?: WorkflowReadPort;
  readonly workflowResume?: WorkflowResumePort;
  readonly workflowCommit?: WorkflowCommitPort;
  readonly evidenceSubmit?: EvidenceSubmitPort;
  readonly outcomeRead?: OutcomeReadPort;
  readonly demoCanonical?: DemoCanonicalReadPort;
}
