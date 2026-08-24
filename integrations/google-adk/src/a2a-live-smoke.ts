import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  createAuthenticatingFetchWithRetry,
  type AuthenticationHandler,
} from "@a2a-js/sdk/client";
import { Role, TaskState } from "@a2a-js/sdk";

/**
 * STAGE 2 LIVE SMOKE — one authenticated real A2A/ADK request:
 *   A2A client -> authenticated ADK Cloud Run -> ADK Runner -> Vertex
 *   Gemini (gemini-3.7-flash, ADC/service identity) ->
 *   true_mandate_canonical_proof -> existing read-only TrueMandate proof.
 *
 * The prompt directs ONLY the canonical-proof tool; zero-write proof comes
 * from (a) the response content and (b) the service logs showing no
 * recordIntent execution. No credentials or tokens are printed.
 *
 * Env: A2A_SERVICE_URL, A2A_SMOKE_TOKEN (identity token for the service).
 */
async function main(): Promise<void> {
  const serviceUrl = (process.env.A2A_SERVICE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.A2A_SMOKE_TOKEN ?? "";
  if (!serviceUrl || !token) {
    throw new Error("A2A_SERVICE_URL and A2A_SMOKE_TOKEN are required");
  }

  const auth: AuthenticationHandler = {
    headers: async () => ({ Authorization: `Bearer ${token}` }),
    shouldRetryWithHeaders: async () => undefined,
  };
  const fetchImpl = createAuthenticatingFetchWithRetry(fetch, auth);
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory({ fetchImpl })],
    // The A2A service is fully authenticated (card route included), so card
    // resolution must use the authenticated fetch too.
    cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
  });

  const client = await factory.createFromUrl(serviceUrl);
  const result = await client.sendMessage({
    message: {
      messageId: "stage2-smoke-1",
      contextId: "",
      taskId: "",
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: "text", value: "Read the TrueMandate canonical proof using your canonical proof tool. Do not record anything." },
          metadata: undefined,
          filename: "",
          mediaType: "text/plain",
        },
      ],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
    tenant: "",
    configuration: undefined,
    metadata: undefined,
  });

  let taskState = "unknown";
  let text = "";
  if ("status" in result && result.status) {
    taskState = String(result.status.state);
    text = collectText(result.status.message?.parts ?? []);
  }
  if ("artifacts" in result) {
    for (const a of result.artifacts ?? []) text += collectText(a.parts);
  }

  const semantic = {
    authorityAllow: /ALLOW/.test(text),
    paymentSuccess: /SUCCESS/.test(text),
    outcomePartial: /PARTIAL/.test(text),
    required500: /500/.test(text),
    received450: /450/.test(text),
    resolutionOpen: /OPEN/.test(text),
  };
  const success =
    taskState === String(TaskState.TASK_STATE_COMPLETED) &&
    Object.values(semantic).every(Boolean);

  console.log(
    JSON.stringify(
      {
        serviceUrl,
        taskState,
        success,
        semantic,
        textExcerpt: text.slice(0, 500),
      },
      null,
      2,
    ),
  );
  if (!success) process.exitCode = 1;
}

function collectText(parts: readonly { content?: unknown }[]): string {
  let out = "";
  for (const p of parts) {
    const c = p.content as { $case?: string; value?: unknown } | undefined;
    if (c?.$case === "text" && typeof c.value === "string") out += c.value;
  }
  return out;
}

main().catch((error) => {
  console.error("A2A SMOKE FAILED:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
