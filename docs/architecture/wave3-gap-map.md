# Wave 3 — Analytics & Governed Learning Gap Map (2026-08-21)

Source-verified. Requirement → implementation → gap → owner → authority implication.

**Status:** Wave 3 NOT STARTED. This document is analysis only — no BigQuery, learning-service, or signal producers were implemented in this pass.

**Sources:** `docs/PROJECT_SPEC.md` (Google Stack, Learning, Security Invariants, Firestore Collections), `TrueMandate_Claude_Handoff.md` (Wave 3 §§3.1–3.7), `docs/architecture/wave1-production-closure.md`, `docs/architecture/wave1-gap-map.md`, `docs/architecture/wave2-production-closure.md`, plus direct inspection of `packages/protocol`, `packages/schemas`, `packages/authority`, `packages/cloud-firestore`, `packages/provenance`, `packages/read-model`, `services/observability-service`, and `infrastructure/terraform`.

## Headline

Only two Wave 3-adjacent pieces exist today, both dead code with no live call path:

1. `LearningProposal` protocol object + Zod schema (types only; no store, no service).
2. Deterministic INV_011 / INV_015 guards in `packages/authority/src/learning.ts` — unit-tested only; never called from any live service.

Everything else (BigQuery, cross-workflow analytics, learning runtime, preference memory, agent reliability, counterparty trust, workflow rule learning) has zero implementation.

## Gap map

| Requirement | Current implementation | Gap | Owner | Authority/security |
|---|---|---|---|---|
| BigQuery analytics (Firestore = ops truth; BQ = history only) | None. Terraform has no `google_bigquery_dataset` / table resources; only unrelated Cloud Run `bigquery_config: []` tfstate noise. No Firestore→BQ or Pub/Sub→BQ export. | Dataset, IAM, export/ingestion pipeline. Natural ingestion: existing Wave 1/2 Pub/Sub governance topics already fan into `observability-api`, but that service is a single-workflow demo/read-model (`services/observability-service/src/demo-runtime.ts`), not a durable multi-workflow sink. | `packages/analytics-bigquery` + `infrastructure/terraform/modules/analytics` + exporter (new service or extension of observability-api) | BQ write-from-events / read-for-analytics only. Never source AuthorityGrant / PreparedAction / CommitToken / current intent / current approval. Enforce by construction (no BQ client in authority/gateway PREPARE/AUTHORIZE/COMMIT) + architecture-ban test. |
| Cross-workflow provenance intelligence | `ProvenanceGraph` (`packages/provenance/src/graph.ts`) is in-memory, single-workflow. `packages/read-model` projects only `IntentWorkspaceView`. Firestore stores `provenanceNodes`/`provenanceEdges` per workflow with no cross-workflow aggregation. | Entire cross-workflow query engine. First natural BQ consumer after export exists (BigQuery Graph per spec — later). | Analytics query package downstream of BQ export | Read-only aggregates. Must not become a second source of truth for a single workflow's current state. |
| LearningProposal runtime (`PROPOSED`→`CONFIRMED`/`REJECTED`/`EXPIRED`/`SUPERSEDED`) | Type: `packages/protocol/src/objects.ts` `LearningProposal` (`USER_PREFERENCE` \| `AGENT_RELIABILITY` \| `COUNTERPARTY_TRUST` \| `WORKFLOW_RULE`). Schema: `packages/schemas/src/objects.ts` `LearningProposalSchema`. Status enum matches spec. Guards: `applyLearningProposal` (INV_011) + `assertLearningCannotExpandAuthority` (INV_015) in `packages/authority/src/learning.ts`, tested in `inv-001-005-008-011.test.ts`. | No `learningProposals` in `COLLECTIONS` (`packages/cloud-firestore/src/document-store.ts`) despite being named in PROJECT_SPEC collection list. No store/repo. No `learning-service`. No create/confirm/reject/expire routes. Guards unwired. No evidence→proposal generator. | `services/learning-service` + `packages/learning-core` on existing protocol/schema/guards | Highest-leverage Wave 3 piece — every other capability is a `proposalType` through this lifecycle. Build + invariant-test (INV_011, INV_015, “confirmed proposal never grants privilege”) before any analytics producer connects. |
| Preference memory | `ConstraintKind.LEARNED_PREFERENCE` exists and is correctly **excluded** from `STICKY_CONSTRAINT_KINDS` (only HARD/SAFETY_CRITICAL/LEGAL/ORGANIZATIONAL_POLICY sticky). Otherwise unused — no emit/consume path in semantic-grounding or intent-service. | No preference store. No `USER_PREFERENCE` proposal producer. No hook that *offers* `LEARNED_PREFERENCE` into a **new** IntentState without touching `rawIntent` or existing state. | `learning-service` + narrow hook in semantic-grounding / intent-service | No generic `rawIntent` edit. Explicit current IntentState outranks `LEARNED_PREFERENCE` — deterministic precedence rule + test, not a prompt convention. |
| Agent reliability (outcome / drift / Guardian / partial / remedy / evidence rates) | Per-workflow raw events exist and are durable (GuardianVerdict, OutcomeContract PARTIAL/BREACHED, ResolutionCase/remedy, Evidence). `packages/safe-benchmark` computes structurally similar rates over **synthetic** scenarios only. | No live aggregation job. No `AGENT_RELIABILITY` proposal producer. No bounded-signal consumer. | Analytics queries + `learning-service` producer | Signal only — must not gate ALLOW/BLOCK (deferred to Wave 4 Adaptive Authority). |
| Counterparty trust | None. No counterparty/vendor identity model or aggregation. | Everything; same shape as agent reliability, keyed by counterparty (`COUNTERPARTY_TRUST`). | Same as agent reliability | Spec states “reputation cannot override hard intent or policy” narratively only — no dedicated invariant ID or test (unlike INV_011/INV_015). Formalize (e.g. INV_026) before trust/reliability signals influence any decision path. |
| Workflow rule learning | None. | Everything. Most composite: depends on learning lifecycle, cross-workflow correction history, and the other three signal types. | `learning-service` (`WORKFLOW_RULE`), last in build order | Confirmed workflow rule must still pass `assertLearningCannotExpandAuthority`; never becomes a standing AuthorityGrant. |

