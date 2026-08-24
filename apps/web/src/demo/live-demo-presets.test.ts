import { describe, expect, it } from "vitest";
import { buildLiveDemoWorkflowRequest } from "./liveDemoPresets";

describe("Live Demo request fidelity", () => {
  it("binds the Travel provider identity to the action merchant", () => {
    const request = buildLiveDemoWorkflowRequest("travel");
    const payload = request.domain.payload as {
      provider: { id: string; name: string };
    };

    expect(payload.provider.id).toBe(request.action.merchant);
    expect(payload.provider.name).toBe(request.action.merchant);
  });
});
