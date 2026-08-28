import { useEffect, useState } from "react";
import { createSdkCore, type IntentWorkspaceView, type Result, type SdkApprovalView, type SdkEvidenceView, type SdkOutcomeView, type SdkResolutionCaseView, type SdkWorkflowCommitResult, type SdkWorkflowRequest, type SdkWorkflowView } from "@truemandate/sdk-core";
import {
  buildLiveDemoWorkflowRequest,
  buildOutcomeEvidenceSubmission,
  LIVE_DEMO_DOMAINS,
  outcomeActionsForDomain,
  resolveCustomPackId,
  type LiveDemoDomainId,
  type RealPackId,
} from "./liveDemoPresets";
import { GovernanceReport } from "./GovernanceReport";
import { LiveProvenanceGraph } from "./LiveProvenanceGraph";
import { ProductTruthBadge } from "./ProductTruth";
import { sanitizePublicPresentationValue } from "./presentationSecurity";
import {
  submitFreshWorkflowWhenReady,
  type FreshWorkflowProgress,
} from "./freshWorkflowSubmission";
import {
  buildGovernanceReport,
  buildLiveProvenanceModel,
  intentIdFromRequest,
  type LiveEvidenceRecord,
} from "./liveWorkflowTruth";
import {
  deriveRunSummary,
  provenanceClaim,
  type EconomicEffectValue,
  type RunSummary,
} from "./live-run-summary";
import {
  classifyFailure,
  deriveStageRail,
  railProgressLabel,
  railStatusLabel,
  type RailStage,
} from "./live-stage-rail";

const sdk = createSdkCore({ baseUrl: "", timeoutMs: 120_000 });

/** The governed path, in the order this page runs it. */
const LIVE_PIPELINE_STAGES: readonly { stage: string; title: string; body: string }[] = [
  { stage: "intent", title: "Human intent", body: "Recorded immutably, before any agent touches it." },
  { stage: "verification", title: "Semantic verification", body: "What it means is proven, not assumed." },
  { stage: "authority", title: "Authority", body: "Permission is bounded, scoped, and revocable." },
  { stage: "execution", title: "Execution", body: "The governed action runs exactly once, or not at all." },
  { stage: "provenance", title: "Provenance", body: "Evidence shows what actually happened." },
];

type AsyncState = "idle" | "working";

type LiveDemoError = {
  readonly code?: string;
  readonly message: string;
};

export type LiveRunState = {
  readonly createdAt: string;
  readonly domainId: LiveDemoDomainId;
  readonly customPackId?: RealPackId;
  readonly request: SdkWorkflowRequest;
  readonly workflow: SdkWorkflowView;
  readonly workspace?: IntentWorkspaceView;
  readonly approval?: SdkApprovalView;
  readonly outcome?: SdkOutcomeView;
  readonly resolution?: SdkResolutionCaseView;
  readonly commit?: SdkWorkflowCommitResult;
  readonly evidenceSubmissions: readonly LiveEvidenceRecord[];
};

type LiveWorkflowView = "lifecycle" | "provenance" | "governance-report";

function toError(error: { code: string; message: string } | { message: string } | unknown): LiveDemoError {
  if (typeof error === "object" && error !== null) {
    const message =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Unexpected backend error";
    const code =
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return { code, message };
  }
  return { message: String(error) };
}

