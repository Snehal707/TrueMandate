import type { PublicBffConfig } from "../config.js";
import { sendJson, type RouteHandler } from "../http.js";

export interface HealthState {
  readonly ready: boolean;
  readonly reason?: string;
  readonly probe?: () => Promise<{ ready: boolean; reason?: string }>;
}

export function createHealthHandlers(
  config: PublicBffConfig,
  state: HealthState = { ready: true },
): { healthz: RouteHandler; readyz: RouteHandler } {
  const healthz: RouteHandler = ({ res }) => {
    sendJson(res, 200, {
      status: "ok",
      service: config.serviceName,
    });
  };

  const readyz: RouteHandler = async ({ res }) => {
    const probed = state.probe
      ? await state.probe()
      : { ready: state.ready, reason: state.reason };
    if (!probed.ready) {
      sendJson(res, 503, {
        status: "not_ready",
        service: config.serviceName,
        reason: probed.reason ?? "not_ready",
      });
      return;
    }
    sendJson(res, 200, {
      status: "ready",
      service: config.serviceName,
      persistence: config.persistence,
    });
  };

  return { healthz, readyz };
}
