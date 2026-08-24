import { afterEach, describe, expect, it, vi } from "vitest";
import { VertexGeminiModel } from "./vertex-gemini.js";

describe("VertexGeminiModel.fromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("is inactive when VERTEX_PROJECT is unset", () => {
    delete process.env.VERTEX_PROJECT;
    const result = VertexGeminiModel.fromEnv();
    expect(result.ok).toBe(false);
  });

  it("constructs from VERTEX_PROJECT without printing tokens", () => {
    process.env.VERTEX_PROJECT = "elite-crossbar-505104-t9";
    process.env.VERTEX_LOCATION = "us-central1";
    process.env.GEMINI_MODEL = "gemini-2.0-flash-001";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "ya29.secret-must-not-log";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = VertexGeminiModel.fromEnv();
    expect(result.ok).toBe(true);
    const printed = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    expect(printed).not.toContain("ya29.secret-must-not-log");
    expect(printed).not.toMatch(/Bearer /);
  });
});
