import type { IncomingMessage, ServerResponse } from "node:http";
import type { Result } from "@truemandate/protocol";
import { ErrorCode } from "@truemandate/protocol";

export interface RouteContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly params: Record<string, string>;
  readonly body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.end(payload);
}

export function sendResult<T>(res: ServerResponse, result: Result<T>): void {
  if (result.ok) {
    sendJson(res, 200, result.value);
    return;
  }
  const detailStatus =
    typeof result.details?.status === "number" &&
    result.details.status >= 400 &&
    result.details.status <= 599
      ? result.details.status
      : undefined;
  const status =
    result.code === ErrorCode.SCHEMA_PARSE_FAILED
      ? 400
      : detailStatus ?? (result.details?.retryable === true ? 503 : 422);
  sendJson(res, status, {
    error: {
      code: result.code,
      message: result.message,
      details: result.details ?? {},
    },
  });
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

export function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

export function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
}
