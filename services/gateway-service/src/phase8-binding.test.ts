import { hashActionProposal } from "@truemandate/guardian-core";
import { OutcomeService } from "@truemandate/outcome-service";
import { AuthorityDecision, ErrorCode, ToolPrivilegeClass } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import {
  FUTURE,
  NOW,
  clearVerdict,
  mintThenAuthorize,
  makeRuntime,
  provenanceOwnerFrom,
} from "./integration/harness.js";
import { TwoPhaseGateway } from "./two-phase.js";

describe("Phase 8 gateway OutcomeContract binding (fail-closed)", () => {
  it("T2 without OutcomeContract → blocked on production gateway", async () => {
    const rt = await makeRuntime();
    const outcomes = new OutcomeService();
    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
      outcomeBinding: outcomes,
    });
    const prepared = await gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: rt.parentScope.capabilities,
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        product: "fg-container",
        quantity: 500,
      },
      idempotencyKey: "bind-missing-t2",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.code).toBe(ErrorCode.OUTCOME_CONTRACT_REQUIRED);
    }
  });

  it("T3 without OutcomeContract → blocked", async () => {
    const rt = await makeRuntime();
    const outcomes = new OutcomeService();
    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
      outcomeBinding: outcomes,
    });
    const action = {
      ...rt.action,
      capability: "non_refundable_purchase",
      refundable: false,
    };
    const verdict = clearVerdict(action, rt.state.stateHash);
    void hashActionProposal;
    const prepared = await gateway.prepare({
      action,
      verdict,
      principalId: "principal-1",
      toolId: "purchase.non_refundable",
      agentCapabilities: {
        ...rt.parentScope.capabilities,
        non_refundable_purchase: AuthorityDecision.ALLOW,
      },
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        product: "fg-container",
        quantity: 500,
        refundability: false,
      },
      idempotencyKey: "bind-missing-t3",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.code).toBe(ErrorCode.OUTCOME_CONTRACT_REQUIRED);
    }
    const tool = gateway.getToolRegistry().getTool("purchase.non_refundable");
    expect(tool.ok).toBe(true);
    if (tool.ok) {
      expect(tool.value.privilegeClass).toBe(ToolPrivilegeClass.T3_HIGH_CONSEQUENCE);
    }
  });

  it("missing outcome binding dependency → blocked", async () => {
    const rt = await makeRuntime();
    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      // Force production path with a port that always fails
      outcomeBinding: {
        assertBinding: () => ({
          ok: false as const,
          code: ErrorCode.OUTCOME_CONTRACT_REQUIRED,
          message: "binding dependency unavailable",
        }),
      },
    });
    const prepared = await gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: rt.parentScope.capabilities,
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
      },
      idempotencyKey: "bind-dep-missing",
      expiresAt: FUTURE,
      createdAt: NOW,
      outcomeContractId: "oc-x",
      outcomeContractHash: "hash-x",
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.code).toBe(ErrorCode.OUTCOME_CONTRACT_REQUIRED);
    }
  });

  it("T0 read operation → unaffected by outcome binding", async () => {
    const rt = await makeRuntime();
    const outcomes = new OutcomeService();
    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
      outcomeBinding: outcomes,
    });
    const visible = gateway.listVisibleTools({
      search: AuthorityDecision.ALLOW,
    });
    expect(visible.some((t) => t.toolId === "catalog.search")).toBe(true);
    expect(
      visible.find((t) => t.toolId === "catalog.search")?.privilegeClass,
    ).toBe(ToolPrivilegeClass.T0_READ);
    expect(gateway.getToolRegistry().requiresPreparedAction(visible[0]!)).toBe(
      false,
    );
  });

  it("T1 policy: registry does not require outcome binding for T1", async () => {
    const rt = await makeRuntime();
    const outcomes = new OutcomeService();
    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
      outcomeBinding: outcomes,
    });
    // No T1 tools registered — policy: only T2/T3 require outcome binding
    const all = gateway.getToolRegistry();
    for (const id of ["catalog.search", "payment.execute", "purchase.non_refundable"]) {
      const t = all.getTool(id);
      expect(t.ok).toBe(true);
      if (!t.ok) continue;
      const needsPa = all.requiresPreparedAction(t.value);
      const needsOutcome =
        t.value.privilegeClass === ToolPrivilegeClass.T2_ECONOMIC_WRITE ||
        t.value.privilegeClass === ToolPrivilegeClass.T3_HIGH_CONSEQUENCE;
      expect(needsPa).toBe(needsOutcome);
      if (t.value.privilegeClass === ToolPrivilegeClass.T1_REVERSIBLE_WRITE) {
        expect(needsOutcome).toBe(false);
      }
    }
  });

  it("T2 commit succeeds with bound contract; payment ≠ outcome SATISFIED", async () => {
    const rt = await makeRuntime();
    const outcomes = new OutcomeService();
    const oc = await outcomes.createContractFromIntent({
      id: "oc-bind",
      intentState: rt.state,
      principalId: "principal-1",
      merchant: "approved-a",
      quantity: 500,
      budgetMax: 800000,
      createdAt: NOW,
    });
    expect(oc.ok).toBe(true);
    if (!oc.ok) return;

    const gateway = new TwoPhaseGateway({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
      provenanceOwner: provenanceOwnerFrom(rt.provenance),
      outcomeBinding: outcomes,
      // TEST-ONLY lane: legacy harness grants lack the production evaluation
      // lineage; the authorize-time provenance gate is skipped here while
      // the binding invariant under test remains enforced.
      allowUnboundEconomicCommit: true,
    });
    const prepared = await gateway.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: rt.parentScope.capabilities,
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        product: "fg-container",
        quantity: 500,
        sku: "FG-500",
      },
      idempotencyKey: "bind-ok",
      expiresAt: FUTURE,
      createdAt: NOW,
      outcomeContractId: oc.value.id,
      outcomeContractHash: oc.value.contractHash,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const authz = await mintThenAuthorize({ authority: rt.authority, gateway, provenance: rt.provenance }, {
      preparedAction: prepared.value,
      action: rt.action,
      verdict: rt.verdict,
      authorityRequest: {
        id: "req-bind",
        principalId: "principal-1",
        agentId: "agent-1",
        intentId: rt.intent.id,
        intentStateId: rt.state.id,
        actionId: rt.action.id,
        capability: "execute_payment",
        scope: rt.parentScope,
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        createdAt: NOW,
      },
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(authz.ok && authz.value.grant && authz.value.commitToken).toBeTruthy();
    if (!authz.ok || !authz.value.grant || !authz.value.commitToken) return;

    const commit = await gateway.commit({
      preparedAction: prepared.value,
      grantId: authz.value.grant.id,
      commitToken: authz.value.commitToken,
      agentId: "agent-1",
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        product: "fg-container",
        quantity: 500,
      },
      actionNodeId: rt.actionNodeId,
      authorityNodeId: rt.authNodeId,
      now: NOW,
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(commit.value.status).toBe("SUCCESS");

    const after = await outcomes.getContract(oc.value.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.paymentStatus).toBe("SUCCESS");
    expect(after.value.state).toBe("AWAITING_OUTCOME");
    expect(after.value.state).not.toBe("SATISFIED");
  });

  it("legacy unbound factory is explicitly named and not production default", async () => {
    const rt = await makeRuntime();
    const legacy = TwoPhaseGateway.createForUnboundLegacyTests({
      intents: rt.intents,
      authority: rt.authority,
      provenance: rt.provenance,
    });
    const prepared = await legacy.prepare({
      action: rt.action,
      verdict: rt.verdict,
      principalId: "principal-1",
      toolId: "payment.execute",
      agentCapabilities: rt.parentScope.capabilities,
      externalState: {
        merchant: "approved-a",
        amount: 700000,
        currency: "INR",
        product: "fg-container",
        quantity: 500,
      },
      idempotencyKey: "legacy-unbound",
      expiresAt: FUTURE,
      createdAt: NOW,
    });
    expect(prepared.ok).toBe(true);
  });
});
