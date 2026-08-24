import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { InMemorySessionService, LlmAgent, Runner, StreamingMode } from "@google/adk";
import { buildTrueMandateTools, defaultModel } from "./agent.js";

/**
 * EXACTLY ONE harmless local real ADK + Vertex smoke:
 *   ADK Runner -> Gemini through Vertex AI (ADC) -> read-only TrueMandate
 *   tool -> canonical proof inspection.
 *
 * The smoke agent carries ONLY the canonical-proof tool, so the run creates
 * zero Intent writes, zero authority effects, zero economic effects, zero
 * canonical mutations. No credentials or tokens are printed.
 *
 * Run (from integrations/google-adk):
 *   GOOGLE_GENAI_USE_VERTEXAI=true \
 *   GOOGLE_CLOUD_PROJECT=elite-crossbar-505104-t9 \
 *   GOOGLE_CLOUD_LOCATION=global \
 *   TM_PUBLIC_BASE_URL=https://tm-dev-web-o2sz2wgoma-uc.a.run.app \
 *   npx tsx src/vertex-smoke.ts
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

function pkgVersion(name: string): string {
  return JSON.parse(
    readFileSync(path.join(HERE, "..", "node_modules", name, "package.json"), "utf8"),
  ).version as string;
}

async function main(): Promise<void> {
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI !== "true") {
    throw new Error("GOOGLE_GENAI_USE_VERTEXAI must be 'true' for this smoke");
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "";
  const model = defaultModel();

  // Only the read-only tool: zero Intent writes are possible by construction.
  const { readCanonicalProof } = buildTrueMandateTools();
  const smokeAgent = new LlmAgent({
    name: "truemandate_vertex_smoke_agent",
    description: "Read-only smoke agent (canonical proof tool only).",
    model,
    instruction:
      "You run exactly one task: call true_mandate_canonical_proof to read the " +
      "canonical proof. Do not attempt any other action.",
    tools: [readCanonicalProof],
  });

  const runner = new Runner({
    agent: smokeAgent,
    appName: "truemandate-vertex-smoke",
    sessionService: new InMemorySessionService(),
  });

  const toolCalls: string[] = [];
  let finalText = "";
  for await (const event of runner.runEphemeral({
    userId: "vertex-smoke-user",
    newMessage: {
      role: "user",
      parts: [
        {
          text: "Read the TrueMandate canonical proof using your canonical proof tool.",
        },
      ],
    },
    runConfig: { streamingMode: StreamingMode.NONE },
  })) {
    for (const part of event.content?.parts ?? []) {
      if (
        typeof part === "object" &&
        part !== null &&
        "functionCall" in part &&
        typeof (part as { functionCall?: { name?: string } }).functionCall?.name === "string"
      ) {
        toolCalls.push((part as { functionCall: { name: string } }).functionCall.name);
      }
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        finalText += (part as { text: string }).text;
      }
    }
  }

  const record = {
    model,
    backend: "Vertex AI",
    location,
    project,
    authMode: "ADC",
    adkVersion: pkgVersion("@google/adk"),
    a2aVersion: pkgVersion("@a2a-js/sdk"),
    toolCalled: [...new Set(toolCalls)],
    success: toolCalls.includes("true_mandate_canonical_proof") && finalText.length > 0,
    finalTextExcerpt: finalText.slice(0, 400),
  };
  console.log(JSON.stringify(record, null, 2));
  if (!record.success) process.exitCode = 1;
}

main().catch((error) => {
  console.error("SMOKE FAILED:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
