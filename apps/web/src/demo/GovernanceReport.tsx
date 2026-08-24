import type { GovernanceReportSection } from "./liveWorkflowTruth";

function availabilityLabel(value: GovernanceReportSection["availability"]): string {
  switch (value) {
    case "PRESENT": return "Recorded";
    case "NOT_CREATED": return "Not created";
    case "NOT_REACHED": return "Not reached";
    case "NOT_PUBLIC": return "Not publicly available";
  }
}

export function GovernanceReport(props: {
  readonly workflowId: string;
  readonly sections: readonly GovernanceReportSection[];
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
          </section>
        ))}
      </div>
    </article>
  );
}

