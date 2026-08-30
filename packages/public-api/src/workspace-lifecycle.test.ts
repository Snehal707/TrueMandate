import { describe, expect, it } from "vitest";
import { EvidenceService } from "@truemandate/evidence-service";
import { ErrorCode, err, ok, type Intent, type Result } from "@truemandate/protocol";
import { createLivePublicBffPorts } from "./adapters.js";

/**
 * The workspace route previously projected no Guardian at all, so the read model
 * substituted an `UNAVAILABLE` placeholder on every run — and a UI reading it
 * concluded Guardian was where the workflow stopped. It must never synthesize
 * that from a projection gap again.
 *
 * `getWorkspace` now accepts an optional `workflowId`. It is a hint, never a
 * credential: the returned artifacts' own `intentId` — set once, at creation, by
 * the engine, never by this read path — is what gets trusted. A caller cannot
 * pair their own intentId with someone else's workflowId and see that
 * workflow's state.
 */

const INTENT: Intent = {
  id: "intent-1",
  principalId: "principal-1" as Intent["principalId"],
  rawText: "Buy 500 food-grade containers from an approved supplier under INR 800000",
  createdAt: "2026-08-21T12:00:00.000Z",
  contentHash: "hash-stub",
} as Intent;

type Row = { kind: string; intentId: string; payload: Record<string, unknown> };

function bound(intentId: string, rows: Omit<Row, "intentId">[]): Row[] {
  return rows.map((row) => ({ ...row, intentId }));
}

function ports(
  listWorkflowArtifacts?: (workflowId: string) => Result<readonly unknown[]>,
  getOutcomeContract?: (id: string) => Result<unknown>,
) {
  return createLivePublicBffPorts({
    intentCreate: { createIntent: () => ok(INTENT) },
    workspaceSource: {
      getIntent: async () => ok(INTENT),
      getTip: async () =>
        ok({ id: "state-1", intentId: "intent-1", constraints: [], stateHash: "h", version: 1, createdAt: INTENT.createdAt, createdBy: "owner" } as never),
      ...(listWorkflowArtifacts ? { listWorkflowArtifacts: async (workflowId: string) => listWorkflowArtifacts(workflowId) } : {}),
    },
    evidence: new EvidenceService(),
    ...(getOutcomeContract ? { outcomeRead: { getOutcomeContract: async (id: string) => getOutcomeContract(id) } } : {}),
  });
}

const EXECUTION_AUTHORIZED_AWAITING_COMMIT = (intentId: string) => bound(intentId, [
  { kind: "PROOF", payload: { status: "SATISFIED", method: "authoritative-proof-handoff", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: true } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  // The immutable WORKFLOW snapshot is frozen here -- exactly as observed live --
  // even though EXECUTION_AUTHORIZATION below proves the workflow reached and
  // passed Authority.
  { kind: "WORKFLOW", payload: { state: "AUTHORITY_EVALUATION" } },
  {
    kind: "EXECUTION_AUTHORIZATION",
    payload: {
      commitTokenId: "ct-1",
      preparedActionId: "prep-1",
      grantId: "grant-1",
      outcomeContractId: "outcome-1",
    },
  },
]);

const AUTHORIZED = (intentId: string) => bound(intentId, [
  { kind: "PROOF", payload: { status: "SATISFIED", method: "authoritative-proof-handoff", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: true } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  { kind: "WORKFLOW", payload: { state: "AUTHORIZED" } },
  { kind: "OUTCOME_CONTRACT", payload: { id: "outcome-1" } },
]);

const FIDELITY_BLOCKED = (intentId: string) => bound(intentId, [
  { kind: "PROOF", payload: { status: "SATISFIED", method: "authoritative-proof-handoff", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: false } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  { kind: "WORKFLOW", payload: { state: "BLOCKED" } },
]);

const MISSING_PROOF = (intentId: string) => bound(intentId, [
  { kind: "PROOF", payload: { status: "UNKNOWN", method: "authoritative-proof-handoff-absent", constraintId: "c-qty" } },
  { kind: "PLAN", payload: { plan: { steps: [] } } },
  { kind: "PLAN_VERIFICATION", payload: { verification: { status: "VERIFIED" } } },
  { kind: "ACTION", payload: { deterministicActionFidelity: { preservesIntent: true } } },
  { kind: "GUARDIAN", payload: { verdict: { decision: "ALLOW", semanticStatus: "CLEAR", criticalFailure: false, judgeResults: [] } } },
  { kind: "WORKFLOW", payload: { state: "BLOCKED" } },
]);

describe("1/2. valid intentId + matching workflowId: successful evidenced workflow", () => {
  it("projects the actual lifecycle, not the placeholder", async () => {
    const result = await ports((workflowId) => ok(AUTHORIZED("intent-1")))
      .workspaceRead.getWorkspace("intent-1", "wf-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.guardian.aggregator.decision).toBe("ALLOW");
    expect(result.value.guardian.aggregator.decision).not.toBe("UNAVAILABLE");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "authority")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "outcome")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.blockingStage).toBeUndefined();
  });
});

describe("3. action-fidelity attack workflow", () => {
  it("names action fidelity, not Guardian, and Authority as NOT_REACHED", async () => {
    const result = await ports(() => ok(FIDELITY_BLOCKED("intent-1")))
      .workspaceRead.getWorkspace("intent-1", "wf-attack");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.blockingStage).toBe("actionFidelity");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "authority")?.status).toBe("NOT_REACHED");
    expect(result.value.guardian.aggregator.decision).not.toBe("UNAVAILABLE");
  });
});

