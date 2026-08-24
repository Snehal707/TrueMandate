# Wave 4 - Adaptive Runtime & General Workflow Gap Map (2026-08-21)

Source-verified. Requirement -> current implementation -> gap -> recommended owner -> invariant implication.

**Status:** Wave 4.1 COMPLETE (Guardian + scope fusion). Wave 4.2 COMPLETE (GenericWorkflowEngine + DomainPack; procurement migrated; hardcoded outcome domain branch removed). Wave 4.3 COMPLETE (`ALLOW_WITH_MONITORING` now materializes when eligible, opens a durable `MonitoringContract`, and real outcome events escalate monitoring fail-open). Remaining active Wave 4 gaps are Adaptive Authority signals, additional domain packs, the general arbitrary-intent API, and SDK/ADK/A2A lifecycle expansion.

**Sources:** `docs/PROJECT_SPEC.md`, `TrueMandate_Claude_Handoff.md` (Sec. 4.1-4.6, "Domain packs for final demo"), `docs/architecture/wave1-production-closure.md`, `docs/architecture/wave2-production-closure.md`, `docs/architecture/wave3-production-closure.md`, `docs/architecture/wave3-gap-map.md`, plus direct inspection of `packages/protocol`, `packages/schemas`, `packages/authority`, `packages/guardian-core`, `services/authority-service`, `services/agent-runtime`, `services/outcome-service`, `packages/sdk-core`, `packages/sdk-agent`, `packages/sdk-adk`, `integrations/google-adk`, `scenarios/`, `packages/safe-benchmark`.

## Headline

Wave 3 built the *signal layer* (`TrustSignal`, `LearnedContext`, `PreferenceRecord`, `WorkflowRule` - all confirmable-only, zero authority influence). Wave 4 must build the *consumption + generalization layer*. Progress so far:

1. **Wave 4.1 done:** Live procurement Authority path (`POST /internal/authority/procurement`) now fuses Guardian semantic gate with deterministic scope via `evaluatePrivilegedAuthority` / `applyGuardianSemanticGate` / `combineAuthorityDecisions`. Guardian BLOCK / REQUIRE_APPROVAL / ALLOW_WITH_MONITORING propagate; scope restrictions still dominate; no grant/CommitToken/Gateway bypass introduced.
2. **Wave 4.2 done:** Procurement orchestration extracted into `GenericWorkflowEngine` + `ProcurementDomainPack`. DomainPack provides only domain semantics (schema, workflowId, action fields, evidence/obligation hints, offer node label, outcome commercial inputs). Governance pipeline (Guardian -> Authority -> Gateway -> Outcome) is engine-owned. Hardcoded `if (domain === "travel") ... else procurement` branch in `OutcomeService` replaced with a domain-keyed builder registry. Architecture-ban tests prove packs cannot mint grants, issue CommitTokens, call Gateway commit, or bypass proof obligations. Procurement remains the canonical historical/reference specimen, not the shared runtime's product identity.
3. **Wave 4.3 done:** `ALLOW_WITH_MONITORING` now preserves the spec's intended semantics: evaluation remains materializable when eligible, the engine opens a durable `MonitoringContract`, Gateway PREPARE accepts the eligible monitoring evaluation, and deterioration escalates via monitoring rather than being collapsed into approval-gating.
4. No decision path consumes `TrustSignal` / `LearnedContextRecord` / `PreferenceRecord` / `WorkflowRule`. Adaptive Authority signal consumption remains the next major gap on top of the now-fused static decision.
5. There is no general arbitrary-intent workflow API. Recording an intent (`POST /v1/intents`) explicitly "does nothing" beyond storage - every SDK capability that would trigger compile/guardian/authority/gateway is marked `infrastructure-owned, no public route`. The engine exists; a public/internal general-intent entry point does not.
6. Procurement is the **only** DomainPack. Travel has fixtures + an outcome template registered in the builder registry but no workflow pack. SaaS/IT spend, Invoice/vendor payment, and Logistics have **zero** runtime presence (benchmark-catalog text only).
7. SDK/ADK/A2A are real but narrow: `sdk-core` supports only `recordIntent` + 3 read routes; the ADK/A2A agent exposes exactly 2 tools (`record_intent`, `canonical_proof`); `sdk-adk` is a fully-built but orphaned package never wired into the real ADK integration.
8. Architecture-ban / no-bypass invariants hold today (extended in Wave 4.2 for DomainPack). No SDK/ADK/A2A/DomainPack path mints a grant, issues a CommitToken, or calls Gateway directly.

