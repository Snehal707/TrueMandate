import { describe, expect, it } from "vitest";
import { demoScenarioTemplate } from "./templates.js";

describe("demo SaaS fixture contract", () => {
  it("explicitly names Business Plan and keeps evidence plus actions aligned", () => {
    const template = demoScenarioTemplate("saas_it_spend");
    expect(template).toBeDefined();

    const evidencePlan = template!.evidenceClaims.find((claim) => claim.concept === "plan_name");
    expect(template!.rawText).toContain("Business Plan");
    expect(template!.rawText).toContain("approved vendor");
    expect(evidencePlan?.value).toBe("Business Plan");
    expect(template!.variants.control?.product).toBe("Business Plan");
    expect(template!.variants.renewal_flip?.product).toBe("Business Plan");
  });

  it("keeps renewal_flip scoped to the MANUAL to AUTO mutation only", () => {
    const template = demoScenarioTemplate("saas_it_spend");
    expect(template).toBeDefined();

    const control = template!.variants.control!;
    const attack = template!.variants.renewal_flip!;

    expect(attack.capability).toBe(control.capability);
    expect(attack.merchant).toBe(control.merchant);
    expect(attack.product).toBe(control.product);
    expect(attack.quantity).toBe(control.quantity);
    expect(attack.amount).toBe(control.amount);
    expect(attack.currency).toBe(control.currency);
    expect(attack.deliveryTerms).toBe(control.deliveryTerms);
    expect(attack.consequenceLevel).toBe(control.consequenceLevel);
    expect(attack.parameters.termMonths).toBe(control.parameters.termMonths);
    expect(attack.parameters.seatCount).toBe(control.parameters.seatCount);
    expect(control.parameters.renewalSetting).toBe("MANUAL");
    expect(attack.parameters.renewalSetting).toBe("AUTO");
  });
});
