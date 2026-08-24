#!/usr/bin/env node
/**
 * Secret readiness preflight — metadata only.
 * Never prints or returns secret payloads.
 *
 * Usage:
 *   node scripts/cloud/secret-preflight.mjs --project ID --prefix tm-dev [--secrets a,b,c]
 */
import { spawnSync } from "node:child_process";

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const project = arg("--project", process.env.GOOGLE_CLOUD_PROJECT ?? "");
const prefix = arg("--prefix", "tm-dev");
const secretList = arg("--secrets", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!project) {
  console.error("secret-preflight: --project is required");
  process.exit(2);
}

const isWin = process.platform === "win32";
const gcloudBin = isWin ? "gcloud.cmd" : "gcloud";

const missing = [];
for (const id of secretList) {
  const secretId = id.startsWith(prefix) ? id : `${prefix}-${id}`;
  const result = spawnSync(
    gcloudBin,
    [
      "secrets",
      "versions",
      "list",
      secretId,
      `--project=${project}`,
      "--filter=state=ENABLED",
      "--limit=1",
      "--format=value(name)",
    ],
    { encoding: "utf8", shell: isWin },
  );
  const name = (result.stdout ?? "").trim();
  if (result.status !== 0 || !name) {
    missing.push(secretId);
  }
}

if (missing.length > 0) {
  console.error(
    `secret-preflight: missing ENABLED versions for: ${missing.join(", ")}`,
  );
  console.error(
    "Add versions out of band (never via Terraform secret_data): gcloud secrets versions add SECRET --data-file=...",
  );
  process.exit(1);
}

console.log(`secret-preflight: ok (${secretList.length} secrets have ENABLED versions)`);
