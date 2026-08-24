import { IntentService } from "@truemandate/intent-service";
import { AuthorityService } from "@truemandate/authority-service";
import { ProvenanceService } from "@truemandate/provenance-service";
import { OutcomeService } from "@truemandate/outcome-service";
import { ResolutionService } from "@truemandate/resolution-service";
import {
  executeRemedyPipeline,
  type PrivilegedRemedyPort,
} from "@truemandate/resolution-service";
import {
  AuthorityDecision,
  ConstraintKind,
  ConstraintMutability,
  ConstraintOperator,
  MeaningClass,
  OutcomeContractState,
  ResolutionCaseState,
  SourceType,
  asAuthorityGrantId,
  asConstraintId,
  asProvenanceEdgeId,
  asProvenanceNodeId,
  ProvenanceNodeKind,
  SemanticRelation,
  TrustClass,
} from "@truemandate/protocol";
import { emptyTaint } from "@truemandate/provenance";
import { hashActionProposal } from "@truemandate/guardian-core";
import {
  GuardianConstraintClassification,
  GuardianSemanticStatus,
  JudgeId,
  JudgeInvocationStatus,
  PROTOCOL_VERSION,
  type ActionProposal,
  type GuardianVerdict,
} from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { TwoPhaseGateway } from "./two-phase.js";
import { mintThenAuthorize, provenanceOwnerFrom } from "./integration/harness.js";

const NOW = "2026-06-04T12:00:00.000Z";
const FUTURE = "2026-12-01T00:00:00.000Z";

