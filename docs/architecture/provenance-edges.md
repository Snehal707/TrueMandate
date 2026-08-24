# Provenance Edge Polarity

## Canonical rule

Every `ProvenanceEdge` is an **influence / derivation arrow**:

- `from` = upstream source (influencer, earlier artifact)
- `to` = downstream derivative (influenced, later artifact)

Taint propagation, planning ancestry, and privileged-path reconstruction all follow this arrow.

Relation **names** are labels on that arrow. English grammar may be inverted relative to the stored direction; the arrow polarity never changes by relation name.

## Relation polarity table

| Relation | Stored as | Notes |
|----------|-----------|-------|
| `DERIVED_FROM` | source → derivative | Derivation edge; **not** English “to is derived from from” |
| `ASSUMES` | asserter → assumption | Matches English |
| `SUPPORTS` | subject → supporting/verdict node | Phase 4: Intent → verification |
| `DELEGATES_TO` | parent → child | Matches English |
| `AUTHORIZES` | authority → action | Matches English |
| `RESULTED_IN` | cause → result | Matches English |
| `WEAKENS` / `STRENGTHENS` / `PRESERVES` | source → transformed | Matches English |
| `INTRODUCED_BY` | introducer → introduced | Name inverted vs English |
| `INFLUENCED_BY` | influencer → influenced | Name inverted vs English |
| `SUMMARIZES` | content → summary | Name inverted vs English |
| `CORRECTED_BY` | claim → correction | Passive subject → corrector |

## API

- `ancestors(nodeId)` — walk **backward** (incoming edges)
- `descendants(nodeId)` — walk **forward** (outgoing edges)

Do not reverse historical edges to “fix” English naming; that would break INV_004 taint survival.