## Gap map

| Requirement | Current implementation | Gap | Owner | Authority/security |
|---|---|---|---|---|
| Adaptive Authority (consume Wave 3 signals under hard-policy dominance) | Full 4-value `AuthorityDecision` enum. Guardian can emit `ALLOW_WITH_MONITORING`. **Wave 4.1:** Guardian+scope fusion is now the live procurement decision. Wave 3 signals fully built + confirmable. INV_026 formalized at learning-confirm time only. | Adaptive decision composition that reads confirmed TrustSignal / LearnedContext / Preference / WorkflowRule *after* fused static decision; dominance rule as tested function/invariant (signals may only narrow/add friction, never broaden). | `packages/authority` + `services/authority-service` | INV_026 must be re-exercised at decision time. Hard policy intersection explicit intent intersection capability max intersection authority chain always wins. No signal may mint grants / CommitTokens / Gateway authority. |
| `ALLOW_WITH_MONITORING` runtime semantics | Enum + evaluation record + `PENDING_MONITORING` materialization reason. Fusion correctly propagates the decision into `EvaluationRecord`. Wave 4.3 now also materializes eligible `ALLOW_WITH_MONITORING` decisions through the real Gateway PREPARE path. | **Done (Wave 4.3).** Execution proceeds immediately when `materializationEligible=true`; the monitoring path no longer collapses into `REQUIRE_APPROVAL`. | `packages/authority` + authority-service + gateway-service + agent-runtime | Monitoring remains non-privileged: it may narrow or freeze future execution, but it does not mint new privilege. |
| `MonitoringContract` + escalation | Protocol object/schema/store/routes are now present. Agent runtime opens a durable `MonitoringContract` for `ALLOW_WITH_MONITORING`, and authority monitoring routes map real outcome events into escalation / resolution transitions. | **Done (Wave 4.3).** Risk deterioration escalates monitoring on `AT_RISK` / `PARTIAL` / `CONFLICTED`; verified failure on `BREACHED` moves to `RESOLUTION_OPENED`. Monitoring creation is fail-open for the initial execution path and emits a visible structured warning on failure. | `packages/protocol` + `packages/schemas` + authority-service + agent-runtime | Escalation to any new privileged action still requires independent authority. Monitoring failure must not silently widen capability. |
| General arbitrary-intent governed workflow | Intent Compiler domain-agnostic. `POST /v1/intents` records arbitrary text. Pub/Sub compile path exists. **Wave 4.2:** `GenericWorkflowEngine` owns the full lifecycle; procurement route re-pointed at engine + `ProcurementDomainPack`. | Public/internal general workflow API: recorded Intent + generic proposed action -> compile-verified IntentState -> engine. Auto-publish / compile glue from recorded intents. No exposure of grant mint / CommitToken / raw Gateway commit. | `services/agent-runtime` + `packages/public-api` + sdk-core | Extend architecture-ban tests to every new public route. Same governance runtime for all intents. |
| Multi-domain runtime (pluggable packs) | **Wave 4.2:** `DomainPack` interface + `ProcurementDomainPack` + `GenericWorkflowEngine`. OutcomeService domain-keyed builder registry (procurement + travel templates). Travel fixtures exist; no TravelDomainPack. SaaS/IT, Invoice, Logistics: SAFE benchmark / golden text only. Authority S2S still named `evaluateProcurement` only. | Travel, SaaS/IT-spend, Invoice/vendor-payment, Logistics as packs (not new services). Generalize S2S/route naming (`evaluateProcurement` -> domain-agnostic evaluate) when adding packs. | agent-runtime DomainPacks + outcome-service registry + authority-service | All domains must use the same governance runtime. Packs must not become separate hardcoded apps. |
| Custom Intent | `POST /v1/intents`, `sdk-core.recordIntent()`, ADK `true_mandate_record_intent` accept free text. Explicitly "nothing follows." | Wire recorded custom intent into general workflow API (API sufficient for Wave 4; judge UI is Wave 5). | Depends on general workflow API | Same no-bypass boundary as general workflow. |
| Full SDK lifecycle | `sdk-core`: `recordIntent`, `readCanonicalProjection`, `readEvidence`, `readWorkspace`. `sdk-agent`: local ActionProposal drafting; `submit/execute/pay/commit/mint: false`. Architecture-ban tests hold. BFF router already defines approval/resolution/evidence/procurement routes that **prod BFF does not wire**. | Workflow status, approval request/respond, evidence submit, outcome status, resolution status, general-intent-run methods. Turn on already-coded BFF routes where safe. Keep zero privileged exposure. | `packages/sdk-core` + `packages/public-api` | Never expose grant mint / CommitToken / Gateway commit. Extend boundary tests. |
| Full ADK lifecycle | Real TS Google ADK agent - 2 tools only. Deployed. Boundary tests prove no economic bypass. `packages/sdk-adk` exists but is **orphaned**. No Python ADK agent. | Wire `sdk-adk`; add governed tools for workflow status, approval respond, evidence submit, outcome/resolution status. Still no direct privileged tool. | `integrations/google-adk` + `packages/sdk-adk` | ADK reasons; TrueMandate authorizes. Tools must call governed public/S2S-safe surfaces only. |
| Full A2A lifecycle | Real A2A 1.0 server + agent card + executor; same 2 skills; live smoke; Cloud Run. No runtime `AgentRegistry` service. | A2A skills mirroring full governed SDK surface; optional reusable A2A client wrapper. Registry remains discovery, not authority. | `integrations/google-adk` | A2A interoperates; TrueMandate authorizes. No privileged skill. |

