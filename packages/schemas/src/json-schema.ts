import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ProtocolSchemas,
  type ProtocolSchemaName,
} from "./registry.js";

export function toJsonSchema(name: ProtocolSchemaName): Record<string, unknown> {
  const schema = ProtocolSchemas[name];
  return zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function allJsonSchemas(): Record<ProtocolSchemaName, Record<string, unknown>> {
  const out = {} as Record<ProtocolSchemaName, Record<string, unknown>>;
  for (const name of Object.keys(ProtocolSchemas) as ProtocolSchemaName[]) {
    out[name] = toJsonSchema(name);
  }
  return out;
}

/**
 * Convert a Zod schema to a plain JSON Schema object with no $ref graph.
 * Used as the input to provider-specific sanitizers (e.g. Vertex responseSchema).
 */
export function zodToPlainJsonSchema(
  schema: z.ZodTypeAny,
  name = "Schema",
): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  }) as Record<string, unknown>;

  if (
    typeof raw.$ref === "string" &&
    raw.definitions &&
    typeof raw.definitions === "object"
  ) {
    const refName = raw.$ref.replace(/^#\/definitions\//, "");
    const defs = raw.definitions as Record<string, unknown>;
    const resolved = defs[refName];
    if (resolved && typeof resolved === "object") {
      return { ...(resolved as Record<string, unknown>) };
    }
  }

  const { $schema: _schema, definitions: _defs, ...rest } = raw;
  return rest;
}
