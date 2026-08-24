import { describe, expect, it } from "vitest";
import {
  buildGovernedSdkAdkToolset,
  TRUE_MANDATE_ADK_TOOL_NAMES,
} from "./governed-sdk-tools.js";
import type { GovernedAdkCore } from "./types.js";

function makeCore(overrides: Partial<GovernedAdkCore> = {}): GovernedAdkCore {
  return {
    recordIntent: async () => ({
      ok: true,
      value: {
        id: "intent-1",
        principalId: "user-1",
        rawText: "buy something",
        createdAt: "2026-08-21T00:00:00.000Z",
        contentHash: "hash-1",
      },
    }),
    readCanonicalProjection: async () => ({
      ok: true,
      value: {
        meta: {
          projectionKind: "canonical-phase-c-v5-live-read",
          readOnly: true,
        },
        intent: {
          id: "intent-1",
          rawText: "buy something",
          contentHash: "hash-1",
        },
        authority: { decision: "ALLOW" },
        execution: { resultState: "SUCCESS" },
        outcome: { state: "SATISFIED", divergence: "NONE" },
        resolution: { state: "CLOSED" },
      } as never,
    }),
    submitWorkflow: async () => ({
      ok: true,
      value: {
        workflowId: "wf-1",
        state: "AUTHORIZED",
        execution: { status: "AUTHORIZED" },
      },
    }),
    readWorkflow: async () => ({
      ok: true,
      value: {
        workflowId: "wf-1",
        state: "AUTHORIZED",
        execution: { status: "AUTHORIZED" },
      },
    }),
    resumeWorkflow: async () => ({
      ok: true,
      value: {
        workflowId: "wf-1",
        state: "AUTHORIZED",
        approval: { id: "approval-1", status: "APPROVED" },
        execution: { status: "AUTHORIZED" },
      },
    }),
    readApproval: async () => ({
      ok: true,
      value: {
        id: "approval-1",
        workflowId: "wf-1",
        intentId: "intent-1",
        intentStateId: "state-1",
        status: "PENDING",
        requestedCapability: "execute_payment",
        requestedScope: {
          amount: 742000,
          currency: "INR",
          merchant: "approved-supplier",
        },
        requestedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
      },
    }),
    decideApproval: async () => ({
      ok: true,
      value: {
        id: "approval-1",
        workflowId: "wf-1",
        intentId: "intent-1",
        intentStateId: "state-1",
        status: "APPROVED",
        requestedCapability: "execute_payment",
        requestedScope: {
          amount: 742000,
          currency: "INR",
          merchant: "approved-supplier",
        },
        requestedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        decision: "APPROVE",
      },
    }),
    submitEvidence: async () => ({
      ok: true,
      value: { id: "evidence-request-1" },
    }),
    readEvidence: async () => ({
      ok: true,
      value: {
        id: "evidence-1",
        source: "merchant",
        contentHash: "hash",
        trustClass: "EXTERNAL",
        captureTime: "2026-08-21T00:00:00.000Z",
      },
    }),
    readOutcome: async () => ({
      ok: true,
      value: {
        id: "outcome-1",
        workflowId: "wf-1",
        intentId: "intent-1",
        intentStateId: "state-1",
        domain: "procurement",
        state: "AWAITING_OUTCOME",
        paymentStatus: "SUCCESS",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    }),
    readResolutionCase: async () => ({
      ok: true,
      value: {
        id: "rc-1",
        contractId: "outcome-1",
        intentId: "intent-1",
        intentStateId: "state-1",
        openedAt: "2026-08-21T00:00:00.000Z",
        responsibilityState: "UNKNOWN",
        state: "OPEN",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    }),
    readResolutionByOutcome: async () => ({
      ok: true,
      value: {
        id: "rc-1",
        contractId: "outcome-1",
        intentId: "intent-1",
        intentStateId: "state-1",
        openedAt: "2026-08-21T00:00:00.000Z",
        responsibilityState: "UNKNOWN",
        state: "OPEN",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    }),
    ...overrides,
  };
}

describe("sdk-adk governed lifecycle tools", () => {
  it("exposes the exact governed tool set, including the existing record and canonical reads", () => {
    const toolset = buildGovernedSdkAdkToolset({ core: makeCore() });
    expect(toolset.tools.map((tool) => tool.name)).toEqual([
      ...TRUE_MANDATE_ADK_TOOL_NAMES,
    ]);
  });

  it("uses generic workflow input rather than procurement-shaped top-level fields", async () => {
    const toolset = buildGovernedSdkAdkToolset({ core: makeCore() });
    const submitWorkflow = toolset.submitWorkflow;

    const success = await submitWorkflow.execute({
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        deliveryTerms: "deliver before 2026-12-30",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: { packId: "procurement", payload: {} },
      idempotencyKey: "wf-1",
    });
    expect(JSON.parse(success)).toMatchObject({
      ok: true,
      submitted: true,
      workflow: { workflowId: "wf-1" },
    });

    const failClosed = await submitWorkflow.execute({
      intent: { kind: "REFERENCE", intentId: "intent-1" },
      action: {
        capability: "execute_payment",
        merchant: "approved-supplier",
        product: "food-grade containers",
        quantity: 500,
        amount: 742000,
        currency: "INR",
        parameters: {},
        consequenceLevel: "HIGH",
      },
      domain: { packId: "procurement", payload: {} },
      supplier: { id: "should-not-be-here" },
      idempotencyKey: "wf-1",
    });
    expect(JSON.parse(failClosed)).toMatchObject({
      ok: false,
      code: "SCHEMA_PARSE_FAILED",
    });
  });

  it("maps approval, evidence, outcome, and resolution tools to governed lifecycle calls", async () => {
    const toolset = buildGovernedSdkAdkToolset({ core: makeCore() });

    expect(
      JSON.parse(
        await toolset.resumeWorkflow.execute({
          workflowId: "wf-1",
          approvalId: "approval-1",
        }),
      ),
    ).toMatchObject({
      ok: true,
      resumed: true,
      workflow: { workflowId: "wf-1" },
    });

    expect(
      JSON.parse(
        await toolset.decideApproval.execute({
          approvalId: "approval-1",
          decision: "APPROVE",
        }),
      ),
    ).toMatchObject({
      ok: true,
      decided: true,
      approval: { id: "approval-1", status: "APPROVED" },
    });

    expect(
      JSON.parse(
        await toolset.readOutcome.execute({ outcomeContractId: "outcome-1" }),
      ),
    ).toMatchObject({
      ok: true,
      outcome: { id: "outcome-1" },
    });

    expect(
      JSON.parse(
        await toolset.readResolutionByOutcome.execute({
          outcomeContractId: "outcome-1",
        }),
      ),
    ).toMatchObject({
      ok: true,
      resolution: { id: "rc-1" },
    });
  });

  it("fails closed if a governed read leaks privileged fields", async () => {
    const toolset = buildGovernedSdkAdkToolset({
      core: makeCore({
        readWorkflow: async () => ({
          ok: true,
          value: {
            workflowId: "wf-1",
            state: "AUTHORIZED",
            authorization: { commitToken: { id: "ct-secret" } },
          } as never,
        }),
      }),
    });

    expect(
      JSON.parse(await toolset.readWorkflow.execute({ workflowId: "wf-1" })),
    ).toMatchObject({
      ok: false,
      code: "SCHEMA_PARSE_FAILED",
    });
  });
});