### Multi-domain status detail

| Domain | Status | Evidence |
|---|---|---|
| Procurement | **Full E2E via GenericWorkflowEngine + ProcurementDomainPack** (+ Wave 4.1 fused Authority) | `generic-workflow-engine.ts`, `procurement-domain-pack.ts`, `evaluateProcurement` S2S, Guardian+scope fusion on `/internal/authority/procurement`, outcome templates, scenarios |
| Travel | **Partial** | `buildTravelRequirements()` / `createTravelContract()` registered in outcome builder registry; fixtures - no TravelDomainPack, no coordinator, no `evaluateTravel` |
| SaaS / IT spend | **Missing** | `"subscriptions"` enum + template intents in `packages/safe-benchmark` only |
| Invoice / vendor payment | **Missing** | `"payments"` golden scenarios + benchmark catalog only |
| Logistics | **Missing** | Resolution-test line + `RootCauseCode.LOGISTICS_FAILURE`; expectation stub only |

## Invariant status entering Wave 4.3+

| Invariant / rule | Status |
|---|---|
| Trust/reputation may influence but never create authority (INV_026) | Enforced only at learning-proposal-confirm time; **not yet exercised** at authority-decision time |
| Hard policy and explicit intent always dominate | True today by construction (static scope + Guardian fusion); must remain true once adaptive inputs are added |
| No direct grant / CommitToken / Gateway exposure | **Held** across SDK, ADK, A2A, Authority route, and DomainPack (Wave 4.2 architecture-ban tests) |
| All domains use the same governance runtime | **Held structurally** - single `GenericWorkflowEngine`; packs supply semantics only |
| Domain packs must not become separate hardcoded apps | **Held** - OutcomeService uses registry; only ProcurementDomainPack exists; no per-domain coordinator |
| Adaptive signals may only narrow or add friction, never broaden a static decision | **No invariant number / test yet.** Formalize before Adaptive Authority consumption lands |
| Guardian+scope fusion never upgrades severity | **Held (Wave 4.1):** `combineAuthorityDecisions` max-severity rank tested |

