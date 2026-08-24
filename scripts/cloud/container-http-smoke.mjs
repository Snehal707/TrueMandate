#!/usr/bin/env node
/**
 * Local container HTTP smoke: /healthz, /readyz, /internal/events.
 * No live GCP writes. Override persistence to memory.
 *
 * Usage:
 *   node scripts/cloud/container-http-smoke.mjs --image IMAGE [--events]
 */
import { spawnSync } from "node:child_process";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const image = arg("--image");
const enableEvents = process.argv.includes("--events");
if (!image) {
  console.error("container-http-smoke: --image is required");
  process.exit(2);
}

const name = `tm-smoke-${Date.now()}`;
const env = [
  "-e",
  "TM_PERSISTENCE=memory",
  "-e",
  "TM_REQUIRE_CONFIG=true",
  "-e",
  "GOOGLE_CLOUD_PROJECT=elite-crossbar-505104-t9",
  "-e",
  "TM_SERVICE_NAME=intent-provenance",
  "-e",
  "TM_MODEL_ARMOR_TEMPLATE=projects/elite-crossbar-505104-t9/locations/us-central1/templates/tm-dev-prompt-response",
  "-e",
  "VERTEX_PROJECT=elite-crossbar-505104-t9",
  "-e",
  "VERTEX_LOCATION=global",
  "-e",
  "GEMINI_MODEL=gemini-3.7-flash",
  "-e",
  "PORT=8080",
];

const run = spawnSync(
  "docker",
  ["run", "-d", "--name", name, "-p", "18080:8080", ...env, image],
  { encoding: "utf8" },
);
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}

function cleanup() {
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
}

try {
  let healthy = false;
  for (let i = 0; i < 30; i += 1) {
    const health = spawnSync("curl", ["-s", "-o", "/tmp/tm-health.json", "-w", "%{http_code}", "http://127.0.0.1:18080/healthz"], {
      encoding: "utf8",
    });
    if ((health.stdout ?? "").trim() === "200") {
      healthy = true;
      break;
    }
    spawnSync("sleep", ["1"]);
  }
  if (!healthy) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    console.error("container-http-smoke: /healthz never returned 200");
    console.error(logs.stdout || logs.stderr);
    cleanup();
    process.exit(1);
  }

  if (enableEvents) {
    const malformed = spawnSync(
      "curl",
      [
        "-s",
        "-o",
        "/tmp/tm-events.json",
        "-w",
        "%{http_code}",
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "-d",
        "{not-json",
        "http://127.0.0.1:18080/internal/events",
      ],
      { encoding: "utf8" },
    );
    if ((malformed.stdout ?? "").trim() !== "400") {
      console.error("container-http-smoke: expected 400 for malformed events, got", malformed.stdout);
      cleanup();
      process.exit(1);
    }
  }

  console.log(`container-http-smoke: ok (${image})`);
  cleanup();
} catch (err) {
  cleanup();
  console.error(err);
  process.exit(1);
}