describe("4. missing-proof workflow", () => {
  it("blames evidence, not Guardian", async () => {
    const result = await ports(() => ok(MISSING_PROOF("intent-1")))
      .workspaceRead.getWorkspace("intent-1", "wf-noproof");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.blockingStage).toBe("evidence");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("COMPLETED");
  });
});

describe("5. workflowId belonging to another intent", () => {
  it("rejects the request and leaks nothing from the foreign workflow", async () => {
    // The workflow's artifacts are all bound to "intent-OTHER" — a different
    // intent than the one being requested.
    const result = await ports(() => ok(AUTHORIZED("intent-OTHER")))
      .workspaceRead.getWorkspace("intent-1", "wf-foreign");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
    // Not merely "no lifecycle" — an explicit rejection, and the response must
    // carry no trace of the foreign workflow's Guardian/Authority/outcome state.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ALLOW");
    expect(serialized).not.toContain("outcome-1");
  });

  it("never returns 200 with the foreign workflow silently substituted", async () => {
    const result = await ports(() => ok(AUTHORIZED("intent-OTHER")))
      .workspaceRead.getWorkspace("intent-1", "wf-foreign");
    // The one invariant that matters most: no ok:true response carrying
    // another intent's workflow state.
    if (result.ok) {
      expect(result.value.lifecycle).toBeUndefined();
    } else {
      expect(result.ok).toBe(false);
    }
  });
});

describe("6. nonexistent workflowId", () => {
  it("fails closed with the existing not-found taxonomy", async () => {
    const result = await ports(() => err(ErrorCode.VALIDATION_FAILED, "Unknown workflow", {}))
      .workspaceRead.getWorkspace("intent-1", "wf-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("also fails closed when the lookup succeeds but returns no rows", async () => {
    const result = await ports(() => ok([]))
      .workspaceRead.getWorkspace("intent-1", "wf-empty");
    expect(result.ok).toBe(false);
  });
});

describe("7. omitted workflowId: legacy response unchanged", () => {
  it("assembles exactly as before when no workflowId is supplied, even though the port is wired", async () => {
    const result = await ports(() => ok(AUTHORIZED("intent-1")))
      .workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle).toBeUndefined();
    expect(result.value.guardian.aggregator.decision).toBe("UNAVAILABLE");
  });

  it("assembles exactly as before when the port itself is entirely absent", async () => {
    const result = await ports().workspaceRead.getWorkspace("intent-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle).toBeUndefined();
    expect(result.value.guardian.aggregator.decision).toBe("UNAVAILABLE");
  });
});

describe("historical workflow with an incomplete artifact set", () => {
  it("survives a workflow missing newer artifact kinds", async () => {
    const result = await ports(() => ok(bound("intent-1", [{ kind: "WORKFLOW", payload: { state: "AUTHORIZED" } }])))
      .workspaceRead.getWorkspace("intent-1", "wf-historical");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "guardian")?.status).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.blockingStage).toBeUndefined();
  });
});

