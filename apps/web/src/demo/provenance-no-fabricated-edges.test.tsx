import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ProvenancePage } from "./ProvenancePage";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * Provenance truth: every rendered canonical id must appear verbatim in the
 * canonical projection. No fabricated edges, no synthesized ids — friendly
 * labels are presentation copy, ids are metadata.
 */

const projectionJson = JSON.stringify(CANONICAL_PHASE_C_V5);

describe("provenance — no fabricated edges", () => {
  const html = renderToString(<ProvenancePage projection={CANONICAL_PHASE_C_V5} />);

  it("renders the five story stages over the 10 durable records", () => {
    expect(html).toContain("The canonical journey of one governed action");
    for (const stage of ["INTENT", "SEMANTIC GOVERNANCE", "ECONOMIC AUTHORIZATION", "EXECUTION &amp; OUTCOME", "RESOLUTION"]) {
      expect(html, `stage ${stage}`).toContain(stage);
    }
    for (const node of [
      "Human Intent",
      "Intent State",
      "Guardian Verdict",
      "Authority Evaluation",
      "Authority Grant",
      "Prepared Action",
      "Commit Token",
      "Execution",
      "Outcome Contract",
      "Resolution Case",
    ]) {
      expect(html, `node ${node}`).toContain(node);
    }
  });

  it("renders the record inspector with the authority punchline by default", () => {
    expect(html).toContain("RECORD INSPECTOR");
    expect(html).toContain("The bounded permission was computed from the verified semantic chain");
    expect(html).toContain("Authorization is computed, bounded and expiring");
  });

  it("every rendered canonical id exists verbatim in the projection", () => {
    // Node raw ids + inspector durable-record ids render inside <code>.
    const ids = [...html.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map((m) => m[1]!);
    const publicIds = ids.filter((id) => !id.startsWith("Private internal"));
    expect(publicIds.length).toBeGreaterThanOrEqual(7);
    for (const id of publicIds) {
      expect(
        projectionJson.includes(id),
        `rendered id not present in the canonical projection: ${id}`,
      ).toBe(true);
    }
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.execution.commitTokenId);
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.authority.grantId);
    expect(html).not.toContain(CANONICAL_PHASE_C_V5.preparedAction.id);
  });

  it("claims no human approval and no synthesized edges", () => {
    expect(html).not.toContain("Human approved");
    expect(html).not.toContain("gate satisfied");
    expect(html).toContain("Ten durable records");
  });

  it("shows friendly meaning first and statuses with semantic color classes", () => {
    expect(html).toContain("st-green");
    expect(html).toContain("st-amber");
    expect(html).toContain("st-blue");
    expect(html).toContain("Payment succeeded — but the goal was measured");
  });
});
