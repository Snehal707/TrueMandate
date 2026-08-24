#!/usr/bin/env node
/**
 * Generates the PUBLIC Agent Card static asset for the web surface.
 *   node scripts/demo/build-agent-card-static.mjs <deployed-a2a-base-url>
 *
 * Writes apps/web/public/.well-known/agent-card.json (vite copies public/
 * to dist; the web-proxy serves it at /.well-known/agent-card.json with
 * application/json). The card is byte-identical to the card the deployed
 * A2A service itself serves (same builder, same base URL — pinned by
 * agent-card tests). Validation: protocolVersion "1.0" (never the package
 * version), JSONRPC binding, < 10 KB, truthful skills only.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentCard } from "../../integrations/google-adk/dist/agent-card.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baseUrl = process.argv[2]?.replace(/\/+$/, "");
if (!baseUrl) {
  console.error("usage: build-agent-card-static.mjs <deployed-a2a-base-url>");
  process.exit(1);
}

const card = buildAgentCard(baseUrl);
const json = JSON.stringify(card, null, 2);

// Hard validation — the card must be a valid A2A 1.0 card.
if (!card.supportedInterfaces?.length) {
  console.error("card has no supportedInterfaces");
  process.exit(1);
}
for (const iface of card.supportedInterfaces) {
  if (iface.protocolVersion !== "1.0") {
    console.error("protocolVersion must be \"1.0\" (not the package version)");
    process.exit(1);
  }
  if (iface.protocolBinding !== "JSONRPC") {
    console.error("protocolBinding must be JSONRPC");
    process.exit(1);
  }
}
if (json.length >= 10 * 1024) {
  console.error("card exceeds the 10 KB registry limit");
  process.exit(1);
}
if (JSON.stringify(json).includes("GEMINI_API_KEY")) {
  console.error("card must embed no credentials");
  process.exit(1);
}

const outDir = path.join(root, "apps/web/public/.well-known");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "agent-card.json");
writeFileSync(outPath, `${json}\n`);
console.log("Wrote", outPath);
console.log("supportedInterfaces[0].url:", card.supportedInterfaces[0].url);
console.log("protocolVersion:", card.supportedInterfaces[0].protocolVersion);
console.log("size:", json.length, "bytes");
console.log("skills:", card.skills.map((s) => s.id).join(", "));
