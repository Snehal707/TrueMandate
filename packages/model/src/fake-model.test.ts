import { ErrorCode } from "@truemandate/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeModel } from "./fake-model.js";

const SampleSchema = z.object({ goal: z.string() }).strict();

describe("FakeModel", () => {
  it("returns schema-valid structured output", async () => {
    const model = new FakeModel({
      handlers: {
        sample: async () => ({ goal: "buy containers" }),
      },
    });
    const result = await model.generateStructured({
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value.goal).toBe("buy containers");
  });

  it("fails closed on malformed structured output", async () => {
    const model = new FakeModel({
      handlers: {
        sample: async () => ({ goal: 123 }),
      },
    });
    const result = await model.generateStructured({
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.MODEL_OUTPUT_INVALID);
      expect(result.details?.retryable).toBe(true);
    }
  });

  it("fails closed when unavailable", async () => {
    const model = new FakeModel({ unavailable: true });
    const result = await model.generateStructured({
      modelId: "fake",
      promptVersion: "v1",
      schemaId: "sample",
      schemaVersion: "1",
      schema: SampleSchema,
      systemInstruction: "test",
      userPayload: {},
      requestId: "r3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ErrorCode.MODEL_UNAVAILABLE);
  });
});
