import type { IntentCreatePort } from "../ports.js";
import { sendResult, type RouteHandler } from "../http.js";

export function createIntentHandler(port: IntentCreatePort): RouteHandler {
  return async ({ res, body }) => {
    const result = await Promise.resolve(port.createIntent(body));
    sendResult(res, result);
  };
}
