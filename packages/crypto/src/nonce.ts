import { randomBytes } from "node:crypto";
import { asNonce, type Nonce } from "@truemandate/protocol";

export function generateNonce(bytes = 16): Nonce {
  return asNonce(randomBytes(bytes).toString("hex"));
}

export {
  InMemoryNonceStore,
  NonceRegistry,
  type NonceStore,
} from "./stores.js";
