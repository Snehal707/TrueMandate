import { ErrorCode, JudgeId, JudgeInvocationStatus, err } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { invokeJudge } from "./invoke.js";

describe("judge invocation budgets", () => {
  it("maps an exhausted required model budget to a fail-closed timeout", async () => {
    const result = await invokeJudge({
      judgeId: JudgeId.FIDELITY,
      model: {
        generateStructured: async () => err(
          ErrorCode.MODEL_UNAVAILABLE,
          "deadline exhausted",
          { reason: "MODEL_DEADLINE_EXCEEDED" },
        ),
      },
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "judge.fidelity.v1",
      schemaVersion: "1",
      systemInstruction: "safe",
      userPayload: {},
      requestId: "judge-timeout",
    });

    expect(result.status).toBe(JudgeInvocationStatus.TIMEOUT);
    expect(result.findings).toEqual([]);
  });
});
