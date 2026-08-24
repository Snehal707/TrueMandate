import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildTrueMandateTools, ROOT_AGENT_INSTRUCTION } from "./agent.js";
import { buildAgentCard } from "./agent-card.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dirPath: string): string[] {
  const out: string[] = [];
  if (!statSync(dirPath, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dirPath)) {
    const p = path.join(dirPath, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("ADK integration cannot execute economics", () => {
  it("source has no internal routes, no S2S imports, no economic tool registrations", () => {
    for (const file of walk(path.join(dir, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}: no internal routes`).not.toMatch(/\/internal\//);
      expect(src, `${file}: no internal runtime imports`).not.toMatch(
        /^import .*@truemandate\/(sdk-core|gateway-service|authority-service|cloud-runtime|outcome-service|resolution-service)/m,
      );
      expect(src, `${file}: no economic tool registration`).not.toMatch(
        /name:\s*["'](payment\.execute|purchase\.non_refundable)["']/,
      );
      expect(src, `${file}: no FunctionTool economic surface`).not.toMatch(
        /FunctionTool\(\{\s*name:\s*["'](pay|execute|purchase)/,
      );
    }
  });

  it("exposes the governed TrueMandate lifecycle tools and nothing domain-specific", () => {
    const { tools } = buildTrueMandateTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "true_mandate_canonical_proof",
      "true_mandate_decide_approval",
      "true_mandate_read_approval",
      "true_mandate_read_evidence",
      "true_mandate_read_outcome",
      "true_mandate_read_resolution_by_outcome",
      "true_mandate_read_resolution_case",
      "true_mandate_read_workflow",
      "true_mandate_record_intent",
      "true_mandate_resume_workflow",
      "true_mandate_submit_evidence",
      "true_mandate_submit_workflow",
    ]);
    expect(tools.map((t) => t.name)).not.toContain("true_mandate_commit_workflow");
    expect(tools.map((t) => t.name)).not.toContain("buy_containers");
    expect(tools.map((t) => t.name)).not.toContain("book_travel");
  });

  it("the agent instruction states the governed no-bypass stance explicitly", () => {
    expect(ROOT_AGENT_INSTRUCTION).toContain("NO AuthorityGrant surface");
    expect(ROOT_AGENT_INSTRUCTION).toContain("NO raw Gateway commit surface");
    expect(ROOT_AGENT_INSTRUCTION).toContain(
      "TrueMandate infrastructure authorizes execution",
    );
    expect(ROOT_AGENT_INSTRUCTION).toContain(
      "never bypass Guardian, Adaptive Authority, approval or monitoring,",
    );
    expect(ROOT_AGENT_INSTRUCTION).toContain("PREPARE, AUTHORIZE, COMMIT");
  });

  it("depends only on sdk-adk from the TrueMandate workspace", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const tmDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@truemandate/"));
    expect(tmDeps).toEqual(["@truemandate/sdk-adk"]);
  });

  it("keeps the A2A card workflow-centric, domain-neutral, and explicit about lifecycle reads and writes", () => {
    const card = buildAgentCard("https://tm-agent.example");
    expect(card.description).toContain("custom intent");
    expect(card.description).toContain("same generic workflow surface");
    expect(card.description).not.toContain("workflow commit");
    const skillIds = card.skills.map((skill) => skill.id);
    expect(skillIds).toEqual([
      "intent-record",
      "canonical-proof",
      "workflow-submit",
      "workflow-read",
      "workflow-resume",
      "approval-read",
      "approval-decide",
      "evidence-submit-read",
      "outcome-read",
      "resolution-read",
    ]);
    expect(JSON.stringify(card)).not.toContain("AuthorityGrant");
    expect(JSON.stringify(card)).not.toContain("PreparedAction");
    expect(JSON.stringify(card)).not.toContain("CommitToken");
    expect(JSON.stringify(card)).not.toContain("/internal/");
  });
});
