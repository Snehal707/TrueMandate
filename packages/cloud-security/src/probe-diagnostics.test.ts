import { describe, expect, it, vi } from "vitest";
import { ModelArmorAdapter } from "./model-armor-adapter.js";

const TEMPLATE = "projects/test-project/locations/us-central1/templates/test-template";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function fetchError(code: string): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = { code };
  return err;
}

describe("Model Armor startup probe diagnostics", () => {
  it("keeps startup success for a healthy probe without emitting diagnostics", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => jsonResponse(200, { sanitizationResult: { filterMatchState: "NO_MATCH_FOUND" } })) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(true);
    expect(adapter.lastProbeDiagnostic).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails closed with a DNS classification and sanitized diagnostic output", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "secret-token-value",
      fetchImpl: (async () => { throw fetchError("ENOTFOUND"); }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(false);
    const diagnostic = adapter.lastProbeDiagnostic;
    expect(diagnostic?.classification).toBe("DNS_RESOLUTION");
    expect(diagnostic?.causeCode).toBe("ENOTFOUND");
    expect(diagnostic?.hostname).toContain("modelarmor.us-central1.rep.googleapis.com");
    expect(typeof diagnostic?.elapsedMs).toBe("number");
    const emitted = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(emitted).toContain("model_armor_probe_failed");
    expect(emitted).toContain("DNS_RESOLUTION");
    // No credentials, prompts, or token material may ever be logged.
    expect(emitted).not.toContain("secret-token-value");
    expect(emitted).not.toContain("Bearer");
    expect(emitted).not.toContain("health-probe");
    errorSpy.mockRestore();
  });

  it("classifies auth (401) and API (503) HTTP failures separately and fail-closed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const authAdapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => jsonResponse(401, { error: { message: "unauthorized" } })) as unknown as typeof fetch,
    });
    expect(await authAdapter.probe()).toBe(false);
    expect(authAdapter.lastProbeDiagnostic?.classification).toBe("AUTH");
    expect(authAdapter.lastProbeDiagnostic?.httpStatus).toBe(401);

    const apiAdapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => jsonResponse(503, { error: { message: "backend" } })) as unknown as typeof fetch,
    });
    expect(await apiAdapter.probe()).toBe(false);
    expect(apiAdapter.lastProbeDiagnostic?.classification).toBe("API_ERROR");
    expect(apiAdapter.lastProbeDiagnostic?.httpStatus).toBe(503);

    const noToken = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => undefined,
      fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch,
    });
    expect(await noToken.probe()).toBe(false);
    expect(noToken.lastProbeDiagnostic?.classification).toBe("AUTH");

    const malformed = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new Error("malformed json"); },
      } as unknown as Response)) as unknown as typeof fetch,
    });
    expect(await malformed.probe()).toBe(false);
    expect(malformed.lastProbeDiagnostic?.classification).toBe("MALFORMED_RESPONSE");
    errorSpy.mockRestore();
  });

  it("classifies connection-refused failures without leaking error messages", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => { throw fetchError("ECONNREFUSED"); }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(false);
    expect(adapter.lastProbeDiagnostic?.classification).toBe("CONNECTION");
    const emitted = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(emitted).not.toContain("fetch failed");
    errorSpy.mockRestore();
  });
});
