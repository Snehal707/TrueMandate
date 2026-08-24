import { describe, expect, it, vi } from "vitest";
import { ModelArmorAdapter, PROBE_POLICY } from "./model-armor-adapter.js";

const TEMPLATE = "projects/test-project/locations/us-central1/templates/test-template";

function fetchError(code: string): Error {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = { code };
  return err;
}

/** AbortSignal.timeout produces a DOMException named TimeoutError. */
function fetchTimeout(): Error {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

const okResponse = (() => ({ ok: true, status: 200, json: async () => ({ sanitizationResult: { filterMatchState: "NO_MATCH_FOUND" } }) })) as unknown as typeof fetch;

describe("Model Armor startup probe bounded retry", () => {
  it("succeeds after a transient connect failure within the bounded window", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) throw fetchError("UND_ERR_CONNECT_TIMEOUT");
        return okResponse({} as RequestInfo, {} as RequestInit);
      }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(true);
    expect(calls).toBe(2);
    // The transient failure was classified CONNECTION and emitted once.
    const emitted = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(emitted).toContain('"classification":"CONNECTION"');
    expect(emitted).toContain('"attempt":1');
    expect(emitted).not.toContain("token");
    errorSpy.mockRestore();
  });

  it("succeeds when transient connect failures outlast the old three-attempt window", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => {
        calls += 1;
        if (calls <= 5) throw fetchError("UND_ERR_CONNECT_TIMEOUT");
        return okResponse({} as RequestInfo, {} as RequestInit);
      }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(true);
    // Five consecutive failures exceed the old three-attempt policy; the
    // extended bounded window keeps retrying and eventually succeeds.
    expect(calls).toBe(6);
    const emitted = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect((emitted.match(/model_armor_probe_failed/g) ?? []).length).toBe(5);
    errorSpy.mockRestore();
  });

  it("stays fail-closed when every attempt in the bounded window fails, emitting one diagnostic per attempt", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "secret-token",
      fetchImpl: (async () => { calls += 1; throw fetchError("UND_ERR_CONNECT_TIMEOUT"); }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(false);
    expect(calls).toBe(PROBE_POLICY.maxAttempts);
    expect(adapter.lastProbeDiagnostic?.classification).toBe("CONNECTION");
    const emitted = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect((emitted.match(/model_armor_probe_failed/g) ?? []).length).toBe(PROBE_POLICY.maxAttempts);
    expect(emitted).not.toContain("secret-token");
    expect(emitted).not.toContain("Bearer");
    expect(emitted).not.toContain("health-probe");
    errorSpy.mockRestore();
  });

  it("classifies explicit abort timeouts as CONNECTION", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      probeBackoffMs: 0,
      tokenProvider: async () => "token",
      fetchImpl: (async () => { throw fetchTimeout(); }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(false);
    expect(adapter.lastProbeDiagnostic?.classification).toBe("CONNECTION");
    errorSpy.mockRestore();
  });

  it("adds no delay on a successful first attempt", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    let calls = 0;
    const adapter = new ModelArmorAdapter({
      templateId: TEMPLATE,
      tokenProvider: async () => "token",
      fetchImpl: (async () => { calls += 1; return okResponse({} as RequestInfo, {} as RequestInit); }) as unknown as typeof fetch,
    });
    expect(await adapter.probe()).toBe(true);
    expect(calls).toBe(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("keeps the policy budget inside the Cloud Run startup bound and above the minute-scale window", () => {
    // Cloud Run vpc-attached startup budget: initial 10s + 12 × (10s + 3s) = 166s.
    const CLOUD_RUN_VPC_STARTUP_BUDGET_MS = 166_000;
    // Documented Direct VPC connection-establishment delay: a minute or more.
    const MINUTE_SCALE_WINDOW_MS = 60_000;
    const worstCase = (PROBE_POLICY.maxAttempts * (PROBE_POLICY.connectTimeoutMs + 500)) +
      ((PROBE_POLICY.maxAttempts - 1) * PROBE_POLICY.maxBackoffMs);
    expect(worstCase).toBeLessThanOrEqual(CLOUD_RUN_VPC_STARTUP_BUDGET_MS);
    expect(worstCase).toBeGreaterThanOrEqual(MINUTE_SCALE_WINDOW_MS);
  });
});
