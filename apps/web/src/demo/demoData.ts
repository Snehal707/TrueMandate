/**
 * Demo data provider.
 *
 * Read-only by construction:
 *   - preferred live source: GET /v1/demo/canonical-phase-c-v5 (same-origin;
 *     in production the web proxy forwards /v1/* to the Public BFF with the
 *     service identity — the browser never touches Firestore);
 *   - offline fallback: the frozen canonical projection embedded in this
 *     bundle (see canonical-phase-c-v5.ts for provenance) — an intentional
 *     resilience fallback, clearly surfaced as "Canonical snapshot".
 *
 * This module contains no mutation surface: there is no "Run demo" that
 * touches canonical Phase A / Phase B v6 / Phase C v5 records.
 */

import type { CanonicalProjection } from "@truemandate/read-model";
import { CANONICAL_PHASE_C_V5 } from "./canonical-phase-c-v5";

export type DemoDataSource = "live" | "snapshot";

export type DemoLoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly source: DemoDataSource; readonly projection: CanonicalProjection }
  | {
      readonly status: "unavailable";
      readonly detail: string;
      readonly source: "snapshot";
      readonly fallback: CanonicalProjection;
    };

/**
 * Optional absolute API override (build-time Vite env). When unset, the
 * relative same-origin path is used — resolved by the web proxy at runtime
 * (PUBLIC_BFF_URL), not baked into the bundle.
 */
const LIVE_API_OVERRIDE = import.meta.env?.VITE_DEMO_API_URL as string | undefined;

const LIVE_PATH = "/v1/demo/canonical-phase-c-v5";

function isCanonicalProjection(value: unknown): value is CanonicalProjection {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { meta?: { projectionKind?: unknown } }).meta?.projectionKind;
  return kind === "canonical-phase-c-v5-frozen" || kind === "canonical-phase-c-v5-live-read";
}

/**
 * Loads the demo projection. Live same-origin read first; on any failure the
 * embedded frozen canonical snapshot is used (never synthetic data).
 */
export async function loadDemoProjection(
  signal?: AbortSignal,
): Promise<DemoLoadState> {
  const endpoint = LIVE_API_OVERRIDE
    ? `${LIVE_API_OVERRIDE}/v1/demo/canonical-phase-c-v5`
    : LIVE_PATH;

  /** Judge-facing copy only — raw fetch/parser errors never reach the UI. */
  const UNAVAILABLE = "Live proof temporarily unavailable.";

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      signal,
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch (parseError) {
        // Non-JSON body (e.g. an HTML error page) — technical detail is
        // logged for developers, never surfaced to judges.
        console.warn("demo live read: non-JSON response", parseError);
        return {
          status: "unavailable",
          detail: UNAVAILABLE,
          source: "snapshot",
          fallback: CANONICAL_PHASE_C_V5,
        };
      }
      if (isCanonicalProjection(body)) {
        return { status: "ready", source: "live", projection: body };
      }
      console.warn("demo live read: unexpected response shape");
      return {
        status: "unavailable",
        detail: UNAVAILABLE,
        source: "snapshot",
        fallback: CANONICAL_PHASE_C_V5,
      };
    }
    console.warn(`demo live read: HTTP ${res.status}`);
    return {
      status: "unavailable",
      detail: UNAVAILABLE,
      source: "snapshot",
      fallback: CANONICAL_PHASE_C_V5,
    };
  } catch (error) {
    console.warn("demo live read: fetch failed", error);
    return {
      status: "unavailable",
      detail: UNAVAILABLE,
      source: "snapshot",
      fallback: CANONICAL_PHASE_C_V5,
    };
  }
}