## Invariant status entering Wave 3

| Invariant / rule | Status |
|---|---|
| INV_011 — Learning cannot rewrite historical intent | Guard + unit tests exist; **not wired** to any live path. |
| INV_015 — Learning / critical failure cannot expand authority | Guard + unit tests exist; **not wired**. |
| Reputation cannot override HARD / SAFETY_CRITICAL / LEGAL / ORGANIZATIONAL_POLICY | Narrative in PROJECT_SPEC / handoff only. **No invariant number, no automated test.** Recommend formalizing before trust/reliability land. |
| Human correction outranks inferred preference | **No code.** Must be a deterministic precedence check wherever `LEARNED_PREFERENCE` / confirmed proposals are consumed. |
| Firestore = operational truth; BigQuery = analytics only | Trivially true today (BQ does not exist). Risk starts at first export/query commit — gate with architecture-ban tests from day one. |

## Recommended implementation order

1. **LearningProposal runtime** — `learning-service` + `learningProposals` Firestore collection + status transitions; wire INV_011 / INV_015 guards into create/confirm/reject; prove confirmed proposals cannot mint or widen AuthorityGrant. Firestore only; no BigQuery yet.
2. **Reputation invariant** — formalize “reputation cannot override sticky policy kinds” as a new invariant with automated tests before any trust/reliability proposal type exists.
3. **BigQuery foundation** — Terraform dataset/tables/IAM + export subscriber off existing Pub/Sub governance topics; architecture-ban: no privileged package imports a BQ client.
4. **Cross-workflow provenance intelligence** — read-only aggregate queries over exported data; read-only analytics API.
5. **Agent reliability** — aggregate → `AGENT_RELIABILITY` LearningProposal via step 1 lifecycle.
6. **Counterparty trust** — aggregate → `COUNTERPARTY_TRUST` LearningProposal; gated by step 2 invariant.
7. **Preference memory** — `USER_PREFERENCE` producer + offer-`LEARNED_PREFERENCE`-on-new-IntentState-only hook + human-correction-outranks-inference test.
8. **Workflow rule learning** — `WORKFLOW_RULE` producer aggregating repeated confirmed corrections from steps 5–7 (last; depends on the others).

