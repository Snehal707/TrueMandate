import express from "express";
import { InMemorySessionService, Runner } from "@google/adk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { rootAgent } from "./agent.js";
import { buildAgentCard } from "./agent-card.js";
import { TrueMandateA2AExecutor } from "./a2a-executor.js";

/**
 * A2A 1.0 server for the TrueMandate governed reference agent.
 *
 *   GET  /.well-known/agent-card.json  -> A2A Agent Card (discovery)
 *   POST /a2a                          -> A2A 1.0 JSON-RPC (SendMessage, …)
 *
 * Local run (Vertex AI + ADC, no API key):
 *   GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT=elite-crossbar-505104-t9 \
 *   GOOGLE_CLOUD_LOCATION=global TM_PUBLIC_BASE_URL=<url> npx tsx src/server.ts
 *
 * Production note: the card's supportedInterfaces[0].url must be a public
 * HTTPS URL for Agent Registry registration; A2A_BASE_URL overrides the
 * advertised base (default: http://localhost:8000).
 *
 * A2A 1.0 correctness: @google/adk@1.6.0 bundles @a2a-js/sdk ^0.3.10, so
 * its own A2A bridge still advertises 0.3. This server pairs the ADK Runner
 * with a native 1.0 AgentExecutor (see a2a-executor.ts) and serves an A2A
 * 1.0 card + JSON-RPC handler from @a2a-js/sdk@1.0.1.
 */
export function createA2AServer() {
  const baseUrl = process.env.A2A_BASE_URL ?? "http://localhost:8000";
  const card = buildAgentCard(baseUrl);
  const taskStore = new InMemoryTaskStore();

  const runner = new Runner({
    agent: rootAgent,
    appName: "truemandate-governed-agent",
    sessionService: new InMemorySessionService(),
  });
  const executor = new TrueMandateA2AExecutor(runner);

  const requestHandler = new DefaultRequestHandler(card, taskStore, executor);

  const app = express();
  app.use(express.json());
  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: requestHandler }));
  app.use("/a2a", jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return { app, card };
}

const isDirect =
  process.argv[1] !== undefined &&
  /google-adk[\\/]+(?:src|dist)[\\/]+server\.(ts|js)$/.test(process.argv[1]);

if (isDirect) {
  const port = Number(process.env.PORT ?? 8000);
  const { app } = createA2AServer();
  app.listen(port, () => {
    console.log(
      `TrueMandate A2A agent listening on :${port} (card at /.well-known/agent-card.json)`,
    );
  });
}
