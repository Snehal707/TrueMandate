#!/usr/bin/env node
/**
 * Minimal HTTP health server for Cloud Run stubs until service HTTP is fully wired.
 * Fails closed when TM_REQUIRE_CONFIG=true and GOOGLE_CLOUD_PROJECT is missing.
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const service = process.env.TM_SERVICE_NAME ?? "unknown";
const requireConfig = process.env.TM_REQUIRE_CONFIG !== "false";
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";

if (requireConfig && !projectId.trim()) {
  console.error("Missing GOOGLE_CLOUD_PROJECT — exiting non-zero (fail closed)");
  process.exit(1);
}

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service }));
    return;
  }
  if (path === "/readyz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ready",
        service,
        persistence: process.env.TM_PERSISTENCE ?? "memory",
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND" }));
}).listen(port, host, () => {
  console.log(JSON.stringify({ msg: "health stub listening", service, port, host }));
});
