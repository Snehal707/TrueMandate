/**
 * RFC 8785-style JSON Canonicalization Scheme (JCS).
 * - Objects: lexicographically sorted keys, no insignificant whitespace
 * - Arrays: element order preserved
 * - Numbers: JSON number serialization (finite only; -0 → 0)
 * - Strings: JSON string escaping; Unicode code units preserved (no NFC rewrite)
 * - null / boolean: literal forms
 *
 * See docs/architecture/phase-1-2-assumptions.md.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function escapeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const ch = value[i]!;
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default:
        if (code < 0x20) {
          out += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          out += ch;
        }
    }
  }
  out += '"';
  return out;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("canonicalize: non-finite numbers are not allowed");
  }
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function canonicalize(value: unknown): string {
  if (value === undefined) {
    throw new Error("canonicalize: undefined is not allowed");
  }
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t === "boolean") {
    return value ? "true" : "false";
  }
  if (t === "number") {
    return serializeNumber(value as number);
  }
  if (t === "string") {
    return escapeString(value as string);
  }
  if (t === "bigint" || t === "symbol" || t === "function") {
    throw new Error(`canonicalize: unsupported type ${t}`);
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => canonicalize(item));
    return `[${parts.join(",")}]`;
  }
  if (t === "object") {
    if (value instanceof Date || value instanceof Map || value instanceof Set) {
      throw new Error("canonicalize: Date/Map/Set are not allowed");
    }
    if (!isPlainObject(value)) {
      throw new Error("canonicalize: non-plain objects are not allowed");
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) {
        continue;
      }
      parts.push(`${escapeString(key)}:${canonicalize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported type ${t}`);
}
