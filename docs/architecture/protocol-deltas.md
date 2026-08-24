# Canonical Protocol Deltas

Additions present in `@truemandate/protocol` and `@truemandate/schemas` that extend or clarify `docs/PROJECT_SPEC.md` Protocol Objects.

| Addition | Reason |
|----------|--------|
| `PlanGraph` / `PlanStep` | Required by Planner section; omitted from Protocol Objects bullet list |
| `SUMMARIZES` semantic relation | Explicit provenance for summarization taint survival (INV_004) |
| `DELEGATES_TO` semantic relation | Explicit provenance for delegation taint survival (INV_004) |
| `PRINCIPAL` / `EXTERNAL` node kinds | Path tracing Principal → Intent → Authority → Action and external influence |
| Branded ID types + `ErrorCode` | Deterministic fail-closed service boundaries |
| `CandidateConstraint` / `CandidateInterpretation` | Phase 4 compiler structured proposals (not authority) |
| `SemanticVerificationResult` / `VerificationFinding` / `SemanticTransformation` | Independent verifier outcomes |
| `AmbiguityClass` (A0–A4) | Ambiguity preserved for later Adaptive Authority |
| `IntentReadiness` | SEARCHABLE / PLANNABLE / ACTIONABLE / EXECUTABLE |
| `SemanticLifecycle` | RAW / COMPILED / VERIFIED / AMBIGUOUS / REJECTED |
| `TemporalResolution` | Stable relative-date resolution against explicit timestamp/timezone |
| `ModelInvocationMeta` | model / prompt / schema / protocol versioning for SAFE reproducibility |
| Error codes: `GROUNDING_FAILED`, `NEGATION_LOSS`, `QUANTITY_MISMATCH`, `TEMPORAL_MISMATCH`, `INVENTED_CONSTRAINT`, `SEMANTIC_WEAKENING`, `SEMANTIC_STRENGTHENING`, `MODEL_UNAVAILABLE`, `SEMANTIC_VERIFICATION_FAILED` | Phase 4 fail-closed semantic gates |
| Provenance edge polarity | Influence-flow `from→to`; `DERIVED_FROM` means source→derivative (see provenance-edges.md) |
| `SourceSpan` UTF-16 code units | Matches `String.prototype.slice`; exact `sourceText` (see source-spans.md) |
| `PlanStatus` / `CommitmentLevel` / `ConstraintCoverageStatus` | Phase 5 planning commitment and coverage |
| `ConstraintCoverageStatus.DEFERRED` | Relevant to workflow but not yet enforced (distinct from `IRRELEVANT`) |
| Extended `PlanGraph` / `PlanStep` | Verification binding, coverage, proof obligations, operationalizations, versioning |
| `PlanVerificationResult` | Independent plan verifier outcome |
| Extended `DelegationEnvelope` | plan/step binding, transformations, envelopeHash |
| Extended `ProofObligation` | Optional constraintId / planStepId / evidenceKinds |
| Error codes: `PLAN_COVERAGE_GAP`, `PLAN_STALE`, `PROOF_OBLIGATION_MISSING`, `UNSUPPORTED_OPERATIONALIZATION`, `INAPPROPRIATE_COMMITMENT`, `DELEGATION_SCOPE_EXPANDED`, `SEMANTIC_READINESS_INSUFFICIENT`, `CONSTRAINT_DROPPED`, `PLAN_VERIFICATION_FAILED` | Phase 5 fail-closed planning/delegation |
| `PARTIALLY_SUPPORTED` / `GuardianSemanticStatus` / `JudgeId` / `JudgeInvocationStatus` / `ConstraintApplicability` | Phase 6 Guardian committee vocabulary |
| Extended `ConstraintClaim` / `GuardianVerdict` / `JudgeResult` | Binding hashes, semantic status, judge results, classifications |
| `GuardianVerdict.intentStateHash` | Bind IntentState content hash; tip-id alone is insufficient |
| `ActionProposal.planId` / `planStepId` | Optional plan binding for Guardian |
| `ProvenanceNodeKind.FINDING` | Guardian judge findings in provenance (not authority) |
| Error codes: `GUARDIAN_*`, `UNTRUSTED_INFLUENCE`, `UNSUPPORTED_ASSUMPTION`, `EVIDENCE_INSUFFICIENT`, `ACTION_PROPOSAL_MISMATCH` | Phase 6 fail-closed semantic review |
| `ToolPrivilegeClass` T0–T3 / `ApprovalDecision` / `ReconciliationState` / `ExecutionState.PENDING` | Phase 7 tool registry + execution |
| Extended `PreparedAction` / `CommitToken` | Guardian/plan/tool/idempotency/external snapshot binding |
| `ApprovalArtifact` / `ToolDescriptor` / `SideEffectRecord` / `MaterialExternalSnapshot` | Approval, registry, ledger, TOCTOU |
| Error codes: `TOOL_*`, `APPROVAL_*`, `SEMANTIC_GATE_BLOCKED`, `GUARDIAN_VERDICT_REQUIRED`, `RECONCILIATION_REQUIRED`, … | Phase 7 fail-closed privileged execution |
| `ProvenanceNodeKind.EXECUTION` / `SIDE_EFFECT` | Phase 7 privileged execution vs side-effect provenance (`OUTCOME` reserved for OutcomeContract) |
| `GrantConsumptionState.PENDING_RECONCILIATION` | UNKNOWN economic execution locks grant until reconcile |
| Economic reservation / `IN_FLIGHT` exposure on UNKNOWN | Prevents CommitToken re-issue and salami under uncertainty |
| `OutcomeRequirementState.PENDING` / `CONFLICTED` / `AT_RISK` | Phase 8 requirement lifecycle |
| `OutcomeRequirementType` / `OutcomeEventType` | Phase 8 typed requirements and events |
| `OutcomeContractState.CONFLICTED` | Independent HARD evidence disagreement |
| Extended `OutcomeContract` / `OutcomeRequirement` / `OutcomeEvent` | Binding hashes, predicates, evidence policy, dedupe |
| `OutcomeStateTransition` / `OutcomeRiskSignal` | Transition audit + AT_RISK operational signal |
| `PreparedAction.outcomeContractId` / `outcomeContractHash` | T2/T3 commit binding (INV-style) |
| Error codes: `OUTCOME_*`, `EVIDENCE_STALE`, `EVIDENCE_NOT_INDEPENDENT`, `EVIDENCE_CONFLICT` | Phase 8 fail-closed outcome/evidence |
| `OutcomeContract.definitionHash` / staged `OutcomeContractDefinition` | Non-circular binding: PA binds definition hash; PA hash never folds into definition |
| Binding policy: T2/T3 require OutcomeContract via registry privilege class | Fail-closed; DI cannot bypass |
| `ResolutionTriggerIdentity` on outcome trigger events | Phase 9 idempotent case opening |
| `ResolutionCaseState` full machine | OPEN → … → VERIFYING_REMEDY → RESOLVED / ESCALATED / CLOSED |
| Extended `ResolutionCase` | principal, trigger identity, PA/SE binding, recursion, caseVersion |
| `CausalTimelineEvent` / `EstablishmentState` | Facts vs claims; no invented narrative |
| `ResponsibilityHypothesis` / `RootCauseCode` / `ResponsibilityState.POSSIBLE` | Structured blame hypotheses; accusation ≠ ESTABLISHED |
| `EvidenceRequest` | Discriminating low-privilege evidence planning |
| Extended `RemedyProposal` | restoration value, financial cost, capabilities, newOutcomeContractId, reversibility |
| `ResolutionEvent` append-only log | Case lifecycle, evidence, hypotheses, remedies, authority, outcomes |
| Error codes: `RESOLUTION_TRANSITION_INVALID`, `RESOLUTION_TRIGGER_DUPLICATE`, `RESOLUTION_RECURSION_LIMIT`, `RESOLUTION_EVIDENCE_LIMIT`, `RESOLUTION_BOUNDS_EXCEEDED`, `RESOLUTION_AGENT_MUTATION_FORBIDDEN`, … | Phase 9 fail-closed resolution |
| `RemediationMandate` + `requiredRemediationMandateId` | Scope prerequisite for remedies; distinct from PreparedAction-bound execution `AuthorityGrant` |
| Error codes: `REMEDIATION_MANDATE_*` | Mandate required/invalid/stale/scope/case mismatch/not executable |

### Staged binding (non-circular)

```
IntentState → Plan → ActionProposal → OutcomeContractDefinition
  → definitionHash (= contractHash at create)
  → PreparedAction.outcomeContractHash binds definitionHash
  → parameterHash = H(parameters only) — never includes outcomeContractHash
  → execution binding event links PreparedAction → OutcomeContract (append-only)
```

`preparedActionId` / `preparedActionHash` on the contract are convenience back-refs and are **excluded** from `definitionHash`.

Any future protocol change must update this file in the same change as types/schemas.