describe("Phase 9 remedy via TwoPhaseGateway", () => {
  it("independent remedy grant + bound OutcomeContract through prepare/authorize/commit", async () => {
    const intents = new IntentService();
    const provenance = new ProvenanceService();
    const authority = new AuthorityService(intents);
    const outcomes = new OutcomeService();
    const gateway = new TwoPhaseGateway({
      intents,
      authority,
      provenance,
      outcomeBinding: outcomes,
      // TEST-ONLY lane: legacy Phase 3/7 harness grants lack the production
      // evaluation lineage; the authorize-time provenance gate is skipped
      // here while the binding invariant under test remains enforced.
      allowUnboundEconomicCommit: true,
      provenanceOwner: provenanceOwnerFrom(provenance),
    });

    const intent = await intents.createIntent({
      id: "intent-remedy",
      principalId: "principal-1",
      rawText: "Buy 500 food-grade containers",
      createdAt: NOW,
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    const state = await intents.createIntentState({
      id: "state-remedy",
      intentId: intent.value.id,
      createdBy: "principal-1",
      createdAt: NOW,
      constraints: [
        {
          id: asConstraintId("c-food"),
          concept: "food_grade",
          operator: ConstraintOperator.REQUIRE,
          value: true,
          kind: ConstraintKind.SAFETY_CRITICAL,
          importance: 1,
          confidence: 1,
          sourceType: SourceType.HUMAN,
          mutability: ConstraintMutability.IMMUTABLE,
          meaningClass: MeaningClass.EXPLICIT,
        },
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    const principalId = asProvenanceNodeId("node-p");
    const intentNodeId = asProvenanceNodeId("node-i");
    const authNodeId = asProvenanceNodeId("node-a");
    const actionNodeId = asProvenanceNodeId("node-act");
    await provenance.recordNode({
      id: principalId,
      kind: ProvenanceNodeKind.PRINCIPAL,
      label: "p",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_HUMAN,
      taint: emptyTaint(),
    });
    await provenance.recordNode({
      id: intentNodeId,
      kind: ProvenanceNodeKind.INTENT,
      label: "i",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_HUMAN,
      taint: emptyTaint(),
      subjectRef: intent.value.id,
    });
    await provenance.recordNode({
      id: authNodeId,
      kind: ProvenanceNodeKind.AUTHORITY,
      label: "a",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    await provenance.recordNode({
      id: actionNodeId,
      kind: ProvenanceNodeKind.ACTION,
      label: "act",
      createdAt: NOW,
      trustClass: TrustClass.TRUSTED_SYSTEM,
      taint: emptyTaint(),
    });
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e1"),
      from: principalId,
      to: intentNodeId,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e2"),
      from: principalId,
      to: authNodeId,
      relation: SemanticRelation.INTRODUCED_BY,
      createdAt: NOW,
    });
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e3"),
      from: intentNodeId,
      to: actionNodeId,
      relation: SemanticRelation.RESULTED_IN,
      createdAt: NOW,
    });
    await provenance.recordEdge({
      id: asProvenanceEdgeId("e4"),
      from: authNodeId,
      to: actionNodeId,
      relation: SemanticRelation.AUTHORIZES,
      createdAt: NOW,
    });

    const purchaseOc = await outcomes.createContractFromIntent({
      id: "oc-purchase",
      intentState: state.value,
      principalId: "principal-1",
      merchant: "approved-a",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    expect(purchaseOc.ok).toBe(true);
    if (!purchaseOc.ok) return;
    await outcomes.onPaymentSuccess(purchaseOc.value.id, NOW);
    await outcomes.applyObservations(
      purchaseOc.value.id,
      {
        quantityReceived: 450,
        quantityOrdered: 500,
        pricePaid: 700000,
        budgetMax: 800000,
        merchantObserved: "approved-a",
        merchantExpected: "approved-a",
        certificateValid: true,
        productObserved: "fg",
        productExpected: "fg",
      },
      NOW,
    );
    const trigger = outcomes
      .listEvents(purchaseOc.value.id)
      .find((e) => e.type === "OUTCOME_PARTIAL");
    expect(trigger).toBeTruthy();
    if (!trigger) return;

    const resolution = new ResolutionService(outcomes);
    const opened = await resolution.openCaseFromTrigger({
      intentState: state.value,
      principalId: "principal-1",
      contractId: purchaseOc.value.id,
      triggerEvent: trigger,
      now: NOW,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const remedies = await resolution.planRemedies(opened.value.id, NOW);
    expect(remedies.ok).toBe(true);
    if (!remedies.ok) return;
    const issued = await resolution.issueMandate({
      caseId: opened.value.id,
      remedy: remedies.value[0]!,
      principalId: "principal-1",
      maxAmount: 100000,
      currency: "INR",
      allowedCapabilities: ["execute_payment"],
      allowedMerchants: ["remedy-counterparty"],
      expiresAt: FUTURE,
      now: NOW,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const port: PrivilegedRemedyPort = {
      executeBoundEconomicAction: async (input) => {
        const action: ActionProposal = {
          id: "action-remedy" as ActionProposal["id"],
          intentId: intent.value.id,
          intentStateId: state.value.id,
          agentId: "agent-1" as ActionProposal["agentId"],
          capability: input.capability,
          merchant: input.merchant,
          product: "remedy",
          quantity: input.quantity,
          amount: input.amount,
          currency: input.currency,
          refundable: true,
          parameters: { remedy: true },
          consequenceLevel: "HIGH",
          createdAt: input.now,
        };
        const actionContentHash = hashActionProposal(action);
        const verdict: GuardianVerdict = {
          id: "gv-remedy",
          actionId: action.id,
          intentId: action.intentId,
          intentStateId: action.intentStateId,
          intentStateHash: state.value.stateHash as GuardianVerdict["intentStateHash"],
          actionContentHash,
          evidenceSnapshotHash:
            "ev-empty" as GuardianVerdict["evidenceSnapshotHash"],
          decision: AuthorityDecision.ALLOW,
          semanticStatus: GuardianSemanticStatus.CLEAR,
          overallFidelity: 1,
          constraintClaims: [
            {
              constraintId: asConstraintId("c-food"),
              classification: GuardianConstraintClassification.SUPPORTED,
              applicability: "APPLICABLE" as const,
              confidence: 1,
              criticality: ConstraintKind.SAFETY_CRITICAL,
            },
          ],
          contradictions: [],
          uncertainty: 0,
          criticalFailure: false,
          judgeResults: [
            {
              judgeId: JudgeId.FIDELITY,
              status: JudgeInvocationStatus.OK,
              findings: [],
            },
          ],
          protocolVersion: PROTOCOL_VERSION,
          promptVersions: {},
          schemaVersions: {},
          stale: false,
          createdAt: input.now,
          verdictHash: actionContentHash,
        };
        const prepared = await gateway.prepare({
          action,
          verdict,
          principalId: input.principalId,
          toolId: input.toolId,
          agentCapabilities: {
            execute_payment: AuthorityDecision.ALLOW,
          },
          externalState: {
            merchant: input.merchant,
            amount: input.amount,
            currency: input.currency,
            product: "remedy",
            quantity: input.quantity,
          },
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
          createdAt: input.now,
          outcomeContractId: input.outcomeContractId,
          outcomeContractHash: input.outcomeContractHash,
        });
        if (!prepared.ok) return prepared;
        const authz = await mintThenAuthorize({ authority, gateway, provenance }, {
          preparedAction: prepared.value,
          action,
          verdict,
          authorityRequest: {
            id: "req-remedy",
            principalId: input.principalId,
            agentId: "agent-1",
            intentId: intent.value.id,
            intentStateId: state.value.id,
            actionId: action.id,
            capability: input.capability,
            scope: {
              capabilities: { execute_payment: AuthorityDecision.ALLOW },
              maxAmount: input.grantScopeMaxAmount,
              currency: input.currency,
              allowedMerchants: [input.merchant],
              deniedMerchants: [],
              allowedCategories: ["remedy"],
              resourceScope: ["resolution"],
              expiresAt: input.expiresAt,
              maxDelegationDepth: 1,
            },
            merchant: input.merchant,
            amount: input.amount,
            currency: input.currency,
            createdAt: input.now,
          },
          expiresAt: input.expiresAt,
          createdAt: input.now,
        });
        if (!authz.ok || !authz.value.grant || !authz.value.commitToken) {
          return authz.ok
            ? {
                ok: false as const,
                code: "VALIDATION_FAILED" as never,
                message: "missing grant/token",
                details: {},
              }
            : authz;
        }
        // Execution grant must differ from mandate and from original purchase grant
        expect(authz.value.grant.id).not.toBe("grant-payment");
        expect(authz.value.grant.id).not.toBe(String(input.remediationMandateId));
        expect(authz.value.grant.preparedActionHash).toBe(
          prepared.value.preparedActionHash,
        );
        const commit = await gateway.commit({
          preparedAction: prepared.value,
          grantId: authz.value.grant.id,
          commitToken: authz.value.commitToken,
          agentId: "agent-1",
          externalState: {
            merchant: input.merchant,
            amount: input.amount,
            currency: input.currency,
            product: "remedy",
            quantity: input.quantity,
          },
          actionNodeId,
          authorityNodeId: authNodeId,
          now: input.now,
        });
        if (!commit.ok) return commit;
        return {
          ok: true as const,
          value: {
            status: commit.value.status as "SUCCESS" | "FAILED" | "UNKNOWN",
            preparedActionId: prepared.value.id,
            preparedActionHash: String(prepared.value.parameterHash),
            executionGrantId: authz.value.grant.id,
            sideEffectId: commit.value.sideEffect?.id,
          },
        };
      },
    };

    const result = await executeRemedyPipeline({
      resolution,
      outcomes,
      gateway: port,
      caseId: opened.value.id,
      remedy: issued.value.remedy,
      mandate: issued.value.mandate,
      originalPaymentGrantId: asAuthorityGrantId("grant-payment"),
      intentState: state.value,
      principalId: "principal-1",
      now: NOW,
      expiresAt: FUTURE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.executionStatus).toBe("SUCCESS");
    expect(result.value.executionGrantId).not.toBe(issued.value.mandate.id);
    expect(result.value.case.state).toBe(ResolutionCaseState.VERIFYING_REMEDY);
    const remedyOc = await outcomes.getContract(result.value.remedyOutcomeContractId);
    expect(remedyOc.ok).toBe(true);
    if (!remedyOc.ok) return;
    expect(remedyOc.value.paymentStatus).toBe("SUCCESS");
    expect(remedyOc.value.state).toBe(OutcomeContractState.AWAITING_OUTCOME);
    expect(remedyOc.value.state).not.toBe(OutcomeContractState.SATISFIED);
    // Original purchase OC still PARTIAL
    const orig = await outcomes.getContract(purchaseOc.value.id);
    expect(orig.ok).toBe(true);
    if (orig.ok) expect(orig.value.state).toBe(OutcomeContractState.PARTIAL);
  });
});
