import type { GovernanceReportSection } from "./liveWorkflowTruth";
import type { RunSummary } from "./live-run-summary";
import { sanitizePublicPresentationValue } from "./presentationSecurity";

function availabilityLabel(value: GovernanceReportSection["availability"]): string {
  switch (value) {
    case "PRESENT": return "Recorded";
    case "NOT_CREATED": return "Not created";
    case "NOT_REACHED": return "Not reached";
    case "NOT_PUBLIC": return "Private (internal)";
    // A record came back, but it does not show this stage happening.
    case "NOT_EXECUTED": return "Not executed";
  }
}

/**
 * Plain-language answers first, technical evidence below. The six lines are the
 * questions a non-technical judge actually has; each is derived from the same
 * `RunSummary` the rail and the Result Summary use.
 */
function PlainSummary(props: { readonly summary: RunSummary; readonly request: string }) {
  const { summary } = props;
  const verified = summary.succeeded
    .filter((fact) => fact.label !== "Intent recorded")
    .map((fact) => (fact.detail ? `${fact.label} (${fact.detail})` : fact.label));

  const granted = summary.succeeded.find((fact) => fact.label === "Authority granted");
  const refused = summary.didNotHappen.find((fact) => fact.label === "Authority did not grant");
  const authorityLine = granted
    ? `Yes — ${granted.detail ?? "granted"}.`
    : refused
      ? `No — Authority returned ${refused.detail ?? "a non-granting decision"}.`
      : "No — Authority was never reached.";

  // Two different "yes" facts exist upstream (live-run-summary.ts) precisely so
  // this line can tell them apart: a lifecycle-confirmed completion is not the
  // same claim as "authorized, result not yet confirmed" -- collapsing them
  // into one check previously made an unconfirmed AUTHORIZED status read as a
  // plain "Yes, it ran".
  const executionCompleted = summary.succeeded.find(
    (fact) => fact.label === "Governed mock execution completed",
  );
  const executionAuthorizedOnly = summary.didNotHappen.find(
    (fact) => fact.label === "Execution not yet committed",
  );
  const executionLine = executionCompleted
    ? `Yes — governed mock execution completed, reporting ${executionCompleted.detail ?? "a result"}.`
    : executionAuthorizedOnly
      ? `Not yet — execution was authorized (${executionAuthorizedOnly.detail ?? "no result yet"}) but has not been confirmed as run. This requires a separate commit.`
      : "No — the action was never executed.";

  const rows: readonly (readonly [string, string])[] = [
    ["What was requested", props.request],
    ["What TrueMandate verified", verified.length ? verified.join(" · ") : "Nothing has been verified yet."],
    ["Why it stopped", summary.reason ?? (summary.terminal ? "No stop reason was returned." : "It has not stopped — this run is still in progress.")],
    ["Was authority granted", authorityLine],
    ["Did execution occur", executionLine],
    ["Economic side effects", `${summary.economicEffect.value} — ${summary.economicEffect.statement}`],
  ];

  return (
    <section className="tm-governance-plain" aria-label="Plain language summary">
      <header>
        <p className="tm-live-kicker">In plain language</p>
        <h4>{summary.headline}</h4>
      </header>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="tm-governance-plain-note">
        Everything above is derived from the returned public artifacts. The technical evidence
        those answers came from is recorded below.
      </p>
    </section>
  );
}

export function GovernanceReport(props: {
  readonly workflowId: string;
  readonly sections: readonly GovernanceReportSection[];
  readonly summary?: RunSummary;
  readonly request?: string;
}) {
  return (
    <article className="tm-governance-report" aria-label={`Governance Report for ${props.workflowId}`}>
      <header className="tm-governance-report-head">
        <div>
          <p className="tm-live-kicker">Generated from the selected live workflow</p>
          <h3>Governance Report</h3>
          <p>{props.workflowId}</p>
        </div>
        <div className="tm-governance-theses">
          <strong>Authorization proves permission, not understanding.</strong>
          <strong>Payment / execution success ≠ outcome success.</strong>
          <strong>Explanation is generated. Provenance is recorded.</strong>
        </div>
      </header>

      {props.summary ? (
        <PlainSummary summary={props.summary} request={props.request ?? "Not recorded."} />
      ) : null}

      <div className="tm-governance-section-list">
        {props.sections.map((section) => (
          <section className="tm-governance-section" key={section.id}>
            <header>
              <h4>{section.title}</h4>
              <span data-availability={section.availability}>{availabilityLabel(section.availability)}</span>
            </header>
            {section.rows.length ? (
              <div className="tm-governance-rows">
                {section.rows.map((item) => (
                  <div className="tm-governance-row" key={`${section.id}-${item.label}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.source === "PUBLIC_API" ? "PUBLIC SDK / API" : "DERIVED PRESENTATION"}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tm-governance-empty">{availabilityLabel(section.availability)}</p>
            )}
            {section.details === undefined ? null : (
              <details className="tm-governance-detail">
                <summary>Returned {section.title.toLowerCase()} artifact</summary>
                <pre>{JSON.stringify(sanitizePublicPresentationValue(section.details), null, 2)}</pre>
              </details>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
