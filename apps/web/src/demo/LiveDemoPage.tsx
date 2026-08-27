import { useEffect, useState } from "react";
import { createSdkCore, type IntentWorkspaceView, type SdkApprovalView, type SdkEvidenceView, type SdkOutcomeView, type SdkResolutionCaseView, type SdkWorkflowCommitResult, type SdkWorkflowRequest, type SdkWorkflowView } from "@truemandate/sdk-core";
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
import { submitFreshWorkflowWhenReady } from "./freshWorkflowSubmission";
import {
  buildGovernanceReport,
  buildLiveProvenanceModel,
  intentIdFromRequest,
  type LiveEvidenceRecord,
} from "./liveWorkflowTruth";
import {
  classifyFailure,
  deriveStageRail,
  railProgressLabel,
  railStatusLabel,
  type RailStage,
} from "./live-stage-rail";

const sdk = createSdkCore({ baseUrl: "", timeoutMs: 120_000 });

/** The governed path, in the order this page runs it. */
const LIVE_PIPELINE_STAGES: readonly { title: string; body: string }[] = [
  { title: "Human intent", body: "Recorded immutably, before any agent touches it." },
  { title: "Semantic verification", body: "What it means is proven, not assumed." },
  { title: "Authority", body: "Permission is bounded, scoped, and revocable." },
  { title: "Execution", body: "The governed action runs exactly once, or not at all." },
  { title: "Provenance", body: "Evidence shows what actually happened." },
];

type AsyncState = "idle" | "working";

type LiveDemoError = {
  readonly code?: string;
  readonly message: string;
};

