# Benchmark V2 C1 rejected-run diagnostic

This report is additive diagnostic evidence for rejected execution
`tm-dev-benchmark-v2-cjhgx`. The original JSON/JSONL records and the hashes in
`rejection.json` are unchanged. Private model replays are not benchmark
evidence.

## `load-1-1-travel`

- Immutable input: `Book 2 refundable hotel stays at Seaside Lodge with Meridian Travel Partners for under USD 5000 before December 31, 2026, with check-in on December 20 and checkout on December 22.`
- Finalized state: `state-intent-benchmark-v2-travel-10001-20260825172744164-compiled-10730bd6e8c04641`
- State hash: `bba075b51f637a75132ad1a0b9e4143aac3b278f1f606ee72fd6c7c0387e73a7`
- The compiler preserved all eight grounded constraints. The check-in and
  checkout values were represented as `12-20` and `12-22`, with exact HUMAN
  source grounding `check-in on December 20` and `checkout on December 22`.
- The absolute booking deadline remained `2026-12-31`; temporal authority was
  bound only to that absolute deadline.
- The semantic verification artifact existed and matched the exact state and
  hash. Its model-proposed readiness was audit-only `PLANNABLE/A1`; the shared
  deterministic planning floor produced `SEARCHABLE/A1` because compact
  yearless `MM-DD` was not recognized as a grounded partial-calendar shape.
- The state-bound submission consumed this persisted readiness. It did not
  recompute readiness and did not read a stale state.
- Same-run successful Travel candidates used full ISO dates. Ten private
  diagnostic replays later produced ISO, spelled month/day, and compact
  `MM-DD` variants; all ten were planning-capable after the shared classifier
  repair.

## `load-1-49-logistics_fulfillment`

- Immutable input: `Arrange 12 approved carrier EXPRESS fulfillment shipments to Mumbai Warehouse before October 1, 2026.`
- Finalized state: `state-intent-benchmark-v2-logistics_fulfillment-10049-20260825172744164-compiled-828dcea7e51e2ca4`
- State hash: `e67da0e95eddd16512277593f8dee5ae5c1ef571eb420ab821209ab3855f2073`
- Compilation and verification preserved shipment count `12`, carrier approval
  `APPROVED`, service level `EXPRESS`, destination `Mumbai Warehouse`, and
  deadline `2026-10-01`. The persisted verification was `PLANNABLE/A1` with no
  critical finding.
- The state and current tip became durable at `2026-08-25T18:20:08.773Z`.
  The state-bound read requested its semantic verification at
  `2026-08-25T18:20:09.749Z` and received `404`. The semantic artifact became
  durable at `2026-08-25T18:20:09.779Z`, approximately 30 ms later.
- The owner previously published state plus tip before writing the companion
  semantic artifact. This exposed a current state that was not yet consumable.
  The repair persists and verifies the immutable semantic artifact first, then
  atomically publishes state plus tip.
- Ten private model replays all retained an approval fact and all ten verified
  as planning-capable. Concept labels varied, but the historical failure was
  not a compiler omission or normalization loss.

## Safety disposition

- Grounding, `PLANNABLE`, privileged `ACTIONABLE`, Guardian, Authority, and
  execution gates are unchanged.
- Compact yearless dates can satisfy only the non-privileged planning floor;
  they cannot establish absolute temporal authority.
- A current owner tip now implies its semantic verification artifact is already
  durable. Identical replay remains idempotent and divergent replay remains
  fail-closed.