## Recommended implementation order

1. ~~**Wire the Guardian+scope fusion into the live authority path.**~~ **DONE (Wave 4.1).**
2. ~~**Generalize the workflow coordinator.**~~ **DONE (Wave 4.2).** `GenericWorkflowEngine` + `DomainPack` + `ProcurementDomainPack`; outcome domain registry; architecture-ban tests.
3. ~~**`MonitoringContract` + correct `ALLOW_WITH_MONITORING` semantics.**~~ **DONE (Wave 4.3).** Eligible `ALLOW_WITH_MONITORING` evaluations materialize, open `MonitoringContract`, and escalate from real outcome events without blocking the initial authorized execution.
4. **Adaptive Authority signal consumption.** Inside the fused decision function, read confirmed Wave 3 signals as bounded inputs; formalize the dominance rule as its own tested function/invariant.
5. **General arbitrary-intent workflow API.** Using the Wave 4.2 engine, add a public/internal route that takes a recorded `Intent` + a generic proposed action through the full governed pipeline.
6. **Additional domain packs.** Travel (already has outcome template), then SaaS/IT-spend, Invoice/vendor-payment, Logistics - as DomainPacks, not new services. Optionally generalize S2S/route naming.
7. **Custom Intent entry point.** Wire step-5's general API behind a minimal entry point.
8. **Full SDK lifecycle.**
9. **Full ADK lifecycle.**
10. **Full A2A lifecycle.**

## Wave 4.1 closure note

- Live path: `/internal/authority/procurement` parses durable `ActionProposal` + `GuardianVerdict` from the integrity-checked artifact chain, then calls `evaluatePrivilegedAuthority`.
- Decision composition: `combineAuthorityDecisions(guardian, scope)` = max severity (`BLOCK > REQUIRE_APPROVAL > ALLOW_WITH_MONITORING > ALLOW`).
- Explicitly deferred at 4.1: Adaptive Authority signals, MonitoringContract, workflow generalization, domains.

## Wave 4.2 closure note

- Engine: `services/agent-runtime/src/generic-workflow-engine.ts` - Intent/IntentState -> ActionProposal -> Guardian -> Authority -> approval -> PREPARE -> AUTHORIZE -> COMMIT -> OutcomeContract.
- DomainPack: `services/agent-runtime/src/domain-pack.ts` - semantics only; no Authority/Gateway/Outcome clients.
- Procurement: `services/agent-runtime/src/procurement-domain-pack.ts`; deleted `procurement-workflow.ts`.
- OutcomeService: `OUTCOME_CONTRACT_BUILDERS` registry replaces `if (domain === "travel")` branch; `createTravelContract` extracted to templates.
- Architecture-ban: `domain-pack-architecture-ban.test.ts` - static + structural + dual-pack path proof.
- Explicitly deferred: Travel/SaaS/Invoice/Logistics packs, Adaptive Authority, MonitoringContract, UI, S2S/route renaming (`evaluateProcurement` etc.).

## Wave 4.3 closure note

- `ALLOW_WITH_MONITORING` now remains materializable when `materializationEligible=true`; Gateway PREPARE accepts the eligible evaluation instead of treating it like a second approval gate.
- `GenericWorkflowEngine` opens a durable `MonitoringContract` on the monitoring path and forwards the returned `monitoringContractId` into outcome creation.
- Real outcome events are wired into monitoring escalation: `AT_RISK`, `PARTIAL`, and `CONFLICTED` elevate risk and escalate the monitoring contract; `BREACHED` opens resolution via `RESOLUTION_OPENED`.
- Monitoring creation is fail-open for the initial already-approved execution path, but failures are not silent: a visible structured warning is emitted as `tm.monitoring.create_failed`.
- Remaining Wave 4 gaps after 4.3: Adaptive Authority consumption, general arbitrary-intent workflow API, additional domain packs, and SDK/ADK/A2A lifecycle expansion.
