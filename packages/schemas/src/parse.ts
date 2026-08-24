import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";
import type { z } from "zod";
import {
  ProtocolSchemas,
  type ProtocolSchemaName,
} from "./registry.js";

export type ProtocolObject<K extends ProtocolSchemaName> = z.infer<
  (typeof ProtocolSchemas)[K]
>;

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  label = "payload",
): Result<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return err(ErrorCode.SCHEMA_PARSE_FAILED, `${label} failed schema validation`, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return ok(parsed.data);
}

export function parseProtocolObject<K extends ProtocolSchemaName>(
  name: K,
  payload: unknown,
): Result<ProtocolObject<K>> {
  const schema = ProtocolSchemas[name] as z.ZodType<ProtocolObject<K>>;
  return parseWithSchema(schema, payload, name);
}

export function validateEnvelope(
  name: ProtocolSchemaName,
  payload: unknown,
): Result<unknown> {
  return parseProtocolObject(name, payload);
}