function fmtDateTime(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 19)} UTC`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const row = asRecord(value);
  return row && typeof row[key] === "string" ? String(row[key]) : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const row = asRecord(value);
  return row && typeof row[key] === "boolean" ? Boolean(row[key]) : undefined;
}

function nestedString(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const part of path) {
    const row = asRecord(current);
    if (!row || !(part in row)) return undefined;
    current = row[part];
  }
  return typeof current === "string" ? current : undefined;
}

function nestedBoolean(value: unknown, path: readonly string[]): boolean | undefined {
  let current: unknown = value;
  for (const part of path) {
    const row = asRecord(current);
    if (!row || !(part in row)) return undefined;
    current = row[part];
  }
  return typeof current === "boolean" ? current : undefined;
}

export function sanitizeLiveDisplayValue(value: unknown): unknown {
  return sanitizePublicPresentationValue(value);
}

function extractApprovalId(workflow?: SdkWorkflowView): string | undefined {
  return stringField(workflow?.approval, "id");
}

function extractOutcomeContractId(workflow?: SdkWorkflowView): string | undefined {
  return stringField(workflow?.outcomeContract, "id");
}

function extractMonitoringId(workflow?: SdkWorkflowView): string | undefined {
  return stringField(workflow?.monitoringContract, "id");
}

function extractEvaluationDecision(workflow?: SdkWorkflowView): string | undefined {
  return nestedString(workflow?.evaluation, ["evaluation", "decision"]) ??
    stringField(workflow?.evaluation, "decision");
}

function extractMaterializationEligible(workflow?: SdkWorkflowView): boolean | undefined {
  return nestedBoolean(workflow?.evaluation, ["evaluation", "materializationEligible"]) ??
    booleanField(workflow?.evaluation, "materializationEligible");
}

function linkedIntentIds(run: LiveRunState): {
  readonly intentId?: string;
  readonly intentStateId?: string;
} {
  return {
    intentId:
      run.workspace?.summary.intentId ??
      run.outcome?.intentId ??
      run.approval?.intentId ??
      run.resolution?.intentId ??
      intentIdFromRequest(run.request),
    intentStateId:
      run.workspace?.summary.intentStateId ??
      run.outcome?.intentStateId ??
      run.approval?.intentStateId ??
      run.resolution?.intentStateId,
  };
}

/**
 * Narrow port this refresh needs — the same "inject the exact dependency, not
 * the whole SDK singleton" pattern `freshWorkflowSubmission.ts` already uses,
 * so this exact binding logic (which workflowId a workspace read is bound to)
 * is independently testable without a live transport.
 */
export interface RefreshWorkflowSdk {
  readWorkflow(workflowId: string): Promise<Result<SdkWorkflowView>>;
  readWorkspace(intentId: string, workflowId?: string): Promise<Result<IntentWorkspaceView>>;
  readApproval(approvalId: string): Promise<Result<SdkApprovalView>>;
  readOutcome(outcomeContractId: string): Promise<Result<SdkOutcomeView>>;
  readResolutionCase(resolutionCaseId: string): Promise<Result<SdkResolutionCaseView>>;
  readResolutionByOutcome(outcomeContractId: string): Promise<Result<SdkResolutionCaseView>>;
}

export async function refreshWorkflowChain(
  workflowSdk: RefreshWorkflowSdk,
  run: LiveRunState,
): Promise<LiveRunState> {
  const workflowResult = await workflowSdk.readWorkflow(run.workflow.workflowId);
  if (!workflowResult.ok) {
    throw workflowResult;
  }

  const workflow = workflowResult.value;
  const intentId = run.workspace?.summary.intentId ??
    run.outcome?.intentId ??
    run.approval?.intentId ??
    intentIdFromRequest(run.request);
  const approvalId = extractApprovalId(workflow);
  const outcomeContractId = extractOutcomeContractId(workflow);

  const approvalResult =
    approvalId ? await workflowSdk.readApproval(approvalId) : undefined;
  if (approvalResult && !approvalResult.ok) {
    throw approvalResult;
  }

  const outcomeResult =
    outcomeContractId ? await workflowSdk.readOutcome(outcomeContractId) : undefined;
  if (outcomeResult && !outcomeResult.ok) {
    throw outcomeResult;
  }

  let resolution: SdkResolutionCaseView | undefined;
  const resolutionId = outcomeResult?.ok ? outcomeResult.value.resolutionCaseId : undefined;
  if (resolutionId) {
    const resolutionResult = await workflowSdk.readResolutionCase(resolutionId);
    if (!resolutionResult.ok) throw resolutionResult;
    resolution = resolutionResult.value;
  } else if (outcomeContractId) {
    const byOutcome = await workflowSdk.readResolutionByOutcome(outcomeContractId);
    if (byOutcome.ok) resolution = byOutcome.value;
  }

  // Bound to THIS run's exact intentId + workflowId pair, every refresh. The
  // backend independently verifies the workflow actually belongs to intentId
  // before projecting anything from it, but the pair must still always be
  // read together — never intentId from one run's binding with a workflowId
  // left over from another.
  const workspaceResult = intentId
    ? await workflowSdk.readWorkspace(intentId, workflow.workflowId)
    : undefined;

  return {
    ...run,
    workflow,
    workspace: workspaceResult?.ok ? workspaceResult.value : run.workspace,
    approval: approvalResult?.ok ? approvalResult.value : undefined,
    outcome: outcomeResult?.ok ? outcomeResult.value : undefined,
    resolution,
  };
}

function DomainSelector(props: {
  readonly selected: LiveDemoDomainId;
  readonly onSelect: (id: LiveDemoDomainId) => void;
}) {
  return (
    <div className="tm-live-domain-grid" role="tablist" aria-label="Live demo domains">
      {LIVE_DEMO_DOMAINS.map((domain) => (
        <button
          key={domain.id}
          type="button"
          role="tab"
          aria-selected={props.selected === domain.id ? "true" : "false"}
          className={`tm-live-domain-card${props.selected === domain.id ? " active" : ""}`}
          onClick={() => props.onSelect(domain.id)}
        >
          <span className="tm-live-domain-label">{domain.label}</span>
          <span className="tm-live-domain-summary">{domain.summary}</span>
        </button>
      ))}
    </div>
  );
}

function JsonBlock(props: { readonly label: string; readonly value: unknown }) {
  return (
    <details className="tm-live-details">
      <summary>{props.label}</summary>
      <pre>{JSON.stringify(sanitizeLiveDisplayValue(props.value), null, 2)}</pre>
    </details>
  );
}

/**
 * Fail-closed presentation. A refusal, an unavailable verifier, and a transport
 * failure are three different things and must not look alike — and none of them
 * may read as a successful or unsafe execution.
 */
export function FailClosedPanel(props: { readonly error: LiveDemoError }) {
  const failure = classifyFailure(props.error.code ?? "LIVE_DEMO_ERROR")!;
  return (
    <section className={`tm-failclosed ${failure.kind}`} role="alert">
      <div className="tm-failclosed-body">
        <strong>{failure.headline}</strong>
        <p>{failure.explanation}</p>
        <p className="tm-failclosed-effect">{failure.economicEffect}</p>
      </div>
      <details className="tm-failclosed-detail">
        <summary>Technical detail</summary>
        <div className="body">
          <code>{props.error.code ?? "LIVE_DEMO_ERROR"}</code>
          <span>{props.error.message}</span>
        </div>
      </details>
    </section>
  );
}

/**
 * RESULT SUMMARY — the answer to "what happened?", above the fold.
 *
 * A judge must be able to answer five questions without opening a tab: what was
 * asked, what was verified, why it stopped, whether it was authorized or
 * executed, and whether anything economic happened. Every value here comes from
 * `deriveRunSummary`, which reads returned artifacts only — the same derivation
 * the Governance Report and the provenance lead use, so they cannot contradict
 * each other the way the rail and the report once did.
 */
const OUTCOME_TONE: Readonly<Record<string, string>> = {
  "authorized-executed": "good",
  "authorized-pending": "info",
  "awaiting-approval": "monitoring",
  "blocked-by-governance": "warn",
  "stopped-unavailable": "warn",
  "in-progress": "info",
  "request-failed": "neutral",
  "no-run": "neutral",
};

const ECONOMIC_TONE: Readonly<Record<EconomicEffectValue, string>> = {
  ZERO: "good",
  RECORDED: "info",
  UNKNOWN: "warn",
};

export function ResultSummaryCard(props: {
  readonly summary: RunSummary;
  readonly workflowId: string;
  readonly createdAt: string;
}) {
  const { summary } = props;
  return (
    <section
      className={`tm-result-summary ${summary.outcomeClass}`}
      aria-label="Result summary"
      data-outcome={summary.outcomeClass}
    >
      <header>
        <div>
          <p className="tm-live-kicker">Result</p>
          <h3>{summary.headline}</h3>
        </div>
        <span className={`tm-badge ${OUTCOME_TONE[summary.outcomeClass] ?? "neutral"}`}>
          {summary.terminal ? "Terminal" : "In progress"}
        </span>
      </header>

      {summary.reason ? (
        <p className="tm-result-reason">
          <b>Why</b>
          {summary.reason}
        </p>
      ) : null}

      <div className="tm-result-columns">
        <div className="tm-result-column succeeded">
          <p className="tm-live-kicker">What succeeded</p>
          {summary.succeeded.length ? (
            <ul>
              {summary.succeeded.map((fact) => (
                <li key={fact.label}>
                  <span>{fact.label}</span>
                  {fact.detail ? <code>{fact.detail}</code> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tm-result-empty">
              {summary.terminal ? "Nothing was returned." : "Nothing has been returned yet."}
            </p>
          )}
        </div>
        <div className="tm-result-column blocked">
          <p className="tm-live-kicker">What did not happen</p>
          {summary.didNotHappen.length ? (
            <ul>
              {summary.didNotHappen.map((fact) => (
                <li key={fact.label}>
                  <span>{fact.label}</span>
                  {fact.detail ? <code>{fact.detail}</code> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tm-result-empty">Every governed stage completed.</p>
          )}
        </div>
      </div>

      <div className="tm-result-effect" data-effect={summary.economicEffect.value}>
        <span className="tm-live-kicker">Economic effect</span>
        <strong className={`tm-badge ${ECONOMIC_TONE[summary.economicEffect.value]}`}>
          {summary.economicEffect.value}
        </strong>
        <p>{summary.economicEffect.statement}</p>
      </div>

      <div className="tm-result-meta">
        <code>{props.workflowId}</code>
        <span>{fmtDateTime(props.createdAt)}</span>
      </div>
    </section>
  );
}

/**
 * Creating a fresh workflow is a genuinely long operation: the intent is
 * recorded, its verified state finalizes asynchronously, and only then is the
 * governed workflow submitted against that exact state. Both legs are real
 * model-backed work, so the wait can run to minutes.
 *
 * A single frozen "Creating…" label makes that look like a hang. This panel
 * shows where the client actually is. Every line is a fact about this browser —
 * a request it has outstanding, or a poll it has performed — never a claim that
 * the backend has reported a stage.
 */
const SUBMISSION_STEPS = [
  {
    id: "recording-intent",
    stage: "intent",
    label: "Recording the intent",
    plain: "Sending the request to the deployed public workflow route.",
  },
  {
    id: "awaiting-intent-state",
    stage: "verification",
    label: "Waiting for the verified intent state",
    plain: "The intent is recorded. Its verified state is still being finalized.",
  },
  {
    id: "submitting-workflow",
    stage: "planning",
    label: "Submitting the governed workflow",
    plain: "Bound to the finalized intent state. Waiting for the governed result.",
  },
] as const;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function SubmissionProgressPanel(props: {
  readonly progress: FreshWorkflowProgress;
  readonly elapsedSeconds: number;
}) {
  const activeIndex = SUBMISSION_STEPS.findIndex((step) => step.id === props.progress.phase);
  return (
    <section
      className="tm-submitting"
      aria-live="polite"
      aria-label="Live workflow submission progress"
    >
      <header>
        <p className="tm-live-kicker">Creating live workflow</p>
        <span className="tm-submitting-elapsed">{formatElapsed(props.elapsedSeconds)} elapsed</span>
      </header>
      <ol className="tm-submitting-steps">
        {SUBMISSION_STEPS.map((step, index) => {
          const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "waiting";
          return (
            <li
              key={step.id}
              className={`tm-submitting-step ${status}`}
              data-stage={step.stage}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <span className="label">{step.label}</span>
              <span className="plain">{step.plain}</span>
              {status === "active" && props.progress.phase === "awaiting-intent-state" ? (
                <span className="detail">
                  Checked {props.progress.polls}{" "}
                  {props.progress.polls === 1 ? "time" : "times"}
                </span>
              ) : null}
              {status === "active" && props.progress.phase === "submitting-workflow" ? (
                <code className="detail">{props.progress.intentStateId}</code>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="tm-submitting-note">
        Every stage is real verification against the deployed backend, so this takes as long as
        the live pipeline takes. Nothing here is simulated or replayed.
      </p>
    </section>
  );
}

/**
 * Judge-readable rail over the real lifecycle. Status comes entirely from
 * deriveStageRail — this component renders, it never decides.
 */
export function StageRail(props: { readonly stages: readonly RailStage[] }) {
  return (
    <section className="tm-rail" aria-label="Workflow progress">
      <header className="tm-rail-head">
        <h4>Workflow progress</h4>
        <span>{railProgressLabel(props.stages)}</span>
      </header>
      <ol className="tm-rail-track">
        {props.stages.map((stage) => (
          <li
            key={stage.id}
            className={`tm-rail-stage ${stage.status}`}
            data-stage={stage.id}
            aria-current={stage.status === "active" ? "step" : undefined}
          >
            <span className="dot" aria-hidden="true" />
            <span className="label">{stage.label}</span>
            <span className="status">{railStatusLabel(stage.status)}</span>
            <span className="plain">{stage.plain}</span>
            {stage.detail ? <code className="detail">{stage.detail}</code> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * What the human actually asked for.
 *
 * The request is rendered verbatim from the submitted SdkWorkflowRequest — never
 * summarised, rewritten, or reconstructed from downstream artifacts. Where that
 * text came from is stated explicitly, because "submitted in this session" and
 * "confirmed against the backend's recorded intent" are different claims.
 *
 * The verified interpretation (the constraints the system extracted) is a
 * separate, separately-labelled field. It is never presented as the request.
 */
export function OriginalRequestCard(props: { readonly run: LiveRunState }) {
  const { run } = props;
  const submitted = run.request.intent.kind === "RAW" ? run.request.intent.rawText : undefined;
  const recorded = run.workspace?.summary.rawIntent;
  const constraints = run.workspace?.semantic?.constraints ?? [];

  const diverged = submitted !== undefined && recorded !== undefined && submitted !== recorded;

  let sourceBadge: { readonly tone: string; readonly text: string };
  if (submitted === undefined) {
    sourceBadge = recorded !== undefined
      ? { tone: "neutral", text: "Recorded intent · not submitted from this session" }
      : { tone: "warn", text: "Original request unavailable" };
  } else if (diverged) {
    sourceBadge = { tone: "warn", text: "Submitted text differs from the recorded intent" };
  } else if (recorded !== undefined) {
    sourceBadge = { tone: "good", text: "Confirmed by the recorded intent" };
  } else {
    sourceBadge = { tone: "info", text: "Submitted in this session · not yet read back" };
  }

  // Show the submitted text when we have it; fall back to the recorded intent
  // only when nothing was submitted from this client.
  const primary = submitted ?? recorded;

  return (
    <section className="tm-request-card" aria-label="Original request">
      <header>
        <p className="tm-live-kicker">Original request</p>
        <span className={`tm-badge ${sourceBadge.tone}`}>{sourceBadge.text}</span>
      </header>

      {primary === undefined ? (
        <p className="tm-request-missing">
          No human request text is available for this workflow. Nothing is inferred from
          downstream artifacts.
        </p>
      ) : (
        <blockquote className="tm-request-text">{primary}</blockquote>
      )}

      {diverged ? (
        <div className="tm-request-diverged">
          <p className="tm-live-kicker">Recorded intent returned by the backend</p>
          <blockquote className="tm-request-text alt">{recorded}</blockquote>
        </div>
      ) : null}

      <div className="tm-request-meta">
        <span className="tm-request-domain">
          <b>Domain</b>
          {liveDomainLabel(run.domainId, run.customPackId)}
        </span>
        <code className="tm-request-workflow">{run.workflow.workflowId}</code>
      </div>

      <details className="tm-request-interpretation">
        <summary>
          Verified interpretation
          <span>
            {constraints.length > 0
              ? `${constraints.length} constraint${constraints.length === 1 ? "" : "s"} extracted`
              : "Not returned yet"}
          </span>
        </summary>
        <div className="body">
          <p className="tm-request-interpretation-note">
            What the runtime proved this request means. This is the system&rsquo;s interpretation,
            not the human&rsquo;s wording.
          </p>
          {constraints.length > 0 ? (
            <ul>
              {constraints.map((constraint) => (
                <li key={constraint.id}>
                  <b>{constraint.concept}</b>
                  <span>{constraint.operator}</span>
                  <code>{String(constraint.expectedValue)}</code>
                  <em>{constraint.criticality}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tm-request-interpretation-empty">
              No public constraint set has been returned for this workflow yet.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

export const STAGE_CARD_LABELS = {
  present: "LIVE",
  waiting: "Not returned yet",
  "not-reached": "Not reached",
  "not-executed": "Not executed",
  "not-created": "Not created",
  // Same vocabulary the rail uses for the stage a terminal run stopped at.
  stopped: "Stopped here",
} as const;

type StageCardState = keyof typeof STAGE_CARD_LABELS;

/** True for states that can never change for this workflow. */
function isTerminalCardState(state: StageCardState): boolean {
  return state !== "present" && state !== "waiting";
}

/**
 * Wording for an absent value, tensed by whether the run can still progress.
 *
 * "yet" promises a future arrival. On a workflow that has terminally stopped,
 * that promise is false — the artifact is never coming.
 */
function absentValue(terminal: boolean, terminalText: string, pendingText: string): string {
  return terminal ? terminalText : pendingText;
}

function StageCard(props: {
  readonly title: string;
  /** `not-reached` / `not-executed` are terminal: this stage will never run. */
  readonly state: StageCardState;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly details?: unknown;
}) {
  return (
    <section
      className={`tm-live-stage${props.state === "present" ? " present" : ""}${
        isTerminalCardState(props.state) ? " not-reached" : ""
      }`}
    >
      <header>
        <h4>{props.title}</h4>
        <span>{STAGE_CARD_LABELS[props.state]}</span>
      </header>
      <div className="tm-live-stage-body">
        {props.rows.map((row) => (
          <div key={`${props.title}-${row.label}`} className="tm-live-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
        {props.rows.length === 0 ? (
          <p className="tm-live-empty">
            No public-safe artifact for this stage has been returned yet.
          </p>
        ) : null}
      </div>
      {props.details !== undefined ? (
        <JsonBlock label={`${props.title} payload`} value={props.details} />
      ) : null}
    </section>
  );
}

function liveDomainLabel(domainId: LiveDemoDomainId, customPackId?: RealPackId): string {
  const resolved = resolveCustomPackId(domainId, customPackId);
  return LIVE_DEMO_DOMAINS.find((entry) => entry.id === domainId)?.label ??
    resolved;
}

export function LiveDemoPage() {
  const [domainId, setDomainId] = useState<LiveDemoDomainId>("travel");
  const [customPackId, setCustomPackId] = useState<RealPackId>("travel");
  const [customRawText, setCustomRawText] = useState(
    "Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5000 before December 31, 2026, with check-in on December 20 and checkout on December 22.",
  );
  const [pending, setPending] = useState<AsyncState>("idle");
  const [refreshing, setRefreshing] = useState<AsyncState>("idle");
  const [run, setRun] = useState<LiveRunState | undefined>();
  const [error, setError] = useState<LiveDemoError | undefined>();
  const [workflowView, setWorkflowView] = useState<LiveWorkflowView>("lifecycle");
  const [progress, setProgress] = useState<FreshWorkflowProgress | undefined>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Keyed on presence, not identity, so a phase change does not restart the clock.
  const submitting = Boolean(progress);
  useEffect(() => {
    if (!submitting) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);

  const selectedLabel = liveDomainLabel(domainId, customPackId);
  const activeOutcomeActions = outcomeActionsForDomain(domainId, customPackId);

  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const refreshed = await refreshWorkflowChain(sdk, run);
          setRun(refreshed);
        } catch {
          // Leave the existing run visible; explicit refresh surfaces errors.
        }
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [run]);

  const launchFreshWorkflow = async () => {
    setPending("working");
    setError(undefined);
    // Clear the previous run's intentId/workflowId binding before the new one
    // is established, so no stale workflow can be polled or displayed while
    // this submission is in flight.
    setRun(undefined);
    try {
      const request = buildLiveDemoWorkflowRequest(domainId, {
        rawText: domainId === "custom_intent" ? customRawText : undefined,
        customPackId,
      });
      const result = await submitFreshWorkflowWhenReady(sdk, request, {
        onProgress: setProgress,
      });
      if (!result.ok) throw result;
      const initialRun: LiveRunState = {
        createdAt: new Date().toISOString(),
        domainId,
        customPackId: domainId === "custom_intent" ? customPackId : undefined,
        request,
        workflow: result.value,
        evidenceSubmissions: [],
      };
      const refreshed = await refreshWorkflowChain(sdk, initialRun).catch(() => initialRun);
      setRun(refreshed);
      setWorkflowView("lifecycle");
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
      setProgress(undefined);
    }
  };

  const refreshLiveState = async () => {
    if (!run) return;
    setRefreshing("working");
    setError(undefined);
    try {
      setRun(await refreshWorkflowChain(sdk, run));
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setRefreshing("idle");
    }
  };

  const approveAndResume = async () => {
    if (!run) return;
    const approvalId = run.approval?.id ?? extractApprovalId(run.workflow);
    if (!approvalId) return;
    setPending("working");
    setError(undefined);
    try {
      const decided = await sdk.decideApproval(approvalId, {
        decision: "APPROVE",
        reason: "Live Demo controlled approval path",
      });
      if (!decided.ok) throw decided;
      const resumed = await sdk.resumeWorkflow(run.workflow.workflowId, {
        approvalId,
      });
      if (!resumed.ok) throw resumed;
      setRun(
        await refreshWorkflowChain(sdk, {
          ...run,
          workflow: resumed.value,
          approval: decided.value,
        }),
      );
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
    }
  };

  const denyApproval = async () => {
    if (!run) return;
    const approvalId = run.approval?.id ?? extractApprovalId(run.workflow);
    if (!approvalId) return;
    setPending("working");
    setError(undefined);
    try {
      const decided = await sdk.decideApproval(approvalId, {
        decision: "DENY",
        reason: "Live Demo controlled denial path",
      });
      if (!decided.ok) throw decided;
      setRun({ ...run, approval: decided.value });
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
    }
  };

  const commitAuthorizedWorkflow = async () => {
    if (!run) return;
    setPending("working");
    setError(undefined);
    try {
      const committed = await sdk.commitWorkflow(run.workflow.workflowId);
      if (!committed.ok) throw committed;
      setRun(
        await refreshWorkflowChain(sdk, {
          ...run,
          commit: committed.value,
        }),
      );
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
    }
  };

  const submitOutcomeEvidence = async (actionId: string, label: string) => {
    if (!run) return;
    const outcomeContractId = run.outcome?.id ?? extractOutcomeContractId(run.workflow);
    if (!outcomeContractId) return;
    const ids = linkedIntentIds(run);
    setPending("working");
    setError(undefined);
    try {
      const submission = buildOutcomeEvidenceSubmission(
        run.domainId,
        actionId,
        {
          workflowId: run.workflow.workflowId,
          intentId: ids.intentId,
          intentStateId: ids.intentStateId,
          outcomeContractId,
        },
        run.customPackId,
      );
      const submitted = await sdk.submitEvidence(submission);
      if (!submitted.ok) throw submitted;
      const body = asRecord(submitted.value);
      const envelopeIds = Array.isArray(body?.envelopeIds)
        ? body!.envelopeIds.filter((value): value is string => typeof value === "string")
        : [];
      const claimIds = Array.isArray(body?.claimIds)
        ? body!.claimIds.filter((value): value is string => typeof value === "string")
        : [];
      const evidenceReads: SdkEvidenceView[] = [];
      for (const evidenceId of envelopeIds) {
        const read = await sdk.readEvidence(evidenceId);
        if (read.ok) evidenceReads.push(read.value);
      }
      setRun(
        await refreshWorkflowChain(sdk, {
          ...run,
          evidenceSubmissions: [
            {
              label,
              submittedAt: new Date().toISOString(),
              envelopeIds,
              claimIds,
              evidenceReads,
              lineage: {
                workflowId: run.workflow.workflowId,
                intentId: ids.intentId,
                intentStateId: ids.intentStateId,
                outcomeContractId,
              },
            },
            ...run.evidenceSubmissions,
          ],
        }),
      );
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
    }
  };

  const approvalPending = run?.approval?.status === "PENDING";
  const canCommit =
    run &&
    (run.workflow.state === "AUTHORIZED" ||
      run.workflow.execution?.status === "AUTHORIZED");

  const evaluationDecision = extractEvaluationDecision(run?.workflow);
  const materializationEligible = extractMaterializationEligible(run?.workflow);
  const monitoringId = extractMonitoringId(run?.workflow);
  const linkedIds = run ? linkedIntentIds(run) : {};

  // Authority comes from the workspace artifact — the same source the Governance
  // Report reads. `workflow.evaluation` is kept only as a fallback for runs where
  // no workspace has been returned; the overall workflow state is never used.
  const authorityDecision = run?.workspace?.authority.decision ?? evaluationDecision;
  const guardianAggregator = run?.workspace?.guardian.aggregator;
  const executionView = run?.workspace?.execution;
  const constraints = run?.workspace?.semantic.constraints ?? [];
  const executionStatus = run?.workflow.execution?.status ?? run?.commit?.status;

  // Rail status is derived from returned artifacts only. `requestInFlight` is a
  // fact about this client, not a claim that the backend reported a stage.
  const stageRail = deriveStageRail({
    hasRun: Boolean(run),
    ...(linkedIds.intentId ? { intentId: linkedIds.intentId } : {}),
    ...(linkedIds.intentStateId ? { intentStateId: linkedIds.intentStateId } : {}),
    workspacePresent: Boolean(run?.workspace),
    artifactsPresent: Boolean(run?.workflow.artifacts),
    evaluationPresent: Boolean(run?.workflow.evaluation),
    ...(guardianAggregator?.decision ? { guardianDecision: guardianAggregator.decision } : {}),
    ...(guardianAggregator?.semanticStatus
      ? { guardianSemanticStatus: guardianAggregator.semanticStatus }
      : {}),
    ...(authorityDecision ? { authorityDecision } : {}),
    ...(run?.workflow.state ? { workflowState: run.workflow.state } : {}),
    ...(executionView?.phase ? { executionPhase: executionView.phase } : {}),
    ...(executionStatus ? { executionStatus } : {}),
    outcomePresent: Boolean(run?.outcome),
    ...(run?.outcome?.state ? { outcomeState: run.outcome.state } : {}),
    resolutionPresent: Boolean(run?.resolution),
    evidenceCount: run?.evidenceSubmissions.length ?? 0,
    requestInFlight: pending === "working" || refreshing === "working",
    ...(error?.code ? { errorCode: error.code } : {}),
    ...(run?.workspace?.lifecycle ? { lifecycle: run.workspace.lifecycle } : {}),
  });

  const runSummary = deriveRunSummary({
    hasRun: Boolean(run),
    workspacePresent: Boolean(run?.workspace),
    ...(run?.workflow.state ? { workflowState: run.workflow.state } : {}),
    ...(linkedIds.intentId ? { intentId: linkedIds.intentId } : {}),
    ...(linkedIds.intentStateId ? { intentStateId: linkedIds.intentStateId } : {}),
    ...(run?.workspace ? { constraintsTotal: constraints.length } : {}),
    ...(run?.workspace
      ? {
          constraintsWithoutCriticalFailure: constraints.filter(
            (constraint) => !constraint.criticalFailure,
          ).length,
        }
      : {}),
    ...(run?.workspace ? { planStepCount: run.workspace.plan.steps.length } : {}),
    planArtifactsPresent: Boolean(run?.workflow.artifacts),
    ...(guardianAggregator?.decision ? { guardianDecision: guardianAggregator.decision } : {}),
    ...(guardianAggregator?.semanticStatus
      ? { guardianSemanticStatus: guardianAggregator.semanticStatus }
      : {}),
    ...(guardianAggregator ? { guardianCriticalFailure: guardianAggregator.criticalFailure } : {}),
    ...(authorityDecision ? { authorityDecision } : {}),
    ...(run?.workspace?.authority.explanation
      ? { authorityExplanation: run.workspace.authority.explanation }
      : {}),
    ...(run?.approval?.status ? { approvalStatus: run.approval.status } : {}),
    ...(executionView?.phase ? { executionPhase: executionView.phase } : {}),
    ...(executionView?.stopReason ? { executionStopReason: executionView.stopReason } : {}),
    ...(executionStatus ? { executionStatus } : {}),
    ...(executionView ? { sideEffectCount: executionView.sideEffects.length } : {}),
    outcomePresent: Boolean(run?.outcome),
    ...(run?.outcome?.state ? { outcomeState: run.outcome.state } : {}),
    resolutionPresent: Boolean(run?.resolution),
    requestInFlight: pending === "working" || refreshing === "working",
    ...(error?.code ? { errorCode: error.code } : {}),
    ...(run?.workspace?.lifecycle ? { lifecycle: run.workspace.lifecycle } : {}),
  });
  // Terminal means the run has stopped for good, so downstream detail cards must
  // stop saying "yet". Sourced from the shared truth model, not re-derived.
  const terminalRun = runSummary.terminal;
  const authorityReached = Boolean(authorityDecision);
  const executionRecordPresent = Boolean(executionView);
  // Mirrors buildGovernanceReport: a record with no result is "not executed";
  // no record at all is "not reached".
  const executionCardState: StageCardState = run?.workflow.execution || run?.commit
    ? "present"
    : terminalRun
      ? (executionRecordPresent ? "not-executed" : "not-reached")
      : "waiting";
  const terminalStageState: StageCardState = terminalRun ? "not-reached" : "waiting";
  // The stage the run stopped at, taken from the rail so the card and the rail
  // can never disagree about where a terminal workflow ended.
  const stoppingStageId = stageRail.find((stage) => stage.status === "blocked")?.id;
  // Outcome and Resolution are contracts that are created, not stages that are
  // reached — matching the Governance Report's NOT_CREATED for the same two.
  const notCreatedStageState: StageCardState = terminalRun ? "not-created" : "waiting";

  const truthInput = run
    ? {
        createdAt: run.createdAt,
        domainLabel: liveDomainLabel(run.domainId, run.customPackId),
        request: run.request,
        workflow: run.workflow,
        workspace: run.workspace,
        approval: run.approval,
        outcome: run.outcome,
        resolution: run.resolution,
        commit: run.commit,
        evidenceSubmissions: run.evidenceSubmissions,
      }
    : undefined;
  const provenanceModel = truthInput ? buildLiveProvenanceModel(truthInput) : undefined;
  const governanceReport = truthInput && provenanceModel
    ? buildGovernanceReport(truthInput, provenanceModel)
    : undefined;

  return (
    <section className="tm-live-demo" aria-label="Live Demo">
      <header className="tm-live-hero">
        <div className="tm-surface-classification">
          <ProductTruthBadge truthClass="LIVE" detail="PUBLIC SDK / API" />
        </div>
        <p className="tm-live-overline">SEMANTIC TRUST FOR AUTONOMOUS AGENTS</p>
        <h2>Autonomous agents can execute correctly — and still violate human intent.</h2>
        <p className="tm-live-sub">
          This mode creates a genuinely fresh workflow against the deployed TrueMandate backend.
          No playback. No frontend stage simulation. Every visible transition comes from the real public lifecycle.
        </p>
        <ol className="tm-pipeline" aria-label="How TrueMandate governs an agent action">
          {LIVE_PIPELINE_STAGES.map((stage, index) => (
            <li key={stage.title} data-stage={stage.stage}>
              <span className="tm-pipeline-num">{index + 1}</span>
              <span className="tm-pipeline-title">{stage.title}</span>
              <span className="tm-pipeline-body">{stage.body}</span>
            </li>
          ))}
        </ol>
        <div className="tm-hero-domains" aria-label="Supported domains">
          <span className="tm-hero-domains-label">Governs economic actions across</span>
          <ul>
            {LIVE_DEMO_DOMAINS.filter((domain) => domain.id !== "custom_intent").map((domain) => (
              <li key={domain.id}>{domain.label}</li>
            ))}
          </ul>
        </div>
      </header>

      <section className="tm-live-panel">
        <div className="tm-live-panel-head">
          <div>
            <p className="tm-live-kicker">Fresh governed workflow</p>
            <h3>Multi-domain selector</h3>
          </div>
          <span className="tm-live-route-chip">POST /v1/workflows</span>
        </div>
        <DomainSelector selected={domainId} onSelect={setDomainId} />

        {domainId === "custom_intent" ? (
          <div className="tm-live-custom">
            <label>
              <span>Workflow pack</span>
              <select
                value={customPackId}
                onChange={(event) => setCustomPackId(event.target.value as RealPackId)}
              >
                <option value="procurement">Procurement</option>
                <option value="travel">Travel</option>
                <option value="saas_it_spend">SaaS / IT Spend</option>
                <option value="invoice_vendor_payment">Invoice / Vendor Payment</option>
                <option value="logistics_fulfillment">Logistics / Fulfillment</option>
              </select>
            </label>
            <label>
              <span>Fresh raw intent</span>
              <textarea
                value={customRawText}
                onChange={(event) => setCustomRawText(event.target.value)}
                rows={5}
              />
            </label>
          </div>
        ) : null}

        <div className="tm-live-actions">
          <button
            type="button"
            className="tm-button primary"
            onClick={() => void launchFreshWorkflow()}
            disabled={pending === "working"}
          >
            {pending === "working" ? "Creating live workflow…" : `Create fresh ${selectedLabel} workflow`}
          </button>
          <p className="tm-live-note">
            All predefined domains use the same generic workflow lifecycle. Procurement is a pack, not a special runtime path.
          </p>
        </div>

        {progress ? (
          <SubmissionProgressPanel progress={progress} elapsedSeconds={elapsedSeconds} />
        ) : null}
      </section>

      {error ? <FailClosedPanel error={error} /> : null}

      {run ? (
        <section className="tm-live-panel">
          <div className="tm-live-panel-head">
            <div>
              <p className="tm-live-kicker">Real backend lifecycle</p>
              <h3>Latest live run</h3>
            </div>
            <span className="tm-live-route-chip">GET /v1/workflows/:workflowId</span>
          </div>

          <OriginalRequestCard run={run} />

          <ResultSummaryCard
            summary={runSummary}
            workflowId={run.workflow.workflowId}
            createdAt={run.createdAt}
          />

          <div className="tm-live-actions secondary">
            <button
              type="button"
              className="tm-button ghost"
              onClick={() => void refreshLiveState()}
              disabled={refreshing === "working"}
            >
              {refreshing === "working" ? "Refreshing…" : "Refresh live state"}
            </button>
            {approvalPending ? (
              <>
                <button
                  type="button"
                  className="tm-button primary"
                  onClick={() => void approveAndResume()}
                  disabled={pending === "working"}
                >
                  Approve & resume
                </button>
                <button
                  type="button"
                  className="tm-button ghost"
                  onClick={() => void denyApproval()}
                  disabled={pending === "working"}
                >
                  Deny
                </button>
              </>
            ) : null}
            {canCommit ? (
              <button
                type="button"
                className="tm-button primary"
                onClick={() => void commitAuthorizedWorkflow()}
                disabled={pending === "working"}
              >
                Commit governed workflow
              </button>
            ) : null}
          </div>

          <div className="tm-live-workflow-tabs" role="tablist" aria-label="Selected live workflow views">
            {([
              ["lifecycle", "Lifecycle"],
              ["provenance", "Provenance"],
              ["governance-report", "Governance Report"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={workflowView === id}
                className={workflowView === id ? "active" : ""}
                onClick={() => setWorkflowView(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {workflowView === "lifecycle" ? (
            <>
              <StageRail stages={stageRail} />
              <div className="tm-live-stage-grid">
            <StageCard
              title="Intent"
              state="present"
              rows={[
                { label: "Intent mode", value: run.request.intent.kind },
                {
                  label: "Raw text",
                  value:
                    run.request.intent.kind === "RAW"
                      ? run.request.intent.rawText
                      : `Reference ${run.request.intent.intentId}`,
                },
                {
                  label: "Intent id",
                  value: linkedIds.intentId ??
                    absentValue(terminalRun, "Not returned", "Not surfaced publicly yet"),
                },
                {
                  label: "IntentState id",
                  value: linkedIds.intentStateId ??
                    absentValue(terminalRun, "Not returned", "Not surfaced publicly yet"),
                },
              ]}
              details={run.request.intent}
            />
            <StageCard
              title="Evidence / Readiness"
              state={run.evidenceSubmissions.length > 0 ? "present" : terminalStageState}
              rows={
                run.evidenceSubmissions.length > 0
                  ? run.evidenceSubmissions.flatMap((submission) => [
                      { label: submission.label, value: fmtDateTime(submission.submittedAt) },
                      {
                        label: "Candidate evidence",
                        value:
                          submission.evidenceReads.length > 0
                            ? submission.evidenceReads
                                .map((evidence) => `${evidence.id} (${evidence.trustClass})`)
                                .join(" · ")
                            : submission.envelopeIds.join(", "),
                      },
                    ])
                  : [
                      {
                        label: "Status",
                        value: absentValue(
                          terminalRun,
                          "No public evidence was submitted for this workflow",
                          "No public evidence submitted from Live Demo yet",
                        ),
                      },
                    ]
              }
              details={run.evidenceSubmissions}
            />
            {/*
              The overall workflow state is a run-level fact, not a Plan outcome.
              Labelled explicitly so "BLOCKED" here cannot be read as "Plan blocked" —
              this run's plan artifacts were returned successfully.
            */}
            <StageCard
              title="Plan"
              state={run.workflow.artifacts ? "present" : terminalStageState}
              rows={[
                {
                  label: "Artifacts",
                  value: run.workflow.artifacts
                    ? "Plan / stage artifacts returned"
                    : absentValue(
                        terminalRun,
                        "No public artifact bundle was returned",
                        "No public artifact bundle yet",
                      ),
                },
                { label: "Overall workflow state (not a Plan outcome)", value: run.workflow.state },
              ]}
              details={run.workflow.artifacts}
            />
            <StageCard
              title="Guardian"
              // LIVE means Guardian activity is genuinely current. A terminal run
              // that stopped here is not live, however much state came back.
              state={
                stoppingStageId === "guardian"
                  ? "stopped"
                  : guardianAggregator || run.workflow.evaluation
                    ? "present"
                    : terminalStageState
              }
              rows={[
                {
                  label: "Decision",
                  value: guardianAggregator?.decision ?? evaluationDecision ??
                    absentValue(terminalRun, "Not returned", "Not surfaced publicly yet"),
                },
                {
                  label: "Semantic status",
                  value: guardianAggregator?.semanticStatus ??
                    absentValue(terminalRun, "Not returned", "Not surfaced publicly yet"),
                },
                {
                  label: "Critical failure",
                  value: guardianAggregator
                    ? String(guardianAggregator.criticalFailure)
                    : absentValue(terminalRun, "Not returned", "Not surfaced publicly yet"),
                },
                {
                  label: "Materialization eligible",
                  value:
                    materializationEligible === undefined
                      ? absentValue(terminalRun, "Not returned", "Not surfaced publicly yet")
                      : String(materializationEligible),
                },
              ]}
              details={run.workspace?.guardian ?? run.workflow.evaluation}
            />
            {/*
              Authority reports only what an Authority artifact says. The overall
              workflow state is deliberately absent here: BLOCKED is reachable
              from any stage, so printing it in this card told judges Authority
              had decided when it had never been reached.
            */}
            <StageCard
              title="Authority"
              state={authorityDecision ? "present" : terminalStageState}
              rows={[
                {
                  label: "Authority decision",
                  value:
                    authorityDecision ??
                    absentValue(
                      terminalRun,
                      "Not reached — no Authority decision was returned",
                      "Not surfaced publicly yet",
                    ),
                },
                {
                  label: "Capability",
                  value: run.workspace?.authority.capability ??
                    absentValue(terminalRun, "Not reached", "Not surfaced publicly yet"),
                },
                {
                  label: "Explanation",
                  value: run.workspace?.authority.explanation ||
                    absentValue(terminalRun, "Not reached", "Not surfaced publicly yet"),
                },
              ]}
              details={run.workspace?.authority}
            />
            {/* Approval and monitoring are downstream of Authority: if Authority
                was never reached, neither was ever created. */}
            <StageCard
              title="Approval / Monitoring"
              state={run.approval || monitoringId ? "present" : terminalStageState}
              rows={[
                {
                  label: "Approval",
                  value: run.approval
                    ? `${run.approval.id} · ${run.approval.status}`
                    : absentValue(
                        terminalRun,
                        authorityReached ? "Not created" : "Not reached — Authority was never reached",
                        "No approval row returned",
                      ),
                },
                {
                  label: "Monitoring",
                  value: monitoringId ??
                    absentValue(
                      terminalRun,
                      authorityReached ? "Not created" : "Not reached — Authority was never reached",
                      "No monitoring contract returned",
                    ),
                },
              ]}
              details={{
                approval: run.approval,
                monitoringContract: run.workflow.monitoringContract,
              }}
            />
            <StageCard
              title="Execution"
              state={executionCardState}
              rows={[
                {
                  label: "Execution result",
                  value: run.workflow.execution?.status ?? run.commit?.status ??
                    absentValue(
                      terminalRun,
                      executionRecordPresent ? "Not executed — no execution result was returned" : "Not reached",
                      "Not created yet",
                    ),
                },
                ...(executionView?.phase
                  ? [{ label: "Pipeline phase (not an execution result)", value: executionView.phase }]
                  : []),
                { label: "Execution id", value: run.workflow.execution?.executionId ?? run.commit?.executionId ?? "—" },
                { label: "Result ref", value: run.workflow.execution?.resultRef ?? run.commit?.resultRef ?? "—" },
              ]}
              details={{
                execution: run.workflow.execution,
                commit: run.commit,
              }}
            />
            <StageCard
              title="Outcome"
              state={
                run.outcome || extractOutcomeContractId(run.workflow) ? "present" : notCreatedStageState
              }
              rows={[
                {
                  label: "Outcome contract",
                  value: run.outcome?.id ?? extractOutcomeContractId(run.workflow) ??
                    absentValue(terminalRun, "Not created", "Not created yet"),
                },
                {
                  label: "State",
                  value: run.outcome?.state ??
                    absentValue(terminalRun, "Not created", "No public outcome row returned yet"),
                },
                {
                  label: "Payment",
                  value: run.outcome?.paymentStatus ??
                    absentValue(terminalRun, "Not created", "Not surfaced publicly yet"),
                },
              ]}
              details={run.outcome ?? run.workflow.outcomeContract}
            />
            <StageCard
              title="Resolution"
              state={run.resolution ? "present" : notCreatedStageState}
              rows={[
                {
                  label: "Case",
                  value: run.resolution?.id ??
                    absentValue(terminalRun, "Not created", "No ResolutionCase returned"),
                },
                { label: "State", value: run.resolution?.state ?? absentValue(terminalRun, "Not created", "—") },
                {
                  label: "Responsibility",
                  value: run.resolution?.responsibilityState ?? absentValue(terminalRun, "Not created", "—"),
                },
              ]}
              details={run.resolution}
            />
              </div>

              <div className="tm-live-proof-rail">
                <JsonBlock label="Workflow DTO" value={run.workflow} />
                {run.workspace ? <JsonBlock label="Public workspace DTO" value={run.workspace} /> : null}
                {run.outcome ? <JsonBlock label="Outcome DTO" value={run.outcome} /> : null}
                {run.resolution ? <JsonBlock label="Resolution DTO" value={run.resolution} /> : null}
              </div>

              {extractOutcomeContractId(run.workflow) ? (
                <section className="tm-live-outcome-panel">
              <div className="tm-live-panel-head">
                <div>
                  <p className="tm-live-kicker">Controlled outcome interaction</p>
                  <h3>Outcome actions</h3>
                </div>
                <span className="tm-live-route-chip">POST /v1/evidence</span>
              </div>
              <p className="tm-live-note">
                These controls submit real lineage-bound candidate evidence through the governed public evidence seam. The submitted envelope remains <strong>UNTRUSTED_EXTERNAL</strong> until the existing verification path acts.
              </p>
              <div className="tm-live-outcome-actions">
                {activeOutcomeActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="tm-live-outcome-button"
                    onClick={() => void submitOutcomeEvidence(action.id, action.label)}
                    disabled={pending === "working"}
                  >
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </button>
                ))}
              </div>
                </section>
              ) : null}
            </>
          ) : null}

          {workflowView === "provenance" && provenanceModel ? (
            <section className="tm-live-workflow-surface" aria-label="Live workflow provenance">
              <div className="tm-live-surface-head">
                <div>
                  <p className="tm-live-kicker">Real durable records and public-safe relationships</p>
                  <h3>Interactive provenance</h3>
                </div>
                <span className="tm-live-route-chip">GET /v1/workspace/:intentId</span>
              </div>
              <p className="tm-provenance-claim">
                {provenanceClaim(
                  runSummary,
                  provenanceModel.nodes.filter((node) => node.source === "PUBLIC_API").length,
                )}
              </p>
              <LiveProvenanceGraph model={provenanceModel} />
            </section>
          ) : null}

          {workflowView === "governance-report" && governanceReport ? (
            <section className="tm-live-workflow-surface" aria-label="Live workflow governance report">
              <GovernanceReport
                workflowId={run.workflow.workflowId}
                sections={governanceReport}
                summary={runSummary}
                request={
                  run.request.intent.kind === "RAW"
                    ? run.request.intent.rawText
                    : `Intent reference ${run.request.intent.intentId}`
                }
              />
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