Order rationale: deterministic governance/lifecycle (1–2) before any analytics-derived signal (3–8) can reach authority except through an already-tested, human-confirmable gate.

## Hard stop

Gap map only. No code, schema, Terraform, or service changes beyond this document. Wave 4 not started.

---

## Wave 3.2 closure note (2026-08-21 — appended, original rows preserved)

**INV_026 formalized.** Reputation/trust may reduce uncertainty but cannot override explicit intent, hard constraints (`HARD`/`SAFETY_CRITICAL`/`LEGAL`/`ORGANIZATIONAL_POLICY`), policy, capability bounds, or existing Authority restrictions. Enforced via `packages/authority/src/trust-signal.ts` and wired into `confirmLearningProposal` for `AGENT_RELIABILITY` / `COUNTERPARTY_TRUST`. Smallest reusable `TrustSignal` contract defined (no score computation). Counterparty-trust / agent-reliability gap rows above remain open for real producers; only the missing invariant ID/test gap is closed.

---

## Wave 3.3 closure note (2026-08-21 — appended, original rows preserved)

**BigQuery analytics + export foundation landed (code + Terraform authored; not applied/deployed).**

| Item | Detail |
|---|---|
| Tables/schemas | `governance_events`, `provenance_nodes`, `provenance_edges` in `packages/analytics-bigquery/src/schemas.ts` + `infrastructure/terraform/modules/analytics` |
| Export architecture | `services/analytics-export-service` subscribes to 10 governance Pub/Sub topics via existing `POST /internal/events` push endpoint; maps `CloudEventEnvelope` → BQ rows; Firestore `analyticsExportLedger` for idempotency |
| Source events | `intent.events`, `semantic.events`, `plan.events`, `guardian.events`, `authority.events`, `execution.events`, `evidence.events`, `outcome.events`, `resolution.events`, `security.events` |
| Source artifacts | Firestore `provenanceNodes` / `provenanceEdges` via on-demand `runProvenanceExportBatch` (future Cloud Run Job; no always-on poller) |
| Idempotency | Deterministic `export_id` = sha256(`kind:naturalKey`); ledger checked before insert; marked only after successful insert |
| Failure behavior | Exporter never throws; BQ loss returns `err` for NACK/retry; subscriptions use `securityCritical: true` so co-located critical handlers cannot be failed by analytics; architecture-ban: privileged packages never import `@google-cloud/bigquery` / `analytics-bigquery` |
| Still open | Cross-workflow provenance query engine, agent reliability, counterparty trust producers, preference memory, workflow rule learning, Adaptive Authority, analytics UI, Cloud Run deploy/apply for analytics-export |

**Invariant preserved:** Firestore = operational truth; BigQuery = analytics/history only. BigQuery never participates in Authority decisions, PreparedAction creation, CommitToken issuance, Gateway commit, current approval, or current IntentState.

---

## Wave 3.4 closure note (2026-08-21 — appended, original rows preserved)

**Cross-workflow provenance intelligence (query/API layer) landed — code-only, not deployed.**

| Item | Detail |
|---|---|
| Package | `packages/analytics-query` — `CrossWorkflowAnalyticsService` + six deterministic queries over Wave 3.3 tables |
| Queries | (1) weakened constraints by concept (2) guardian intervention by agent (3) counterparty↔partial/breached correlation (4) ambiguity class↔BLOCK correlation (5) remedy restoration rate (6) bounded BFS provenance traversal across workflows |
| API surface | `GET /internal/analytics/weakened-constraints`, `.../guardian-intervention-agents`, `.../counterparty-outcome-correlation`, `.../ambiguity-blocked-correlation`, `.../remedy-restoration-rate`, `.../provenance-traversal/:startNodeId` via `services/analytics-query-service` (Cloud Run entry present; **not** wired into Terraform/runtime deploy) |
| Payload contract | Documented in `field-contract.ts` — domain fields (`concept`, `decision`, `merchant`, `ambiguityClass`, `remedyType`, `restored`, `agentId`) live in opaque `payload` JSON; real publishers do not yet consistently populate them |
| Isolation | Architecture-ban: authority/gateway/learning never import `analytics-query` / `@google-cloud/bigquery`; analytics never influences live Authority/Gateway |
| Still open | Publisher payload-contract compliance, agent reliability scoring, counterparty trust scoring, preference memory, workflow rule learning, Adaptive Authority, analytics UI, deploy/apply for analytics-export + analytics-query |

