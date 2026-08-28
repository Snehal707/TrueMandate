import { createServer, type Server } from "node:http";
import { URL } from "node:url";
import type { InternalCallerIdentityVerifier } from "@truemandate/cloud-runtime";
import {
  loadPublicBffConfig,
  type CreatePublicBffOptions,
  type PublicBffConfig,
} from "./config.js";
import { createPublicBffRouter } from "./router.js";
import type { PublicBffPorts } from "./ports.js";
import type { HealthState } from "./handlers/health.js";

export interface PublicBff {
  readonly config: PublicBffConfig;
  readonly ports: PublicBffPorts;
  readonly handleRequest: ReturnType<typeof createPublicBffRouter>;
}

export function createPublicBff(
  ports: PublicBffPorts,
  options: CreatePublicBffOptions = {},
  healthState?: HealthState,
  /** Injectable so tests can supply a fake verifier. Defaults to real
   * ADC-based Google OIDC verification (set inside createPublicBffRouter). */
  identityVerifier?: InternalCallerIdentityVerifier,
): PublicBff {
  const config = loadPublicBffConfig(options);
  const handleRequest = createPublicBffRouter(ports, config, healthState, identityVerifier);
  return { config, ports, handleRequest };
}

export interface PublicBffServer {
  readonly bff: PublicBff;
  readonly server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createPublicBffServer(
  ports: PublicBffPorts,
  options: CreatePublicBffOptions = {},
  healthState?: HealthState,
  identityVerifier?: InternalCallerIdentityVerifier,
): PublicBffServer {
  const bff = createPublicBff(ports, options, healthState, identityVerifier);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      await bff.handleRequest(req.method ?? "GET", url.pathname, req, res);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : "Internal error",
          },
        }),
      );
    }
  });

  return {
    bff,
    server,
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(bff.config.port, bff.config.host, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
