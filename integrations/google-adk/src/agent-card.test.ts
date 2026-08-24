import { describe, expect, it } from "vitest";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultAgentCardResolver } from "@a2a-js/sdk/client";
import { buildAgentCard } from "./agent-card.js";

describe("A2A 1.0 Agent Card", () => {
  const card = buildAgentCard("https://tm-agent.example");

  it("declares the exact A2A discovery path constant", () => {
    expect(AGENT_CARD_PATH).toBe(".well-known/agent-card.json");
  });

  it("carries all required A2A 1.0 fields", () => {
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.description.length).toBeGreaterThan(0);
    expect(card.version).toBe("1.0.0");
    expect(card.supportedInterfaces).toHaveLength(1);
    expect(card.supportedInterfaces[0]).toMatchObject({
      url: "https://tm-agent.example/a2a",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card.capabilities).toBeDefined();
    expect(card.defaultInputModes).toContain("text/plain");
    expect(card.defaultOutputModes).toContain("text/plain");
    expect(card.skills.length).toBeGreaterThan(0);
  });

  it("names the PLATFORM, not the proof scenario", () => {
    expect(card.name).toBe("TrueMandate Governance Agent");
    expect(card.description).toContain("Procurement is the canonical proof scenario");
    expect(card.description).not.toContain("procurement reference agent");
  });

  it("serializes the security metadata in the canonical A2A 1.0 wire shape", () => {
    const raw = JSON.stringify(card);
    const parsed = JSON.parse(raw) as {
      securitySchemes: {
        cloudRunIdentity: {
          httpAuthSecurityScheme: {
            description: string;
            scheme: string;
            bearerFormat: string;
          };
        };
      };
      securityRequirements: { schemes: { cloudRunIdentity: { list: string[] } } }[];
    };
    expect(raw).not.toContain("$case");
    expect(parsed.securitySchemes.cloudRunIdentity.httpAuthSecurityScheme).toMatchObject({
      scheme: "Bearer",
      bearerFormat: "JWT",
    });
    expect(parsed.securitySchemes.cloudRunIdentity.httpAuthSecurityScheme.description).toContain(
      "Google Cloud Run IAM identity token",
    );
    expect(parsed.securitySchemes.cloudRunIdentity.httpAuthSecurityScheme.description).toContain(
      "roles/run.invoker",
    );
    expect(parsed.securitySchemes.cloudRunIdentity.httpAuthSecurityScheme.description).toContain(
      "No allUsers",
    );
    expect(parsed.securityRequirements).toEqual([
      { schemes: { cloudRunIdentity: { list: [] } } },
    ]);
    expect(() =>
      new DefaultAgentCardResolver().normalizeAgentCard(JSON.parse(raw)),
    ).not.toThrow();
    expect(raw).not.toContain("oauth2");
    expect(raw).not.toContain("openIdConnect");
    expect(raw).not.toContain("clientCredentials");
  });

  it("every skill has the required id/name/description/tags", () => {
    for (const skill of card.skills) {
      expect(skill.id.length).toBeGreaterThan(0);
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });

  it("stays under the 10 KB Agent Registry card limit", () => {
    const json = JSON.stringify(card);
    expect(json.length).toBeLessThan(10 * 1024);
  });

  it("advertises zero direct execution capability and no privileged handles", () => {
    const json = JSON.stringify(card).toLowerCase();
    expect(json).not.toContain("execute_payment");
    expect(json).not.toContain("raw gateway commit");
    expect(json).not.toContain("authoritygrant");
    expect(json).not.toContain("preparedaction");
    expect(json).not.toContain("committoken");
    expect(json).not.toContain("/internal/");
    const skillIds = card.skills.map((s) => s.id);
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
    expect(card.skills.some((s) => s.id === "canonical-proof" && s.inputModes.length === 0)).toBe(
      true,
    );
  });

  it("describes the generic workflow lifecycle across registered packs and custom intent", () => {
    expect(card.description).toContain(
      "procurement, travel, SaaS/IT spend, invoice/vendor payment, logistics/fulfillment, and custom intent",
    );
    expect(card.description).toContain("same generic workflow surface");
  });

  it("is deterministic for a given base URL", () => {
    expect(JSON.stringify(buildAgentCard("https://tm-agent.example"))).toBe(JSON.stringify(card));
  });
});