---

## Wave 3.5 closure note (2026-08-21 — appended, original rows preserved)

**Analytics publisher contract compliance landed — code-only, not deployed.**

| Item | Detail |
|---|---|
| Outbound port | `packages/cloud-pubsub` — `PubSubPublisherPort` (Noop / Memory / lazy Google), `TM_GOVERNANCE_EVENTS_MODE` (`disabled` default), fail-open `publishFailOpen` |
| Publishers wired | `authority-service` → `AUTHORITY_DECISION`; `agent-runtime` → `PLAN_CREATED` + `GUARDIAN_VERDICT`; `outcome-service` → outcome trigger/SATISFIED events with `merchant`; `resolution-service` → `REMEDY_COMPLETED` with `restored` |
| Fields emitted | `decision`, `agentId`, `ambiguityClass`, `merchant`, `restored`, plus workflow/intent/plan/contract aggregate ids |
| Intentionally unavailable | `concept` (no DriftEvent producer); `remedyType` (no RemedyProposal taxonomy) — see `UNAVAILABLE_ANALYTICS_FIELDS` |
| Backward compatibility | Optional `OutcomeContract.merchant`; default Noop publisher; older events without new fields still parse; publish failures never affect business Results |
| Still open | Drift detection producer, remedy-type taxonomy, agent reliability / counterparty trust scoring, preference memory, workflow rule learning, Adaptive Authority, analytics UI, enabling `TM_GOVERNANCE_EVENTS_MODE=pubsub` in deploy |

---

## Wave 3.6 closure note (2026-08-21 — appended, original rows preserved)

**Two remaining Wave 3.5 "intentionally unavailable" fields closed with real, deterministic producers — code-only, not deployed.**

| Item | Detail |
|---|---|
| Constraint-weakening detector | `packages/authority/src/constraint-drift.ts` — pure, non-LLM `detectWeakenedConstraints(previous, next)`. Matches constraints by `id` and structurally classifies `LT`/`LTE`/`GT`/`GTE` bound loosening, `BETWEEN` range widening, `IN`/`NOT_IN` set widening, `REQUIRE` true→false drops, and outright removal. Returns nothing (no fabricated verdict) for incomparable operator-family changes (e.g. `EQ`→`IN`). |
| Drift producer wiring | `IntentService.createIntentState()` (`services/intent-service/src/service.ts`) runs the detector against the previous tip's constraints whenever a real transition occurs (`tip` exists), then emits `CONSTRAINT_WEAKENED` to `intent.events` per weakened concept via new `services/intent-service/src/analytics-events.ts::publishConstraintWeakenedEvent`. First-version states (no prior tip) emit nothing. `semantic.events` remains unwired — no service performs a comparable comparison at the semantic-verification stage (see `UNAVAILABLE_ANALYTICS_FIELDS`). |
| RemedyType taxonomy | `RemedyType` enum added to `packages/protocol/src/enums.ts` (`REFUND`, `REPLACEMENT`, `EVIDENCE`, `CANCEL`, `ESCALATE`) — the exact same values `resolution-core`'s remedy planner already computed as `RemedyOption.kind`, now also surfaced as `RemedyProposal.remedyType` (optional, backward compatible) in `packages/resolution-core/src/remedy-planner.ts`. Zod: `RemedyTypeSchema` + optional `RemedyProposalSchema.remedyType`. |
| RemedyType producer wiring | `ResolutionService.resolveFromRemedyOutcome()` (`services/resolution-service/src/service.ts`) derives `remedyType` via a new `findRemedyTypeForCase()` helper: finds the most recently issued `RemediationMandate` for the case, resolves its bound `RemedyProposal`, and reads `remedyType` — never guessed. `publishRemedyCompletedEvent` (`services/resolution-service/src/analytics-events.ts`) omits the field entirely when no mandate/remedy was ever bound (e.g. variance-only closures, or SATISFIED without a planned+bound remedy). |
| Non-fabrication proof | `packages/authority/src/constraint-drift.test.ts` (10 cases) proves tightened bounds, identical states, and incomparable operator swaps produce **no** verdict. `services/resolution-service/src/resolution-events-contract.test.ts` proves `remedyType` is present when a remedy is bound and `undefined` when it is not. |
| Real-pipeline query proof | `packages/analytics-query/src/queries/real-publisher-pipeline.test.ts` drives real `IntentService`/`ResolutionService` lifecycles end-to-end (not synthetic `govEvent` fixtures) through `envelopeToGovernanceEventRow` into `runWeakenedConstraints` / `runRemedyRestorationRate`, proving both queries work from actual publisher output. |
| Field contract updated | `packages/analytics-query/src/field-contract.ts` — `intent.events` `CONSTRAINT_WEAKENED` row moved `unavailable` → `wired`; `UNAVAILABLE_ANALYTICS_FIELDS` narrowed to `concept` on `semantic.events` only and `remedyType`'s residual "only when bound" caveat. |
| Backward compatibility | Both new fields are optional on their protocol objects and Zod schemas; `packages/schemas/src/remedy-proposal-compat.test.ts` proves legacy `RemedyProposal` documents without `remedyType` still parse, and that inventing a taxonomy value outside the enum is rejected. |
| Still open | `semantic.events` drift producer (no semantic-verification-stage comparison exists), agent reliability / counterparty trust scoring, preference memory, workflow rule learning, Adaptive Authority, analytics UI, enabling `TM_GOVERNANCE_EVENTS_MODE=pubsub` in deploy |