describe("8. redaction guarantees remain intact", () => {
  it("exposes no token, grant, credential or model internal, matched or mismatched workflow", async () => {
    for (const rows of [AUTHORIZED("intent-1"), AUTHORIZED("intent-OTHER")]) {
      const result = await ports(() => ok(rows)).workspaceRead.getWorkspace("intent-1", "wf-1");
      const serialized = JSON.stringify(result).toLowerCase();
      for (const forbidden of ["committoken", "commit_token", "grantid", "nonce", "credential", "privatekey", "promptversion"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});

describe("9. workflow frozen at an early state, but EXECUTION_AUTHORIZATION proves Authority granted", () => {
  it("reports Authority ALLOW and PreparedAction completed even though the WORKFLOW snapshot never advanced", async () => {
    const result = await ports((workflowId) => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")))
      .workspaceRead.getWorkspace("intent-1", "wf-frozen");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.authority?.decision).toBe("ALLOW");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "authority")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "preparedAction")?.status).toBe("COMPLETED");
  });

  it("does not also claim execution or outcome without an outcomeRead port wired", async () => {
    const result = await ports((workflowId) => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")))
      .workspaceRead.getWorkspace("intent-1", "wf-frozen");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.stages.find((s) => s.stage === "execution")?.status).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("10. execution confirmed end-to-end via the outcome contract", () => {
  it("fetches the OutcomeContract by the id recorded on EXECUTION_AUTHORIZATION and completes execution and outcome", async () => {
    const result = await ports(
      () => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")),
      (id) => {
        expect(id).toBe("outcome-1");
        return ok({ id, state: "RESOLVED", paymentStatus: "SUCCESS" });
      },
    ).workspaceRead.getWorkspace("intent-1", "wf-committed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.stages.find((s) => s.stage === "execution")?.status).toBe("COMPLETED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "outcome")?.status).toBe("COMPLETED");
  });
});

describe("11. outcome contract exists but payment has not resolved yet", () => {
  it("completes outcome but does not claim execution completed while payment is still pending", async () => {
    const result = await ports(
      () => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")),
      (id) => ok({ id, state: "AWAITING_OUTCOME", paymentStatus: "PENDING" }),
    ).workspaceRead.getWorkspace("intent-1", "wf-pending");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.stages.find((s) => s.stage === "execution")?.status).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "outcome")?.status).toBe("COMPLETED");
  });
});

describe("12. outcome contract lookup fails", () => {
  it("degrades to NOT_REACHED/NOT_PRODUCED rather than throwing or faking success", async () => {
    const result = await ports(
      () => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")),
      () => err(ErrorCode.VALIDATION_FAILED, "Unknown outcome contract", {}),
    ).workspaceRead.getWorkspace("intent-1", "wf-lookup-failed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lifecycle?.stages.find((s) => s.stage === "execution")?.status).toBe("NOT_REACHED");
    expect(result.value.lifecycle?.stages.find((s) => s.stage === "outcome")?.status).toBe("NOT_PRODUCED");
  });
});

describe("13. redaction guarantees hold for the new EXECUTION_AUTHORIZATION-derived fields", () => {
  it("exposes no commit token, grant, or prepared-action id from EXECUTION_AUTHORIZATION or the outcome contract", async () => {
    const result = await ports(
      () => ok(EXECUTION_AUTHORIZED_AWAITING_COMMIT("intent-1")),
      (id) => ok({ id, state: "RESOLVED", paymentStatus: "SUCCESS" }),
    ).workspaceRead.getWorkspace("intent-1", "wf-committed");
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["ct-1", "prep-1", "grant-1", "committoken", "commit_token", "grantid", "credential", "privatekey"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
