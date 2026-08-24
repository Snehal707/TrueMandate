import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config.js";

describe("runtime caller configuration", () => {
  it("keeps governed workflow commit callers separate from raw execution callers", () => {
    const config = loadRuntimeConfig({
      TM_REQUIRE_CONFIG: "false",
      TM_WORKFLOW_COMMIT_CALLER_EMAILS: "public-bff@example.test",
      TM_EXECUTION_CALLER_EMAIL: "phase-b@example.test,phase-c@example.test",
    });

    expect(config.workflowCommitCallerEmails).toEqual(["public-bff@example.test"]);
    expect(config.executionCallerEmails).toEqual([
      "phase-b@example.test",
      "phase-c@example.test",
    ]);
    expect(config.executionCallerEmails).not.toContain("public-bff@example.test");
  });
});