---

## Wave 3.7 closure note (2026-08-21 — appended, original rows preserved)

**Agent reliability + counterparty trust scoring landed — code-only, not deployed.**

| Item | Detail |
|---|---|
| Package | `packages/analytics-scoring` — pure deterministic scorers (`computeAgentReliabilityScore`, `computeCounterpartyTrustScore`) emitting `TrustSignal` + `ScoringProposalDraft` for `AGENT_RELIABILITY` / `COUNTERPARTY_TRUST` |
| Formulas | Agent: `reliability = max(0, 1 - interventionCount/workflowCount)` over all `GUARDIAN_VERDICT` events (dedicated `agent-reliability-stats` aggregate; interventions = non-ALLOW). Counterparty: `trust = max(0, 1 - partialOrBreached/totalOutcomes)` from existing `counterparty-outcome-correlation` |
| Minimum evidence | Agent: `workflowCount >= 5`; Counterparty: `totalOutcomes >= 3`. Below threshold → `value = 0.5` (neutral) with `insufficient_evidence:need_N` in `basis[]` — never fabricates confident scores |
| Facade | `packages/analytics-query/src/scoring-facade.ts` — `generateAgentReliabilityProposals` / `generateCounterpartyTrustProposals` return drafts only (no Firestore writes); callers POST to existing learning-service |
| Lifecycle | Draft → `createLearningProposal` → PROPOSED → human confirm/reject → LearnedContextRecord. `requiresConfirmation` always true (Wave 3.1) |
| Invariants | INV_026 already wired in `confirmLearningProposal` for these proposal types; scoring package architecture-ban: never imported by Authority/Gateway/learning privilege paths; scores cannot mint grants/CommitTokens |
| Isolation | Scoring depends only on `@truemandate/protocol` (no circular dep with analytics-query). Query depends on scoring. Privileged packages forbid both |
| Still open | Preference memory (`USER_PREFERENCE`), workflow rule learning (`WORKFLOW_RULE`), Adaptive Authority (runtime consumption of confirmed signals), analytics UI, enabling `TM_GOVERNANCE_EVENTS_MODE=pubsub` / deploy |

**Invariant preserved:** Scores are explainable historical aggregates only. They cannot directly affect Authority, override explicit intent/policy, or mint privilege. Insufficient history yields neutral scores. Proposals still require human confirmation.

---

## Wave 3.8 closure note (2026-08-21 — appended, original rows preserved)

**Governed preference memory landed — code-only, not deployed.**

