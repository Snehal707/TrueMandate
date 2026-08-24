import { createHash } from "node:crypto";
import { asHashDigest, type HashDigest } from "@truemandate/protocol";
import { canonicalize } from "./canonicalize.js";

export function sha256Hex(input: string | Uint8Array): HashDigest {
  const hash = createHash("sha256");
  hash.update(input);
  return asHashDigest(hash.digest("hex"));
}

export function hashCanonical(value: unknown): HashDigest {
  return sha256Hex(canonicalize(value));
}
