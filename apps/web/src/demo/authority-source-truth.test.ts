import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The bug this pins: a judge-facing Authority surface reading the *overall*
 * workflow state.
 *
 * BLOCKED is reachable from any stage — verification, planning, Guardian — so
 * treating it as an Authority artifact made the rail claim Authority had
 * returned BLOCKED on runs where Authority was never reached, contradicting the
 * Governance Report on the same screen.
 *
 * AUTHORIZED and AWAITING_APPROVAL are different: they are only reachable
 * *through* Authority, so they remain legitimate evidence that it ran.
 */

const read = (file: string) =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

/** Strip comments so prose about the bug is not mistaken for the bug. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("no judge-facing surface derives Authority from overall workflow state", () => {
  it("the rail's authorityKnown never consults a blocked workflow state", () => {
    const source = code(read("live-stage-rail.ts"));
    const block = /const authorityKnown =([\s\S]*?);/.exec(source)?.[1] ?? "";
    expect(block, "authorityKnown must exist").not.toBe("");
    expect(block).toContain("input.authorityDecision");
    for (const forbidden of ["BLOCKED_WORKFLOW_STATES", '"BLOCKED"', '"DENIED"', '"REJECTED"']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });

  it("the Authority rail row takes its detail only from a real decision", () => {
    const source = code(read("live-stage-rail.ts"));
    const authoritySeed = /id: "authority",[\s\S]*?\n    \},/.exec(source)?.[0] ?? "";
    expect(authoritySeed, "authority seed must exist").not.toBe("");
    expect(authoritySeed).toContain("input.authorityDecision");
    expect(authoritySeed).not.toContain("workflowState");
  });

  it("the Authority stage card shows no workflow-state row", () => {
    const source = code(read("LiveDemoPage.tsx"));
    const card = /title="Authority"[\s\S]*?details=\{[^}]*\}\s*\/>/.exec(source)?.[0] ?? "";
    expect(card, "Authority StageCard must exist").not.toBe("");
    expect(card).not.toContain("run.workflow.state");
    expect(card).not.toContain('label: "Workflow state"');
    // And it reads the Authority artifact, not the Guardian evaluation blob.
    expect(card).toContain("authorityDecision");
  });

  it("the Guardian stage card reads the Guardian aggregator, not Authority", () => {
    const source = code(read("LiveDemoPage.tsx"));
    const card = /title="Guardian"[\s\S]*?details=\{[^}]*\}\s*\/>/.exec(source)?.[0] ?? "";
    expect(card, "Guardian StageCard must exist").not.toBe("");
    expect(card).toContain("guardianAggregator");
    expect(card).not.toContain("run.workflow.state");
  });

  it("the Governance Report's execution result never falls back to a pipeline phase", () => {
    const source = code(read("liveWorkflowTruth.ts"));
    const block = /const executionResult =([\s\S]*?);/.exec(source)?.[1] ?? "";
    expect(block, "executionResult must exist").not.toBe("");
    expect(block).toContain("input.workflow.execution?.status");
    expect(block).toContain("input.commit?.status");
    // PROPOSE is a stage the run reached, not evidence the action ran.
    expect(block).not.toContain("phase");
  });

  it("the summary only accepts through-Authority states as evidence Authority ran", () => {
    const source = code(read("live-run-summary.ts"));
    const block = /const authorityRanPerState =([\s\S]*?);/.exec(source)?.[1] ?? "";
    expect(block, "authorityRanPerState must exist").not.toBe("");
    expect(block).toContain("AUTHORIZED");
    expect(block).toContain("AWAITING_APPROVAL");
    for (const forbidden of ['"BLOCKED"', '"DENIED"', '"REJECTED"']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});