| Item | Detail |
|---|---|
| Protocol | `PreferenceRecord` + `PreferenceOrigin` / `PreferenceRecordStatus` + `PreferenceRecordId`; error codes `PREFERENCE_SUBJECT_MISMATCH`, `PREFERENCE_PROTECTED_CONCEPT`; Zod schemas registered |
| Package | `packages/preference-core` — subject identity, protected concepts, supersession, retrieval precedence, tip key + record builders |
| INV_027 | `packages/authority/src/preference-signal.ts` wired into `createLearningProposal` for `USER_PREFERENCE` (protected concepts + required content shape) |
| Persistence | Firestore collections `preferenceRecords`, `preferenceTips` (`subjectId::domain::concept` tip), `demoSessions` |
| Learning routes | Identity bind on create; confirm-time supersession → PreferenceRecord; `POST /internal/demo-sessions`; `GET /internal/preferences/:subjectId/:domain/:concept` |
| Isolation | Authenticated `principal:{email}` or allocated `demo:{sessionId}`; cross-judge / cross-domain bleed structurally impossible |
| Precedence | sticky/hard > any explicit current constraint > protected denylist → NONE > active preference → PREFERENCE > else NONE |
| Supersession | explicit always activates; learned-over-learned activates; learned-over-explicit stored SUPERSEDED (never silently overrides) |
| Still open | Workflow rule learning (`WORKFLOW_RULE`), Adaptive Authority (no live IntentState fill yet), analytics UI, deploy |

**Invariant preserved:** Preferences require confirmation, never create authority, never override explicit current intent or protected concepts, and never share memory across subjects/domains.

---

## Wave 3.9 closure note (2026-08-21 — appended, original rows preserved)

**Governed workflow-rule learning landed — code-only, not deployed.**

| Item | Detail |
|---|---|
| Protocol | `WorkflowRule` + `WorkflowRuleStatus` + `WorkflowRuleId`; error codes `WORKFLOW_RULE_SUBJECT_MISMATCH`, `WORKFLOW_RULE_PROTECTED_CONCEPT`, `WORKFLOW_RULE_INSUFFICIENT_EVIDENCE`; Zod schemas registered |
| Package | `packages/workflow-rule-core` — evidence threshold (`MIN=3`, distinct refs), preference-history derivation, applicability precedence, versioned supersession, tip key + record builders |
| INV_028 | `packages/authority/src/workflow-rule-signal.ts` wired into `createLearningProposal` for `WORKFLOW_RULE` (protected concepts + ≥3 distinct evidence + required content shape); INV_015 still applies when scope pair present |
| Persistence | Firestore collections `workflowRules`, `workflowRuleTips` (`subjectId::domain::concept` tip), `preferenceEvidenceIndexes` (secondary index for evidence derivation) |
| Learning routes | Identity bind on create; confirm-time versioned supersession → WorkflowRule; `GET /internal/workflow-rules/:subjectId/:domain/:concept`; `POST /internal/workflow-rules/evidence` |
| Evidence | Derived from repeated confirmed `PreferenceRecord` history (deduped by `sourceLearningProposalId`); insufficient history → `sufficient=false` / create rejected |
| Precedence | sticky/hard > any explicit current constraint > protected denylist → NONE > active rule → RULE > else NONE |
| Supersession | first confirm → v1 ACTIVE; later confirm → version++, previous SUPERSEDED; lineage via `supersedesId` / `supersededById` |
| Still open | Adaptive Authority (runtime consumption of confirmed preferences/rules/trust), analytics UI, enabling `TM_GOVERNANCE_EVENTS_MODE=pubsub` / deploy |

**Invariant preserved:** Workflow rules require repeated confirmed evidence and human confirmation, never create authority, never override explicit current intent or protected concepts, and never share memory across subjects/domains.

**Wave 3 functional status:** Learning lifecycle, reputation invariant, BigQuery analytics/export, cross-workflow queries, publisher contract, semantic gaps, scoring, preference memory, and workflow-rule learning are implemented in code. Remaining Wave 3 gaps are Adaptive Authority consumption (Wave 4), analytics UI, and production enablement/deploy of analytics publishers.
