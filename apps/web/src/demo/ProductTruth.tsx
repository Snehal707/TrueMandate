export type ProductTruthClass =
  | "LIVE"
  | "CANONICAL_HISTORICAL"
  | "PRESENTATION_DERIVED";

const TRUTH_LABELS: Readonly<Record<ProductTruthClass, string>> = {
  LIVE: "LIVE",
  CANONICAL_HISTORICAL: "CANONICAL / HISTORICAL",
  PRESENTATION_DERIVED: "PRESENTATION-DERIVED",
};

export function ProductTruthBadge(props: {
  readonly truthClass: ProductTruthClass;
  readonly detail?: string;
}) {
  return (
    <span className="tm-truth-badge" data-truth-class={props.truthClass}>
      {TRUTH_LABELS[props.truthClass]}
      {props.detail ? <small>{props.detail}</small> : null}
    </span>
  );
}
