import type { z } from "zod";
import { zodToPlainJsonSchema } from "@truemandate/schemas";

/** Vertex OpenAPI-subset keywords for responseSchema. */
const VERTEX_KEYS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "anyOf",
  "maximum",
  "minimum",
  "maxItems",
  "minItems",
  "nullable",
  "description",
  "format",
  "propertyOrdering",
]);

const JSON_VALUE_ANYOF = [
  { type: "string" },
  { type: "number" },
  { type: "integer" },
  { type: "boolean" },
  { type: "object" },
  { type: "array", items: {} },
  { type: "null" },
] as const;

export interface VertexSchemaConversion {
  readonly responseSchema: Record<string, unknown>;
  readonly strippedKeywords: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeType(type: unknown): string | string[] | undefined {
  if (typeof type === "string") return type;
  if (Array.isArray(type) && type.every((t) => typeof t === "string")) {
    return type as string[];
  }
  return undefined;
}

/**
 * Sanitize a JSON Schema node into Vertex's OpenAPI responseSchema subset.
 * Strips unsupported keywords; fails closed on unresolved $ref.
 */
export function sanitizeForVertexResponseSchema(
  node: unknown,
  stripped: string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(node)) {
    throw new Error("Vertex responseSchema root must be an object schema");
  }
  if (typeof node.$ref === "string") {
    throw new Error(`Unsupported unresolved $ref in Vertex schema: ${node.$ref}`);
  }

  // Empty schema (often from z.unknown()) → explicit JSON value anyOf.
  const keys = Object.keys(node).filter(
    (k) => k !== "$schema" && k !== "definitions" && k !== "$id" && k !== "title",
  );
  if (keys.length === 0) {
    stripped.push("(empty→anyOf)");
    return { anyOf: [...JSON_VALUE_ANYOF] };
  }

  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(node)) {
    if (
      key === "$schema" ||
      key === "definitions" ||
      key === "$id" ||
      key === "title" ||
      key === "additionalProperties" ||
      key === "default" ||
      key === "examples" ||
      key === "minLength" ||
      key === "maxLength" ||
      key === "pattern" ||
      key === "exclusiveMinimum" ||
      key === "exclusiveMaximum" ||
      key === "uniqueItems" ||
      key === "const"
    ) {
      stripped.push(key);
      continue;
    }
    if (!VERTEX_KEYS.has(key) && key !== "type" && key !== "properties" && key !== "items" && key !== "anyOf" && key !== "enum" && key !== "required" && key !== "description" && key !== "format" && key !== "nullable" && key !== "minimum" && key !== "maximum" && key !== "minItems" && key !== "maxItems") {
      stripped.push(key);
      continue;
    }

    if (key === "const") {
      stripped.push("const");
      continue;
    }

    if (key === "type") {
      const t = normalizeType(value);
      if (Array.isArray(t)) {
        const nonNull = t.filter((x) => x !== "null");
        if (t.includes("null") && nonNull.length === 1) {
          out.type = nonNull[0];
          out.nullable = true;
        } else if (nonNull.length === 1) {
          out.type = nonNull[0];
        } else {
          out.anyOf = t.map((x) =>
            x === "null" ? { type: "null" } : { type: x },
          );
        }
      } else if (t) {
        out.type = t;
      }
      continue;
    }

    if (key === "properties" && isPlainObject(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = sanitizeForVertexResponseSchema(propSchema, stripped);
      }
      out.properties = props;
      out.propertyOrdering = Object.keys(props);
      continue;
    }

    if (key === "items") {
      out.items = isPlainObject(value)
        ? sanitizeForVertexResponseSchema(value, stripped)
        : value;
      continue;
    }

    if (key === "anyOf" && Array.isArray(value)) {
      out.anyOf = value.map((branch) =>
        sanitizeForVertexResponseSchema(branch, stripped),
      );
      continue;
    }

    if (key === "enum" && Array.isArray(value)) {
      // Vertex only supports string enums.
      if (value.every((v) => typeof v === "string")) {
        out.enum = value;
      } else {
        stripped.push("enum(non-string)");
      }
      continue;
    }

    if (key === "required" && Array.isArray(value)) {
      out.required = value.filter((v) => typeof v === "string");
      continue;
    }

    if (VERTEX_KEYS.has(key)) {
      out[key] = value;
    } else {
      stripped.push(key);
    }
  }

  // Nullable via anyOf [{type:T},{type:null}] → type + nullable.
  if (Array.isArray(out.anyOf) && !out.type) {
    const branches = out.anyOf as Record<string, unknown>[];
    const nullBranch = branches.find((b) => b.type === "null");
    const nonNull = branches.filter((b) => b.type !== "null");
    if (nullBranch && nonNull.length === 1 && typeof nonNull[0]!.type === "string") {
      const merged = { ...nonNull[0]! };
      merged.nullable = true;
      delete out.anyOf;
      Object.assign(out, merged);
    }
  }

  if (
    out.type === "object" &&
    isPlainObject(out.properties) &&
    !Array.isArray(out.propertyOrdering)
  ) {
    out.propertyOrdering = Object.keys(out.properties as object);
  }

  return out;
}

export function zodToVertexResponseSchema(
  schema: z.ZodTypeAny,
  name = "StructuredOutput",
): VertexSchemaConversion {
  const plain = zodToPlainJsonSchema(schema, name);
  const strippedKeywords: string[] = [];
  const responseSchema = sanitizeForVertexResponseSchema(plain, strippedKeywords);
  if (responseSchema.type !== "object" && !responseSchema.anyOf) {
    // Root must be object for compiler/verifier outputs.
    if (!responseSchema.properties) {
      throw new Error("Vertex responseSchema must resolve to an object schema");
    }
    responseSchema.type = "object";
  }
  return {
    responseSchema,
    strippedKeywords: [...new Set(strippedKeywords)],
  };
}

/** Required top-level keys that must appear in a Vertex object schema's required/properties. */
export function vertexObjectRequiredFields(
  responseSchema: Record<string, unknown>,
): string[] {
  const required = Array.isArray(responseSchema.required)
    ? (responseSchema.required as string[])
    : [];
  return required;
}

export function vertexObjectPropertyNames(
  responseSchema: Record<string, unknown>,
): string[] {
  if (!isPlainObject(responseSchema.properties)) return [];
  return Object.keys(responseSchema.properties);
}
