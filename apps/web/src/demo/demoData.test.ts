import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDemoProjection } from "./demoData";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

/**
 * Start Demo is read-only: exactly one GET to the canonical demo route,
 * validation of the projection, and — on any failure — the embedded frozen
 * snapshot with a subtle judge-facing notice. No writes, no other calls.
 */

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>) {
  const calls: { method?: string; url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String((input as Request).url);
      calls.push({ method: (init as RequestInit | undefined)?.method ?? "GET", url });
      return impl(input, init);
    },
  );
  return calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("loadDemoProjection (Start Demo data path)", () => {
  it("performs exactly one GET to the canonical demo route and returns live", async () => {
    const calls = stubFetch(async () => jsonResponse(200, CANONICAL_PHASE_C_V5));
    const state = await loadDemoProjection();
    expect(state.status).toBe("ready");
    if (state.status === "ready") {
      expect(state.source).toBe("live");
      expect(state.projection.outcome.divergence).toEqual({
        requiredQuantity: 500,
        verifiedReceived: 450,
        shortfall: 50,
        evidenceClaimIds: ["phase-c-claim-v5-quantity_received"],
      });
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/v1/demo/canonical-phase-c-v5" });
  });

  it("falls back to the frozen snapshot on HTTP failure with subtle copy", async () => {
    stubFetch(async () => jsonResponse(503, { error: "unavailable" }));
    const state = await loadDemoProjection();
    expect(state.status).toBe("unavailable");
    if (state.status === "unavailable") {
      expect(state.source).toBe("snapshot");
      expect(state.detail).toBe("Live proof temporarily unavailable.");
      expect(state.fallback.meta.projectionKind).toBe("canonical-phase-c-v5-frozen");
    }
  });

  it("never surfaces raw parser errors in judge-facing copy", async () => {
    stubFetch(async () =>
      new Response("<!doctype html><html>gateway error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = await loadDemoProjection();
    expect(state.status).toBe("unavailable");
    if (state.status === "unavailable") {
      expect(state.detail).toBe("Live proof temporarily unavailable.");
      expect(state.detail).not.toContain("<!doctype");
      expect(state.detail).not.toContain("Unexpected token");
    }
    // technical detail went to the console, not the UI
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("validates the response shape before accepting it", async () => {
    stubFetch(async () => jsonResponse(200, { hello: "world" }));
    const state = await loadDemoProjection();
    expect(state.status).toBe("unavailable");
  });

  it("never calls POST, PUT, or any internal service URL", async () => {
    const calls = stubFetch(async () => jsonResponse(200, CANONICAL_PHASE_C_V5));
    await loadDemoProjection();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).not.toContain("agent-runtime");
    expect(calls[0]?.url).not.toContain("gateway");
    expect(calls[0]?.url).not.toContain("firestore");
  });
});
