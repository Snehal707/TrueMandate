#!/usr/bin/env node
/**
 * Live ADC smoke for gemini-3.7-flash. One harmless deterministic JSON request.
 * Does not print tokens. Not a benchmark.
 */
import { spawnSync } from "node:child_process";
import { vertexGenerateContentUrl } from "../../packages/model/dist/vertex-gemini.js";

const project =
  process.env.VERTEX_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "elite-crossbar-505104-t9";
const location = process.env.VERTEX_LOCATION ?? "global";
const model = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";
const endpoint = vertexGenerateContentUrl(project, location, model);

const token = spawnSync("gcloud", ["auth", "print-access-token"], {
  encoding: "utf8",
  shell: true,
}).stdout.trim();
if (!token) {
  console.error(JSON.stringify({ ok: false, error: "No ADC access token" }));
  process.exit(1);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Reply with JSON only: {\"ok\":true,\"ping\":\"pong\"}. No other text.",
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  }),
});

if (!response.ok) {
  console.error(
    JSON.stringify({
      ok: false,
      model,
      location,
      endpoint,
      httpStatus: response.status,
    }),
  );
  process.exit(1);
}

const body = (await response.json());
const parts = body?.candidates?.[0]?.content?.parts ?? [];
const text = parts
  .filter((p) => !p.thought && typeof p.text === "string")
  .map((p) => p.text)
  .join("")
  .trim();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      model,
      location,
      endpoint,
      error: "Response was not JSON",
    }),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: parsed?.ok === true,
    model,
    modelVersion: body.modelVersion,
    location,
    endpoint,
    httpSuccess: true,
    schemaOk: parsed?.ping === "pong",
  }),
);
