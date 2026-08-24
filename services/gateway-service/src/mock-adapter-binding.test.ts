import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockPaymentAdapter } from "./mock-adapter.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("gateway payment adapter", () => {
  it("TwoPhaseGateway binds MockPaymentAdapter and does not call live processors", () => {
    const src = readFileSync(path.join(here, "two-phase.ts"), "utf8");
    expect(src).toContain("private readonly adapter = new MockPaymentAdapter()");
    expect(src).not.toMatch(/stripe|adyen|paypal|checkout\.com|square\.com/i);
    expect(src).not.toMatch(/googleapis\.com\/payments/i);
    const adapter = new MockPaymentAdapter();
    expect(typeof adapter.invoke).toBe("function");
  });
});