type LiveRunState = {
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

async function refreshWorkflowChain(run: LiveRunState): Promise<LiveRunState> {
  const workflowResult = await sdk.readWorkflow(run.workflow.workflowId);
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
    approvalId ? await sdk.readApproval(approvalId) : undefined;
  if (approvalResult && !approvalResult.ok) {
    throw approvalResult;
  }

  const outcomeResult =
    outcomeContractId ? await sdk.readOutcome(outcomeContractId) : undefined;
  if (outcomeResult && !outcomeResult.ok) {
    throw outcomeResult;
  }

  let resolution: SdkResolutionCaseView | undefined;
  const resolutionId = outcomeResult?.ok ? outcomeResult.value.resolutionCaseId : undefined;
  if (resolutionId) {
    const resolutionResult = await sdk.readResolutionCase(resolutionId);
    if (!resolutionResult.ok) throw resolutionResult;
    resolution = resolutionResult.value;
  } else if (outcomeContractId) {
    const byOutcome = await sdk.readResolutionByOutcome(outcomeContractId);
    if (byOutcome.ok) resolution = byOutcome.value;
  }

  const workspaceResult = intentId ? await sdk.readWorkspace(intentId) : undefined;

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
          <li key={stage.id} className={`tm-rail-stage ${stage.status}`} aria-current={stage.status === "active" ? "step" : undefined}>
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

function StageCard(props: {
  readonly title: string;
  readonly state: "present" | "waiting";
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly details?: unknown;
}) {
  return (
    <section className={`tm-live-stage${props.state === "present" ? " present" : ""}`}>
      <header>
        <h4>{props.title}</h4>
        <span>{props.state === "present" ? "LIVE" : "Not returned yet"}</span>
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

  const selectedLabel = liveDomainLabel(domainId, customPackId);
  const activeOutcomeActions = outcomeActionsForDomain(domainId, customPackId);

  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const refreshed = await refreshWorkflowChain(run);
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
    try {
      const request = buildLiveDemoWorkflowRequest(domainId, {
        rawText: domainId === "custom_intent" ? customRawText : undefined,
        customPackId,
      });
      const result = await submitFreshWorkflowWhenReady(sdk, request);
      if (!result.ok) throw result;
      const initialRun: LiveRunState = {
        createdAt: new Date().toISOString(),
        domainId,
        customPackId: domainId === "custom_intent" ? customPackId : undefined,
        request,
        workflow: result.value,
        evidenceSubmissions: [],
      };
      const refreshed = await refreshWorkflowChain(initialRun).catch(() => initialRun);
      setRun(refreshed);
      setWorkflowView("lifecycle");
    } catch (nextError) {
      setError(toError(nextError));
    } finally {
      setPending("idle");
    }
  };

  const refreshLiveState = async () => {
    if (!run) return;
    setRefreshing("working");
    setError(undefined);
    try {
      setRun(await refreshWorkflowChain(run));
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
        await refreshWorkflowChain({
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
        await refreshWorkflowChain({
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
        await refreshWorkflowChain({
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

  // Rail status is derived from returned artifacts only. `requestInFlight` is a
  // fact about this client, not a claim that the backend reported a stage.
  const stageRail = deriveStageRail({
    hasRun: Boolean(run),
    ...(linkedIds.intentId ? { intentId: linkedIds.intentId } : {}),
    ...(linkedIds.intentStateId ? { intentStateId: linkedIds.intentStateId } : {}),
    workspacePresent: Boolean(run?.workspace),
    artifactsPresent: Boolean(run?.workflow.artifacts),
    evaluationPresent: Boolean(run?.workflow.evaluation),
    ...(evaluationDecision ? { authorityDecision: evaluationDecision } : {}),
    ...(run?.workflow.state ? { workflowState: run.workflow.state } : {}),
    ...(run?.workflow.execution?.status ?? run?.commit?.status
      ? { executionStatus: (run?.workflow.execution?.status ?? run?.commit?.status) as string }
      : {}),
    outcomePresent: Boolean(run?.outcome),
    ...(run?.outcome?.state ? { outcomeState: run.outcome.state } : {}),
    resolutionPresent: Boolean(run?.resolution),
    evidenceCount: run?.evidenceSubmissions.length ?? 0,
    requestInFlight: pending === "working" || refreshing === "working",
    ...(error?.code ? { errorCode: error.code } : {}),
  });
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
            <li key={stage.title}>
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

          <div className="tm-live-summary-grid">
            <div className="tm-live-summary-card">
              <span>Domain</span>
              <strong>{liveDomainLabel(run.domainId, run.customPackId)}</strong>
            </div>
            <div className="tm-live-summary-card">
              <span>Workflow</span>
              <strong>{run.workflow.workflowId}</strong>
            </div>
            <div className="tm-live-summary-card">
              <span>Workflow state</span>
              <strong>{run.workflow.state}</strong>
            </div>
            <div className="tm-live-summary-card">
              <span>Created</span>
              <strong>{fmtDateTime(run.createdAt)}</strong>
            </div>
          </div>

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
                { label: "Intent id", value: linkedIds.intentId ?? "Not surfaced publicly yet" },
                { label: "IntentState id", value: linkedIds.intentStateId ?? "Not surfaced publicly yet" },
              ]}
              details={run.request.intent}
            />
            <StageCard
              title="Evidence / Readiness"
              state={run.evidenceSubmissions.length > 0 ? "present" : "waiting"}
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
                        value: "No public evidence submitted from Live Demo yet",
                      },
                    ]
              }
              details={run.evidenceSubmissions}
            />
            <StageCard
              title="Plan"
              state={run.workflow.artifacts ? "present" : "waiting"}
              rows={[
                { label: "Workflow state", value: run.workflow.state },
                {
                  label: "Artifacts",
                  value: run.workflow.artifacts ? "Plan / stage artifacts returned" : "No public artifact bundle yet",
                },
              ]}
              details={run.workflow.artifacts}
            />
            <StageCard
              title="Guardian"
              state={run.workflow.evaluation ? "present" : "waiting"}
              rows={[
                { label: "Decision", value: evaluationDecision ?? "Not surfaced publicly yet" },
                {
                  label: "Materialization eligible",
                  value:
                    materializationEligible === undefined
                      ? "Not surfaced publicly yet"
                      : String(materializationEligible),
                },
              ]}
              details={run.workflow.evaluation}
            />
            <StageCard
              title="Authority"
              state={run.workflow.evaluation ? "present" : "waiting"}
              rows={[
                { label: "Workflow state", value: run.workflow.state },
                { label: "Authority decision", value: evaluationDecision ?? "Not surfaced publicly yet" },
              ]}
              details={run.workflow}
            />
            <StageCard
              title="Approval / Monitoring"
              state={run.approval || monitoringId ? "present" : "waiting"}
              rows={[
                {
                  label: "Approval",
                  value: run.approval ? `${run.approval.id} · ${run.approval.status}` : "No approval row returned",
                },
                {
                  label: "Monitoring",
                  value: monitoringId ?? "No monitoring contract returned",
                },
              ]}
              details={{
                approval: run.approval,
                monitoringContract: run.workflow.monitoringContract,
              }}
            />
            <StageCard
              title="Execution"
              state={run.workflow.execution || run.commit ? "present" : "waiting"}
              rows={[
                {
                  label: "Execution status",
                  value: run.workflow.execution?.status ?? run.commit?.status ?? "Not created yet",
                },
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
              state={run.outcome ? "present" : extractOutcomeContractId(run.workflow) ? "present" : "waiting"}
              rows={[
                {
                  label: "Outcome contract",
                  value: run.outcome?.id ?? extractOutcomeContractId(run.workflow) ?? "Not created yet",
                },
                {
                  label: "State",
                  value: run.outcome?.state ?? "No public outcome row returned yet",
                },
                {
                  label: "Payment",
                  value: run.outcome?.paymentStatus ?? "Not surfaced publicly yet",
                },
              ]}
              details={run.outcome ?? run.workflow.outcomeContract}
            />
            <StageCard
              title="Resolution"
              state={run.resolution ? "present" : "waiting"}
              rows={[
                { label: "Case", value: run.resolution?.id ?? "No ResolutionCase returned" },
                { label: "State", value: run.resolution?.state ?? "—" },
                {
                  label: "Responsibility",
                  value: run.resolution?.responsibilityState ?? "—",
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
              <LiveProvenanceGraph model={provenanceModel} />
            </section>
          ) : null}

          {workflowView === "governance-report" && governanceReport ? (
            <section className="tm-live-workflow-surface" aria-label="Live workflow governance report">
              <GovernanceReport
                workflowId={run.workflow.workflowId}
                sections={governanceReport}
              />
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
