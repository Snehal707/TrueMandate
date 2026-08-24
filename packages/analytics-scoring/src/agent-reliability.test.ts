import { describe, expect, it } from "vitest";
import {
  computeAgentReliabilityScore,
  createAgentReliabilityProposal,
} from "./agent-reliability.js";
import { MIN_AGENT_WORKFLOWS, NEUTRAL_SCORE } from "./thresholds.js";

const AT = "2026-08-21T12:00:00.000Z";

describe("computeAgentReliabilityScore", () => {
  it("high-quality agent (0 interventions, 10 workflows) → reliability 1.0", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-good", interventionCount: 0, workflowCount: 10 },
      AT,
    );
    expect(signal.subjectType).toBe("AGENT");
    expect(signal.subjectId).toBe("agent-good");
    expect(signal.value).toBe(1.0);
    expect(signal.sampleSize).toBe(10);
    expect(signal.basis).toContain("guardian_interventions:0");
    expect(signal.basis).toContain("workflows_observed:10");
    expect(signal.basis.some((b) => b.startsWith("insufficient_evidence"))).toBe(
      false,
    );
  });

  it("low-quality agent (8 interventions, 10 workflows) → reliability 0.2", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-bad", interventionCount: 8, workflowCount: 10 },
      AT,
    );
    expect(signal.value).toBeCloseTo(0.2, 6);
    expect(signal.sampleSize).toBe(10);
  });

  it("caps reliability at 0 when interventions exceed workflows", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-worst", interventionCount: 20, workflowCount: 5 },
      AT,
    );
    expect(signal.value).toBe(0);
  });

  it("insufficient evidence (2 workflows) → neutral 0.5", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-new", interventionCount: 0, workflowCount: 2 },
      AT,
    );
    expect(signal.value).toBe(NEUTRAL_SCORE);
    expect(signal.sampleSize).toBe(2);
    expect(signal.basis).toContain(
      `insufficient_evidence:need_${MIN_AGENT_WORKFLOWS}`,
    );
  });

  it("zero workflows → neutral 0.5, sampleSize 0", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-empty", interventionCount: 0, workflowCount: 0 },
      AT,
    );
    expect(signal.value).toBe(NEUTRAL_SCORE);
    expect(signal.sampleSize).toBe(0);
  });

  it("exactly MIN_AGENT_WORKFLOWS is confident", () => {
    const signal = computeAgentReliabilityScore(
      {
        agentKey: "agent-edge",
        interventionCount: 1,
        workflowCount: MIN_AGENT_WORKFLOWS,
      },
      AT,
    );
    expect(signal.value).toBeCloseTo(1 - 1 / MIN_AGENT_WORKFLOWS, 6);
    expect(
      signal.basis.some((b) => b.startsWith("insufficient_evidence")),
    ).toBe(false);
  });
});

describe("createAgentReliabilityProposal", () => {
  it("wraps TrustSignal into AGENT_RELIABILITY draft", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "agent-a", interventionCount: 1, workflowCount: 10 },
      AT,
    );
    const draft = createAgentReliabilityProposal(signal, {
      id: "lp-agent-a",
      principalId: "principal-1",
    });
    expect(draft.proposalType).toBe("AGENT_RELIABILITY");
    expect(draft.content.trustSignal).toEqual(signal);
    expect(draft.domain).toBe("procurement");
    expect(draft.createdAt).toBe(AT);
  });

  it("rejects non-AGENT subjectType", () => {
    const signal = computeAgentReliabilityScore(
      { agentKey: "a", interventionCount: 0, workflowCount: 10 },
      AT,
    );
    expect(() =>
      createAgentReliabilityProposal(
        { ...signal, subjectType: "COUNTERPARTY" },
        { id: "x", principalId: "p" },
      ),
    ).toThrow(/AGENT/);
  });
});
